using EssayGrader.Core.Models;

namespace EssayGrader.Core.Models;

/// <summary>一篇作文（含多页扫描图）。</summary>
public class Essay
{
    public int Id { get; set; }
    public string FileName { get; set; } = "";          // 主文件名，用于自然排序
    public int SortOrder { get; set; }                  // 已按文件名算出的排序序号
    public string Title { get; set; } = "";
    public string Author { get; set; } = "";
    public int PageCount { get; set; }
    public Enums.EssayStatus Status { get; set; } = Enums.EssayStatus.Pending;
    public DateTime CreatedAt { get; set; } = DateTime.Now;
    public DateTime? UpdatedAt { get; set; }

    public List<EssayPage> Pages { get; set; } = new();
    public List<BodySentence> Sentences { get; set; } = new();
}

/// <summary>作文的一页扫描图。</summary>
public class EssayPage
{
    public int Id { get; set; }
    public int EssayId { get; set; }
    public int PageNo { get; set; }
    public string ImagePath { get; set; } = "";   // 原图
    public string ThumbPath { get; set; } = "";   // 缩略图
    public int Width { get; set; }
    public int Height { get; set; }
}

/// <summary>识别出的正文句子（逐句带置信度与区域，用于与原图复核）。</summary>
public class BodySentence
{
    public int Id { get; set; }
    public int EssayId { get; set; }
    public string Seq { get; set; } = "";         // 自然句序号，如 a1
    public int Index { get; set; }                // 在篇内经自然排序后的序号
    public string Text { get; set; } = "";        // 当前最新文本（经过校对/润色后）
    public string OriginalText { get; set; } = "";// 模型首次识别文本
    public double Confidence { get; set; } = 1.0; // 置信度 0..1
    public string Region { get; set; } = "";      // 模型给出的原图区域标识
    public Enums.Verdict Verdict { get; set; } = Enums.Verdict.Ok;
    public bool NeedVerify { get; set; }          // 存疑待人工
    public bool Modified { get; set; }            // 是否被人工修改过（重批不覆盖）
    public string Notes { get; set; } = "";       // 修改说明
}

/// <summary>纠错/润色审计日志（可撤销）。</summary>
public class CorrectionLog
{
    public int Id { get; set; }
    public int SentenceId { get; set; }
    public string Original { get; set; } = "";
    public string Corrected { get; set; } = "";
    public Enums.Verdict Verdict { get; set; }
    public string Reason { get; set; } = "";
    public bool UserAccepted { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.Now;
}