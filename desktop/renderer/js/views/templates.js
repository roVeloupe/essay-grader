import { h, icon, toast } from '../util.js';
import { state, reloadTemplates, saveSettings } from '../state.js';

let currentId = null;

export function renderTemplates() {
  if (!currentId) currentId = state.settings.templateId || state.templates[0]?.id;
  let draft = clone(state.templates.find((t) => t.id === currentId) || state.templates[0]);

  const page = h('div', { class: 'page wide' });
  page.append(h('div', { class: 'page-head' },
    h('div', {},
      h('h1', { class: 'page-title', text: '评分标准' }),
      h('div', { class: 'page-desc', text: '按学段与文体设置维度、分值和等级。批阅时会严格按这里的分数区间给分。' })
    ),
    h('div', { class: 'page-actions' },
      h('button', { class: 'btn', onclick: () => {
        const t = { id: '', name: '新标准', total: 50, stage: '初中', dimensions: [{ name: '内容', max: 30, rule: '' }, { name: '语言', max: 20, rule: '' }], levels: [{ name: '一类文', min: 45, max: 50, desc: '' }, { name: '二类文', min: 0, max: 44, desc: '' }] };
        window.api.saveTemplate(t).then(async (list) => { state.templates = list; currentId = list[list.length - 1].id; await reloadTemplates(); });
      } }, icon('plus'), '新建标准')
    )
  ));

  const grid = h('div', { class: 'tpl-grid' });

  const side = h('div', { class: 'tpl-list card' });
  for (const t of state.templates) {
    side.append(h('button', {
      class: 'tpl-item' + (t.id === currentId ? ' is-active' : ''),
      onclick: () => { currentId = t.id; render(); }
    },
      h('div', { class: 'tpl-name', text: t.name }),
      h('div', { class: 'tpl-meta', text: `${t.stage || ''} · ${t.total} 分 · ${t.dimensions?.length || 0} 维` }),
      t.builtin ? h('span', { class: 'badge', text: '内置' }) : null
    ));
  }
  grid.append(side);

  const editor = h('div', { class: 'card tpl-editor' });
  if (!draft) {
    editor.append(h('div', { class: 'empty' }, h('p', { text: '还没有评分标准' })));
  } else {
    editor.append(
      h('div', { class: 'form-row' },
        field('名称', h('input', { class: 'input', value: draft.name, oninput: (e) => { draft.name = e.target.value; } })),
        field('学段', select(['初中', '高中'], draft.stage, (v) => { draft.stage = v; })),
        field('总分', h('input', { class: 'input', type: 'number', value: draft.total, oninput: (e) => { draft.total = Number(e.target.value) || 0; } }))
      ),
      h('div', { class: 'section-label', text: '评分维度' })
    );

    const dimBox = h('div', { class: 'dim-editor' });
    (draft.dimensions || []).forEach((d, i) => {
      dimBox.append(h('div', { class: 'dim-edit-row' },
        h('input', { class: 'input', value: d.name, placeholder: '维度名', oninput: (e) => { d.name = e.target.value; } }),
        h('input', { class: 'input narrow', type: 'number', value: d.max, placeholder: '分值', oninput: (e) => { d.max = Number(e.target.value) || 0; } }),
        h('input', { class: 'input grow', value: d.rule || '', placeholder: '评分要点（会写进提示词）', oninput: (e) => { d.rule = e.target.value; } }),
        h('button', { class: 'btn icon ghost', title: '删除', onclick: () => { draft.dimensions.splice(i, 1); render(); } }, icon('trash'))
      ));
    });
    dimBox.append(h('button', {
      class: 'btn sm ghost',
      onclick: () => { draft.dimensions.push({ name: '新维度', max: 10, rule: '' }); render(); }
    }, icon('plus'), '添加维度'));
    editor.append(dimBox, h('div', { class: 'section-label', text: '等级划分' }));

    const lvBox = h('div', { class: 'dim-editor' });
    (draft.levels || []).forEach((l, i) => {
      lvBox.append(h('div', { class: 'level-edit-row' },
        h('input', { class: 'input', value: l.name, placeholder: '等级名', oninput: (e) => { l.name = e.target.value; } }),
        h('input', { class: 'input narrow', type: 'number', value: l.min, oninput: (e) => { l.min = Number(e.target.value) || 0; } }),
        h('input', { class: 'input narrow', type: 'number', value: l.max, oninput: (e) => { l.max = Number(e.target.value) || 0; } }),
        h('input', { class: 'input grow', value: l.desc || '', placeholder: '等级描述', oninput: (e) => { l.desc = e.target.value; } }),
        h('button', { class: 'btn icon ghost', onclick: () => { draft.levels.splice(i, 1); render(); } }, icon('trash'))
      ));
    });
    lvBox.append(h('button', {
      class: 'btn sm ghost',
      onclick: () => { draft.levels.push({ name: '新等级', min: 0, max: 10, desc: '' }); render(); }
    }, icon('plus'), '添加等级'));
    editor.append(lvBox);

    editor.append(h('div', { class: 'row', style: 'gap:10px;margin-top:22px' },
      h('button', { class: 'btn primary', onclick: async () => {
        const sum = (draft.dimensions || []).reduce((a, d) => a + (Number(d.max) || 0), 0);
        if (sum !== Number(draft.total)) {
          if (!confirm(`维度分值合计 ${sum} 与总分 ${draft.total} 不一致，仍然保存？`)) return;
        }
        const list = await window.api.saveTemplate(draft);
        state.templates = list;
        currentId = (list.find((t) => t.name === draft.name) || draft).id || currentId;
        toast('已保存');
        await reloadTemplates();
      } }, icon('check'), '保存'),
      h('button', { class: 'btn ghost', disabled: draft.builtin, title: draft.builtin ? '内置标准不可删除' : '', onclick: async () => {
        if (!confirm(`删除「${draft.name}」？`)) return;
        state.templates = await window.api.deleteTemplate(draft.id);
        currentId = state.templates[0]?.id;
        if (state.settings.templateId === draft.id) await saveSettings({ templateId: currentId });
        render();
      } }, icon('trash'), '删除'),
      h('button', { class: 'btn ghost', onclick: async () => {
        await saveSettings({ templateId: draft.id });
        toast(`批改默认标准已设为「${draft.name}」`);
      } }, '设为默认')
    ));
  }
  grid.append(editor);
  page.append(grid);

  return page;
}

function render() {
  const root = document.getElementById('view');
  root.replaceChildren(renderTemplates());
}

function field(label, control) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label', text: label }), control);
}

function select(options, value, onChange) {
  const el = h('select', { class: 'input', onchange: (e) => onChange(e.target.value) });
  for (const o of options) el.append(h('option', { value: o, text: o, selected: o === value }));
  return el;
}

function clone(x) { return x ? JSON.parse(JSON.stringify(x)) : null; }
