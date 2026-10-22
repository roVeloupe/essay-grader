import { h, icon, toast } from '../util.js';
import { state, saveSettings, reloadTemplates } from '../state.js';

const MODELS = [
  { id: 'opencode/deepseek-v4.1-flash-free', label: 'DeepSeek V4.1 Flash（免费 · 支持图片，推荐）' },
  { id: 'opencode/nemotron-3.5-super-vl-free', label: 'Nemotron 3.5 Super VL（免费 · 支持图片，长文本）' },
  { id: 'opencode/mimo-v2.6-flash-free', label: 'MiMo v2.6 Flash（免费 · 支持图片）' },
  { id: 'opencode/minimax-m3.1-flash-free', label: 'MiniMax M3.1 Flash（免费 · 支持图片）' },
  { id: 'opencode/glm-5.3-flash-free', label: 'GLM 5.3 Flash（免费 · 支持图片）' },
  { id: 'opencode/big-pickle', label: 'Big Pickle（免费 · 纯文本）' },
  { id: 'opencode/nemotron-3-ultra-free', label: 'Nemotron 3 Ultra（免费 · 纯文本）' }
];

export function renderSettings() {
  const s = state.settings;
  const page = h('div', { class: 'page' });
  const dirty = {};

  page.append(h('div', { class: 'page-head' },
    h('div', {},
      h('h1', { class: 'page-title', text: '设置' }),
      h('div', { class: 'page-desc', text: '批改引擎、评分标准与导出位置。改完点右下的保存。' })
    ),
    h('div', { class: 'page-actions' },
      h('button', { class: 'btn', onclick: async () => {
        const st = await window.api.backendStatus();
        state.backend = st;
        toast(st.ready ? `引擎运行中 · 端口 ${st.port}` : `引擎未就绪：${st.error || '未知'}`, st.ready ? 'info' : 'error');
        render();
      } }, icon('refresh'), '检测引擎'),
      h('button', { class: 'btn primary', onclick: async () => {
        await saveSettings(dirty);
        toast('已保存');
      } }, icon('check'), '保存设置')
    )
  ));

  // 引擎状态卡
  const be = state.backend || {};
  page.append(h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', { class: 'card-title', text: '批改引擎' }),
      h('span', { class: 'badge ' + (be.ready ? 'ok' : 'err'), text: be.ready ? `运行中 · :${be.port}` : '未就绪' })
    ),
    h('p', { class: 'hint', text: '引擎由应用自动拉起（OpenCode + 本地代理），全部请求在你自己的电脑上发出，不需要 API Key。' }),
    be.error ? h('pre', { class: 'log-box', text: be.error }) : null
  ));

  // 模型
  const modelSel = h('select', { class: 'input', onchange: (e) => { dirty.model = e.target.value; } });
  for (const m of MODELS) modelSel.append(h('option', { value: m.id, text: m.label, selected: m.id === s.model }));
  modelSel.append(h('option', { value: s.model, text: `${s.model}（当前）`, selected: !MODELS.some((m) => m.id === s.model) }));

  const fallbackSel = h('select', { class: 'input', onchange: (e) => { dirty.fallbackModel = e.target.value; } });
  for (const m of MODELS) fallbackSel.append(h('option', { value: m.id, text: m.label, selected: m.id === s.fallbackModel }));
  fallbackSel.append(h('option', { value: '', text: '不启用备用模型' , selected: !s.fallbackModel }));

  page.append(h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', { class: 'card-title', text: '模型' })),
    h('div', { class: 'form-row' },
      field('批改模型', modelSel),
      field('批阅学段', seg(['初中', '高中'], s.stage, (v) => { dirty.stage = v; })),
      field('默认评分标准', (() => {
        const el = h('select', { class: 'input', onchange: (e) => { dirty.templateId = e.target.value; } });
        for (const t of state.templates) el.append(h('option', { value: t.id, text: `${t.name}（${t.total} 分）`, selected: t.id === s.templateId }));
        return el;
      })())
    ),
    h('div', { class: 'form-row' },
      field('同时批改篇数', numInput(s.concurrency, 1, 3, (v) => { dirty.concurrency = v; })),
      field('待核对阈值', numInput(s.verifyThreshold, 0, 1, (v) => { dirty.verifyThreshold = v; }, 0.05)),
      field('导出格式', seg(['docx', 'md', 'pdf'], s.exportFormat, (v) => { dirty.exportFormat = v; }, { docx: 'Word', md: 'Markdown', pdf: 'PDF' }))
    ),
    h('div', { class: 'form-row' },
      field('备用模型', fallbackSel)
    ),
    h('p', { class: 'hint', text: '主模型超时、限流或返回内容无法解析时，自动换备用模型重跑一次。推荐 MiniMax M3.1 Flash（支持图片，识别和批阅都能接）。' }),
    h('p', { class: 'hint', text: '免费模型有速率限制，篇数越大越容易被限流；建议保持 1 篇。' })
  ));

  // 导出
  page.append(h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', { class: 'card-title', text: '导出' })),
    h('div', { class: 'form-row' },
      field('导出目录', h('div', { class: 'row', style: 'gap:8px' },
        h('input', { class: 'input grow', value: s.exportDir || state.info?.exportDir || '', readonly: true }),
        h('button', { class: 'btn sm', onclick: async () => {
          const dir = await window.api.pickDir();
          if (dir) { dirty.exportDir = dir; await saveSettings(dirty); toast('导出目录已更新'); render(); }
        } }, icon('folder'), '选择')
      )),
      field('打开', h('div', { class: 'row', style: 'gap:8px' },
        h('button', { class: 'btn sm ghost', onclick: () => window.api.openPath(state.info?.exportDir) }, '导出目录'),
        h('button', { class: 'btn sm ghost', onclick: () => window.api.openPath(state.info?.dataDir) }, '数据目录')
      ))
    )
  ));

  // 外观与信息
  page.append(h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', { class: 'card-title', text: '外观与关于' })),
    h('div', { class: 'form-row' },
      field('主题', seg(['system', 'light', 'dark'], s.theme, async (v) => {
        dirty.theme = v;
        await saveSettings({ theme: v });
        document.documentElement.dataset.theme = v === 'system'
          ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
          : v;
      }, { system: '跟随系统', light: '浅色', dark: '深色' })),
      field('版本', h('div', { class: 'hint', text: `Essay Grader ${state.info?.version || ''} · Electron ${state.info?.electron || ''}` })),
      field('数据位置', h('div', { class: 'hint', text: state.info?.dataDir || '' }))
    )
  ));

  return page;
}

function render() {
  document.getElementById('view').replaceChildren(renderSettings());
}

function field(label, control) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label', text: label }), control);
}

function numInput(value, min, max, onChange, step = 1) {
  return h('input', {
    class: 'input', type: 'number', value, min, max, step,
    oninput: (e) => onChange(Number(e.target.value))
  });
}

function seg(options, value, onChange, labels = {}) {
  const wrap = h('div', { class: 'segmented' });
  for (const o of options) {
    wrap.append(h('button', {
      type: 'button',
      'aria-pressed': String(o === value),
      onclick: (e) => {
        for (const b of wrap.children) b.setAttribute('aria-pressed', 'false');
        e.currentTarget.setAttribute('aria-pressed', 'true');
        onChange(o);
      },
      text: labels[o] || o
    }));
  }
  return wrap;
}
