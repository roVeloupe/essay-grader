# 高中作文 AI 批改系统 · 代码仓库

Windows 桌面应用（WinUI3），自动识别扫描作文图片 → 纠错校对（对照原图）→ 按可调标准批阅 → 按文件名排序输出。
AI 引擎：**StepFun（阶跃星辰）** `step-3.7-flash`，图片以原生 base64 交付多模态模型。

## 目录结构
```
高中作文批改系统/
├─ EssayGrader.sln
├─ docs/ 开发文档.md + 界面预览/*.html
├─ src/
│  ├─ EssayGrader.Core/    # 核心类库（net8.0，可跨平台编译/测试）
│  │   ├─ Models/          # Essay/Sentence/GradeTemplate/GradingResult/AppSettings
│  │   └─ Services/        # StepFunClient · PromptBuilder · FileSorter · ImageLoader
│  │                       # StorageService(SQLite) · GradingRunner · SaveService · ExportService
│  └─ EssayGrader.App/     # WinUI3 界面（net8.0-windows，需 Windows 构建）
└─ smoke/ EssayGrader.Smoke # 命令行冒烟测试（无网络，用 Fake StepFunClient 验证核心管道）
```

## 快速验证核心逻辑（任意平台，无需 Windows / 无需网络）
```bash
dotnet run --project smoke/EssayGrader.Smoke/EssayGrader.Smoke.csproj -c Debug
```
会依次演示：文件名自然排序（`IMG_2` 排在 `IMG_10` 前）→ 识别 → 校对（低置信句被润色）→ 按标准批阅 → 按文件名顺序导出 Markdown，并验证「保存位置可配置」。

## 构建 WinUI3 界面（须在 Windows 上）
环境：Windows 10 1809+ · .NET 8 SDK · Visual Studio 2022（勾选「Windows 应用 SDK / WinUI」工作负载）。
```powershell
cd 高中作文批改系统
dotnet restore EssayGrader.sln
dotnet build src/EssayGrader.App/EssayGrader.App.csproj -c Debug -p:Platform=x64
```
或直接用 Visual Studio 打开 `EssayGrader.sln`，将 `EssayGrader.App` 设为启动项目后运行。

## 首次运行接入 StepFun
在 `%LocalAppData%\EssayGrader\AppSettings.json`（或应用「设置」页）填写：
```json
{
  "StepFun": {
    "BaseUrl": "https://api.stepfun.com/v1",
    "ApiKey": "sk-你的Key",
    "Model": "step-3.7-flash",
    "ReasoningEffort": "high",
    "Temperature": 0.2,
    "TimeoutSeconds": 120
  },
  "Grading": { "Concurrency": 2, "VerifyThreshold": 0.8, "PassThreshold": 0.9 },
  "Save": {
    "ResultsDir": "D:\\教案\\作文批改\\结果",
    "ExportDir": "D:\\教案\\作文批改\\导出",
    "Mode": 0,            // 0 始终默认目录 / 1 每次询问
    "Format": 2,          // 0 Word 1 Pdf 2 Markdown
    "MergeToSingleFile": true
  }
}
```
> API Key 生产环境建议改用 Windows DPAPI 加密落盘（见开发文档 §13）。

## 给开发者的说明
- **当前为 M1–M2 骨架 + 核心已验证**；±随开发推进继续实现「校正/校对视图」「批阅标准管理视图」等 UI。
- 开发文档见 [`docs/开发文档.md`](docs/开发文档.md)，界面预览见 [`docs/界面预览/总览.html`](docs/界面预览/总览.html)。