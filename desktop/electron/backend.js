'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

/**
 * 内嵌的 OpenCode 免费模型后端。
 *
 * 链路：本应用 → opencode2api（本机 127.0.0.1:10000）→ opencode server（127.0.0.1:10001）
 *      → OpenCode Zen 免费模型。
 *
 * 为什么不直连 Zen：Zen 免费层只允许 opencode 二进制内部请求，
 * 直连 https://opencode.ai/inference/openai/v1 会返回 403 FreeTierError。
 */

const HEALTH_TIMEOUT_MS = 60000;

function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function freePort(start) {
  return new Promise((resolve) => {
    const tryPort = (p) => {
      const srv = net.createServer();
      srv.once('error', () => tryPort(p + 1));
      srv.once('listening', () => srv.close(() => resolve(p)));
      srv.listen(p, '127.0.0.1');
    };
    tryPort(start);
  });
}

class Backend {
  constructor({ appDir, userDataDir, logger = () => {} }) {
    this.appDir = appDir;
    this.userDataDir = userDataDir;
    this.log = logger;
    this.child = null;
    this.port = 10000;
    this.backendPort = 10001;
    this.ready = false;
    this.lastError = '';
    this.starting = null;
  }

  resolvePaths() {
    const appDir = this.appDir;
    // 打包后 appDir 是 <安装目录>/resources/app.asar，它的上一级就是 resources，
    // 不能再拼一次 resources（否则会得到 resources/resources）。
    const inAsar = appDir.includes('app.asar');
    const resources = inAsar ? path.dirname(appDir) : path.join(appDir, '..');

    const candidates = [
      path.join(resources, 'backend', 'opencode2api'),
      path.join(appDir, '..', 'opencode2api'),
      path.join(appDir, '..', '..', 'opencode2api')
    ];
    const apiDir = candidates.find((p) => exists(path.join(p, 'index.js'))) || '';

    const binCandidates = [
      path.join(resources, 'bin', 'opencode.exe'),
      path.join(appDir, '..', 'bin', 'opencode.exe'),
      path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'opencode', 'opencode.exe')
    ];
    const opencode = binCandidates.find(exists) || '';
    return { apiDir, opencode, resources };
  }

  status() {
    return { ready: this.ready, port: this.port, error: this.lastError, paths: this.resolvePaths() };
  }

  async start() {
    if (this.ready) return this.status();
    if (this.starting) return this.starting;
    this.starting = this._start().finally(() => { this.starting = null; });
    return this.starting;
  }

  async _start() {
    const { apiDir, opencode } = this.resolvePaths();
    if (!apiDir) throw new Error('缺少 opencode2api 组件（resources/backend/opencode2api）');
    if (!opencode) throw new Error('缺少 opencode 引擎（resources/bin/opencode.exe）');

    const port = await freePort(10000);
    this.port = port;
    this.backendPort = port + 1;

    // 独立数据目录：绝不能碰用户已有的 ~/.local/share/opencode（旧库结构不兼容）
    const dataRoot = path.join(this.userDataDir, 'opencode');
    const dirs = {
      XDG_DATA_HOME: path.join(dataRoot, 'data'),
      XDG_CONFIG_HOME: path.join(dataRoot, 'config'),
      XDG_STATE_HOME: path.join(dataRoot, 'state'),
      XDG_CACHE_HOME: path.join(dataRoot, 'cache')
    };
    for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });

    const env = {
      ...process.env,
      ...dirs,
      OPENCODE_PATH: opencode,
      OPENCODE_SERVER_URL: `http://127.0.0.1:${this.backendPort}`,
      PORT: String(port),
      BIND_HOST: '127.0.0.1',
      MANAGE_BACKEND: 'true',
      DISABLE_TOOLS: 'true',
      USE_ISOLATED_HOME: 'false',
      WEB_PANEL_ENABLED: 'false',
      REQUEST_TIMEOUT_MS: '300000',
      OMIT_SYSTEM_PROMPT: 'true',
      NO_COLOR: '1',
      // 打包后 Node 由 Electron 自带运行时提供
      ELECTRON_RUN_AS_NODE: '1'
    };

    this.log(`启动后端 ${apiDir} (port ${port}, opencode ${path.basename(opencode)})`);
    const child = spawn(process.execPath, [path.join(apiDir, 'index.js')], {
      cwd: apiDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    this.child = child;

    const logPath = path.join(this.userDataDir, 'backend.log');
    const stream = fs.createWriteStream(logPath, { flags: 'a' });
    const pipe = (buf) => {
      const s = buf.toString();
      stream.write(s);
      for (const line of s.split(/\r?\n/)) if (line.trim()) this.log('[backend] ' + line.trim());
    };
    child.stdout.on('data', pipe);
    child.stderr.on('data', pipe);

    child.on('exit', (code) => {
      this.log(`后端退出 code=${code}`);
      if (this.child === child) {
        this.ready = false;
        this.child = null;
        if (code !== 0 && code !== null) this.lastError = `后端异常退出（${code}），详见 backend.log`;
      }
    });

    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await this.ping()) {
        this.ready = true;
        this.lastError = '';
        this.log('后端就绪');
        return this.status();
      }
      if (!this.child) break;
      await new Promise((r) => setTimeout(r, 600));
    }
    this.lastError = '后端启动超时（60s）';
    throw new Error(this.lastError);
  }

  async ping() {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 2500);
      const res = await fetch(`http://127.0.0.1:${this.port}/health`, { signal: ac.signal });
      clearTimeout(t);
      if (!res.ok) return false;
      const j = await res.json();
      return j?.status === 'ok';
    } catch {
      return false;
    }
  }

  stop() {
    if (this.child) {
      try { this.child.kill(); } catch {}
      this.child = null;
    }
    this.ready = false;
  }
}

module.exports = { Backend };
