using System.Reflection;
using System.Text.Json.Serialization;
using EssayGrader.Core;
using EssayGrader.Core.Models;
using EssayGrader.Core.Services;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;

// ---------------------------------------------------------------------------
// EssayGrader.Web：本地 HTTP 后端 —— 复用 EssayGrader.Core 已验证逻辑，
// 接入 StepFun「Step Plan」通道（step-3.7-flash，原生 base64 多模态），Key 内置。
// 前端是 1:1 复刻微信电脑版的网页界面（wwwroot/）。
// ---------------------------------------------------------------------------

// 内置 Key：以 XOR 混淆字节形式存放，运行时解码，避免源码含明文密钥。
// 可用环境变量 ESSAY_GRADER_KEY 覆盖（便于个人部署时替换为自己的 Key）。
var EmbeddedKey = DecodeKey();

static string DecodeKey()
{
    var env = Environment.GetEnvironmentVariable("ESSAY_GRADER_KEY");
    if (!string.IsNullOrWhiteSpace(env)) return env;
    byte[] enc =
    {
        0x7c, 0x38, 0x1b, 0x7c, 0x7a, 0x7e, 0x05, 0x1c, 0x03, 0x31, 0x2c, 0x3d, 0x3b, 0x0e, 0x38, 0x1a,
        0x7a, 0x25, 0x3d, 0x2e, 0x39, 0x19, 0x7e, 0x20, 0x2f, 0x2f, 0x73, 0x0c, 0x7e, 0x38, 0x07, 0x26,
        0x3d, 0x1c, 0x1c, 0x78, 0x0c, 0x7d, 0x09, 0x32, 0x01, 0x1a, 0x3c, 0x0c, 0x2e, 0x79, 0x79, 0x13,
        0x1a, 0x11, 0x06, 0x20, 0x2d, 0x2f, 0x0a, 0x22, 0x3c, 0x12, 0x12, 0x28, 0x2c, 0x7e, 0x25, 0x1b
    };
    return new string(enc.Select(x => (char)(x ^ 0x4b)).ToArray());
}

// 用户可写目录（单文件 exe 可能位于 Program Files 等只读位置，数据统一落到 %LocalAppData%）
var localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
var appDataDir = Path.Combine(string.IsNullOrEmpty(localApp) ? AppContext.BaseDirectory : localApp, "EssayGrader");

// 可写数据根目录：优先环境变量，否则默认 %LocalAppData%\EssayGrader
var dataRoot = Environment.GetEnvironmentVariable("EGrader_DATA") ?? Path.Combine(appDataDir, "data");
var imagesRoot = Path.Combine(dataRoot, "uploads");
var dbPath = Path.Combine(dataRoot, "app.db");
Directory.CreateDirectory(imagesRoot);

// 前端页面优先级：①exe 旁 wwwroot（便于用户覆盖升级）→ ②%LocalAppData% 已抽取的嵌入资源
var webRoot = Path.Combine(AppContext.BaseDirectory, "wwwroot");
if (!File.Exists(Path.Combine(webRoot, "index.html")))
{
    // 没有外部 wwwroot：从嵌入资源抽取到可写目录，下次运行复用
    webRoot = Path.Combine(appDataDir, "webroot");
    var embeddedWeb = Assembly.GetExecutingAssembly()
        .GetManifestResourceNames().Where(n => n.StartsWith("webroot/", StringComparison.Ordinal)).ToArray();
    if (embeddedWeb.Length > 0) ExtractEmbeddedWeb(embeddedWeb, webRoot);
}

static void ExtractEmbeddedWeb(string[] names, string destDir)
{
    try
    {
        var asm = Assembly.GetExecutingAssembly();
        foreach (var n in names)
        {
            var rel = n["webroot/".Length..].Replace('/', Path.DirectorySeparatorChar);
            var target = Path.GetFullPath(Path.Combine(destDir, rel));
            if (!target.StartsWith(Path.GetFullPath(destDir), StringComparison.Ordinal)) continue; // 防路径穿越
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            using var input = asm.GetManifestResourceStream(n)!;
            using var output = File.Create(target);
            input.CopyTo(output);
        }
    }
    catch
    {
        // 抽取失败不致命：回退到内容根 wwwroot（若存在）
    }
}

