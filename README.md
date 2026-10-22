# 语文作文批改助手 · Essay Grader

把学生作文**拍成照片**，自动完成 **识别 → 校对 → 按标准批阅 → 导出** 的桌面工具。
面向初高中语文老师，Windows 桌面，**不需要 API Key、不需要注册、不花钱**。

> 本仓库有两条线：
> - **`desktop/`（v2，推荐）** —— Electron + Node.js 重写，接 OpenCode Zen 免费模型，双击即用。
> - **`src/`（v1，legacy）** —— 旧的 .NET 8 / WinUI3 版本，依赖 StepFun 付费 API，留作参考，不再维护。

---

## 为什么重写

旧版要求老师自己去申请 StepFun 的 API Key、自己填 BaseUrl、自己付钱。
使用门槛全在“配置”和“费用”这两件事上，而目标用户（笔记本 8G 内存、10 代酷睿、不会读日志）恰恰最怕这两件事。

v2 把这两件事一起解决：

| | v1（.NET 8） | v2（Electron） |
| --- | --- | --- |
| 模型来源 | StepFun `step-3.7-flash`，自备 Key、按量付费 | OpenCode Zen 免费模型，**零配置、零费用** |
| 运行依赖 | .NET 8 运行时 + WinUI3 | 无（Electron 自带运行时） |
| 安装方式 | 手动部署 / 自己编译 | 一个 NSIS 安装包，双击下一步 |
| 引擎 | 直连云端 API | 安装包内嵌 `opencode.exe` + 本机代理，`127.0.0.1` 起服务 |
| 提示词 | 三段通用提示词 | 三段重写：识别保真 / 校对四态 / 批阅引用原文 |
| 兜底 | 无 | 主模型失败自动切备用模型（MiniMax M3.1 Flash） |

---

## 功能

- **批量导入**：拖拽或选择图片（`jpg/jpeg/png/bmp/webp`），同一篇多页一次导入按文件名顺序合并。
- **逐句识别**：多模态模型输出标题、作者、逐句正文、置信度与段落归属。
- **人工校对**：左侧原图、右侧逐句可编辑；四态标记（正常 / 学生笔误 / 识别修正 / 待核对）。
- **笔误**：**只记录、不改正文**——学生的错字必须留给老师批，程序不替学生改卷。
- **按标准批阅**：内置初中记叙文（50 分）、高中议论文（60 分）两套模板，可自建维度/分值/等级线。
- **结果页**：总分 + 等级 + 维度分条 + 做得好的地方 / 需要改进的地方 / 下一步怎么练（均引用原文）+ 笔误清单。
- **导出**：Markdown / Word（`docx`，A4 版式）/ PDF，可单篇或一键导出全部。
- **断网也能看**：作文与照片存在本机 `%APPDATA%\essay-grader`，卸载不删。

---

## 快速开始（用户）

1. 到 [Releases](../../releases) 下载 `语文作文批改助手-2.0.0-安装包.exe`。
2. 双击安装（默认装当前用户目录，不需要管理员权限）。
3. 打开后：拖入作文照片 → 「开始批改」→ 等 30–60 秒 → 点开看结果 → 导出 Word。

详细步骤（含“批改前先核对原文”）见 [`desktop/README.md`](desktop/README.md)。

## 快速开始（开发）

```powershell
# 1. 前端依赖
cd desktop
npm install
node node_modules\electron\install.js   # npm 11 拦截 install script 时需要手动补

# 2. 本机引擎：opencode 二进制 + 代理
#    opencode.exe  → desktop\..\bin\opencode.exe
#    opencode2api  → desktop\..\opencode2api\（git clone 后 npm install）
#    也可直接跑 tools\setup-backend.ps1 自动准备

# 3. 起开发版
$env:PATH = 'C:\Program Files\nodejs;' + $env:PATH
npm start
```

打包成安装包：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run dist     # 产物：desktop\dist\语文作文批改助手-2.0.0-安装包.exe
```

---

## 架构

```
┌──────────────────────────── Electron 主进程 ────────────────────────────┐
│  main.js      窗口 / IPC / 导出 / app-media 协议                        │
│  backend.js   拉起内嵌引擎：挑空闲端口 → 隔离 XDG 目录 → spawn 代理 → 轮询 /health │
│  runner.js    队列与三阶段编排，进度事件推到渲染层                       │
│  ai.js        OpenAI 兼容调用 + JSON 提取 + 失败切备用模型 + 笔误兜底    │
│  prompts.js   识别 / 校对 / 批阅 三段提示词                             │
│  store.js     JSON 存储 + 内置评分模板                                  │
│  export.js    Markdown / docx / PDF                                     │
└─────────────────────────────────┬──────────────────────────────────────┘
                                  │ HTTP（127.0.0.1，随机空闲端口）
