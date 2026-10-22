# 打包与分发

## 一、产物

| 目标 | 命令 | 产物 |
| --- | --- | --- |
| 免安装目录 | `npm run pack` | `desktop/dist/win-unpacked/` |
| NSIS 安装包 | `npm run dist` | `desktop/dist/语文作文批改助手-<version>-安装包.exe` |

安装包约 **121 MB**：Electron 运行时 ~90 MB + `opencode.exe` 172 MB（压缩后 ~60 MB）+ 代理依赖。

## 二、必要的环境变量

国内网络下 electron 与 NSIS 工具链都走镜像，且需要代理：

```powershell
$env:PATH = 'C:\Program Files\nodejs;' + $env:PATH
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
$env:HTTP_PROXY  = 'http://127.0.0.1:7897'
$env:HTTPS_PROXY = 'http://127.0.0.1:7897'
npm run dist
```

`PATH` 里必须有 node：`electron-builder` 的部分子进程会直接调用 `node`，
否则报 `'"node"' is not recognized as an internal or external command`（npm 自己的报错是 `exit 1`，很容易误判成构建失败）。

## 三、`build` 配置（package.json）

```json
{
  "build": {
    "appId": "com.essaygrader.desktop",
    "productName": "语文作文批改助手",
    "files": ["electron/**/*", "renderer/**/*", "package.json"],
    "extraResources": [
      { "from": "../opencode2api", "to": "backend/opencode2api" },
      { "from": "../bin/opencode.exe", "to": "bin/opencode.exe" }
    ],
    "win": { "target": [{ "target": "nsis", "arch": ["x64"] }], "icon": "build/icon.ico" },
    "nsis": { "oneClick": false, "allowToChangeInstallationDirectory": true },
    "afterPack": "build/afterPack.cjs"
  }
}
```

## 四、两个必须的补丁

### 1. `extraResources` 不复制 `node_modules`

`extraResources` 只搬文件，不展开依赖树。代理 `opencode2api` 需要 `express / axios / body-parser / @opencode-ai/sdk` 等 88 个包，
缺了就启动即崩。`build/afterPack.cjs` 在打包完成后整目录 `fs.cpSync`：

```js
const src = path.join(__dirname, '..', '..', 'opencode2api');
const dst = path.join(context.appOutDir, 'resources', 'backend', 'opencode2api');
fs.cpSync(src, dst, { recursive: true, dereference: true, filter: (p) => !/[\\/](\.git|tests?|docs?)[\\/]/.test(p) });
```

### 2. asar 内外路径语义不同

`app.getAppPath()` 在打包后是 `…\resources\app.asar`，
若照源码布局再拼 `..\resources` 会得到 `…\resources\resources\backend\…`，于是报「缺少 opencode2api 组件」。
`backend.js` 里按是否在 asar 内分支：

```js
const resources = appDir.includes('app.asar')
  ? path.dirname(appDir)                      // …\resources
  : path.join(appDir, '..');                  // 源码：desktop\..
```

## 五、常见失败

| 报错 | 根因 | 解法 |
| --- | --- | --- |
| `EPERM: operation not permitted, unlink ...\bin\opencode.exe` | 上次打包版/开发版留下的 `opencode.exe` 仍在运行，占用文件 | `Get-Process opencode, electron, 语文作文批改助手 -EA SilentlyContinue \| Stop-Process -Force`，等 3–4 秒再打包 |
| `'\"node\"' is not recognized` | `PATH` 缺 node 目录 | 前置 `C:\Program Files\nodejs` |
| `1 package has install scripts not yet covered by allowScripts: electron@…` | npm 11 默认拦截 install script，`electron` 的 postinstall 没跑 | 手动 `node node_modules\electron\install.js`，或 `npm config set ignore-scripts false` 后重装 |
| 打包版界面正常但永远「引擎启动中」 | 上面两个补丁任一没生效 | 看 `%APPDATA%\essay-grader\engine.log`：`缺少 opencode2api 组件` / `缺少 opencode 引擎` / `后端异常退出(1)` |

## 六、发布流程

1. 改 `desktop/package.json` 的 `version`，更新 `CHANGELOG.md`。
2. 打安装包，记录大小与 SHA256：
   ```powershell
   Get-FileHash 'dist\语文作文批改助手-2.0.0-安装包.exe' -Algorithm SHA256
   ```
3. `git tag v2.0.0 && git push origin v2.0.0` —— `.github/workflows/release.yml` 会在 windows-latest 上重跑构建并挂资产。
4. 在 Release 说明里贴 SHA256 与「安装包内嵌 opencode.exe，会被部分杀软误报，需加白名单」的提示。

## 七、杀软与签名

安装包未做代码签名（证书成本高于本项目定位）。需要注意：

- `opencode.exe` 180 MB 的静态二进制容易被启发式引擎标记；
- NSIS 自解压行为也会加分。
- 因此 README 与 Release 说明都要求用户把 `resources\bin\opencode.exe` 加入白名单，或选择「仍要运行」。

如果将来要签名，用 `electron-builder` 的 `win.certificateFile` + `CSC_KEY_PASSWORD`，其它配置不用改。
