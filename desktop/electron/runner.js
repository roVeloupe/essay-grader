'use strict';

const { recognizePage, correctSentences, gradeEssay } = require('./ai');

/**
 * 批改流水线：识别（逐页）→ 校对 → 批阅。
 * 单篇串行跑三个阶段，篇与篇之间按 settings.concurrency 限流。
 */
class Runner {
  constructor({ store, backend, emit }) {
    this.store = store;
    this.backend = backend;
    this.emit = emit;
    this.running = new Set();
    this.queue = [];
    this.active = 0;
  }

  base() {
    return `http://127.0.0.1:${this.backend.port}/v1`;
  }

  enqueue(ids) {
    for (const id of ids) if (!this.running.has(id) && !this.queue.includes(id)) this.queue.push(id);
    this.pump();
  }

  /** 只批阅（不重识别），直接开跑，不进队列。 */
  enqueueGrade(ids) {
    for (const id of ids) {
      if (this.running.has(id)) continue;
      this.runOneGrade(id);
    }
  }

  cancel(id) {
    const p = this.store.papers.find((x) => x.id === id);
    if (p) {
      this.queue = this.queue.filter((x) => x !== id);
      this.store.updatePaper(id, { status: 'ready', error: '' });
      this.emit('paper', p);
    }
  }

  pump() {
    const limit = Math.max(1, Math.min(3, Number(this.store.settings.concurrency) || 1));
    while (this.active < limit && this.queue.length) {
      const id = this.queue.shift();
      this.runOne(id).finally(() => { this.active--; this.pump(); });
      this.active++;
    }
  }

  progress(paper, stage, pct, message) {
    this.emit('progress', { paperId: paper.id, stage, pct, message });
  }

  /** 只跑批阅阶段：用老师校对后的文本打分，不重新识别。 */
  async runOneGrade(id) {
    const paper = this.store.papers.find((p) => p.id === id);
    if (!paper) return;
    const settings = this.store.settings;
    const template = this.store.templates.find((t) => t.id === paper.templateId) || this.store.templates[0];
    const t0 = Date.now();
    this.running.add(id);
    this.store.updatePaper(id, { status: 'running', error: '', progress: { stage: 'grade', pct: 10, message: '正在按校对文本批阅…' } });
    this.progress(paper, 'grade', 30, '正在按标准批阅…');
    try {
      const sentences = paper.sentences || [];
      const body = essayBody(sentences);
      if (!body.trim()) throw new Error('没有可批阅的正文，请先完成识别');
      const grade = await gradeEssay({
        body,
        template,
        authorErrors: paper.authorErrors || [],
        stage: paper.stage || settings.stage,
        base: this.base(),
        model: settings.model,
        onLog: (m) => this.emit('log', `${paper.name}: ${m}`)
      });
      const timing = { ...(paper.timing || {}), grade: Date.now() - t0, total: Date.now() - t0 };
      this.store.updatePaper(id, { grade, status: 'graded', gradedAt: new Date().toISOString(), timing, progress: { stage: 'done', pct: 100, message: '完成' } });
      this.progress(paper, 'done', 100, `完成：${grade.total} 分 · ${grade.level || ''}`);
      this.emit('paper', this.store.papers.find((p) => p.id === id));
    } catch (e) {
      const msg = e?.message || String(e);
      this.store.updatePaper(id, { status: 'error', error: msg });
      this.progress(paper, 'error', 100, msg);
      this.emit('paper', this.store.papers.find((p) => p.id === id));
    } finally {
      this.running.delete(id);
    }
  }

