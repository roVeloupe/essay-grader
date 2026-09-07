using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using EssayGrader.Core.Models;

namespace EssayGrader.Core.Services;

/// <summary>StepFun（OpenAI 兼容）多模态对话客户端。</summary>
public interface IStepFunClient
{
    /// <summary>发送多模态对话（支持 base64 图片），返回模型文本内容。</summary>
    Task<string> CompleteAsync(string system, string userText,
        string? base64Image = null, string? imageMime = "image/jpeg",
        CancellationToken ct = default);

    /// <summary>健康检查：用一条很短的消息确认连接与鉴权。</summary>
    Task<string> TestAsync(CancellationToken ct = default);
}

/// <summary>StepFun 客户端：Base URL https://api.stepfun.com/v1 · model step-3.7-flash。</summary>
public class StepFunClient : IStepFunClient
{
    private readonly HttpClient _http;
    private readonly StepFunOptions _opt;

    public StepFunClient(HttpClient http, StepFunOptions opt)
    {
        _http = http;
        _opt = opt;
    }

    public async Task<string> CompleteAsync(string system, string userText,
        string? base64Image, string? imageMime, CancellationToken ct)
    {
        var contentParts = new List<object>();
        if (!string.IsNullOrEmpty(base64Image))
        {
            contentParts.Add(new { type = "text", text = userText });
            contentParts.Add(new
            {
                type = "image_url",
                image_url = new { url = $"data:{imageMime};base64,{base64Image}" } // 原生 base64 多模态
            });
        }
        else
        {
            contentParts.Add(new { type = "text", text = userText });
        }

        var payload = new
        {
            model = _opt.Model,
            temperature = _opt.Temperature,
            max_tokens = _opt.MaxTokens, // step-3.7-flash 为输出预算（思考关闭）
            enable_thinking = _opt.EnableThinking, // 显式关闭思考，避免推理烧满 token 导致输出为空
            reasoning_effort = _opt.ReasoningEffort, // 仅 thinking 开启时生效（low|medium|high）
            response_format = new { type = "json_object" }, // 结构化输出降低解析失败率
            messages = new object?[]
            {
                new { role = "system", content = system },
                new { role = "user", content = (object)contentParts }
            }
        };

        using var req = new HttpRequestMessage(HttpMethod.Post, CombineUrl(_opt.BaseUrl, "/chat/completions"));
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _opt.ApiKey);
        req.Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(_opt.TimeoutSeconds));

        using var resp = await _http.SendAsync(req, cts.Token);
        var body = await resp.Content.ReadAsStringAsync(ct);
        if (!resp.IsSuccessStatusCode)
            throw new StepFunException($"StepFun 返回 {(int)resp.StatusCode}: {Truncate(body)}");

        using var doc = JsonDocument.Parse(body);
        if (doc.RootElement.TryGetProperty("choices", out var choices) && choices.GetArrayLength() > 0)
        {
            var content = choices[0].GetProperty("message").GetProperty("content");
            var txt = content.ValueKind switch
            {
                JsonValueKind.Array => content.ToString(),      // 罕见：部分返回 content 为数组
                _ => content.GetString() ?? ""
            };
            if (string.IsNullOrWhiteSpace(txt))
                throw new StepFunException(
                    $"模型返回空内容（推理已占满 max_tokens={_opt.MaxTokens}），请增大 Token 预算后重试");
            return txt;
        }
        throw new StepFunException("StepFun 响应缺少 choices: " + Truncate(body));
    }

    public async Task<string> TestAsync(CancellationToken ct)
        => await CompleteAsync("你是助手", "请回复\"连接成功\"这四个字（不要引号）。", null, null, ct);

    private static string CombineUrl(string baseUrl, string path)
        => baseUrl.TrimEnd('/') + path;

    private static string Truncate(string s) => s.Length <= 400 ? s : s[..400] + "…";
}

public class StepFunException : Exception
{
    public StepFunException(string message) : base(message) { }
}

/// <summary>带重试的包装，负责把 JSON 解析成对应 DTO。</summary>
public class StepFunJson
{
    private readonly IStepFunClient _client;
    public StepFunJson(IStepFunClient c) => _client = c;

