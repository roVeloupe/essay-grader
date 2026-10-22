'use strict';

const fs = require('node:fs');
const path = require('node:path');

function fmtDate(iso) {
  const d = new Date(iso || Date.now());
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function bodyText(paper) {
  const paras = new Map();
  for (const s of paper.sentences || []) {
    const k = s.paragraph || 1;
    if (!paras.has(k)) paras.set(k, []);
    paras.get(k).push(s.finalText || s.text);
  }
  return [...paras.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, arr]) => '　　' + arr.join(''))
    .join('\n\n');
}

function toMarkdown(paper, template) {
  const g = paper.grade || {};
  const lines = [];
  lines.push(`# ${paper.title || paper.name}`);
  lines.push('');
  lines.push(`> 作者：${paper.author || '未识别'}　|　批改时间：${fmtDate(paper.gradedAt)}　|　评分标准：${template?.name || ''}`);
  lines.push('');
  lines.push(`## 得分：${g.total ?? '-'} / ${template?.total ?? '-'}　（${g.level || ''}）`);
  lines.push('');
  if (g.summary) {
    lines.push(`**总评**：${g.summary}`);
    lines.push('');
  }
  if (g.dimensions?.length) {
    lines.push('| 维度 | 得分 | 满分 | 评价 |');
    lines.push('| --- | --- | --- | --- |');
    for (const d of g.dimensions) {
      lines.push(`| ${d.name} | ${d.score} | ${d.max} | ${(d.comment || '').replace(/\|/g, '｜')} |`);
    }
    lines.push('');
  }
  const section = (title, arr) => {
    if (!arr?.length) return;
    lines.push(`## ${title}`);
    lines.push('');
    for (const item of arr) {
      lines.push(`- ${item.text}${item.source ? `\n  > 原文：「${item.source}」` : ''}`);
    }
    lines.push('');
  };
  section('优点', g.pros);
  section('问题与失分点', g.cons);
  section('修改建议', g.suggestions);
  if (g.highlights?.length) {
    lines.push('## 可分享的句子');
    lines.push('');
    for (const h of g.highlights) lines.push(`- 「${h}」`);
    lines.push('');
  }
  if (paper.authorErrors?.length) {
    lines.push('## 学生笔误清单');
    lines.push('');
    lines.push('| 原文 | 应为 | 类型 | 位置 |');
    lines.push('| --- | --- | --- | --- |');
    for (const e of paper.authorErrors) {
      lines.push(`| ${e.wrong} | ${e.right} | ${e.kind} | ${e.sentenceId} |`);
    }
    lines.push('');
  }
  lines.push('## 作文原文');
  lines.push('');
  lines.push(bodyText(paper));
  lines.push('');
  lines.push('---');
  lines.push(`由 语文作文批改助手 生成 · ${fmtDate(new Date().toISOString())}`);
  return lines.join('\n');
}

async function toDocx(paper, template, target) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType } = require('docx');
  const g = paper.grade || {};
  const FONT = 'Microsoft YaHei';
  const P = (text, opts = {}) =>
    new Paragraph({
      spacing: { after: opts.after ?? 120, line: opts.line ?? 320 },
      alignment: opts.align,
      children: [new TextRun({ text, font: FONT, size: opts.size ?? 22, bold: opts.bold, color: opts.color, italics: opts.italics })]
    });

  const children = [];
  children.push(P(paper.title || paper.name, { size: 40, bold: true, align: AlignmentType.CENTER, after: 80 }));
  children.push(P(`作者：${paper.author || '未识别'}　|　${fmtDate(paper.gradedAt)}　|　${template?.name || ''}`, { size: 18, color: '666666', align: AlignmentType.CENTER, after: 220 }));
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 220 },
      children: [
        new TextRun({ text: `${g.total ?? '-'}`, font: FONT, size: 64, bold: true }),
        new TextRun({ text: ` / ${template?.total ?? '-'}`, font: FONT, size: 28, color: '666666' }),
        new TextRun({ text: `　${g.level || ''}`, font: FONT, size: 26, color: '444444' })
      ]
    })
  );
  if (g.summary) children.push(P(g.summary, { size: 22, italics: false }));

  if (g.dimensions?.length) {
    const rows = [
      new TableRow({
        tableHeader: true,
        children: ['维度', '得分', '满分', '评价'].map(
          (t) => new TableCell({ children: [P(t, { bold: true, size: 20 })] })
        )
      }),
      ...g.dimensions.map(
        (d) => new TableRow({ children: [d.name, `${d.score}`, `${d.max}`, d.comment || ''].map((t) => new TableCell({ children: [P(t, { size: 20 })] })) })
      )
    ];
    children.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
    children.push(P('', { after: 120 }));
  }

  const block = (title, arr) => {
    if (!arr?.length) return;
    children.push(P(title, { size: 26, bold: true, after: 100 }));
    for (const item of arr) {
      children.push(P(`· ${item.text}`, { size: 21 }));
      if (item.source) children.push(P(`　原文：「${item.source}」`, { size: 19, color: '777777', after: 100 }));
    }
  };
  block('优点', g.pros);
  block('问题与失分点', g.cons);
  block('修改建议', g.suggestions);

  if (paper.authorErrors?.length) {
    children.push(P('学生笔误清单', { size: 26, bold: true, after: 100 }));
    for (const e of paper.authorErrors) children.push(P(`· 「${e.wrong}」应为「${e.right}」（${e.kind}）`, { size: 20 }));
  }

  children.push(P('作文原文', { size: 26, bold: true, after: 100 }));
  for (const line of bodyText(paper).split('\n\n')) children.push(P(line, { size: 22 }));

  const doc = new Document({ sections: [{ properties: {}, children }] });
  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(target, buf);
  return target;
}

module.exports = { toMarkdown, toDocx, bodyText, fmtDate };
