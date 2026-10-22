'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_BASE = 'http://127.0.0.1:10000/v1';
const DEFAULT_MODEL = 'opencode/deepseek-v4.1-flash-free';

class AiError extends Error {
  constructor(message, { retryable = false } = {}) {
    super(message);
    this.name = 'AiError';
    this.retryable = retryable;
  }
}

function mimeOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.bmp') return 'image/bmp';
  return 'image/jpeg';
}

function toDataUrl(file) {
  return `data:${mimeOf(file)};base64,${fs.readFileSync(file).toString('base64')}`;
}

/** 从模型输出里提取 JSON（容忍 ```json 包裹、前后废话、尾随逗号）。 */
function extractJson(text) {
  if (!text || typeof text !== 'string') throw new AiError('模型返回为空');
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.search(/[[{]/);
  if (start < 0) throw new AiError('模型没有返回 JSON：' + s.slice(0, 120));
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) throw new AiError('模型返回的 JSON 不完整');
  let raw = s.slice(start, end + 1);
  try {
    return JSON.parse(raw);
  } catch {
    raw = raw.replace(/,\s*([}\]])/g, '$1');
    try { return JSON.parse(raw); } catch (e) {
      throw new AiError('JSON 解析失败：' + e.message);
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 主模型失败（请求错、超时、JSON 解析不了）时自动换备用模型再跑一次。
 * 免费模型会限流、会抽风，兜底比报错更有用。
 */
async function withFallback({ model, fallbackModel, onLog, run }) {
  try {
    return await run(model);
  } catch (e) {
    if (!fallbackModel || fallbackModel === model) throw e;
    onLog?.(`主模型 ${model} 失败（${e.message}），改用备用模型 ${fallbackModel}`);
    try {
      return await run(fallbackModel);
    } catch (e2) {
      throw new AiError(`主模型与备用模型都失败：${e.message} / ${e2.message}`);
    }
  }
}

/**
 * OpenAI 兼容的 chat 调用（走本机 opencode2api 代理）。
 * @param {object} p
 * @param {string} p.base
 * @param {string} p.model
 * @param {string} p.system
 * @param {string|Array} p.user
 * @param {number} [p.timeoutMs]
 * @param {number} [p.maxTokens]
 * @param {(msg:string)=>void} [p.onLog]
 */
async function chat({ base = DEFAULT_BASE, model = DEFAULT_MODEL, system, user, timeoutMs = 240000, maxTokens = 8000, onLog, signal }) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: user });

  const body = JSON.stringify({
    model,
    messages,
    stream: false,
    temperature: 0.2,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' }
  });

  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const onAbort = () => ac.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body,
        signal: ac.signal
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new AiError(`HTTP ${res.status} ${t.slice(0, 200)}`, { retryable: res.status >= 500 || res.status === 429 });
      }
      const json = await res.json();
      const text = json?.choices?.[0]?.message?.content ?? '';
      const usage = json?.usage || {};
      onLog?.(`model=${model} prompt=${usage.prompt_tokens || 0} completion=${usage.completion_tokens || 0}`);
      return { text, usage, json };
    } catch (e) {
      lastErr = e;
      const aborted = e.name === 'AbortError';
      if (aborted && !signal?.aborted) lastErr = new AiError(`请求超时（${Math.round(timeoutMs / 1000)}s）`, { retryable: true });
      if (attempt === 3 || (e.retryable === false && !aborted)) break;
      onLog?.(`第 ${attempt} 次失败：${lastErr.message}，重试…`);
      await sleep(1500 * attempt);
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }
  throw lastErr instanceof AiError ? lastErr : new AiError(String(lastErr?.message || lastErr));
}

/** 识别单页图片。 */
async function recognizePage({ image, page = 1, base, model, fallbackModel, onLog, signal }) {
  const { buildRecognize } = require('./prompts');
  const p = buildRecognize({ page });
  const user = [
    { type: 'text', text: p.user },
    { type: 'image_url', image_url: { url: toDataUrl(image) } }
  ];
  return withFallback({
    model,
    fallbackModel,
    onLog,
    run: async (m) => {
      const r = await chat({ base, model: m, system: p.system, user, onLog, signal, maxTokens: 6000 });
      const data = extractJson(r.text);
      const sentences = [];
      for (const para of data.paragraphs || []) {
        for (const s of para.sentences || []) {
          if (!s?.text) continue;
          sentences.push({
            id: s.id || `p${para.index || 1}s${sentences.length + 1}`,
            paragraph: para.index || 1,
            text: String(s.text).trim(),
            confidence: typeof s.confidence === 'number' ? s.confidence : 0.9,
            needVerify: !!s.need_verify
          });
        }
      }
      if (!sentences.length) throw new AiError('识别结果为空，请检查图片是否清晰');
      return {
        page,
        model: m,
        title: data.title?.text || '',
        author: data.author?.text || '',
        confidence: Math.min(...sentences.map((s) => s.confidence)),
        sentences,
        usage: r.usage
      };
    }
  });
}

