using EssayGrader.Core.Models;
using EssayGrader.Core.Services;
using Microsoft.Extensions.DependencyInjection;

namespace EssayGrader.Core;

/// <summary>核心模块依赖装配，供 WinUI3 App 与命令行 smoke 复用。</summary>
public static class Composition
{
    public static ServiceProvider Build(AppSettings settings, string dbPath, string? imagesRoot = null)
    {
        var services = new ServiceCollection();
        services.AddSingleton(settings);
        services.AddSingleton(settings.StepFun);
        services.AddSingleton(settings.Grading);
        services.AddSingleton(settings.Save);
        services.AddSingleton(new StorageService(dbPath));
        services.AddSingleton<PromptBuilder>();
        services.AddSingleton<ImageLoader>();
        services.AddSingleton<SaveService>();
        services.AddSingleton<ExportService>();
        services.AddSingleton<GradingRunner>();

        // HTTP：StepFun 客户端
        services.AddSingleton<HttpClient>(sp =>
        {
            var h = new HttpClient { Timeout = TimeSpan.FromSeconds(settings.StepFun.TimeoutSeconds + 30) };
            h.DefaultRequestHeaders.UserAgent.ParseAdd("EssayGrader/1.0");
            return h;
        });
        services.AddSingleton<IStepFunClient, StepFunClient>();
        services.AddSingleton<StepFunJson>();

        var provider = services.BuildServiceProvider();

        // 建表 + 确保至少有一套默认标准
        var db = provider.GetRequiredService<StorageService>();
        db.InitAsync().GetAwaiter().GetResult();

        var std = TemplateDefaults;
        var tplStore = provider.GetRequiredService<StorageService>();
        _ = tplStore; // 模板默认值在 App/调用侧落库，见 TemplateSeeding.EnsureAsync
        return provider;
    }

    /// <summary>开发文档中的默认"高考作文评分"标准。</summary>
    public static GradeTemplate TemplateDefaults => new()
    {
        Name = "高考作文评分",
        TotalScore = 60,
        IsDefault = true,
        Dimensions =
        {
            new GradeDimension { Name = "内容立意", MaxScore = 25, Rule = "围绕标题与中心论点展开；素材真实典型、有细节；主题思想积极、有深度升华。偏离话题或立意平庸适当扣分。" },
            new GradeDimension { Name = "语言表达", MaxScore = 20, Rule = "语句通顺、用词准确、善用修辞（比喻/排比/拟人）；过度口语化、病句、错别字适当扣分。" },
            new GradeDimension { Name = "结构条理", MaxScore = 12, Rule = "开头引入、主体展开、结尾收束完整；过渡自然、层次清晰；详略得当。" },
            new GradeDimension { Name = "卷面书写", MaxScore = 3, Rule = "卷面整洁、字迹工整、无大范围涂改（依据原图自动评估）。" }
        }
    };
}

/// <summary>标准模板落库与读取。</summary>
public static class TemplateSeeding
{
    /// <summary>确保存在默认标准模板；已存在则返回首个模板，否则写入默认。</summary>
    public static async Task<GradeTemplate> EnsureDefaultAsync(StorageService db, CancellationToken ct = default)
    {
        var existing = await db.GetTemplatesAsync(ct);
        if (existing.Count > 0) return existing[0];
        return await db.SaveTemplateAsync(Composition.TemplateDefaults, ct);
    }
}