var settings = new AppSettings
{
    StepFun = new StepFunOptions
    {
        BaseUrl = "https://api.stepfun.com/step_plan/v1", // Step Plan 专用通道
        ApiKey = EmbeddedKey,                              // 内置 Key
        Model = "step-3.7-flash",
        EnableThinking = false,     // 关闭思考，避免推理烧满 token 导致输出为空
        ReasoningEffort = "low",
        MaxTokens = 32768,         // 关闭思考后为输出预算，防截断
        TimeoutSeconds = 1500
    },
    Grading = new GradingOptions { Concurrency = 2 },
    Save = new SaveOptions
    {
        ResultsDir = Path.Combine(dataRoot, "results"),
        ExportDir = Path.Combine(dataRoot, "exports"),
        Mode = Enums.SaveMode.AlwaysDefaultDir,
        Format = Enums.ExportFormat.Markdown,
        MergeToSingleFile = true
    }
};

var provider = Composition.Build(settings, dbPath, imagesRoot);
var db = provider.GetRequiredService<StorageService>();
var runner = provider.GetRequiredService<GradingRunner>();
var sorter = new FileSorter();
var images = provider.GetRequiredService<ImageLoader>();
var save = provider.GetRequiredService<SaveService>();
var export = provider.GetRequiredService<ExportService>();
var testClient = provider.GetRequiredService<IStepFunClient>();
var stepOpts = provider.GetRequiredService<StepFunOptions>();
var gradeOpts = provider.GetRequiredService<GradingOptions>();
var saveOpts = provider.GetRequiredService<SaveOptions>();

// 会话内存状态
var essayById = new Dictionary<int, Essay>();
var lockObj = new object();

await TemplateSeeding.EnsureDefaultAsync(db);

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    WebRootPath = webRoot,
    ContentRootPath = AppContext.BaseDirectory // 固定内容根，避免受启动目录影响
});
builder.WebHost.UseUrls($"http://0.0.0.0:{Environment.GetEnvironmentVariable("PORT") ?? "5000"}");
builder.Services.AddRouting();
builder.Services.AddAntiforgery();
var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();
app.UseAntiforgery();
app.MapGet("/", () => Results.Redirect("/index.html"));

// ---------- 工具 ----------
string ImagePath(int id, string fileName) => Path.Combine(imagesRoot, $"{id}_{Path.GetFileName(fileName)}");
string ThumbPath(int id) => Path.Combine(imagesRoot, $"thumb_{id}.jpg");

async Task<Essay> LoadEssayAsync(int id, CancellationToken ct)
{
    if (TryMemory(id, out var m)) return m;
    var all = await db.GetEssaysAsync(ct);
    var hit = all.FirstOrDefault(x => x.Id == id) ?? throw new KeyNotFoundException($"essay {id} 不存在");
    hit.Sentences = await db.GetSentencesAsync(id, ct);
    lock (lockObj) essayById[id] = hit;
    return hit;
}
bool TryMemory(int id, out Essay e)
{
    lock (lockObj) return essayById.TryGetValue(id, out e!);
}

object EssayDto(Essay e, bool hasImage)
{
    return new
    {
        e.Id, e.BatchId, e.FileName, e.SortOrder, e.Title, e.Author, e.PageCount,
        Status = e.Status.ToString(), StatusInt = (int)e.Status,
        hasImage, imageUrl = hasImage ? $"/api/essays/{e.Id}/image" : null,
        thumbUrl = hasImage ? $"/api/essays/{e.Id}/thumb" : null,
        UpdatedAt = e.UpdatedAt
    };
}