/** 仅把个别汉字替换掉（其余字符完全相同）——这类修改无法区分“学生写错”与“识别错”。 */
function onlyHanSubstitutions(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diffs = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === b[i]) continue;
    if (!/[\u4e00-\u9fa5]/.test(a[i]) || !/[\u4e00-\u9fa5]/.test(b[i])) return false;
    diffs += 1;
    if (diffs > 2) return false;
  }
  return diffs > 0;
}

/** 校对全部句子：分开 ocr_fix 与 author_error。 */
async function correctSentences({ sentences, base, model, fallbackModel, onLog, signal }) {
  const { buildCorrect } = require('./prompts');
  const p = buildCorrect(sentences.map((s) => ({ id: s.id, text: s.text })));
  return withFallback({
    model,
    fallbackModel,
    onLog,
    run: async (m) => {
      const r = await chat({ base, model: m, system: p.system, user: p.user, onLog, signal, maxTokens: 8000 });
      return { sentences: mergeSentences(sentences, extractJson(r.text)), model: m, usage: r.usage };
    }
  });
}

/** 把模型返回的判断合回原句。 */
function mergeSentences(sentences, data) {
  const list = Array.isArray(data.sentences) ? data.sentences : [];
  // 模型偶尔会改写 id（去掉页码前缀、换成 p1s1）。先按原 id 对，
  // 再按去掉前缀的短 id 对，最后按顺序兜底，避免整篇被判成"需人工核对"。
  const shortId = (id) => String(id || '').replace(/^\d+-/, '');
  const byId = new Map();
  const byShort = new Map();
  list.forEach((s, i) => {
    if (s?.id != null) {
      byId.set(String(s.id), s);
      byShort.set(shortId(s.id), s);
    }
    if (!s?.id) byId.set(`__idx${i}`, s);
  });
  return sentences.map((s, i) => {
    let c = byId.get(s.id) || byShort.get(shortId(s.id));
    if (!c && list.length === sentences.length) c = list[i];
    if (!c) c = {};
    let verdict = ['ok', 'ocr_fix', 'author_error', 'verify'].includes(c.verdict) ? c.verdict : 'verify';
    const fixedText = c.text ? String(c.text).trim() : '';
    // 模型有时标成 ocr_fix 却没真的改（或只把问题写进 issues）。
    // 这时按"学生笔误"处理：保留原文，问题进笔误表。
    if (verdict === 'ocr_fix' && (!fixedText || fixedText === s.text)) {
      verdict = Array.isArray(c.issues) && c.issues.length ? 'author_error' : 'verify';
    }
    // 只差一两个汉字的修改，模型分不清“孩子写错”还是“识别错”，一律按学生笔误处理：
    // 保留原文，把差异写进笔误表，交给老师对照原图判断。宁可多看一眼，也不悄悄改字。
    if (verdict === 'ocr_fix' && fixedText && onlyHanSubstitutions(s.text, fixedText)) {
      verdict = 'author_error';
      if (!Array.isArray(c.issues) || !c.issues.length) {
        c.issues = [{ wrong: '', right: '', kind: '错别字', reason: `疑似笔误：识别为「${fixedText}」，请对照原图确认` }];
      }
    }
    return {
      ...s,
      verdict,
      finalText: verdict === 'ocr_fix' && fixedText ? fixedText : s.text,
      issues: Array.isArray(c.issues) ? c.issues : [],
      needVerify: verdict === 'verify' || verdict === 'author_error' || !!c.need_verify
    };
  });
}

/** 批阅。 */
async function gradeEssay({ body, template, authorErrors, stage, base, model, fallbackModel, onLog, signal }) {
  const { buildGrade } = require('./prompts');
  const p = buildGrade({ body, template, authorErrors, stage });
  return withFallback({
    model,
    fallbackModel,
    onLog,
    run: async (m) => {
      const r = await chat({ base, model: m, system: p.system, user: p.user, onLog, signal, maxTokens: 6000 });
      const data = extractJson(r.text);
      const dims = (data.dimensions || []).map((d, i) => ({
        name: d.name || template.dimensions[i]?.name || `维度${i + 1}`,
        score: clampScore(d.score, 0, d.max || template.dimensions[i]?.max || 0),
        max: Number(d.max) || template.dimensions[i]?.max || 0,
        comment: d.comment || ''
      }));
      const sum = dims.reduce((a, d) => a + d.score, 0);
      const total = Number.isFinite(Number(data.total)) ? Math.round(Number(data.total)) : sum;
      return {
        model: m,
        total: Math.min(template.total, Math.max(0, total || sum)),
        level: data.level || '',
        summary: data.summary || '',
        dimensions: dims,
        pros: normList(data.pros),
        cons: normList(data.cons),
        suggestions: normList(data.suggestions),
        highlights: Array.isArray(data.highlights) ? data.highlights.slice(0, 3) : [],
        usage: r.usage
      };
    }
  });
}

function clampScore(v, min, max) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function normList(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => (typeof x === 'string' ? { text: x, source: '' } : { text: x?.text || '', source: x?.source || '' }))
    .filter((x) => x.text);
}

module.exports = { chat, recognizePage, correctSentences, gradeEssay, extractJson, AiError, DEFAULT_BASE, DEFAULT_MODEL, toDataUrl };