  async runOne(id) {
    const paper = this.store.papers.find((p) => p.id === id);
    if (!paper) return;
    const settings = this.store.settings;
    const template = this.store.templates.find((t) => t.id === paper.templateId) || this.store.templates[0];
    const model = settings.model;
    const t0 = Date.now();
    const timing = {};
    this.running.add(id);
    this.store.updatePaper(id, { status: 'running', error: '', progress: { stage: 'ocr', pct: 2, message: '准备中…' } });
    this.progress(paper, 'ocr', 3, '正在识别图片…');

    try {
      // ① 识别
      const pages = [];
      for (let i = 0; i < paper.images.length; i++) {
        const t = Date.now();
        const r = await recognizePage({
          image: paper.images[i],
          page: i + 1,
          base: this.base(),
          model,
          fallbackModel: settings.fallbackModel,
          onLog: (m) => this.emit('log', `${paper.name}: ${m}`)
        });
        pages.push(r);
        timing[`ocr${i + 1}`] = Date.now() - t;
        this.progress(paper, 'ocr', 3 + Math.round(((i + 1) / paper.images.length) * 35), `已识别第 ${i + 1}/${paper.images.length} 页`);
        this.store.updatePaper(id, {
          title: pages[0]?.title || paper.title,
          author: pages[0]?.author || paper.author,
          progress: { stage: 'ocr', pct: 3 + Math.round(((i + 1) / paper.images.length) * 35), message: `已识别第 ${i + 1} 页` }
        });
      }

      const sentences = [];
      pages.forEach((pg, pi) => {
        for (const s of pg.sentences) {
          sentences.push({ ...s, id: `${pi + 1}-${s.id}`, page: pi + 1 });
        }
      });
      this.store.updatePaper(id, {
        title: pages[0]?.title || '',
        author: pages[0]?.author || '',
        sentences: sentences.map((s) => ({ ...s, finalText: s.text, verdict: 'ok', issues: [] })),
        status: 'running'
      });

      // ② 校对
      this.progress(paper, 'correct', 45, '正在校对（区分识别错误与学生笔误）…');
      const t1 = Date.now();
      const corrected = await correctSentences({
        sentences,
        base: this.base(),
        model,
        fallbackModel: settings.fallbackModel,
        onLog: (m) => this.emit('log', `${paper.name}: ${m}`)
      });
      timing.correct = Date.now() - t1;

      const authorErrors = [];
      for (const s of corrected.sentences) {
        if (s.verdict === 'author_error') {
          for (const issue of s.issues || []) {
            authorErrors.push({ sentenceId: s.id, text: s.text, wrong: issue.wrong || '', right: issue.right || '', kind: issue.kind || '其他', reason: issue.reason || '' });
          }
        }
      }
      this.store.updatePaper(id, {
        sentences: corrected.sentences,
        authorErrors,
        progress: { stage: 'correct', pct: 60, message: '校对完成' }
      });
      this.progress(paper, 'correct', 62, `校对完成：${authorErrors.length} 处笔误`);

      // ③ 批阅
      this.progress(paper, 'grade', 68, '正在按标准批阅…');
      const t2 = Date.now();
      const body = essayBody(corrected.sentences);
      const grade = await gradeEssay({
        body,
        template,
        authorErrors,
        stage: paper.stage || settings.stage,
        base: this.base(),
        model,
        fallbackModel: settings.fallbackModel,
        onLog: (m) => this.emit('log', `${paper.name}: ${m}`)
      });
      timing.grade = Date.now() - t2;
      timing.total = Date.now() - t0;

      this.store.updatePaper(id, {
        grade,
        status: 'graded',
        gradedAt: new Date().toISOString(),
        timing,
        progress: { stage: 'done', pct: 100, message: '完成' }
      });
      this.progress(paper, 'done', 100, `完成：${grade.total} 分 · ${grade.level || ''}`);
      this.emit('paper', this.store.papers.find((p) => p.id === id));
    } catch (e) {
      const msg = e?.message || String(e);
      this.store.updatePaper(id, { status: 'error', error: msg, timing });
      this.progress(paper, 'error', 100, msg);
      this.emit('paper', this.store.papers.find((p) => p.id === id));
    } finally {
      this.running.delete(id);
    }
  }
}

/** 把句子拼成正文；段落之间空一行，供批阅提示词使用。 */
function essayBody(sentences) {
  const paras = new Map();
  for (const s of sentences || []) {
    const text = String(s.finalText || s.text || '').trim();
    if (!text) continue;
    const key = Number(s.paragraph) || 1;
    if (!paras.has(key)) paras.set(key, []);
    paras.get(key).push(text);
  }
  return [...paras.keys()]
    .sort((a, b) => a - b)
    .map((k) => paras.get(k).join(''))
    .join('\n\n');
}

module.exports = { Runner };