// ---------- 健康 & 连接测试 ----------
app.MapGet("/api/health", () => Results.Ok(new { ok = true, time = DateTime.Now }));
app.MapPost("/api/test", async (CancellationToken ct) =>
{
    try
    {
        var msg = await testClient.TestAsync(ct);
        return Results.Ok(new { ok = true, message = msg });
    }
    catch (Exception ex)
    {
        return Results.Json(new { ok = false, message = ex.Message }, statusCode: 502);
    }
});

// ---------- 设置 ----------
app.MapGet("/api/settings", () => Results.Ok(new
{
    stepFun = new { stepOpts.BaseUrl, stepOpts.Model, stepOpts.ReasoningEffort, stepOpts.MaxTokens, hasKey = !string.IsNullOrEmpty(stepOpts.ApiKey) },
    grading = new { gradeOpts.Concurrency, gradeOpts.VerifyThreshold, gradeOpts.PassThreshold },
    save = new
    {
        saveOpts.ResultsDir, saveOpts.ExportDir,
        Mode = saveOpts.Mode.ToString(), Format = saveOpts.Format.ToString(),
        saveOpts.MergeToSingleFile,
        resolvedResults = save.ResolveResultsDir(),
        resolvedExport = save.ResolveExportDir()
    }
}));

app.MapPut("/api/settings", async (SettingsIn input, CancellationToken ct) =>
{
    if (input.ReasoningEffort != null) stepOpts.ReasoningEffort = input.ReasoningEffort;
    if (input.ResultsDir != null) saveOpts.ResultsDir = input.ResultsDir;
    if (input.ExportDir != null) saveOpts.ExportDir = input.ExportDir;
    if (input.Mode != null) saveOpts.Mode = Enum.TryParse<Enums.SaveMode>(input.Mode, true, out var m) ? m : saveOpts.Mode;
    if (input.Format != null) saveOpts.Format = Enum.TryParse<Enums.ExportFormat>(input.Format, true, out var f) ? f : saveOpts.Format;
    if (input.MergeToSingleFile.HasValue) saveOpts.MergeToSingleFile = input.MergeToSingleFile.Value;
    if (input.Concurrency.HasValue) gradeOpts.Concurrency = input.Concurrency.Value;
    if (!string.IsNullOrWhiteSpace(input.ApiKey)) stepOpts.ApiKey = input.ApiKey;

    await db.SetPropertyAsync("results_dir", saveOpts.ResultsDir, ct);
    await db.SetPropertyAsync("export_dir", saveOpts.ExportDir, ct);
    await db.SetPropertyAsync("mode", saveOpts.Mode.ToString(), ct);
    return Results.Ok(new { ok = true });
});

// ---------- 批阅标准模板 ----------
app.MapGet("/api/templates", async (CancellationToken ct) =>
    Results.Ok(await db.GetTemplatesAsync(ct)));

app.MapPost("/api/templates", async (GradeTemplate template, CancellationToken ct) =>
{
    template.Id = 0;
    var saved = await db.SaveTemplateAsync(template, ct);
    return Results.Ok(saved);
});

app.MapPut("/api/templates/{id:int}", async (int id, GradeTemplate template, CancellationToken ct) =>
{
    template.Id = id;
    await db.UpdateTemplateAsync(template, ct);
    return Results.Ok(template);
});

app.MapDelete("/api/templates/{id:int}", async (int id, CancellationToken ct) =>
{
    await db.DeleteTemplateAsync(id, ct);
    return Results.Ok(new { ok = true });
});

app.MapPost("/api/templates/{id:int}/set-default", async (int id, CancellationToken ct) =>
{
    var tpls = await db.GetTemplatesAsync(ct);
    foreach (var t in tpls)
    {
        t.IsDefault = t.Id == id;
        if (t.Id == id) continue;
        // 清除其它默认标记（只更新该模板是否默认）
        await db.UpdateTemplateAsync(t, ct);
    }
    var target = tpls.FirstOrDefault(t => t.Id == id);
    if (target != null) { target.IsDefault = true; await db.UpdateTemplateAsync(target, ct); }
    return Results.Ok(new { ok = true });
});

