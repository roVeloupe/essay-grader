using CommunityToolkit.Mvvm.ComponentModel;
using EssayGrader.Core.Models;

namespace EssayGrader.App.ViewModels;

/// <summary>中部列表中一行作文的展示模型。</summary>
public partial class EssayListItem : ObservableObject
{
    public Essay Essay { get; set; } = new();
    public string FullPath { get; set; } = "";

    public string DisplayName => Essay.FileName;
    public string Initial => Essay.Author.Length > 0 ? Essay.Author[..1] : (Essay.FileName.Length > 0 ? Essay.FileName[..1] : "?");

    private static readonly string[] Palette = { "#07C160", "#5A87F0", "#F0A05A", "#9B6BEF", "#5FC9A6" };
    public string Color => Palette[(Essay.SortOrder - 1 + Palette.Length) % Palette.Length];

    [ObservableProperty] private string _summary = "等待导入原图";
    [ObservableProperty] private string _statusText = "待识别";

    public void Refresh()
    {
        Summary = Essay.Title.Length > 0 ? $"{Essay.Title} · {Essay.Sentences.Count} 句" : "等待识别";
        StatusText = Essay.Status switch
        {
            Enums.EssayStatus.Recognized => "已识别",
            Enums.EssayStatus.Corrected => "已校对",
            Enums.EssayStatus.Graded => "已批阅",
            Enums.EssayStatus.Recognizing => "识别中…",
            _ => "待识别"
        };
        OnPropertyChanged(nameof(Summary));
        OnPropertyChanged(nameof(StatusText));
        OnPropertyChanged(nameof(DisplayName));
    }
}