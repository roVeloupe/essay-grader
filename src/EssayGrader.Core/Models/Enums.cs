namespace EssayGrader.Core.Models;

/// <summary>作文批改系统全局枚举。</summary>
public static class Enums
{
    /// <summary>单篇作文的七态处理状态机。</summary>
    public enum EssayStatus
    {
        Pending,        // 待识别（已导入，未开始）
        Recognizing,    // 识别中
        Recognized,     // 已识别
        Correcting,     // 校对中
        Corrected,      // 已校对
        Grading,        // 批阅中
        Graded          // 已批阅
    }

    /// <summary>校对/校对裁决。</summary>
    public enum Verdict
    {
        Ok,        // 识别通过
        Correct,   // 已修正（纠正识别错误）
        Polish,    // 已润色（调整为通顺，不改变原意）
        Verify     // 存疑待人工
    }

    /// <summary>批阅意见类型。</summary>
    public enum GradingItemKind
    {
        Pro,     // 优点
        Against, // 缺点
        Suggestion // 修改建议
    }

    /// <summary>导出格式。</summary>
    public enum ExportFormat { Word, Pdf, Markdown }

    /// <summary>保存位置模式（FR-20）。</summary>
    public enum SaveMode
    {
        AskEachTime,        // 每次询问
        AlwaysDefaultDir    // 始终保存到默认目录
    }
}