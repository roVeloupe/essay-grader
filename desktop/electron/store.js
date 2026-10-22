'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_TEMPLATES = [
  {
    id: 'junior-default',
    name: '初中记叙文（50 分）',
    total: 50,
    stage: '初中',
    builtin: true,
    dimensions: [
      { name: '内容', max: 20, rule: '中心明确，选材具体，情感真实；有细节描写而非概括叙述。' },
      { name: '结构', max: 10, rule: '条理清楚，详略得当，首尾呼应；段落划分合理。' },
      { name: '语言', max: 15, rule: '语句通顺，用词准确，有 1-2 处生动的表达；错别字与病句按处扣分。' },
      { name: '书写与规范', max: 5, rule: '标点正确，格式规范，卷面整洁（按识别结果判断）。' }
    ],
    levels: [
      { name: '一类文', min: 45, max: 50, desc: '中心突出，材料新颖，语言生动，结构精巧。' },
      { name: '二类文', min: 38, max: 44, desc: '中心明确，材料具体，语言通顺，结构完整。' },
      { name: '三类文', min: 30, max: 37, desc: '中心基本明确，材料一般，语言基本通顺。' },
      { name: '四类文', min: 0, max: 29, desc: '中心不明或偏离题意，语病较多，结构混乱。' }
    ]
  },
  {
    id: 'senior-default',
    name: '高中议论文（60 分）',
    total: 60,
    stage: '高中',
    builtin: true,
    dimensions: [
      { name: '立意', max: 20, rule: '观点明确、准确，有思想深度，能扣住材料核心。' },
      { name: '论证', max: 20, rule: '论据充分、典型，论证有层次，分析到位，不是例子堆砌。' },
      { name: '结构', max: 10, rule: '起承转合清晰，段落之间有逻辑推进。' },
      { name: '语言', max: 10, rule: '表达准确、连贯，有一定文采；错别字与病句按处扣分。' }
    ],
    levels: [
      { name: '一类文', min: 54, max: 60, desc: '立意深刻，论证有力，结构严谨，语言有文采。' },
      { name: '二类文', min: 45, max: 53, desc: '立意准确，论证较充分，结构完整，语言通顺。' },
      { name: '三类文', min: 36, max: 44, desc: '立意基本准确，论证一般，结构基本完整。' },
      { name: '四类文', min: 0, max: 35, desc: '立意偏差或论证薄弱，结构松散，语病较多。' }
    ]
  }
];

const DEFAULT_SETTINGS = {
  model: 'opencode/deepseek-v4.1-flash-free',
  fallbackModel: 'opencode/minimax-m3.1-flash-free',
  stage: '初中',
  templateId: 'junior-default',
  concurrency: 1,
  verifyThreshold: 0.7,
  exportDir: '',
  theme: 'system',
  exportFormat: 'docx'
};

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'store.json');
    this.papersDir = path.join(dir, 'papers');
    fs.mkdirSync(this.papersDir, { recursive: true });
    this.data = this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const data = {
        settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) },
        templates: Array.isArray(raw.templates) && raw.templates.length ? raw.templates : DEFAULT_TEMPLATES,
        papers: Array.isArray(raw.papers) ? raw.papers : []
      };
      // 老版本把 Big Pickle 当兜底，但它是纯文本模型，识别阶段直接报错。
      // 升级到支持图片的 MiniMax；用户主动选过的其它模型保持不变。
      if (!data.settings.fallbackModel || data.settings.fallbackModel === 'opencode/big-pickle') {
        data.settings.fallbackModel = DEFAULT_SETTINGS.fallbackModel;
      }
      // 内置模板升级：字段合并，保留用户自定义模板
      for (const def of DEFAULT_TEMPLATES) {
        const cur = data.templates.find((t) => t.id === def.id);
        if (cur && cur.builtin) Object.assign(cur, { ...def, ...cur, dimensions: cur.dimensions?.length ? cur.dimensions : def.dimensions, levels: cur.levels?.length ? cur.levels : def.levels });
        if (!cur) data.templates.push(def);
      }
      return data;
    } catch {
      return { settings: { ...DEFAULT_SETTINGS }, templates: structuredClone(DEFAULT_TEMPLATES), papers: [] };
    }
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  get settings() { return this.data.settings; }
  get templates() { return this.data.templates; }
  get papers() { return this.data.papers; }

  updateSettings(patch) {
    Object.assign(this.data.settings, patch || {});
    this.save();
    return this.data.settings;
  }

  upsertTemplate(t) {
    const list = this.data.templates;
    const i = list.findIndex((x) => x.id === t.id);
    if (i >= 0) list[i] = { ...list[i], ...t };
    else list.push({ ...t, id: t.id || crypto.randomUUID(), builtin: false });
    this.save();
    return this.data.templates;
  }

  deleteTemplate(id) {
    this.data.templates = this.data.templates.filter((t) => t.id !== id || t.builtin);
    this.save();
    return this.data.templates;
  }

  createPaper({ name, files }) {
    const id = crypto.randomUUID();
    const dir = path.join(this.papersDir, id);
    fs.mkdirSync(dir, { recursive: true });
    const images = [];
    files.forEach((src, i) => {
      const ext = path.extname(src).toLowerCase() || '.jpg';
      const dst = path.join(dir, `page-${String(i + 1).padStart(2, '0')}${ext}`);
      fs.copyFileSync(src, dst);
      images.push(dst);
    });
    const paper = {
      id,
      name: name || path.basename(files[0] || '未命名').replace(/\.[^.]+$/, ''),
      images,
      createdAt: new Date().toISOString(),
      status: 'ready',
      stage: this.data.settings.stage,
      templateId: this.data.settings.templateId,
      title: '',
      author: '',
      sentences: [],
      authorErrors: [],
      grade: null,
      error: '',
      timing: {}
    };
    this.data.papers.unshift(paper);
    this.save();
    return paper;
  }

  updatePaper(id, patch) {
    const p = this.data.papers.find((x) => x.id === id);
    if (!p) return null;
    Object.assign(p, patch);
    this.save();
    return p;
  }

  deletePaper(id) {
    this.data.papers = this.data.papers.filter((p) => p.id !== id);
    try { fs.rmSync(path.join(this.papersDir, id), { recursive: true, force: true }); } catch {}
    this.save();
  }
}

module.exports = { Store, DEFAULT_TEMPLATES, DEFAULT_SETTINGS };
