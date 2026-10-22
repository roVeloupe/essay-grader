'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, protocol, net, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { Store } = require('./store');
const { Backend } = require('./backend');
const { Runner } = require('./runner');
const { toMarkdown, toDocx } = require('./export');

const isDev = process.argv.includes('--dev');
const APP_ROOT = path.join(__dirname, '..');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

let win = null;
let store = null;
let backend = null;
let runner = null;
const logs = [];

function log(line) {
  const s = `[${new Date().toISOString()}] ${line}`;
  logs.push(s);
  if (logs.length > 800) logs.shift();
  if (isDev) console.log(s);
  // 落盘：打包后没有控制台，老师反馈问题时要能拿到运行日志
  try {
    if (app.isReady()) fs.appendFileSync(path.join(app.getPath('userData'), 'engine.log'), s + '\r\n');
  } catch { /* 日志失败不影响主流程 */ }
  win?.webContents.send('app:log', s);
}

function createWindow() {
  nativeTheme.themeSource = store?.settings.theme || 'system';
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#151517' : '#f7f7f8',
    title: '语文作文批改助手',
    titleBarStyle: 'hidden',
    ...(process.platform === 'win32'
      ? {
          titleBarOverlay: {
            color: '#00000000',
            symbolColor: nativeTheme.shouldUseDarkColors ? '#e6e6e6' : '#3a3d42',
            height: 36
          }
        }
      : {}),
    trafficLightPosition: { x: 16, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  win.loadFile(path.join(APP_ROOT, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) win.webContents.openDevTools({ mode: 'detach' });
}

function applyTheme() {
  const t = store.settings.theme || 'system';
  nativeTheme.themeSource = t;
  if (win && process.platform === 'win32') {
    win.setTitleBarOverlay({
      color: '#00000000',
      symbolColor: nativeTheme.shouldUseDarkColors ? '#e6e6e6' : '#3a3d42',
      height: 36
    });
  }
  win?.webContents.send('app:theme', { dark: nativeTheme.shouldUseDarkColors, source: t });
}

function exportDir() {
  const dir = store.settings.exportDir || path.join(app.getPath('documents'), '作文批改');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeName(s) {
  return String(s || '作文').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
}

async function exportPaper(paper, format) {
  const template = store.templates.find((t) => t.id === paper.templateId);
  const dir = exportDir();
  const base = safeName(`${paper.title || paper.name}_${paper.author || ''}`.replace(/_$/, ''));
  if (format === 'md') {
    const file = path.join(dir, `${base}.md`);
    fs.writeFileSync(file, toMarkdown(paper, template), 'utf8');
    return file;
  }
  if (format === 'docx') {
    const file = path.join(dir, `${base}.docx`);
    await toDocx(paper, template, file);
    return file;
  }
  if (format === 'pdf') {
    const file = path.join(dir, `${base}.pdf`);
    const html = buildPrintHtml(paper, template);
    const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const buf = await w.webContents.printToPDF({ printBackground: true, margins: { marginType: 'default' }, pageSize: 'A4' });
    w.destroy();
    fs.writeFileSync(file, buf);
    return file;
  }
  throw new Error('未知导出格式');
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function buildPrintHtml(paper, template) {
  const g = paper.grade || {};
  const dims = (g.dimensions || [])
    .map((d) => `<tr><td>${esc(d.name)}</td><td>${d.score}</td><td>${d.max}</td><td>${esc(d.comment)}</td></tr>`)
    .join('');
  const list = (arr) =>
    (arr || []).map((i) => `<li>${esc(i.text)}${i.source ? `<div class="src">原文：「${esc(i.source)}」</div>` : ''}</li>`).join('');
  const paras = (paper.sentences || [])
    .reduce((acc, s) => {
      const k = s.paragraph || 1;
      (acc[k] = acc[k] || []).push(s.finalText || s.text);
      return acc;
    }, {});
  const body = Object.keys(paras)
    .sort((a, b) => a - b)
    .map((k) => `<p>${esc(paras[k].join(''))}</p>`)
    .join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: "Microsoft YaHei", "PingFang SC", serif; color:#1b1b1f; font-size: 11pt; line-height: 1.8; }
  h1 { text-align:center; font-size: 20pt; margin: 0 0 4px; }
  .meta { text-align:center; color:#777; font-size: 9pt; margin-bottom: 14px; }
  .score { text-align:center; font-size: 34pt; font-weight: 700; margin: 6px 0 2px; }
  .score small { font-size: 12pt; color:#888; font-weight: 400; }
  .level { text-align:center; color:#555; margin-bottom: 16px; }
  table { width:100%; border-collapse: collapse; margin: 8px 0 14px; font-size: 10pt; }
  th, td { border: 1px solid #ddd; padding: 5px 7px; text-align: left; }
  th { background:#f5f5f6; }
  h2 { font-size: 13pt; margin: 16px 0 6px; padding-left: 8px; border-left: 3px solid #333; }
  ul { padding-left: 18px; margin: 4px 0; }
  li { margin-bottom: 5px; }
  .src { color:#888; font-size: 9pt; }
  .body p { text-indent: 2em; margin: 6px 0; }
  </style></head><body>
  <h1>${esc(paper.title || paper.name)}</h1>
  <div class="meta">作者：${esc(paper.author || '未识别')}　|　${esc(template?.name || '')}</div>
  <div class="score">${g.total ?? '-'}<small> / ${template?.total ?? '-'}</small></div>
  <div class="level">${esc(g.level || '')}</div>
  <p>${esc(g.summary || '')}</p>
  <table><tr><th>维度</th><th>得分</th><th>满分</th><th>评价</th></tr>${dims}</table>
  <h2>优点</h2><ul>${list(g.pros)}</ul>
  <h2>问题与失分点</h2><ul>${list(g.cons)}</ul>
  <h2>修改建议</h2><ul>${list(g.suggestions)}</ul>
  <h2>作文原文</h2><div class="body">${body}</div>
  </body></html>`;
}

app.whenReady().then(async () => {
  store = new Store(app.getPath('userData'));
  backend = new Backend({ appDir: APP_ROOT, userDataDir: app.getPath('userData'), logger: log });
  runner = new Runner({ store, backend, emit: (ch, payload) => win?.webContents.send(ch, payload) });

  protocol.handle('app-media', (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const target = path.normalize(path.join(store.papersDir, rel));
    if (!target.startsWith(store.papersDir)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(target).toString());
  });

  Menu.setApplicationMenu(null);
  createWindow();

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    dataDir: app.getPath('userData'),
    exportDir: exportDir(),
    platform: process.platform,
    dark: nativeTheme.shouldUseDarkColors,
    backend: backend.status()
  }));

  ipcMain.handle('backend:start', async () => backend.start());
  ipcMain.handle('backend:status', async () => backend.status());
  ipcMain.handle('app:logs', () => logs.slice(-200));

  ipcMain.handle('settings:get', () => store.settings);
  ipcMain.handle('settings:save', (e, patch) => {
    const s = store.updateSettings(patch);
    if (patch && 'theme' in patch) applyTheme();
    return s;
  });

  ipcMain.handle('templates:list', () => store.templates);
  ipcMain.handle('templates:save', (e, t) => store.upsertTemplate(t));
  ipcMain.handle('templates:delete', (e, id) => store.deleteTemplate(id));

  ipcMain.handle('papers:list', () => store.papers);
  ipcMain.handle('papers:add', (e, { files, templateId, stage }) => {
    const created = [];
    for (const f of files) {
      const paper = store.createPaper({ name: path.basename(f).replace(/\.[^.]+$/, ''), files: [f] });
      store.updatePaper(paper.id, { templateId: templateId || store.settings.templateId, stage: stage || store.settings.stage });
      created.push(paper);
    }
    return created;
  });
  ipcMain.handle('papers:addBatch', (e, { groups, templateId, stage }) => {
    const created = [];
    for (const g of groups) {
      const paper = store.createPaper({ name: g.name, files: g.files });
      store.updatePaper(paper.id, { templateId: templateId || store.settings.templateId, stage: stage || store.settings.stage });
      created.push(paper);
    }
    return created;
  });
  ipcMain.handle('papers:update', (e, payload) => {
    const { id, patch, ...rest } = payload || {};
    return store.updatePaper(id, patch || rest);
  });
  ipcMain.handle('papers:delete', (e, id) => store.deletePaper(id));

  ipcMain.handle('dialog:pickImages', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: '选择作文图片',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp'] }]
    });
    return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle('dialog:pickDir', async () => {
    const r = await dialog.showOpenDialog(win, { title: '选择导出目录', properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? '' : r.filePaths[0];
  });
  ipcMain.handle('shell:openPath', async (e, p) => { await shell.openPath(p); });
  ipcMain.handle('shell:showItem', (e, p) => shell.showItemInFolder(p));

  ipcMain.handle('grade:start', async (e, ids) => {
    if (!backend.ready) await backend.start();
    runner.enqueue(ids);
    return { queued: ids.length };
  });
  ipcMain.handle('grade:cancel', (e, id) => runner.cancel(id));
  ipcMain.handle('grade:regrade', async (e, id) => {
    if (!backend.ready) await backend.start();
    runner.enqueueGrade([id]);
    return { ok: true };
  });

  ipcMain.handle('export:one', async (e, { id, format }) => {
    const paper = store.papers.find((p) => p.id === id);
    if (!paper) throw new Error('作文不存在');
    const file = await exportPaper(paper, format);
    return file;
  });
  ipcMain.handle('export:all', async (e, { ids, format }) => {
    const files = [];
    for (const id of ids) {
      const paper = store.papers.find((p) => p.id === id);
      if (!paper || paper.status !== 'graded') continue;
      try { files.push(await exportPaper(paper, format)); } catch (err) { log('导出失败 ' + err.message); }
    }
    return files;
  });

  backend
    .start()
    .then(() => {
      log('引擎就绪：http://127.0.0.1:' + backend.port + '/v1');
      win?.webContents.send('backend:status', backend.status());
    })
    .catch((err) => {
      log('后端启动失败：' + err.message);
      win?.webContents.send('backend:status', { ...backend.status(), error: err.message });
    });
});

app.on('window-all-closed', () => {
  backend?.stop();
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => backend?.stop());
