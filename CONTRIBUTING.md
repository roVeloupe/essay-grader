# 贡献指南

## 环境

- Node.js ≥ 20（开发用 24 实测）
- Windows 10/11 x64（本项目只面向 Windows 桌面）
- 代理可选，仅打包时需要拉 electron 镜像

## 本地跑起来

```powershell
cd desktop
npm install
node node_modules\electron\install.js   # npm 11 拦截 install script 时手动补

# 引擎依赖（二选一）
#  A. 自动准备
powershell -ExecutionPolicy Bypass -File ..\tools\setup-backend.ps1
#  B. 手动：clone opencode2api 到 essay-grader-rework\opencode2api，
#     下载 opencode.exe 放到 essay-grader-rework\bin\opencode.exe

$env:PATH = 'C:\Program Files\nodejs;' + $env:PATH
npm start
```

首次启动会在 `%APPDATA%\essay-grader\` 建数据目录，并拉起内嵌引擎（端口 10000 起）。

## 代码约定

- 主进程一律 CommonJS（`'use strict'`），渲染层一律 ES Module，**不引入构建工具**。
- 渲染层禁止 `innerHTML` 拼接用户内容，统一用 `js/util.js` 的 `h()` 构造 DOM。
- 任何"正确性依赖模型自觉"的逻辑都要有代码兜底（见 `ai.js` 的 `onlyHanSubstitutions`）。
- 提示词改动必须在 `docs/PROMPTS.md` 里同步"为什么这样改"和实测结果。

## 提交信息

`type(scope): 说明`，type 取 `feat|fix|docs|build|ci|refactor|test|chore`。
修 bug 请在正文写清「现象 → 根因 → 验证方式」，方便对照 issue。

## 提 issue

- 用模板，附上 `%APPDATA%\essay-grader\engine.log` 的相关片段（**注意脱敏路径**）。
- 涉及识别质量的问题请附一张脱敏后的作文图，否则无法复现。

## 发布

见 [`docs/PACKAGING.md`](PACKAGING.md) 第六节。
