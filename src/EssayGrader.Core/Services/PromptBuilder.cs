using System.Text;
using EssayGrader.Core.Models;

namespace EssayGrader.Core.Services;

/// <summary>组装识别 / 校对 / 批阅三种提示词。</summary>
public class PromptBuilder
{
    /// <summary>识别提示词（要求逐句置信度 + 区域）。</summary>
    public string BuildRecognize()
        => "你是手写作文扫描图的识别助手。请识别图片中的标题、作者姓名、正文。\n" +
           "要求返回 JSON：\n" +
           "{\n" +
           " \"page_count\": 页数,\n" +
           " \"title\": {\"text\":\"标题\",\"confidence\":0-1},\n" +
           " \"author\": {\"text\":\"姓名\",\"confidence\":0-1},\n" +
           " \"body\": [{\"id\":\"a1\",\"text\":\"一句完整自然句\",\"confidence\":0-1,\"region\":\"区域标识\"}, ...]\n" +
           "}\n" +
           "最后给 low_confidence: [低于0.7置信度的句子id数组]。\n" +
           "body 必须是一个数组，每个元素一句完整的话；只做识别，不要改写、不要添加内容。";

    /// <summary>纠错 + 校对比对提示词（对照原图 base64，不改变原意）。</summary>
    public string BuildCorrect(string originalBody)
        => $"你作为批改前的中文校对助手，请对照上面这张作文原图，对下面识别文本逐句核对并修正：\n" +
           $"识别文本：\n{originalBody}\n\n" +
           "对每一句给出裁决，返回 JSON：\n" +
           "{\"sentences\": [{\"id\":\"a1\",\"verdict\":\"ok|correct|polish|verify\",\"text\":\"处理后的文本\",\"need_verify\":true/false,\"reason\":\"说明\"}]}\n" +
           "规则：\n" +
           "- 识别错误 → verdict=correct 给出 corrected 文本；\n" +
           "- 语句不通顺（疑似漏字/错字导致）→ 在不改变原意前提下 verdict=polish 润色 text；\n" +
           "- 无法判断 → verdict=verify 且 need_verify=true 交给人工；\n" +
           "- 正确 → verdict=ok。\n" +
           "禁止添加新情节，禁止改变主旨与情感。";

    /// <summary>批阅提示词（按标准模板）。</summary>
    public string BuildGrading(string body, GradeTemplate template)
    {
        var sb = new StringBuilder();
        sb.AppendLine("请按下述批阅标准对这篇作文评分。");
        sb.AppendLine($"标准名称：{template.Name}，总分：{template.TotalScore}。");
        sb.AppendLine("各维度满分：");
        foreach (var d in template.Dimensions)
            sb.AppendLine($"- {d.Name}（满分 {d.MaxScore}）：{d.Rule}");
        sb.AppendLine();
        sb.AppendLine("对每篇作文输出 JSON：");
        sb.AppendLine("{");
        sb.AppendLine(" \"total\": 总分, \"level\": \"评价等级\", \"summary\": \"一句话综合评价\",");
        sb.AppendLine(" \"dimensions\": [{\"name\":\"维度\",\"score\":得分,\"max\":满分}],");
        sb.AppendLine(" \"pros\":     [{\"text\":\"优点\",\"source\":\"引用原文(可空)\"}],");
        sb.AppendLine(" \"againsts\": [{\"text\":\"缺点及失分点\",\"source\":\"引用原文(可空)\"}],");
        sb.AppendLine(" \"suggestions\":[{\"text\":\"修改建议(不改变原意)\",\"source\":null}]");
        sb.AppendLine("}");
        sb.AppendLine();
        sb.AppendLine("作文正文：");
        sb.AppendLine(body);
        sb.AppendLine("仅依据正文与标准评分，不要臆造原文没有的内容。");
        return sb.ToString();
    }
}