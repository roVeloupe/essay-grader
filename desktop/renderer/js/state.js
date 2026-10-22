import { toast } from './util.js';

export const state = {
  info: null,
  settings: {},
  templates: [],
  papers: [],
  route: { name: 'desk', params: {} },
  selection: new Set(),
  visible: new Set(), // 当前筛选后的作文 id
  backend: { ready: false, error: '' },
  busy: false,
  ready: false
};

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit() { for (const fn of listeners) fn(); }

export async function loadAll() {
  const [info, settings, templates, papers] = await Promise.all([
    window.api.info(),
    window.api.getSettings(),
    window.api.listTemplates(),
    window.api.listPapers()
  ]);
  Object.assign(state, { info, settings, templates, papers, backend: info.backend });
  state.ready = true;
  emit();
}

export async function reloadPapers() {
  state.papers = await window.api.listPapers();
  emit();
}

export async function reloadTemplates() {
  state.templates = await window.api.listTemplates();
  emit();
}

export function paperById(id) {
  return state.papers.find((p) => p.id === id);
}

export function templateFor(paper) {
  return state.templates.find((t) => t.id === paper.templateId) || state.templates[0];
}

export async function importFiles(files) {
  if (!files?.length) return;
  try {
    const created = await window.api.addPapers({ files, templateId: state.settings.templateId, stage: state.settings.stage });
    state.papers = [...created, ...state.papers];
    for (const p of created) state.selection.add(p.id);
    emit();
    toast(`已导入 ${created.length} 篇作文`);
  } catch (e) {
    toast('导入失败：' + e.message, 'error');
  }
}

export async function startGrading(ids) {
  if (!ids.length) return;
  try {
    if (!state.backend.ready) {
      toast('正在启动批改引擎…');
      state.backend = await window.api.backendStart();
      emit();
    }
    for (const id of ids) {
      const p = paperById(id);
      if (p) Object.assign(p, { status: 'running', progress: { stage: 'ocr', pct: 1, message: '排队中…' }, error: '' });
    }
    emit();
    await window.api.startGrading(ids);
  } catch (e) {
    toast('启动失败：' + e.message, 'error');
  }
}

export async function saveSettings(patch) {
  state.settings = await window.api.saveSettings(patch);
  emit();
}

export function go(name, params = {}) {
  state.route = { name, params };
  emit();
}
