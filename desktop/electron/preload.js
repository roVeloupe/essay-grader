'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => {
  const h = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('api', {
  info: () => ipcRenderer.invoke('app:info'),
  logs: () => ipcRenderer.invoke('app:logs'),
  backendStart: () => ipcRenderer.invoke('backend:start'),
  backendStatus: () => ipcRenderer.invoke('backend:status'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),

  listTemplates: () => ipcRenderer.invoke('templates:list'),
  saveTemplate: (t) => ipcRenderer.invoke('templates:save', t),
  deleteTemplate: (id) => ipcRenderer.invoke('templates:delete', id),

  listPapers: () => ipcRenderer.invoke('papers:list'),
  addPapers: (p) => ipcRenderer.invoke('papers:add', p),
  addPaperBatch: (p) => ipcRenderer.invoke('papers:addBatch', p),
  updatePaper: (p) => ipcRenderer.invoke('papers:update', p),
  deletePaper: (id) => ipcRenderer.invoke('papers:delete', id),

  pickImages: () => ipcRenderer.invoke('dialog:pickImages'),
  getFilePath: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return ''; }
  },
  pickDir: () => ipcRenderer.invoke('dialog:pickDir'),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p),

  startGrading: (ids) => ipcRenderer.invoke('grade:start', ids),
  cancelGrading: (id) => ipcRenderer.invoke('grade:cancel', id),
  regrade: (id) => ipcRenderer.invoke('grade:regrade', id),

  exportOne: (p) => ipcRenderer.invoke('export:one', p),
  exportAll: (p) => ipcRenderer.invoke('export:all', p),

  onProgress: on('progress'),
  onPaper: on('paper'),
  onLog: on('app:log'),
  onTheme: on('app:theme'),
  onBackend: on('backend:status')
});
