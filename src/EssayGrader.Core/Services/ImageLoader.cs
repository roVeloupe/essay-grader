using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.Processing;

namespace EssayGrader.Core.Services;

/// <summary>图片加载与压缩：读取尺寸、生成缩略图、转 base64（供 step-3.7-flash 原生识别）。</summary>
public class ImageLoader
{
    private readonly JpegEncoder _jpeg = new()
    {
        Quality = 85
    };

    /// <summary>读取图片并返回尺寸。</summary>
    public Task<(int Width, int Height)> ReadSizeAsync(string path, CancellationToken ct = default)
    {
        var img = Image.Identify(path);
        return Task.FromResult((img.Width, img.Height));
    }

    /// <summary>把整图先等比缩放，再编码为 JPEG base64（控制传给模型的尺寸与流量）。</summary>
    public string ToBase64(string path, int maxEdge = 2048, CancellationToken ct = default)
    {
        using var img = Image.Load(path);
        ScaleToMaxEdge(img, maxEdge);
        using var ms = new MemoryStream();
        img.Save(ms, _jpeg);
        return Convert.ToBase64String(ms.ToArray());
    }

    /// <summary>生成缩略图（用于 UI 列表快速预览）。</summary>
    public string CreateThumbnail(string sourcePath, string outPath, int thumbEdge = 320, CancellationToken ct = default)
    {
        using var img = Image.Load(sourcePath);
        img.Mutate(x => x.AutoOrient());
        ScaleToMaxEdge(img, thumbEdge);
        Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
        img.Save(outPath, _jpeg);
        return outPath;
    }

    private static void ScaleToMaxEdge(Image img, int maxEdge)
    {
        var w = img.Width; var h = img.Height;
        if (w <= maxEdge && h <= maxEdge) return;
        var scale = Math.Min(1.0, (double)maxEdge / Math.Max(w, h));
        img.Mutate(x => x.Resize((int)(w * scale), (int)(h * scale)));
    }
}