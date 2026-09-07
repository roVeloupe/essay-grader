using System.Text.Json.Serialization;

namespace EssayGrader.Core.Models;

/// <summary>识别阶段模型返回的结构化结果（要求 response_format=json_object）。</summary>
public class RecognitionResult
{
    public int PageCount { get; set; }
    public TextPart Title { get; set; } = new();
    public TextPart Author { get; set; } = new();
    public List<RecSentence> Body { get; set; } = new();

    /// <summary>低置信度句子 id 列表（进入待复核）。</summary>
    public List<string> LowConfidence { get; set; } = new();
}

public class TextPart
{
    public string Text { get; set; } = "";
    public double Confidence { get; set; } = 1.0;
}

public class RecSentence
{
    public string Id { get; set; } = "";
    public string Text { get; set; } = "";
    public double Confidence { get; set; } = 1.0;
    public string Region { get; set; } = "";
}

/// <summary>校对阶段模型返回：逐句裁决。</summary>
public class CorrectResult
{
    public List<CorrectSentence> Sentences { get; set; } = new();
}

public class CorrectSentence
{
    public string Id { get; set; } = "";
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public Enums.Verdict Verdict { get; set; }
    public string Text { get; set; } = "";      // 纠正/润色后的文本
    [JsonPropertyName("need_verify")]
    public bool NeedVerify { get; set; }
    public string Reason { get; set; } = "";
}

/// <summary>批阅阶段模型返回：按标准的结构化结果。</summary>
public class GradingOutcome
{
    public int Total { get; set; }
    public string Level { get; set; } = "";
    public string Summary { get; set; } = "";
    public List<DimOut> Dimensions { get; set; } = new();
    public List<OpinionOut> Pros { get; set; } = new();
    public List<OpinionOut> Againsts { get; set; } = new();
    public List<OpinionOut> Suggestions { get; set; } = new();
}

public class DimOut { public string Name { get; set; } = ""; public int Score { get; set; } public int Max { get; set; } }
public class OpinionOut { public string Text { get; set; } = ""; public string? Source { get; set; } }