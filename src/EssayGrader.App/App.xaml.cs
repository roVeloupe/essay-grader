using System.Text.Json;
using EssayGrader.Core;
using EssayGrader.Core.Models;
using EssayGrader.Core.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.UI.Xaml;

namespace EssayGrader.App;

/// <summary>WinUI3 应用入口：装配 DI、加载设置、创建主窗口。</summary>
public partial class App : Application
{
    public static ServiceProvider Services { get; private set; } = null!;
    public static AppSettings Settings { get; private set; } = new();

    public App()
    {
        InitializeComponent();
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        var appData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "EssayGrader");
        Directory.CreateDirectory(appData);

        // AppSettings.json：StepFun 接入 + 批阅 + 保存位置（FR-19/20）
        var cfgPath = Path.Combine(appData, "AppSettings.json");
        if (File.Exists(cfgPath))
            Settings = JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(cfgPath)) ?? new AppSettings();

        var dbPath = Path.Combine(appData, "essay.db");
        Services = Composition.Build(Settings, dbPath);

        // 确保存在默认批阅标准模板
        _ = TemplateSeeding.EnsureDefaultAsync(Services.GetRequiredService<StorageService>())
            .GetAwaiter().GetResult();

        var settingsStore = Services.GetRequiredService<StorageService>();
        RestoreFromProperties(settingsStore);

        _ = new MainWindow();
    }

    /// <summary>将 SQLite props 中保存的目录/模式（保存位置）合并回设置内存对象。</summary>
    private static void RestoreFromProperties(StorageService db)
    {
        var save = Settings.Save;
        var dirs = new(string key, Action<string> set)[]
        {
            ("results_dir", v => save.ResultsDir = v),
            ("export_dir",  v => save.ExportDir = v),
        };
        foreach (var (key, set) in dirs)
        {
            var v = db.GetPropertyAsync(key).GetAwaiter().GetResult();
            if (!string.IsNullOrEmpty(v)) set(v);
        }
        var mode = db.GetPropertyAsync("save_mode").GetAwaiter().GetResult();
        if (int.TryParse(mode, out var m)) save.Mode = (Enums.SaveMode)m;
    }
}