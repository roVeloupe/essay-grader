import { h, icon, toast, fmtDate } from '../util.js';
import { state, paperById, templateFor, startGrading, go } from '../state.js';

export function renderResult({ id }) {
  const paper = paperById(id);
  if (!paper) return h('div', { class: 'page' }, h('div', { class: 'empty' }, h('h3', { text: '作文不存在' })));
  const t = templateFor(paper);
  const g = paper.grade;

  const page = h('div', { class: 'page wide' });

  page.append(h('div', { class: 'page-head' },
    h('div', { class: 'row', style: 'gap:12px' },
      h('button', { class: 'btn icon ghost', title: '返回', onclick: () => go('desk') }, icon('chevL')),
      h('div', {},
        h('h1', { class: 'page-title', text: paper.title || paper.name }),
        h('div', { class: 'page-desc', text: `${t?.name || ''} · ${paper.author || '未署名'} · ${fmtDate(paper.gradedAt || paper.createdAt)} · 用时 ${secs(paper.timing?.total)}` })
      )
    ),
    h('div', { class: 'page-actions' },
      h('button', { class: 'btn ghost', onclick: () => go('review', { id: paper.id }) }, icon('review'), '核对原文'),
      h('button', { class: 'btn ghost', onclick: () => startGrading([paper.id]) }, icon('refresh'), '重批'),
      h('button', { class: 'btn', onclick: () => exportOne(paper, 'md') }, icon('export'), 'Markdown'),
      h('button', { class: 'btn primary', onclick: () => exportOne(paper, 'docx') }, icon('export'), '导出 Word')
    )
  ));

  if (!g) {
    page.append(h('div', { class: 'empty' }, icon('alert'), h('h3', { text: '还没有批阅结果' }), h('p', { text: '这篇作文尚未完成批阅。' })));
    return page;
  }

  // 顶部成绩卡
  page.append(h('div', { class: 'result-hero' },
    h('div', { class: 'score-block' },
      h('div', { class: 'score-big' }, String(g.total), h('small', { text: ` / ${t?.total ?? ''}` })),
      h('div', { class: 'score-level', text: g.level || '' })
    ),
    h('div', { class: 'dim-list' }, ...g.dimensions.map(dimBar)),
    h('div', { class: 'hero-summary' },
      h('div', { class: 'card-title', text: '总评' }),
      h('p', { text: g.summary || '—' }),
      h('div', { class: 'meta-row' },
        h('span', { text: `学生笔误 ${(paper.authorErrors || []).length} 处` }),
        h('span', { text: `识别 ${secs(paper.timing?.ocr1)}` }),
        h('span', { text: `校对 ${secs(paper.timing?.correct)}` }),
        h('span', { text: `批阅 ${secs(paper.timing?.grade)}` }),
        g.model ? h('span', { text: `模型 ${String(g.model).replace('opencode/', '')}` }) : null
      )
    )
  ));

  // 三栏反馈
  const grid = h('div', { class: 'feedback-grid' });
  grid.append(feedbackCard('做得好的地方', 'pros', g.pros, 'ok'));
  grid.append(feedbackCard('需要改进的地方', 'cons', g.cons, 'warn'));
  grid.append(feedbackCard('下一步怎么练', 'suggestions', g.suggestions, 'info'));
  page.append(grid);

  // 笔误清单
  if (paper.authorErrors?.length) {
    const card = h('div', { class: 'card', style: 'margin-top:22px' },
      h('div', { class: 'card-head' }, h('div', { class: 'card-title', text: `学生笔误（${paper.authorErrors.length}）` }),
        h('div', { class: 'hint', text: '只统计学生写错的字词，不含扫描识别误差' }))
    );
    const list = h('div', { class: 'error-table' });
    for (const e of paper.authorErrors) {
      list.append(h('div', { class: 'error-row' },
        h('span', { class: 'badge', text: e.kind || '笔误' }),
        h('span', { class: 'issue-wrong', text: e.wrong }),
        h('span', { class: 'issue-arrow', text: '→' }),
        h('span', { class: 'issue-right', text: e.right }),
        h('span', { class: 'error-ctx', text: e.text || '' }),
        h('span', { class: 'error-reason', text: e.reason || '' })
      ));
    }
    card.append(list);
    page.append(card);
  }

  // 原文（可折叠）
  const details = h('details', { class: 'card', style: 'margin-top:22px' },
    h('summary', { class: 'card-title', text: '识别出的原文' })
  );
  const body = h('div', { class: 'essay-body' });
  const paras = groupParagraphs(paper.sentences || []);
  for (const p of paras) body.append(h('p', { text: p }));
  details.append(body);
  page.append(details);

  return page;
}

function dimBar(d) {
  const pct = d.max ? Math.round((d.score / d.max) * 100) : 0;
  return h('div', { class: 'dim' },
    h('div', { class: 'dim-head' },
      h('span', { class: 'dim-name', text: d.name }),
      h('span', { class: 'dim-score', text: `${d.score} / ${d.max}` })
    ),
    h('div', { class: 'dim-bar' }, h('i', { style: `width:${pct}%` })),
    d.comment ? h('div', { class: 'dim-comment', text: d.comment }) : null
  );
}

function feedbackCard(title, kind, items, tone) {
  const card = h('div', { class: 'card feedback-card', 'data-tone': tone },
    h('div', { class: 'card-head' }, h('div', { class: 'card-title', text: title }))
  );
  const list = h('div', { class: 'feedback-list' });
  if (!items?.length) list.append(h('div', { class: 'hint', text: '暂无' }));
  for (const it of items || []) {
    list.append(h('div', { class: 'feedback-item' },
      h('p', { text: it.text }),
      it.source ? h('div', { class: 'quote', text: `“${trim(it.source, 60)}”` }) : null
    ));
  }
  card.append(list);
  return card;
}

function groupParagraphs(sentences) {
  const map = new Map();
  for (const s of sentences) {
    const k = s.paragraph || 1;
    if (!map.has(k)) map.set(k, []);
    const txt = (s.finalText || s.text || '').trim();
    if (txt) map.get(k).push(txt);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, arr]) => arr.join(''));
}

function trim(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }

function secs(ms) { return ms ? (ms / 1000).toFixed(1) + 's' : '—'; }

async function exportOne(paper, format) {
  try {
    const file = await window.api.exportOne({ id: paper.id, format });
    if (file) { toast('已导出：' + file.split(/[\\/]/).pop()); window.api.showItem(file); }
  } catch (e) {
    toast('导出失败：' + e.message, 'error');
  }
}
