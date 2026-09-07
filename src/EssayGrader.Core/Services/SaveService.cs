using EssayGrader.Core.Models;

namespace EssayGrader.Core.Services;

/// <summary>保存位置解析（FR-19/FR-20）。默认目录可用用户在设置中指定。</summary>
public class SaveService
{
    private readonly SaveOptions _save;
    public SaveService(SaveOptions save) => _save = save;

    private static string DefaultRootDir()
    {
        var app = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        return Path.Combine(app, "EssayGrader", "exports");
    }

    /// <summary>批阅结果目录（单篇「保存结果」）。未设置回退到默认目录。</summary>
    public string ResolveResultsDir()
    {
        var dir = string.IsNullOrWhiteSpace(_save.ResultsDir)
            ? DefaultRootDir()
            : _save.ResultsDir;
        Directory.CreateDirectory(dir);
        return dir;
    }

    /// <summary>导出目标目录；若非"每次询问"模式，按批次建子目录（批次_yyyyMMdd_HHmmss）。</summary>
    public string ResolveExportDir()
    {
        var baseDir = string.IsNullOrWhiteSpace(_save.ExportDir)
            ? DefaultRootDir()
            : _save.ExportDir;
        var dir = _save.Mode == Enums.SaveMode.AskEachTime
            ? baseDir
            : Path.Combine(baseDir, $"批次_{DateTime.Now:yyyyMMdd_HHmmss}");
        Directory.CreateDirectory(dir);
        return dir;
    }

    /// <summary>为给定作文拼一个无冲突的输出路径。</summary>
    public string ComposePath(string directory, string fileName, string suffix, string ext)
    {
        var baseName = Path.GetFileNameWithoutExtension(fileName);
        var candidate = Path.Combine(directory, $"{baseName}{suffix}.{ext}");
        var n = 1;
        while (File.Exists(candidate))
            candidate = Path.Combine(directory, $"{baseName}{suffix}_{n++}.{ext}");
        return candidate;
    }
}