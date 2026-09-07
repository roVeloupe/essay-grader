using System.Text;
using EssayGrader.Core.Models;

namespace EssayGrader.Core.Services;

/// <summary>结果导出：按文件名顺序生成可阅读文本（当前实现 Markdown；Word/PDF 后续扩展）。</summary>
public class ExportService
{
    private readonly SaveService _save;
    private readonly SaveOptions _saveOpt;
    public ExportService(SaveService save, SaveOptions saveOpt) { _save = save; _saveOpt = saveOpt; }

    /// <summary>把一组作文与其批阅结果合并为 Markdown 文本（严格按文件名顺序 FR-16）。</summary>
    public string BuildMergedMarkdown(IEnumerable<(Essay essay, GradingOrder? grading)> rows)
    {
        var sb = new StringBuilder();
        sb.AppendLine("# 高中作文批阅报告");
        sb.AppendLine();
        sb.AppendLine($"生成时间：{DateTime.Now:yyyy-MM-dd HH:mm:ss}");
        sb.AppendLine();
        sb.AppendLine("---");
        foreach (var (essay, grading) in rows)
        {
            sb.AppendLine($"## {essay.SortOrder}. {essay.Title}（作者：{essay.Author}）");
            sb.AppendLine();
            sb.AppendLine($"- 文件名：`{essay.FileName}`　状态：{essay.Status}");
            if (grading != null)
            {
                sb.AppendLine($"- 总分：**{grading.Total}**　等级：{grading.Level}");
                if (grading.Summary.Length > 0) sb.AppendLine($"- 综合评价：{grading.Summary}");
            }
            sb.AppendLine();
            sb.AppendLine("### 正文");
            foreach (var s in essay.Sentences)
                if (s.Verdict != Enums.Verdict.Verify)
                    sb.AppendLine($"{s.Text}");
            if (grading != null)
            {
                sb.AppendLine();
                sb.AppendLine("### 批阅意见");
                void Emit(string blockTitle, IEnumerable<GradingItem> items)
                {
                    var list = items.ToList();
                    if (list.Count == 0) return;
                    sb.AppendLine($"**{blockTitle}**");
                    foreach (var it in list)
                    {
                        sb.AppendLine($"- {it.Text}{(string.IsNullOrEmpty(it.SourceSentence) ? "" : $"（原文：{it.SourceSentence}）")}");
                    }
                }
                Emit("✅ 优点", grading.Items.Where(i => i.Kind == Enums.GradingItemKind.Pro));
                Emit("⚠️ 缺点", grading.Items.Where(i => i.Kind == Enums.GradingItemKind.Against));
                Emit("✏️ 修改建议", grading.Items.Where(i => i.Kind == Enums.GradingItemKind.Suggestion));
            }
            sb.AppendLine();
            sb.AppendLine("---");
        }
        return sb.ToString();
    }

    /// <summary>导出并返回落盘路径。</summary>
    public async Task<string> ExportMergedAsync(IEnumerable<(Essay, GradingOrder?)> rows, CancellationToken ct = default)
    {
        var text = BuildMergedMarkdown(rows);
        var dir = _save.ResolveExportDir();
        var path = _save.ComposePath(dir, _saveOpt.MergeToSingleFile ? "批阅报告合并" : "批阅报告", "", "md");
        await File.WriteAllTextAsync(path, text, Encoding.UTF8, ct);
        return path;
    }
}

/// <summary>导出所需的最小批阅投影，避免导出依赖强类型 GradingResult 未持久化的问题。</summary>
public record GradingOrder(int Total, string Level, string Summary, IEnumerable<GradingItem> Items);