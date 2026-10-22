# 更新日志

本项目的所有重要变更都记录在这里，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [2.0.0] - 2026-10-22

彻底重写：.NET 8 / WinUI3 + StepFun 付费 API → Electron / Node.js + OpenCode Zen 免费模型。
目标从“能跑”改成“老师拿到安装包就能用，不配置、不付费”。

### Added

- **桌面应用（Electron 33）**：无边框窗口、深色主题、侧栏三页（批改台 / 评分标准 / 设置）。
- **内嵌引擎**：随安装包携带 `opencode2api` 与 `opencode.exe`，启动时自动挑空闲端口、
  以 `ELECTRON_RUN_AS_NODE` 拉起代理、轮询 `/health`，引擎数据隔离在 `%APPDATA%\essay-grader\opencode`。
- **三段流水线**：逐页 OCR → 纯文本校对 → 按模板批阅，进度事件实时推到界面。
- **人工校对页**：左原图 / 右逐句可编辑，四态标记（`ok` / `ocr_fix` / `author_error` / `verify`），
  改动 500ms 防抖自动保存，可「按当前文本批阅」覆盖旧成绩。
- **笔误清单**：`author_error` **只记录不改正文**，导出时单列，避免程序替学生改卷。
- **评分模板**：内置初中记叙文（50 分：内容20/结构10/语言15/书写5）、
  高中议论文（60 分：立意20/论证20/结构10/语言10），可自建维度、分值、等级线。
- **导出**：Markdown、Word（docx，A4 表格 + 分数大字）、PDF（隐藏窗口 `printToPDF`），支持一键导出全部。
- **备用模型兜底**：`ai.js` 的 `withFallback()`，主模型失败（限流/超时/JSON 不合法）自动切
  `opencode/minimax-m3.1-flash-free` 重跑一次，结果页标注实际使用的模型。
- **打包**：electron-builder + NSIS，`build/afterPack.cjs` 把 `opencode2api`（含 `node_modules`）整目录复制进
  `resources\backend\opencode2api`，安装包 121.4 MB，免管理员安装。
- **文档**：README、架构说明、提示词设计、打包与排错、issue/PR 模板、CI 与 release 工作流。

### Changed

- 提示词全部重写（`desktop/electron/prompts.js`）：
  - 识别阶段：逐字转录、错别字原样保留、不可辨用 `□`，配正误对照 few-shot。
  - 校对阶段：四态优先级 `verify → author_error → ocr_fix → ok`，明确“宁可让老师多看一眼，也不要悄悄改掉孩子的错字”。
  - 批阅阶段：强制引用原句、每类 3–5 条、维度分为整数且总和等于总分。
- 存储从 SQLite 改为单一 `store.json` + `papers/<id>/` 目录，便于备份与排查。
- 默认模型 `opencode/deepseek-v4.1-flash-free`，默认备用模型 `opencode/minimax-m3.1-flash-free`。

### Fixed

- 视觉模型把学生错字“自动纠正”（`玩要 → 玩耍`、`冲满 → 充满`）——
  提示词不足以扭转 OCR 先验，改为 `onlyHanSubstitutions()` 确定性兜底：同长度、1–2 处汉字替换一律判 `author_error`。
- 校对阶段把学生笔误判成 `ocr_fix` 并改写正文（同上）。
- 结果页三栏反馈文字一字一行：`.feedback-item` 的 `grid-template-columns:16px 1fr` 与单子节点不匹配，改 `display:block`。
- 结果页点「重批」后分数不刷新：`onProgress` 在 `done/error` 时按当前路由 `reloadPapers()` 再 `go('result')`。
- 「校对」页点了没反应：`review.js` 的 `chip()` 早于 `let only` 声明触发 TDZ `ReferenceError`；
  同时给 `renderView()` 加 try/catch、全局 `error` / `unhandledrejection` 兜底提示。
- 评分标准页等级行五列错位：新增 `.level-edit-row`（130px / 72px / 72px / 1fr / 30px）。
- 打包版永远「引擎启动中」：① `extraResources` 不复制 `node_modules` → `afterPack` 补齐；
  ② `backend.js` 在 asar 内重复拼 `resources` → 用 `path.dirname(appDir)`。
- 启动即退出：继承 `ELECTRON_RUN_AS_NODE=1` 让 `electron.exe` 变成 node 进程，启动前需清除该变量。
- 设置页备用模型仍是 Big Pickle：`store.js` 的 `load()` 增加迁移，旧值 `opencode/big-pickle`（纯文本，识别必失败）改写为 MiniMax。

### Removed

- StepFun API Key / BaseUrl / 推理强度等需要用户手工填写的配置项。
- 付费模型调用路径（v1 的 `StepFunClient.cs` 保留在 `src/` 作为历史参考）。

---

## 开发时间线（2026-10-22，本地时区 UTC+8）

| 时间 | 事件 |
| --- | --- |
| 20:33 | 拉取旧仓库，确认 v1 是 .NET 8 + StepFun 付费链路 |
| 20:41 | 装 opencode-ai 1.19.0 与 opencode2api，代理在 `127.0.0.1:10000` 起来 |
| 20:52 | 确认 0 凭据可用 11 个免费模型；发现 PowerShell 发中文变乱码（编码问题） |
| 21:03 | 直连 `opencode.ai/inference` 返回 403 `FreeTierError`，确定必须经 `opencode.exe` |
| 21:18 | v2 主体骨架完成（主进程 / 引擎 / 提示词 / 渲染层） |
| 21:24 | 首次端到端：识别 5.7s、校对 4.8s、批阅 14.9s，60 分制给出 32/60 |
| 21:31 | 发现模拟卷拍照后「学生笔误 0 处」→ 定位为 OCR 规范化 + 校对误判 |
| 21:38 | 加 `onlyHanSubstitutions()` 兜底，笔误链路打通（两处错字正确归到 `author_error`） |
| 21:52 | 修 review 页 TDZ、结果页刷新与 feedback 布局，逐页截图验证 |
| 22:07 | 打包首次成功（121 MB NSIS），但打包版引擎起不来 |
| 22:16 | 定位 `node_modules` 缺失 + asar 路径拼接两处 bug，修好后打包版实跑 31/50、36/50 |
| 22:24 | 导出 Markdown / Word / PDF 实测落盘 |
| 22:31 | 兜底模型改 MiniMax M3.1 Flash（21.4s 出合法 JSON），加配置迁移与设置页下拉 |
| 22:40 | 重打安装包 121.4 MB，写 README 与本文档 |
