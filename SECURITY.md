# 安全说明

## 数据流向

| 数据 | 去向 | 说明 |
| --- | --- | --- |
| 作文照片 | 本机 `127.0.0.1` 引擎 → OpenCode 免费通道 → 模型 | 不经过本项目的任何服务器（本项目没有服务器） |
| 识别结果、分数、导出文件 | 本机 `%APPDATA%\essay-grader` 与导出目录 | 纯本地 |
| 崩溃日志 | 不收集 | 应用不上报任何统计 |

卸载不会删除 `%APPDATA%\essay-grader`；如需彻底清除请手动删除该目录。

## 密钥

本应用**不使用也不需要 API Key**。若你自行改造接入付费模型，请把密钥放在环境变量或
`%APPDATA%\essay-grader\store.json` 之外的配置里，**不要提交进仓库**。

## 报告漏洞

请通过仓库的 Security → Report a vulnerability 私密上报，或开 issue 时不要贴利用细节。
常见问题（路径穿越、`app-media` 协议越权读取）属于重点关注范围：

- `app-media://` 只允许映射 `%APPDATA%\essay-grader\papers` 下的文件，实现里做了前缀校验。
- 渲染层 CSP 为 `default-src 'self'; img-src 'self' app-media: data: blob:`，未开启 `unsafe-eval`。

## 依赖

`opencode2api` 与 `opencode.exe` 为第三方组件，分别遵循其上游许可证；
本项目只做打包集成，未修改其源码逻辑。
