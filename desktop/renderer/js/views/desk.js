import { h, icon, toast, fmtDate, statusOf } from '../util.js';
import { state, importFiles, startGrading, paperById, templateFor, go, emit } from '../state.js';

let filter = 'all';
let over = false;

export function renderDesk() {
  const page = h('div', { class: 'page' });

  const papers = state.papers.filter((p) => {
    if (filter === 'todo') return p.status !== 'graded';
    if (filter === 'done') return p.status === 'graded';
    return true;
  });
  state.visible = new Set(papers.map((p) => p.id));

  const selected = [...state.selection].filter((id) => paperById(id));

  page.append(
    h('div', { class: 'page-head' },
      h('div', {},
        h('h1', { class: 'page-title', text: '批改台' }),
        h('div', { class: 'page-desc', text: '把作文拍成图片放进来，识别、校对、批阅一次跑完。' })
      ),
      h('div', { class: 'page-actions' },
        h('button', { class: 'btn', onclick: pickFiles }, icon('plus'), '导入图片'),
        h('button', {
          class: 'btn primary',
          disabled: !selected.length,
          onclick: async () => { await startGrading(selected); }
        }, icon('play'), `开始批改${selected.length ? ` (${selected.length})` : ''}`)
      )
    )
  );

  // 拖放区
  const dz = h('div', {
    class: 'dropzone' + (over ? ' is-over' : ''),
    onclick: pickFiles,
    ondragover: (e) => { e.preventDefault(); over = true; dz.classList.add('is-over'); },
    ondragleave: () => { over = false; dz.classList.remove('is-over'); },
    ondrop: (e) => {
      e.preventDefault(); over = false; dz.classList.remove('is-over');
      const files = [...e.dataTransfer.files]
        .filter((f) => /\.(png|jpe?g|bmp|webp)$/i.test(f.name))
        .map((f) => window.api.getFilePath(f))
        .filter(Boolean);
      importFiles(files);
    }
  },
    h('div', { class: 'dropzone-icon' }, icon('upload')),
    h('h3', { text: '拖入作文图片，或点击选择' }),
    h('p', { text: '支持 JPG / PNG / BMP / WebP，可一次选多张；同一篇多页请一次导入。' })
  );
  page.append(dz);

  // 列表头
  const listHead = h('div', { class: 'row between', style: 'margin:22px 0 0' },
    h('div', { class: 'row', style: 'gap:14px' },
      h('div', { class: 'card-title', text: `作文（${papers.length}）` }),
      h('div', { class: 'segmented' },
        seg('all', '全部'), seg('todo', '待批改'), seg('done', '已完成')
      )
    ),
    h('div', { class: 'row' },
      selected.length > 1 ? h('button', { class: 'btn sm', onclick: () => { state.selection.clear(); emit(); } }, '取消选择') : null,
      state.papers.some((p) => p.status === 'graded')
        ? h('button', { class: 'btn sm ghost', onclick: exportAll }, icon('export'), '导出全部')
        : null
    )
  );
  page.append(listHead);

  if (!papers.length) {
    page.append(
      h('div', { class: 'empty' },
        icon('image'),
        h('h3', { text: state.papers.length ? '这个筛选下没有作文' : '还没有作文' }),
        h('p', { text: state.papers.length ? '换个筛选看看。' : '先导入几张作文照片，导入后会自动排队。' })
      )
    );
  } else {
    const list = h('div', { class: 'paper-list' });
    for (const p of papers) list.append(paperRow(p));
    page.append(list);
  }

  return page;
}

function seg(key, label) {
  return h('button', {
    'aria-pressed': String(filter === key),
    onclick: () => { filter = key; emit(); },
    text: label
  });
}

function paperRow(p) {
  const t = templateFor(p);
  const sel = state.selection.has(p.id);
  const st = statusOf(p);
  const running = p.status === 'running';
  const pct = p.progress?.pct ?? 0;

  const thumb = h('img', {
    class: 'paper-thumb',
    src: `app-media://papers/${p.id}/page-01${extOf(p.images?.[0])}`,
    loading: 'lazy',
    onerror: (e) => { e.target.style.visibility = 'hidden'; }
  });

  const metaBits = [
    t?.name || '',
    p.createdAt ? fmtDate(p.createdAt) : '',
    p.images?.length > 1 ? `${p.images.length} 页` : ''
  ].filter(Boolean);

  const scoreEl = p.status === 'graded'
    ? h('div', { class: 'paper-score' }, `${p.grade.total}`, h('small', { text: ` / ${t?.total ?? ''}` }))
    : h('div', { class: 'badge ' + st.cls, text: st.text });

  const actions = h('div', { class: 'paper-actions' },
    running
      ? h('button', { class: 'btn sm ghost', onclick: (e) => { e.stopPropagation(); window.api.cancelGrading(p.id); } }, icon('stop'), '停止')
      : h('button', {
          class: 'btn sm ghost',
          onclick: (e) => { e.stopPropagation(); startGrading([p.id]); }
        }, icon('refresh'), p.status === 'graded' ? '重批' : '批改'),
    p.sentences?.length ? h('button', { class: 'btn sm ghost', onclick: (e) => { e.stopPropagation(); go('review', { id: p.id }); } }, '校对') : null,
    h('button', {
      class: 'btn sm ghost',
      title: '移除',
      onclick: async (e) => {
        e.stopPropagation();
        if (!confirm(`移除《${p.name}》？图片也会删除。`)) return;
        await window.api.deletePaper(p.id);
        state.papers = state.papers.filter((x) => x.id !== p.id);
        state.selection.delete(p.id);
        emit();
      }
    }, icon('trash'))
  );

  const row = h('div', {
    class: 'paper' + (sel ? ' is-selected' : ''),
    dataset: { id: p.id, status: p.status },
    onclick: (e) => {
      if (e.ctrlKey || e.metaKey) {
        sel ? state.selection.delete(p.id) : state.selection.add(p.id);
        emit();
        return;
      }
      if (p.status === 'graded') go('result', { id: p.id });
      else if (p.sentences?.length) go('review', { id: p.id });
      else if (!running) startGrading([p.id]);
    }
  },
    thumb,
    h('div', { class: 'paper-main' },
      h('div', { class: 'paper-name', text: p.title || p.name }),
      h('div', { class: 'paper-meta', text: metaBits.join(' · ') }),
      running
        ? h('div', { class: 'progress-line' }, h('i', { style: `width:${pct}%` }))
        : p.status === 'error'
          ? h('div', { class: 'paper-meta', style: 'color:var(--destructive)', text: p.error?.slice(0, 90) })
          : null
    ),
    scoreEl,
    actions
  );
  return row;
}

function extOf(file) {
  if (!file) return '.jpg';
  const m = /\.([a-z0-9]+)$/i.exec(file);
  return m ? '.' + m[1].toLowerCase() : '.jpg';
}

async function pickFiles() {
  const files = await window.api.pickImages();
  if (files?.length) await importFiles(files);
}

async function exportAll() {
  const ids = state.papers.filter((p) => p.status === 'graded').map((p) => p.id);
  if (!ids.length) return toast('还没有可导出的批改结果');
  const format = state.settings.exportFormat || 'docx';
  toast(`正在导出 ${ids.length} 篇…`);
  try {
    const files = await window.api.exportAll({ ids, format });
    if (files.length) {
      toast(`已导出 ${files.length} 个文件到 ${state.info.exportDir}`);
      window.api.showItem(files[0]);
    }
  } catch (e) {
    toast('导出失败：' + e.message, 'error');
  }
}
