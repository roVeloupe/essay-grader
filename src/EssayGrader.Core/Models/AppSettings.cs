using EssayGrader.Core.Models;

namespace EssayGrader.Core.Models;

/// <summary>应用设置（StepFun 接入 + 批阅 + 保存位置）。由 AppSettings.json 加载。</summary>
public class AppSettings
{
    /// <summary>StepFun / OpenAI 兼容接入。</summary>
    public StepFunOptions StepFun { get; set; } = new();

    /// <summary>批阅与输出。</summary>
    public GradingOptions Grading { get; set; } = new();

    /// <summary>默认保存位置配置（FR-19/FR-20）。</summary>
    public SaveOptions Save { get; set; } = new();
}

public class StepFunOptions
{
    // Step Plan（阶跃星辰订阅制）专用 OpenAI 兼容通道，区别于普通 https://api.stepfun.com/v1
    public string BaseUrl { get; set; } = "https://api.stepfun.com/step_plan/v1";
    public string ApiKey { get; set; } = "";            // 生产用 Windows DPAPI 加密，这里加载后内存使用
    public string Model { get; set; } = "step-3.7-flash";
    public bool EnableThinking { get; set; } = false;        // step-3.7-flash 思考默认关闭；显式 false 确保不产生推理 token
    public string ReasoningEffort { get; set; } = "low";     // 合法值 low|medium|high；仅在 EnableThinking=true 时生效
    public double Temperature { get; set; } = 0.2;
    public int MaxTokens { get; set; } = 32768; // 关闭思考后为输出预算，足够容纳完整正文与评分
    public int TimeoutSeconds { get; set; } = 1500; // 关闭思考后响应应明显加快，仍留宽余量防超时
}

public class GradingOptions
{
    public int Concurrency { get; set; } = 2;           // 批阅并发数
    public double VerifyThreshold { get; set; } = 0.8;  // 低于此置信度进入待复核
    public double PassThreshold { get; set; } = 0.9;    // 高于此置信度直接通过
    public int DefaultTemplateId { get; set; }
}

public class SaveOptions
{
    public string ResultsDir { get; set; } = "";        // 批阅结果保存目录
    public string ExportDir { get; set; } = "";         // 导出文档目录
    public Enums.SaveMode Mode { get; set; } = Enums.SaveMode.AlwaysDefaultDir;
    public Enums.ExportFormat Format { get; set; } = Enums.ExportFormat.Markdown;
    public bool MergeToSingleFile { get; set; } = true; // 是否合并为一个文档
}