// ---------- 批阅记录（批次） ----------
app.MapGet("/api/batches", async (CancellationToken ct) => Results.Ok(await db.GetBatchesAsync(ct)));

app.MapPost("/api/batches", async (BatchIn input, CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(input.Name)) return Results.BadRequest("批次名不能为空");
    var b = await db.SaveBatchAsync(new Batch { Name = input.Name.Trim(), Note = input.Note ?? "" }, ct);
    return Results.Ok(b);
});

app.MapPut("/api/batches/{id:int}", async (int id, BatchIn input, CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(input.Name)) return Results.BadRequest("批次名不能为空");
    await db.UpdateBatchAsync(new Batch { Id = id, Name = input.Name.Trim(), Note = input.Note ?? "" }, ct);
    return Results.Ok(new { ok = true });
});

app.MapDelete("/api/batches/{id:int}", async (int id, CancellationToken ct) =>
{
    await db.DeleteBatchAsync(id, ct);
    return Results.Ok(new { ok = true });
});

// ---------- 作文 ----------
app.MapGet("/api/essays", async (int batchId, CancellationToken ct) =>
{
    var all = await db.GetEssaysAsync(ct, batchId);
    var dtos = new List<object>();
    foreach (var e in all)
        dtos.Add(EssayDto(e, File.Exists(ImagePath(e.Id, e.FileName))));
    return Results.Ok(dtos);
});

app.MapPost("/api/import", async (int batchId, IFormFileCollection files, HttpContext ctx, CancellationToken ct) =>
{
    var uploaded = new List<(string Name, Stream S)>();
    foreach (var f in files)
        uploaded.Add((f.FileName, f.OpenReadStream()));

    if (uploaded.Count == 0) return Results.BadRequest("未收到图片");

    // 1) 按文件名自然排序生成 Essay
    var essays = sorter.BuildEssays(uploaded.Select(x => x.Name).ToList());

    // 2) 存文件、写库（归入当前批次）
    var list = new List<object>();
    for (int i = 0; i < essays.Count; i++)
    {
        var e = essays[i];
        e.BatchId = batchId;
        await db.UpsertEssayAsync(e, ct); // 写库取 id
        var imgPath = ImagePath(e.Id, e.FileName);
        var fs = File.Create(imgPath);
        await uploaded[i].S.CopyToAsync(fs, ct);
        await fs.DisposeAsync();
        try { images.CreateThumbnail(imgPath, ThumbPath(e.Id), 320, ct); } catch { /* 缩略图失败忽略 */ }
        lock (lockObj) essayById[e.Id] = e;
        list.Add(EssayDto(e, true));
    }
    return Results.Ok(list);
}).DisableAntiforgery();

app.MapGet("/api/essays/{id:int}", async (int id, CancellationToken ct) =>
{
    try
    {
        var e = await LoadEssayAsync(id, ct);
        var has = File.Exists(ImagePath(e.Id, e.FileName));
        var grading = await db.GetGradingByEssayAsync(id, ct);
        return Results.Ok(new { essay = EssayDto(e, has), grading, sentences = e.Sentences });
    }
    catch (KeyNotFoundException) { return Results.NotFound(); }
});

app.MapGet("/api/essays/{id:int}/image", async (int id, HttpContext ctx, CancellationToken ct) =>
{
    var e = await LoadEssayAsync(id, ct);
    var p = ImagePath(e.Id, e.FileName);
    return File.Exists(p) ? Results.File(p) : Results.NotFound();
});

