# 排错手册

按“老师会遇到的”和“开发/打包会遇到的”分开。每条都对应一个已关闭的 issue，里面有根因和验证过程。

---

## 一、老师侧（安装后使用）

### 1. 标题栏一直「引擎启动中…」

先等 30 秒（机械硬盘首次启动要解压 180 MB 的引擎）。仍然不动，看
`%APPDATA%\essay-grader\engine.log`：

| 日志 | 含义 | 处理 |
| --- | --- | --- |
| `缺少 opencode2api 组件` | 安装不完整 | 重装（见 [#14](../../issues/14)） |
| `缺少 opencode 引擎` | `resources\bin\opencode.exe` 被杀软隔离 | 加白名单后重装 |
| `后端异常退出（1）` | 代理崩了 | 同上；或看 `backend.log` 第一行 |
| `Database is not empty ...` | 引擎读到了别人的数据目录 | 不该出现；若出现说明 XDG 隔离失效（[#3](../../issues/3)） |

### 2. 「无法连接本机引擎（10000 端口被占用）」

上一次没退干净。任务管理器结束「语文作文批改助手.exe」与 `opencode.exe` 后重开。
应用本身会从 10000 起自动找空闲端口（[#4](../../issues/4)），所以偶尔显示「引擎就绪 · 10001」是正常的。

### 3. 「模型没有返回 JSON」

免费通道限流或模型抽风。程序会自动重试 3 次，再失败就切备用模型重跑一次（[#17](../../issues/17)）。
都失败时点「重批」即可，已识别校对的内容不会丢。

### 4. 学生错字被程序改掉了 / 「学生笔误 0 处」

v2.0.0 已修（[#11](../../issues/11)）：同长度单字替换一律判 `author_error`，正文保留原字。
若仍遇到，先到「校对」页确认那句的标记，再把作文图与 `store.json` 对应片段发到 issue。

### 5. 点「校对」没反应

v2.0.0 已修（[#12](../../issues/12)）。如果新版本仍无反应，说明又出现了未捕获异常：
按 F12 打开 DevTools 看 Console，把第一条红字发到 issue。

### 6. 识别不准

拍照质量决定上限：

- 正对、光线均匀、不要阴影压住字；
- 字迹占画面 70% 以上；
- 一次只拍一页，多页分多张图一次导入（按文件名顺序合并）。

识别结果永远可以在「校对」页对照原图修改，改完「按当前文本批阅」。

---

## 二、开发侧（环境与打包）

### 7. `node` / `npm` 找不到

这台机器上 PATH 可能只有 `npm.cmd`。所有脚本前置：

```powershell
$env:PATH = 'C:\Program Files\nodejs;' + $env:PATH
```

注意 `npm run dist` 内部的 electron-builder 也会调 `node`，不加会报
`'"node"' is not recognized`，而 npm 退出码同样是 1，很容易误判（[#15](../../issues/15)）。

### 8. npm 11 拦截 install scripts

见 [#2](../../issues/2)。`node node_modules\electron\install.js` 手动补。

### 9. 启动即退出、没有窗口

先查环境变量：

```powershell
$env:ELECTRON_RUN_AS_NODE   # 有值就先删
Remove-Item Env:\ELECTRON_RUN_AS_NODE
electron.exe --version      # 应该是 v33.x，输出 v20.x 说明还在 node 模式
```

见 [#7](../../issues/7)。

### 10. 打包报 `EPERM ... opencode.exe`

进程占用，见 [#15](../../issues/15)：

```powershell
Get-Process opencode, electron, '语文作文批改助手' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 4
npm run dist
```

### 11. 打包版能开但引擎起不来

两个必查点（[#14](../../issues/14)）：

1. `resources\backend\opencode2api\node_modules` 是否存在（88 项）——`afterPack` 是否执行；
2. `resources\bin\opencode.exe` 是否存在，大小是否 180 MB 左右。

路径拼接的经典错误是 asar 内又拼了一次 `resources`：

```js
// 打包后 appDir = ...\resources\app.asar
const resources = appDir.includes('app.asar') ? path.dirname(appDir) : path.join(appDir, '..');
```

### 12. 用 PowerShell 读中文 JSON 报语法错

不是文件坏了，是 GBK 解码吞了引号（[#6](../../issues/6)）：

```powershell
Get-Content $p -Raw -Encoding UTF8 | ConvertFrom-Json
```

排查脚本优先用 Node：`JSON.parse(fs.readFileSync(p, 'utf8'))`。

### 13. 引擎读到了别人的数据库

给引擎独立 XDG 目录（[#3](../../issues/3)），见 `backend.js` 的 `XDG_DATA_HOME` 等四个变量。

### 14. 模型返回 403 FreeTierError

免费额度只能在 `opencode.exe` 内部使用（[#5](../../issues/5)），不要试图绕过二进制直连。

### 15. 用 `Invoke-RestMethod` 测接口，中文变 `??????`

PowerShell 5.1 按 Latin-1 发送 body（[#1](../../issues/1)）。用 Node 测，或传字节数组：

```powershell
Invoke-RestMethod -Uri $u -Method Post -ContentType 'application/json; charset=utf-8' `
  -Body ([Text.Encoding]::UTF8.GetBytes($json))
```

---

## 三、界面（开发时容易复发）

| 症状 | 根因 | 参考 |
| --- | --- | --- |
| 反馈卡片一字一行 | 单文本节点用了 `grid-template-columns:16px 1fr` | [#10](../../issues/10) |
| 等级行第 5 个格子换行 | 5 个子节点套 4 列网格 | [#16](../../issues/16) |
| 重批后分数不变 | `onProgress` 没处理“停在结果页”的情况 | [#13](../../issues/13) |
| 引擎就绪但界面显示启动中 | 主进程没广播 `backend:status` | [#8](../../issues/8) |
| 批改报「作文正文为空」 | id 前缀丢失 + `verify` 过滤 | [#9](../../issues/9) |

---

## 四、把日志变成可复现的最小信息

提 issue 时最少给三样：

1. 版本（安装包版本或 `git rev-parse --short HEAD`）；
2. `engine.log` 末尾 20 行（**删掉用户名路径**）；
3. 出问题那篇的 `store.json` 片段（只留 `sentences` / `authorErrors` / `grade`，图片不用）。

有这三样，90% 的问题不需要猜。
