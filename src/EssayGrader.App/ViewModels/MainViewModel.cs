using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using EssayGrader.Core.Models;
using EssayGrader.Core.Services;
using Microsoft.Extensions.DependencyInjection;

namespace EssayGrader.App.ViewModels;

/// <summary>主窗口 ViewModel：作文列表（按文件名排序）、识别/校对/批阅/导出。</summary>
public partial class MainViewModel : ObservableObject
{
    private readonly FileSorter _sorter;
    private readonly GradingRunner _runner;
    private readonly StorageService _db;
    private readonly ExportService _export;
    private GradeTemplate _template = Composition.TemplateDefaults; // 启动时用 EnsureDefault 刷新

    public ObservableCollection<EssayListItem> Essays { get; } = new();

    [ObservableProperty] private EssayListItem? _selected;
    [ObservableProperty] private string _selectedTitle = "";
    [ObservableProperty] private string _selectedMeta = "";
    [ObservableProperty] private string _recognizedText = "";
    [ObservableProperty] private string _progress = "";

    public MainViewModel(IServiceProvider sp)
    {
        _sorter = sp.GetRequiredService<FileSorter>();
        _runner = sp.GetRequiredService<GradingRunner>();
        _db = sp.GetRequiredService<StorageService>();
        _export = sp.GetRequiredService<ExportService>();
        _ = TemplateSeeding.EnsureDefaultAsync(_db).ContinueWith(t =>
        {
            if (t.IsCompletedSuccessfully) _template = t.Result;
        }, TaskScheduler.Default);
    }

    partial void OnSelectedChanged(EssayListItem? value)
    {
        if (value is null) { SelectedTitle = ""; SelectedMeta = ""; RecognizedText = ""; return; }
        var e = value.Essay;
        SelectedTitle = e.Title.Length > 0 ? e.Title : System.IO.Path.GetFileNameWithoutExtension(e.FileName);
        SelectedMeta = e.Author.Length > 0 || e.PageCount > 0
            ? $"· {e.Author} · {e.PageCount} 页 · {e.Sentences.Count} 句"
            : "";
        RecognizedText = string.Join("\n", e.Sentences.Select(s => s.Text));
    }

    /// <summary>把用户选择的图片文件（按文件名自然排序）登记进列表。</summary>
    public void AddImages(IEnumerable<string> paths)
    {
        var byName = paths.ToDictionary(p => System.IO.Path.GetFileName(p), p => p, StringComparer.OrdinalIgnoreCase);
        foreach (var e in _sorter.BuildEssays(byName.Keys))
        {
            Essays.Add(new EssayListItem { Essay = e, FullPath = byName[e.FileName] });
        }
        if (Selected is null && Essays.Count > 0) Selected = Essays[0];
    }

    /// <summary>对当前选中作文执行 识别 → 校对。</summary>
    public async Task RunRecognizeCorrectAsync(CancellationToken ct = default)
    {
        if (Selected is null) return;
        var item = Selected;
        Progress = "识别并校对中…";
        await _runner.RecognizeAsync(item.Essay, item.FullPath, ct);
        await _runner.CorrectAsync(item.Essay, item.FullPath, ct);
        item.Refresh();
        Progress = $"已识别并校对：{item.Essay.Title}";
    }

    /// <summary>按当前默认批阅标准批阅选中作文。</summary>
    public async Task GradeAsync(CancellationToken ct = default)
    {
        if (Selected is null) return;
        var item = Selected;
        var g = await _runner.GradeAsync(item.Essay, _template, ct);
        await _db.SaveGradingAsync(g, ct);
        item.Refresh();
        Progress = $"批阅完成：{g.Total}/{_template.TotalScore} 分 · {g.Level}";
    }

    /// <summary>合并导出全部批阅结果（按文件名顺序）。</summary>
    public async Task ExportAsync(CancellationToken ct = default)
    {
        var rows = new List<(Essay, GradingOrder?)>();
        foreach (var item in Essays.OrderBy(i => i.Essay.SortOrder))
        {
            GradingOrder? g = null;
            if (item.Essay.Status >= Enums.EssayStatus.Graded)
                g = new GradingOrder(0, "已批阅", "", new List<GradingItem>());
            rows.Add((item.Essay, g));
        }
        var path = await _export.ExportMergedAsync(rows, ct);
        Progress = $"已导出：{path}";
    }
}