    /// <summary>调用并重试、并把返回 JSON 反序列化为 T。</summary>
    public async Task<T?> SendAsync<T>(string system, string userText,
        string? base64Image, CancellationToken ct, bool allowRetry = true)
    {
        // 简单重试：最多 3 次，指数退避（1s/2s/4s）
        const int max = 3;
        for (int attempt = 1; ; attempt++)
        {
            try
            {
                var raw = await _client.CompleteAsync(system, userText, base64Image, "image/jpeg", ct);
                return JsonSerializer.Deserialize<T>(SanitizeJson(raw), JsonOpts);
            }
            catch (StepFunException ex) when (allowRetry && attempt < max &&
                                              (IsTransientStatus(ex))) // transient-ish
            {
                await Task.Delay(TimeSpan.FromSeconds(Math.Pow(2, attempt - 1)), ct);
            }
        }
    }

    internal static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        // 模型返回的 verdict 等枚举为小写（"ok"/"correct"/"polish"/"verify"），需 CamelCase 映射；
        // verdict 额外用宽容转换器，遇到模型偶发离词汇值时落到 Verify（人工复核）而非抛 500
        Converters = { new LenientVerdictConverter(), new LenientIntConverter(), new JsonStringEnumConverter(JsonNamingPolicy.CamelCase, allowIntegerValues: true) }
    };

    private static bool IsTransientStatus(StepFunException ex)
        => ex.Message.StartsWith("StepFun 返回 5") || ex.Message.StartsWith("StepFun 返回 429")
            || ex.Message.Contains("空内容"); // 推理占满 token 返回空内容，属可重试的瞬时失败

    /// <summary>去除模型偶尔包裹的 ```json ... ``` 标记，只保留纯 JSON。</summary>
    internal static string SanitizeJson(string raw)
    {
        var s = raw.Trim();
        if (s.StartsWith("```")) s = s.TrimStart('`').Trim();
        if (s.StartsWith("json", StringComparison.OrdinalIgnoreCase)) s = s[4..].TrimStart();
        if (s.EndsWith("```")) s = s.TrimEnd('`').Trim();
        var start = s.IndexOf('{');
        var end = s.LastIndexOf('}');
        if (start >= 0 && end > start) return s[start..(end + 1)];
        return s;
    }
}

/// <summary>宽容的 Verdict 枚举转换：映射模型常见小写值；未知值安全落到 Verify（交人工复核）。</summary>
public sealed class LenientVerdictConverter : System.Text.Json.Serialization.JsonConverter<Enums.Verdict>
{
    public override Enums.Verdict Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == System.Text.Json.JsonTokenType.Number && reader.TryGetInt32(out var n))
            return Enum.IsDefined(typeof(Enums.Verdict), n) ? (Enums.Verdict)n : Enums.Verdict.Verify;
        if (reader.TokenType == System.Text.Json.JsonTokenType.String)
        {
            var s = reader.GetString()?.Trim().ToLowerInvariant();
            return s switch
            {
                "ok" or "正确" or "通过" or "无误" or "keep" => Enums.Verdict.Ok,
                "correct" or "修正" or "已改正" or "fix" => Enums.Verdict.Correct,
                "polish" or "润色" or "修改" or "rephrase" => Enums.Verdict.Polish,
                "verify" or "存疑" or "不确定" or "unknown" => Enums.Verdict.Verify,
                _ => Enums.Verdict.Verify // 离词汇值 → 交人工，避免整段解析失败
            };
        }
        return Enums.Verdict.Verify;
    }

    public override void Write(Utf8JsonWriter writer, Enums.Verdict value, JsonSerializerOptions options)
        => writer.WriteStringValue(value switch
        {
            Enums.Verdict.Ok => "ok",
            Enums.Verdict.Correct => "correct",
            Enums.Verdict.Polish => "polish",
            _ => "verify"
        });
}

/// <summary>宽容的 Int32 转换：接受小数/字符串形式的分数（模型偶发返回 18.5 或 "18.5"），就近取整，避免整批解析失败。</summary>
public sealed class LenientIntConverter : System.Text.Json.Serialization.JsonConverter<int>
{
    public override int Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == System.Text.Json.JsonTokenType.Number)
        {
            if (reader.TryGetInt32(out var i)) return i;
            if (reader.TryGetDouble(out var d)) return (int)Math.Round(d);
            return 0;
        }
        if (reader.TokenType == System.Text.Json.JsonTokenType.String)
        {
            var s = reader.GetString();
            if (string.IsNullOrWhiteSpace(s)) return 0;
            if (double.TryParse(s.Trim(), System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var v))
                return (int)Math.Round(v);
        }
        return 0;
    }

    public override void Write(Utf8JsonWriter writer, int value, JsonSerializerOptions options)
        => writer.WriteNumberValue(value);
}