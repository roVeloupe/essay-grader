import { h, icon, toast } from './util.js';
import { state, subscribe, loadAll, paperById, go, reloadPapers, emit } from './state.js';
import { renderDesk } from './views/desk.js';
import { renderReview } from './views/review.js';
import { renderResult } from './views/result.js';
import { renderTemplates } from './views/templates.js';
import { renderSettings } from './views/settings.js';

const NAV = [
  { key: 'desk', label: '批改台', icon: 'desk' },
  { key: 'templates', label: '评分标准', icon: 'rules' },
  { key: 'settings', label: '设置', icon: 'gear' }
];

const viewEl = document.getElementById('view');
const navEl = document.getElementById('nav');
const titleEl = document.getElementById('win-title');
const statusEl = document.getElementById('engine-status');

function renderNav() {
  navEl.replaceChildren();
  for (const item of NAV) {
    const active = state.route.name === item.key || (item.key === 'desk' && ['review', 'result', 'grade-wait'].includes(state.route.name));
    navEl.append(h('button', {
      class: 'nav-item' + (active ? ' is-active' : ''),
      onclick: () => go(item.key)
    }, icon(item.icon), h('span', { text: item.label })));
  }
  const graded = state.papers.filter((p) => p.status === 'graded').length;
  const todo = state.papers.filter((p) => p.status !== 'graded').length;
  navEl.append(h('div', { class: 'nav-foot' },
    h('div', { class: 'nav-stat' }, h('b', { text: String(graded) }), ' 已批改'),
    h('div', { class: 'nav-stat' }, h('b', { text: String(todo) }), ' 待批改')
  ));
}

function renderStatus() {
  const be = state.backend || {};
  statusEl.dataset.state = be.ready ? 'ok' : be.error ? 'err' : 'idle';
  statusEl.textContent = be.ready ? `引擎就绪 · ${be.port}` : be.error ? '引擎异常' : '引擎启动中…';
  statusEl.title = be.error || (be.ready ? 'OpenCode 代理已连接' : '正在启动 OpenCode');
}

function renderView() {
  const { name, params } = state.route;
  let node;
  try {
    switch (name) {
      case 'review': node = renderReview(params); break;
      case 'result': node = renderResult(params); break;
      case 'grade-wait': node = renderGradeWait(params); break;
      case 'templates': node = renderTemplates(); break;
      case 'settings': node = renderSettings(); break;
      default: node = renderDesk();
    }
  } catch (err) {
    console.error(err);
    node = h('div', { class: 'page' },
      h('div', { class: 'empty' },
        h('h3', { text: '这个页面出错了' }),
        h('p', { class: 'hint', text: String(err && err.message ? err.message : err) }),
        h('button', { class: 'btn ghost', onclick: () => go('desk') }, '回到批改台')
      )
    );
  }
  viewEl.replaceChildren(node);
  titleEl.textContent = name === 'desk' ? '批改台' : name === 'review' ? '识别与校对' : name === 'result' ? '批阅结果' : name === 'templates' ? '评分标准' : name === 'settings' ? '设置' : '批改台';
}

function renderGradeWait({ id }) {
  const p = paperById(id);
  const wrap = h('div', { class: 'page' },
    h('div', { class: 'grade-wait' },
      h('div', { class: 'spinner' }),
      h('h2', { text: '正在按当前文本批阅…' }),
      h('p', { class: 'hint', text: p ? `${p.title || p.name} · ${state.templates.find((t) => t.id === p.templateId)?.name || ''}` : '' }),
      h('div', { class: 'progress-line wide' }, h('i', { style: `width:${p?.progress?.pct || 5}%` })),
      h('p', { class: 'hint', id: 'wait-msg', text: p?.progress?.message || '准备请求…' }),
      h('button', { class: 'btn ghost', onclick: () => go('review', { id }) }, '返回校对')
    )
  );
  return wrap;
}

function render() {
  renderNav();
  renderStatus();
  renderView();
}

subscribe(render);

// —— 进度：只更新对应行，避免整页重绘打断输入
window.api.onProgress((evt) => {
  const p = paperById(evt.paperId);
  if (!p) return;
  p.status = evt.stage === 'done' ? 'graded' : evt.stage === 'error' ? 'error' : 'running';
  p.progress = { stage: evt.stage, pct: evt.pct, message: evt.message };
  if (evt.stage === 'error') p.error = evt.message;

  const row = viewEl.querySelector(`.paper[data-id="${evt.paperId}"]`);
  if (row) {
    const bar = row.querySelector('.progress-line i');
    if (bar) bar.style.width = `${evt.pct}%`;
    const meta = row.querySelector('.paper-meta');
    if (meta && evt.message) meta.textContent = evt.message;
  }

  if (evt.stage === 'done' || evt.stage === 'error') {
    const samePaper = state.route.params?.id === evt.paperId;
    // 重批时停留在结果页/校对页的情况：跑完要刷新当前视图，否则用户看到的还是旧分数
    if (samePaper && ['result', 'review'].includes(state.route.name)) {
      reloadPapers().then(() => {
        if (evt.stage === 'done') go('result', { id: evt.paperId });
        else { toast('批阅失败：' + evt.message, 'error'); go('review', { id: evt.paperId }); }
      });
    }
    emit();
    return;
  }

  const waitMsg = document.getElementById('wait-msg');
  if (waitMsg && state.route.params?.id === evt.paperId) {
    waitMsg.textContent = evt.message || '';
    const bar = document.querySelector('.grade-wait .progress-line i');
    if (bar) bar.style.width = `${evt.pct}%`;
  }
  if (state.route.name === 'desk') renderNav();
});

window.api.onPaper((updated) => {
  const i = state.papers.findIndex((p) => p.id === updated.id);
  if (i >= 0) state.papers[i] = updated;
  if (state.route.name === 'desk') { emit(); }
});

window.api.onLog((line) => { if (window.__dev) console.log('[backend]', line); });

window.api.onBackend((st) => {
  state.backend = st;
  renderStatus();
  if (st?.ready) toast('引擎就绪，可以开始批改了', 'ok', 2600);
  else if (st?.error) toast('引擎启动失败：' + st.error, 'error', 6000);
});

window.api.onTheme((t) => {
  document.documentElement.dataset.theme = t?.dark ? 'dark' : 'light';
});

window.addEventListener('error', (e) => { if (e?.message) toast('界面出错：' + e.message, 'error', 5000); });
window.addEventListener('unhandledrejection', (e) => {
  const msg = e?.reason?.message || e?.reason;
  if (msg) toast('操作失败：' + msg, 'error', 5000);
});

document.addEventListener('keydown', (e) => {  if (e.key === 'Escape' && ['review', 'result', 'grade-wait'].includes(state.route.name)) go('desk');
  if ((e.ctrlKey || e.metaKey) && e.key === 'o') { e.preventDefault(); document.querySelector('.dropzone')?.click(); }
});

(async function boot() {
  try {
    await loadAll();
    document.documentElement.dataset.theme = resolveTheme(state.settings.theme);
    render();
    // 引擎没起来就轮询（opencode 首次启动可能要十几秒）
    if (!state.backend?.ready) {
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          state.backend = await window.api.backendStatus();
          renderStatus();
          if (state.backend.ready) break;
        } catch {}
      }
      if (!state.backend?.ready) toast('引擎仍未就绪，可到「设置」查看日志', 'error', 6000);
    }
  } catch (e) {
    document.body.append(h('pre', { style: 'padding:24px;color:#b91c1c', text: '启动失败：' + e.stack }));
  }
})();

function resolveTheme(t) {
  if (t === 'light' || t === 'dark') return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
