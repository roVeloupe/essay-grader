using EssayGrader.Core.Models;
using EssayGrader.Core.Services;

namespace EssayGrader.Core.Services;

/// <summary>单篇作文的处理管道：识别 → 校对 → 批阅（状态机）。</summary>
public class GradingRunner
{
    private readonly StepFunJson _llm;
    private readonly PromptBuilder _prompt;
    private readonly ImageLoader _images;
    private readonly StorageService _db;

    public GradingRunner(IStepFunClient client, PromptBuilder prompt, ImageLoader images, StorageService db)
    {
        _llm = new StepFunJson(client);
        _prompt = prompt;
        _images = images;
        _db = db;
    }

    /// <summary>步骤① 内容识别（图片→base64→step-3.7-flash）。</summary>
    public async Task<RecognitionResult> RecognizeAsync(Essay essay, string imagePath, CancellationToken ct = default)
    {
        essay.Status = Enums.EssayStatus.Recognizing;
        var b64 = _images.ToBase64(imagePath, 2048, ct);
        var res = await _llm.SendAsync<RecognitionResult>(
            "你是手写作文扫描图的识别助手。只识别，不改写，不添加内容。",
            _prompt.BuildRecognize(), b64, ct, allowRetry: true)
            ?? throw new StepFunException("识别结果解析为空");

        essay.Title = res.Title.Text;
        essay.Author = res.Author.Text;
        essay.Sentences = res.Body.Select((s, i) => new BodySentence
        {
            Seq = s.Id, Index = i + 1,
            Text = s.Text, OriginalText = s.Text,
            Confidence = s.Confidence, Region = s.Region,
            NeedVerify = res.LowConfidence.Contains(s.Id)
        }).ToList();
        essay.Status = Enums.EssayStatus.Recognized;
        essay.UpdatedAt = DateTime.Now;
        await _db.UpsertEssayAsync(essay, ct);
        await _db.ReplaceSentencesAsync(essay.Id, essay.Sentences, ct);
        return res;
    }

    /// <summary>步骤② 纠错 + 校对（纯文本）。对照原图逐句复核在 step-3.7-flash/pi计划通道会触发无限思考、永不返回正文；
    /// 故改为纯文本修正，无法判定的句子标记 verify 交人工，UI 可对照原图复核。</summary>
    public async Task<CorrectResult> CorrectAsync(Essay essay, string imagePath, CancellationToken ct = default)
    {
        essay.Status = Enums.EssayStatus.Correcting;
        var body = string.Join("\n", essay.Sentences.Select(s => $"[{s.Seq}] {s.Text}"));
        var res = await _llm.SendAsync<CorrectResult>(
            "你是批改前的中文校对助手。只修正识别错误与语病，禁止添加新情节、禁止改变主旨。",
            _prompt.BuildCorrect(body), null, ct, allowRetry: true)
            ?? new CorrectResult();

        var bySeq = essay.Sentences.ToDictionary(s => s.Seq, s => s);
        foreach (var c in res.Sentences)
        {
            if (!bySeq.TryGetValue(c.Id, out var s)) continue;
            if (c.NeedVerify) { s.Verdict = Enums.Verdict.Verify; s.NeedVerify = true; continue; }
            s.Verdict = c.Verdict;
            if (c.Verdict is Enums.Verdict.Correct or Enums.Verdict.Polish)
            {
                s.Text = c.Text;
                s.Notes = c.Reason;
            }
        }
        essay.Status = Enums.EssayStatus.Corrected;
        essay.UpdatedAt = DateTime.Now;
        await _db.UpsertEssayAsync(essay, ct);
        await _db.ReplaceSentencesAsync(essay.Id, essay.Sentences, ct);
        return res;
    }

    /// <summary>步骤③ 批阅（按标准模板）。</summary>
    public async Task<GradingResult> GradeAsync(Essay essay, GradeTemplate template, CancellationToken ct = default)
    {
        essay.Status = Enums.EssayStatus.Grading;
        // 只提交已确认(通过/已修正/已润色)的句子；存疑的跳过，避免把不确定内容带进批阅
        var body = string.Join("\n", essay.Sentences
            .Where(s => s.Verdict != Enums.Verdict.Verify)
            .Select(s => s.Text));

        var outx = await _llm.SendAsync<GradingOutcome>(
            "你是一位资历深厚的高中语文老师。严格按下述标准评分，只依据正文，不要臆造。",
            _prompt.BuildGrading(body, template), null, ct, allowRetry: true)
            ?? new GradingOutcome();

        var g = new GradingResult
        {
            EssayId = essay.Id, TemplateId = template.Id,
            Total = outx.Total, Level = outx.Level, Summary = outx.Summary,
            DimensionScores = outx.Dimensions.Select(d => new DimensionScore
            {
                DimName = d.Name, Score = d.Score, MaxScore = d.Max
            }).ToList(),
            Items = MapItems(outx),
            CreatedAt = DateTime.Now
        };

        essay.Status = Enums.EssayStatus.Graded;
        essay.UpdatedAt = DateTime.Now;
        await _db.UpsertEssayAsync(essay, ct);
        return g;
    }

    private static List<GradingItem> MapItems(GradingOutcome o)
    {
        var list = new List<GradingItem>();
        list.AddRange(o.Pros.Select(x => new GradingItem { Kind = Enums.GradingItemKind.Pro, Text = x.Text, SourceSentence = x.Source }));
        list.AddRange(o.Againsts.Select(x => new GradingItem { Kind = Enums.GradingItemKind.Against, Text = x.Text, SourceSentence = x.Source }));
        list.AddRange(o.Suggestions.Select(x => new GradingItem { Kind = Enums.GradingItemKind.Suggestion, Text = x.Text }));
        return list;
    }
}