app.MapGet("/api/essays/{id:int}/thumb", async (int id, CancellationToken ct) =>
{
    var e = await LoadEssayAsync(id, ct);
    var t = ThumbPath(id);
    var full = ImagePath(e.Id, e.FileName);
    if (!File.Exists(full)) return Results.NotFound();
    if (!File.Exists(t)) try { images.CreateThumbnail(full, t, 320, ct); } catch { return Results.File(full); }
    return Results.File(t);
});

// ---------- 处理管道 ----------
app.MapPost("/api/essays/{id:int}/recognize", async (int id, CancellationToken ct) =>
{
    var e = await LoadEssayAsync(id, ct);
    await runner.RecognizeAsync(e, ImagePath(id, e.FileName), ct);
    return Results.Ok(new { ok = true, essay = EssayDto(e, true), sentences = e.Sentences });
});

app.MapPost("/api/essays/{id:int}/correct", async (int id, CancellationToken ct) =>
{
    var e = await LoadEssayAsync(id, ct);
    await runner.CorrectAsync(e, ImagePath(id, e.FileName), ct);
    return Results.Ok(new { ok = true, essay = EssayDto(e, true), sentences = e.Sentences });
});

app.MapPost("/api/essays/{id:int}/grade", async (int id, int? templateId, CancellationToken ct) =>
{
    var e = await LoadEssayAsync(id, ct);
    var tpls = await db.GetTemplatesAsync(ct);
    var tpl = tpls.FirstOrDefault(t => t.Id == templateId) ??
              tpls.FirstOrDefault(t => t.IsDefault) ??
              tpls.FirstOrDefault();
    if (tpl == null) return Results.BadRequest("没有可用的批阅标准");
    var g = await runner.GradeAsync(e, tpl, ct);
    g.EssayId = e.Id; g.TemplateId = tpl.Id;
    await db.SaveGradingAsync(g, ct);
    return Results.Ok(g);
});

app.MapGet("/api/essays/{id:int}/result", async (int id, CancellationToken ct) =>
{
    var g = await db.GetGradingByEssayAsync(id, ct);
    return g == null ? Results.NotFound() : Results.Ok(g);
});

// 人工修正：整体替换句子 + 标记已校对
app.MapPut("/api/essays/{id:int}/sentences", async (int id, List<BodySentence> sentences, CancellationToken ct) =>
{
    var e = await LoadEssayAsync(id, ct);
    e.Sentences = sentences;
    if (e.Status < Enums.EssayStatus.Corrected) e.Status = Enums.EssayStatus.Corrected;
    e.UpdatedAt = DateTime.Now;
    await db.UpsertEssayAsync(e, ct);
    await db.ReplaceSentencesAsync(id, sentences, ct);
    return Results.Ok(new { ok = true, essay = EssayDto(e, true) });
});

// ---------- 导出（按文件名顺序合并，可按批次） ----------
app.MapPost("/api/export", async (int batchId, CancellationToken ct) =>
{
    var all = await db.GetEssaysAsync(ct, batchId);
    var rows = new List<(Essay, GradingOrder?)>();
    foreach (var e in all)
    {
        e.Sentences = await db.GetSentencesAsync(e.Id, ct);
        var g = await db.GetGradingByEssayAsync(e.Id, ct);
        GradingOrder? order = g == null ? null
            : new GradingOrder(g.Total, g.Level, g.Summary, g.Items);
        rows.Add((e, order));
    }
    var path = await export.ExportMergedAsync(rows, ct);
    return Results.Ok(new { ok = true, path, text = export.BuildMergedMarkdown(rows) });
});

app.Run();

public class SettingsIn
{
    public string? ApiKey { get; set; }
    public string? ReasoningEffort { get; set; }
    public string? ResultsDir { get; set; }
    public string? ExportDir { get; set; }
    public string? Mode { get; set; }
    public string? Format { get; set; }
    public bool? MergeToSingleFile { get; set; }
    public int? Concurrency { get; set; }
}

public class BatchIn
{
    public string? Name { get; set; }
    public string? Note { get; set; }
}