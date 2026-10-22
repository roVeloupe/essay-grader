# 架构说明

## 一、进程模型

```
essay-grader.exe（Electron 主进程）
├── BrowserWindow（无边框，titleBarOverlay 36px）
│   └── renderer/index.html —— 零构建 ES Module 前端
└── child_process: node opencode2api/index.js   （ELECTRON_RUN_AS_NODE=1）
    └── child_process: opencode.exe serve --port 10001
```

- **主进程**持有全部业务逻辑与磁盘状态，渲染层只做展示与交互，通过 `contextBridge` 走 IPC。
- **引擎子进程**是第三方代理 `opencode2api`，它再拉起 `opencode.exe`。
  免费模型只能经 `opencode.exe` 访问（见 issue「直连 403 FreeTierError」），所以这两个进程必须随包分发。
- 引擎数据目录通过 `XDG_DATA_HOME` / `XDG_CONFIG_HOME` / `XDG_STATE_HOME` / `XDG_CACHE_HOME`
  指向 `%APPDATA%\essay-grader\opencode`，**绝不写用户已有的 `%LOCALAPPDATA%\opencode`**
  （旧版本库结构不兼容时 opencode 会直接报 `Database is not empty and has no session table` 退出）。

## 二、引擎生命周期（`desktop/electron/backend.js`）

1. `resolvePaths()` 定位两样东西：
   - 代理目录：`resources/backend/opencode2api`（打包）→ `../opencode2api`（源码）→ `../../opencode2api`
   - 引擎二进制：`resources/bin/opencode.exe` → `../bin/opencode.exe` → `%APPDATA%\npm\node_modules\opencode-ai\bin\opencode.exe`
2. `freePort(10000)` 从 10000 起找一个空闲端口（被占用就顺延）。
3. `spawn(process.execPath, [index.js], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', XDG_* } })`
   —— 用 Electron 自带的 Node 跑代理，安装包不必再带一个 Node 运行时。
4. 每 250ms 轮询 `GET /health`，最多 60s；成功即 `ready=true` 并把端口号回传渲染层（标题栏显示「引擎就绪 · 10000」）。
5. 日志追加写 `%APPDATA%\essay-grader\engine.log`（**UTF-8**；用 PowerShell 读要注意编码，见排错文档）。

## 三、IPC 一览（`preload.js` → `window.api.*`）

| 通道 | 作用 |
| --- | --- |
| `app:info` | 版本、数据目录、导出目录、模板、设置、引擎状态 |
| `backend:start` / `backend:status` | 手动重启引擎 / 查询状态（事件 `backend:status` 也会主动推） |
| `settings:get` / `settings:save` | 读写设置（含模型、备用模型、并发、阈值、导出格式） |
| `templates:list` / `templates:save` / `templates:delete` | 评分模板 CRUD（内置模板不可删） |
| `papers:list` / `papers:add` / `papers:addBatch` / `papers:update` / `papers:delete` | 作文 CRUD |
| `dialog:pickImages` / `dialog:pickDir` | 原生文件/目录选择 |
| `shell:openPath` / `shell:showItem` | 打开导出目录 / 在资源管理器定位文件 |
| `grade:start` / `grade:cancel` / `grade:regrade` | 开始批改 / 停止 / 只按当前文本重批 |
| `export:one` / `export:all` | 导出单篇 / 全部（`md` / `docx` / `pdf`） |

事件：`progress`（阶段与百分比）、`paper`（记录更新）、`log`（引擎日志摘要）、`theme`、`backend:status`。

`papers:update` 兼容两种载荷形状：`{ id, patch }` 与 `{ id, ...字段 }`。

## 四、数据契约

```js
paper = {
  id, name, images: [], createdAt,
  status: 'ready' | 'running' | 'graded' | 'error',
  templateId, title, author,
  sentences: [sentence], authorErrors: [error], grade: gradeResult,
  error, timing: { ocr, correct, grade, total }, gradedAt
}

sentence = {
  id,                       // `${page}-p${paragraph}s${index}`
  paragraph, text,          // 识别出的原文
  confidence, needVerify,
  verdict: 'ok' | 'ocr_fix' | 'author_error' | 'verify',
  finalText,                // 老师确认后的正文（author_error 时等于 text）
  issues: [{ wrong, right, kind, reason }]
}

gradeResult = {
  total, level, summary,
  dimensions: [{ name, score, max, comment }],
  pros / cons / suggestions: [{ text, source }],
  highlights, model
}
```

存储布局：

```
%APPDATA%\essay-grader\
├── store.json          所有作文、模板、设置
├── papers\<id>\page-01.jpg
├── engine.log          引擎启动与错误
├── backend.log         代理输出
└── opencode\{data,config,state,cache}
```

## 五、流水线（`runner.js`）

```
runOne(id)
 ├─ 逐页 recognizePage(image)  → 合并句子（段落按页内顺序）
 ├─ correctSentences(全部句子) → verdict + finalText + authorErrors
 └─ gradeEssay(正文 + 模板 + authorErrors) → gradeResult
```

- 并发由 `settings.concurrency` 控制（默认 1，免费通道限流时调大只会更慢）。
- `runOneGrade(id)` 复用已有句子只跑批阅，供「按当前文本批阅」使用：
  正文取 `sentences.filter(s => s.verdict !== 'verify').map(s => s.finalText || s.text)`，按段落 `\n\n` 拼接。
- 进度事件：`{ paperId, stage, pct, message }`，`stage` ∈ `ocr | correct | grade | done | error`。

## 六、渲染层

零构建 ES Module，五个视图：

| 文件 | 视图 |
| --- | --- |
| `views/desk.js` | 批改台：拖放导入、筛选、行内操作、多选、导出全部 |
| `views/review.js` | 识别与校对：左原图右逐句、四态高亮、防抖保存 |
| `views/result.js` | 批改结果：分数 hero、维度条、三栏建议、笔误表 |
| `views/templates.js` | 评分标准：维度行与等级行编辑 |
| `views/settings.js` | 设置：引擎状态、模型、学段、并发、导出、主题 |

状态集中在 `js/state.js`（`subscribe/emit`），路由在 `js/app.js` 的 `renderView()`，
所有视图函数包在 try/catch 里，异常时渲染错误页而不是白屏。

## 七、打包产物结构

```
语文作文批改助手-2.0.0-安装包.exe    121 MB（NSIS，免管理员）
└── 安装后
    ├── 语文作文批改助手.exe
    └── resources\
        ├── app.asar                    Electron 应用（electron/ + renderer/）
        ├── bin\opencode.exe            172 MB 引擎（OpenCode Zen 免费通道）
        └── backend\opencode2api\       代理源码 + node_modules（88 个包）
```

`extraResources` 不复制 `node_modules`，因此 `build/afterPack.cjs` 在打包后整目录 `cpSync` 补齐；
`backend.js` 又必须按 asar 内外的差异计算 `resources` 根目录，否则会拼成
`resources\resources\backend\...` 而报「缺少组件」。两件事都必须做对，否则安装包“能装、打不开”。
