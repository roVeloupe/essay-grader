using System.Text.RegularExpressions;
using EssayGrader.Core.Models;

namespace EssayGrader.Core.Services;

/// <summary>按文件名的自然排序（FR-02/FR-16）：2 排在 10 前。</summary>
public partial class FileSorter
{
    public static IEnumerable<FileInfo> SortByFileName(IEnumerable<FileInfo> files)
        => files.OrderBy(f => f.Name, NaturalComparer.Instance);

    public static IEnumerable<string> SortByFileName(IEnumerable<string> paths)
        => paths.OrderBy(p => Path.GetFileName(p), NaturalComparer.Instance);

    /// <summary>把一组图片文件登记成若干 Essay，并写好 SortOrder。</summary>
    public List<Essay> BuildEssays(IEnumerable<string> imagePaths)
    {
        var ordered = SortByFileName(imagePaths).ToList();
        var list = new List<Essay>();
        for (int i = 0; i < ordered.Count; i++)
        {
            list.Add(new Essay
            {
                FileName = Path.GetFileName(ordered[i]),
                SortOrder = i + 1,
                PageCount = 1,
                Status = Enums.EssayStatus.Pending,
                CreatedAt = DateTime.Now
            });
        }
        return list;
    }
}

/// <summary>RFC-like 「自然排序」比较器：数字段按数值比较。</summary>
public sealed partial class NaturalComparer : IComparer<string>
{
    public static readonly NaturalComparer Instance = new();
    [GeneratedRegex(@"(\d+|\D+)")]
    private static partial Regex TokenPattern();

    public int Compare(string? x, string? y)
    {
        if (ReferenceEquals(x, y)) return 0;
        if (x is null) return -1;
        if (y is null) return 1;

        var tx = TokenPattern().Matches(x).Select(m => m.Value).ToArray();
        var ty = TokenPattern().Matches(y).Select(m => m.Value).ToArray();
        var n = Math.Min(tx.Length, ty.Length);
        for (int i = 0; i < n; i++)
        {
            var ax = tx[i]; var ay = ty[i];
            if (long.TryParse(ax, out var nx) && long.TryParse(ay, out var ny))
            {
                if (nx != ny) return nx.CompareTo(ny);
            }
            else
            {
                var cx = StringComparer.OrdinalIgnoreCase.Compare(ax, ay);
                if (cx != 0) return cx;
            }
        }
        return tx.Length.CompareTo(ty.Length);
    }
}