┌─────────────────────────────────▼──────────────────────────────────────┐
│  opencode2api（内嵌 Node 子进程，ELECTRON_RUN_AS_NODE）                 │
│      └── opencode.exe（OpenCode Zen 免费通道的唯一合法入口）            │
└────────────────────────────────────────────────────────────────────────┘
```

渲染层是**零构建**的 ES Module 前端（`desktop/renderer/`），直接用 `<script type="module">` 加载，
没有 webpack/vite，改完刷新即生效。

数据流：

```
照片 → base64 data URL → 多模态识别（逐句 + confidence）
     → 纯文本校对（ok / ocr_fix / author_error / verify）
     → 按模板维度评分（分数 + 等级 + 建议，全部引用原文）
     → Markdown / docx / PDF
```

细节见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

---

## 提示词设计（这是本项目最核心的部分）

三段提示词解决三种不同的失败模式：

| 阶段 | 失败模式 | 对策 |
| --- | --- | --- |
| 识别 | 视觉模型会“顺手把错字改成对的” | 强约束逐字转录 + 正误对照 few-shot + 保留 `□` 表示不可辨 |
| 校对 | 模型把“学生写错”解释成“OCR 认错”，于是替学生改卷 | 四态优先级 `verify → author_error → ocr_fix → ok`，`author_error` 正文必须与原文一致 |
| 批阅 | 空泛套话、不引原文、维度分与总分对不上 | 强制引用原句、每类 3–5 条、分数为整数且总和等于总分 |

但实测结论是：**提示词压不住模型的 OCR 先验**。
「玩要 → 玩耍」在识别阶段仍然被自动纠正，在校对阶段仍被判成 `ocr_fix`。
因此在 `ai.js` 里加了确定性兜底 `onlyHanSubstitutions()`：同长度、仅 1–2 处汉字替换 → 一律判 `author_error`，正文保留原字。
提示词负责“大部分”，代码负责“兜底”。详见 [`docs/PROMPTS.md`](docs/PROMPTS.md)。

---

## 免费额度

- 默认 `opencode/deepseek-v4.1-flash-free`（200k 上下文，支持图片）。
- 备用 `opencode/minimax-m3.1-flash-free`（1M 上下文，支持图片）。
- 免费通道**有频率限制**：连续批改偶尔要等 1–3 分钟，或返回无法解析的内容。
  主模型失败会自动切备用模型重跑一次；仍失败就点「重批」，已识别校对的内容不会丢。
- 「同时批改篇数」建议保持 1，调大更容易被限流。

---

## 遇到问题时

本项目开发过程中踩到的每个坑都开成了 issue 并写了解法，按时间排序：

→ [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) · [Issues](../../issues?q=is%3Aissue)

高频的几个：

| 症状 | 去处 |
| --- | --- |
| 状态一直「引擎启动中…」 | `%APPDATA%\essay-grader\engine.log`，见 [#8](../../issues/8) / [#14](../../issues/14) |
| `EPERM ... opencode.exe` 打包失败 | 先结束 `opencode.exe` 进程，见 [#15](../../issues/15) |
| 学生错字被程序改掉了 | 已修（`onlyHanSubstitutions` 兜底），见 [#11](../../issues/11) |
| 点「校对」没反应 | 已修（TDZ），见 [#12](../../issues/12) |

---

## 目录

```
desktop/            v2 应用（Electron）
  electron/         主进程：窗口 / 引擎 / 提示词 / 调用 / 队列 / 存储 / 导出
  renderer/         零构建前端：批改台 / 校对 / 结果 / 评分标准 / 设置
  build/            afterPack 钩子与图标
docs/               架构、提示词、打包、排错
tools/              引擎准备脚本与配置样例
src/                v1（.NET 8）legacy 代码
.github/            issue/PR 模板、CI、release 工作流
```

## 许可

未声明许可证前，保留所有权利。若需引用，请先开 issue 联系作者。
