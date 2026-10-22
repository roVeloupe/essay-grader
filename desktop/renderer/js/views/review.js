import { h, icon, toast, debounce } from '../util.js';
import { state, paperById, templateFor, startGrading, go, emit } from '../state.js';

const VERDICT = {
  ok: { text: '正常', cls: 'ok' },
  ocr_fix: { text: '识别修正', cls: 'warn' },
  author_error: { text: '学生笔误', cls: 'err' },
  verify: { text: '待核对', cls: 'info' }
};

export function renderReview({ id }) {
  const paper = paperById(id);
  if (!paper) return h('div', { class: 'page' }, h('div', { class: 'empty' }, h('h3', { text: '作文不存在' })));

  let pageNo = 1;
  const page = h('div', { class: 'page wide' });

  const sentences = paper.sentences || [];
  const stats = countBy(sentences);
  const dirty = { value: false };
  const persist = debounce(async () => {
    if (!dirty.value) return;
    dirty.value = false;
    await window.api.updatePaper({ id: paper.id, sentences: paper.sentences, authorErrors: collectErrors(paper) });
  }, 500);

  const head = h('div', { class: 'page-head' },
    h('div', { class: 'row', style: 'gap:12px' },
      h('button', { class: 'btn icon ghost', title: '返回', onclick: () => go('desk') }, icon('chevL')),
      h('div', {},
        h('h1', { class: 'page-title', text: paper.title || paper.name }),
        h('div', { class: 'page-desc', text: `${templateFor(paper)?.name || ''} · ${sentences.length} 句 · 学生笔误 ${stats.author_error} 处 · 待核对 ${stats.verify} 句` })
      )
    ),
    h('div', { class: 'page-actions' },
      h('button', { class: 'btn ghost', onclick: () => startGrading([paper.id]) }, icon('refresh'), '重新识别'),
      h('button', { class: 'btn primary', onclick: async () => { await flush(); go('grade-wait', { id: paper.id }); await window.api.regrade(paper.id); } }, icon('spark'), '按当前文本批阅')
    )
  );
  page.append(head);

  const imagePane = h('div', { class: 'image-pane' });
  const img = h('img', { class: 'page-image', src: `app-media://papers/${paper.id}/page-01${extOf(paper.images[0])}` });
  const tabs = h('div', { class: 'segmented' });
  const renderTabs = () => {
    tabs.replaceChildren(...paper.images.map((file, i) =>
      h('button', {
        'aria-pressed': String(pageNo === i + 1),
        onclick: () => { pageNo = i + 1; renderTabs(); img.src = `app-media://papers/${paper.id}/page-${pad(i + 1)}${extOf(file)}`; }
      }, `第 ${i + 1} 页`)
    ));
  };
  renderTabs();
  if (paper.images.length > 1) imagePane.append(tabs);
  imagePane.append(img);

  const listPane = h('div', { class: 'sentence-pane' });
  let only = 'all'; // 必须在 chip() 调用之前初始化，否则 TDZ 报错导致整页渲染失败
  const filterBar = h('div', { class: 'row between', style: 'margin-bottom:10px' },
    h('div', { class: 'segmented' },
      chip('全部', 'all'), chip('待核对', 'verify'), chip('笔误', 'author_error')
    ),
    h('div', { class: 'hint', text: '点句子可直接改字，改动会自动保存' })
  );
  listPane.append(filterBar);

  function chip(label, key) {
    return h('button', {
      'aria-pressed': String(only === key),
      onclick: () => { only = key; renderList(); }
    }, label);
  }

  const listBody = h('div', { class: 'sentence-list' });
  listPane.append(listBody);

  function renderList() {
    listBody.replaceChildren();
    const shown = sentences.filter((s) => only === 'all' || s.verdict === only);
    if (!shown.length) { listBody.append(h('div', { class: 'empty small' }, h('p', { text: '没有符合条件的句子' }))); return; }
    shown.forEach((s, i) => listBody.append(sentenceRow(s, sentences.indexOf(s) + 1)));
  }
  renderList();

  function sentenceRow(s, no) {
    const v = VERDICT[s.verdict] || VERDICT.ok;
    const textEl = h('div', {
      class: 'sentence-text',
      contentEditable: 'true',
      spellcheck: false,
      text: s.finalText || s.text,
      oninput: (e) => { s.finalText = e.target.textContent; dirty.value = true; persist(); },
      onblur: () => { s.verdict = s.verdict === 'verify' ? 'ok' : s.verdict; dirty.value = true; persist(); }
    });

    const issues = h('div', { class: 'issue-list' });
    if (s.verdict === 'ocr_fix' && s.text !== s.finalText) {
      issues.append(h('div', { class: 'issue' },
        h('span', { class: 'issue-tag', text: '识别为' }),
        h('span', { class: 'issue-wrong', text: s.text }),
        h('span', { class: 'issue-arrow', text: '→' }),
        h('span', { class: 'issue-right', text: s.finalText })
      ));
    }
    for (const it of s.issues || []) {
      if (s.verdict !== 'author_error') continue;
      const hasPair = !!(it.wrong || it.right);
      issues.append(h('div', { class: 'issue' },
        h('span', { class: 'issue-tag', text: it.kind || '笔误' }),
        hasPair ? h('span', { class: 'issue-wrong', text: it.wrong || '？' }) : null,
        hasPair ? h('span', { class: 'issue-arrow', text: '→' }) : null,
        hasPair ? h('span', { class: 'issue-right', text: it.right || '？' }) : null,
        it.reason ? h('span', { class: 'issue-reason', text: it.reason }) : null
      ));
    }

    const row = h('div', { class: 'sentence', 'data-verdict': s.verdict },
      h('div', { class: 'sentence-no', text: String(no) }),
      h('div', { class: 'sentence-main' }, textEl, issues),
      h('div', { class: 'sentence-side' },
        h('span', { class: 'badge ' + v.cls, text: v.text }),
        s.verdict === 'verify'
          ? h('button', { class: 'btn sm ghost', title: '标记为已核对', onclick: () => { s.verdict = 'ok'; dirty.value = true; persist(); renderAll(); } }, icon('check'))
          : null,
        s.verdict === 'ocr_fix'
          ? h('button', {
              class: 'btn sm ghost', title: '还原为原识别文本',
              onclick: () => { s.finalText = s.text; s.verdict = 'ok'; dirty.value = true; persist(); renderAll(); }
            }, icon('x'))
          : null
      )
    );
    return row;
  }

  function renderAll() {
    renderList();
    head.querySelector('.page-desc').textContent =
      `${templateFor(paper)?.name || ''} · ${sentences.length} 句 · 学生笔误 ${countBy(sentences).author_error} 处 · 待核对 ${countBy(sentences).verify} 句`;
  }

  async function flush() {
    if (!dirty.value) return;
    dirty.value = false;
    await window.api.updatePaper({ id: paper.id, sentences: paper.sentences, authorErrors: collectErrors(paper) });
  }

  page.append(h('div', { class: 'review-grid' }, imagePane, listPane));
  return page;
}

function countBy(sentences) {
  const out = { ok: 0, ocr_fix: 0, author_error: 0, verify: 0 };
  for (const s of sentences) out[s.verdict] = (out[s.verdict] || 0) + 1;
  return out;
}

function collectErrors(paper) {
  const out = [];
  for (const s of paper.sentences || []) {
    if (s.verdict !== 'author_error') continue;
    for (const it of s.issues || []) {
      out.push({ sentenceId: s.id, text: s.text, wrong: it.wrong || '', right: it.right || '', kind: it.kind || '其他', reason: it.reason || '' });
    }
  }
  return out;
}

function pad(n) { return String(n).padStart(2, '0'); }

function extOf(file) {
  const m = /\.([a-z0-9]+)$/i.exec(file || '');
  return m ? '.' + m[1].toLowerCase() : '.jpg';
}
