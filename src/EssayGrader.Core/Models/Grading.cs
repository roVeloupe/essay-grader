namespace EssayGrader.Core.Models;

/// <summary>批阅标准模板（FR-12，可随时增删改）。</summary>
public class GradeTemplate
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public int TotalScore { get; set; }
    public bool IsDefault { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.Now;
    public List<GradeDimension> Dimensions { get; set; } = new();
}

/// <summary>单个评分维度（名称 + 满分 + 评分解读规则 prompt 片段）。</summary>
public class GradeDimension
{
    public int Id { get; set; }
    public int TemplateId { get; set; }
    public string Name { get; set; } = "";
    public int MaxScore { get; set; }
    public string Rule { get; set; } = "";   // 给 AI 的评分规则提示词
}

/// <summary>批阅结果（FR-13/14）。</summary>
public class GradingResult
{
    public int Id { get; set; }
    public int EssayId { get; set; }
    public int TemplateId { get; set; }
    public int Total { get; set; }
    public string Level { get; set; } = "";      // 评价等级，如 B- / 一类文
    public string Summary { get; set; } = "";    // 综合评价
    public List<DimensionScore> DimensionScores { get; set; } = new();
    public List<GradingItem> Items { get; set; } = new();
    public DateTime CreatedAt { get; set; } = DateTime.Now;
    public string RawJson { get; set; } = "";    // 模型原始 JSON，便于审计
}

/// <summary>维度得分。</summary>
public class DimensionScore
{
    public int GradingId { get; set; }
    public string DimName { get; set; } = "";
    public int Score { get; set; }
    public int MaxScore { get; set; }
}

/// <summary>优点 / 缺点 / 修改建议（可引用原文句子）。</summary>
public class GradingItem
{
    public int GradingId { get; set; }
    public Enums.GradingItemKind Kind { get; set; }
    public string Text { get; set; } = "";
    public string? SourceSentence { get; set; }   // 引用的原文
}