using EssayGrader.Core.Models;
using Microsoft.Data.Sqlite;

namespace EssayGrader.Core.Services;

/// <summary>SQLite 持久化（跨平台）。作文/句子/校正日志/标准模板/批阅结果/属性。</summary>
public class StorageService
{
    private readonly string _dbPath;

    public StorageService(string dbPath) => _dbPath = dbPath;

    private SqliteConnection Open()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_dbPath)!);
        var conn = new SqliteConnection($"Data Source={_dbPath}");
        conn.Open();
        return conn;
    }

    private static async Task<long> LastInsertIdAsync(SqliteConnection c, CancellationToken ct)
    {
        await using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT last_insert_rowid();";
        return (long)(await cmd.ExecuteScalarAsync(ct) ?? 0L);
    }

    public async Task InitAsync(CancellationToken ct = default)
    {
        await using var c = Open();
        var sql = """
            CREATE TABLE IF NOT EXISTS essays(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_name TEXT NOT NULL, sort_order INT, title TEXT, author TEXT,
                page_count INT, status INT, created_at TEXT, updated_at TEXT);
            CREATE TABLE IF NOT EXISTS pages(
                id INTEGER PRIMARY KEY AUTOINCREMENT, essay_id INT, page_no INT,
                image_path TEXT, thumb_path TEXT, width INT, height INT);
            CREATE TABLE IF NOT EXISTS sentences(
                id INTEGER PRIMARY KEY AUTOINCREMENT, essay_id INT, seq TEXT, idx INT,
                text TEXT, original_text TEXT, confidence REAL, region TEXT,
                verdict INT, need_verify INT, modified INT, notes TEXT);
            CREATE TABLE IF NOT EXISTS correction_logs(
                id INTEGER PRIMARY KEY AUTOINCREMENT, sentence_id INT,
                original TEXT, corrected TEXT, verdict INT, reason TEXT,
                user_accepted INT, created_at TEXT);
            CREATE TABLE IF NOT EXISTS templates(
                id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, total_score INT,
                is_default INT, updated_at TEXT);
            CREATE TABLE IF NOT EXISTS dimensions(
                id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INT,
                name TEXT, max_score INT, rule TEXT);
            CREATE TABLE IF NOT EXISTS gradings(
                id INTEGER PRIMARY KEY AUTOINCREMENT, essay_id INT, template_id INT,
                total INT, level TEXT, summary TEXT, raw_json TEXT, created_at TEXT);
            CREATE TABLE IF NOT EXISTS grading_items(
                id INTEGER PRIMARY KEY AUTOINCREMENT, grading_id INT, kind INT,
                dim_name TEXT, text TEXT, source_sentence TEXT);
            CREATE TABLE IF NOT EXISTS props(key TEXT PRIMARY KEY, value TEXT);
            """;
        await using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        await cmd.ExecuteNonQueryAsync(ct);
    }

    // ---------- Essays ----------
    public async Task UpsertEssayAsync(Essay e, CancellationToken ct = default)
    {
        await using var c = Open();
        if (e.Id == 0)
        {
            await using var ins = c.CreateCommand();
            ins.CommandText = """
                INSERT INTO essays(file_name,sort_order,title,author,page_count,status,created_at,updated_at)
                VALUES($fn,$so,$t,$a,$pc,$st,$ca,$ua)
                """;
            ins.Parameters.AddWithValue("$fn", e.FileName);
            ins.Parameters.AddWithValue("$so", e.SortOrder);
            ins.Parameters.AddWithValue("$t", D(e.Title));
            ins.Parameters.AddWithValue("$a", D(e.Author));
            ins.Parameters.AddWithValue("$pc", e.PageCount);
            ins.Parameters.AddWithValue("$st", (int)e.Status);
            ins.Parameters.AddWithValue("$ca", e.CreatedAt.ToString("O"));
            ins.Parameters.AddWithValue("$ua", D(e.UpdatedAt?.ToString("O")));
            await ins.ExecuteNonQueryAsync(ct);
            e.Id = (int)await LastInsertIdAsync(c, ct);
            return;
        }

        await using var cmd = c.CreateCommand();
        cmd.CommandText = """
            UPDATE essays
            SET file_name=$fn, sort_order=$so, title=$t, author=$a, page_count=$pc,
                status=$st, created_at=$ca, updated_at=$ua
            WHERE id=$id
            """;
        cmd.Parameters.AddWithValue("$id", e.Id);
        cmd.Parameters.AddWithValue("$fn", e.FileName);
        cmd.Parameters.AddWithValue("$so", e.SortOrder);
        cmd.Parameters.AddWithValue("$t", D(e.Title));
        cmd.Parameters.AddWithValue("$a", D(e.Author));
        cmd.Parameters.AddWithValue("$pc", e.PageCount);
        cmd.Parameters.AddWithValue("$st", (int)e.Status);
        cmd.Parameters.AddWithValue("$ca", e.CreatedAt.ToString("O"));
        cmd.Parameters.AddWithValue("$ua", D(e.UpdatedAt?.ToString("O")));
        await cmd.ExecuteNonQueryAsync(ct);
    }

    /// <summary>把 null 转为 DBNull，避免 AddWithValue 抛 “Value must be set”。</summary>
    private static object D(object? v) => v switch { null => DBNull.Value, _ => v };

    public async Task<List<Essay>> GetEssaysAsync(CancellationToken ct = default)
    {
        var list = new List<Essay>();
        await using var c = Open();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT * FROM essays ORDER BY sort_order ASC, id ASC";
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
        {
            list.Add(new Essay
            {
                Id = r.GetInt32(0), FileName = r.GetString(1), SortOrder = r.GetInt32(2),
                Title = r.IsDBNull(3) ? "" : r.GetString(3),
                Author = r.IsDBNull(4) ? "" : r.GetString(4),
                PageCount = r.GetInt32(5), Status = (Enums.EssayStatus)r.GetInt32(6)
            });
        }
        return list;
    }

    // ---------- Sentences ----------
    public async Task ReplaceSentencesAsync(int essayId, IEnumerable<BodySentence> sents, CancellationToken ct = default)
    {
        await using var c = Open();
        await using var del = c.CreateCommand();
        del.CommandText = "DELETE FROM sentences WHERE essay_id=$e";
        del.Parameters.AddWithValue("$e", essayId);
        await del.ExecuteNonQueryAsync(ct);

        foreach (var s in sents)
        {
            await using var cmd = c.CreateCommand();
            cmd.CommandText = """
                INSERT INTO sentences(essay_id,seq,idx,text,original_text,confidence,region,verdict,need_verify,modified,notes)
                VALUES($e,$s,$i,$t,$o,$cf,$r,$v,$nv,$m,$n)
                """;
            cmd.Parameters.AddWithValue("$e", essayId);
            cmd.Parameters.AddWithValue("$s", s.Seq);
            cmd.Parameters.AddWithValue("$i", s.Index);
            cmd.Parameters.AddWithValue("$t", D(s.Text));
            cmd.Parameters.AddWithValue("$o", D(s.OriginalText));
            cmd.Parameters.AddWithValue("$cf", s.Confidence);
            cmd.Parameters.AddWithValue("$r", D(s.Region));
            cmd.Parameters.AddWithValue("$v", (int)s.Verdict);
            cmd.Parameters.AddWithValue("$nv", s.NeedVerify ? 1 : 0);
            cmd.Parameters.AddWithValue("$m", s.Modified ? 1 : 0);
            cmd.Parameters.AddWithValue("$n", D(s.Notes));
            await cmd.ExecuteNonQueryAsync(ct);
        }
    }

    public async Task<List<BodySentence>> GetSentencesAsync(int essayId, CancellationToken ct = default)
    {
        var list = new List<BodySentence>();
        await using var c = Open();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT * FROM sentences WHERE essay_id=$e ORDER BY idx";
        cmd.Parameters.AddWithValue("$e", essayId);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
            list.Add(new BodySentence
            {
                Id = r.GetInt32(0), EssayId = r.GetInt32(1), Seq = r.GetString(2), Index = r.GetInt32(3),
                Text = r.GetString(4), OriginalText = r.IsDBNull(5) ? "" : r.GetString(5),
                Confidence = r.GetDouble(6), Region = r.IsDBNull(7) ? "" : r.GetString(7),
                Verdict = (Enums.Verdict)r.GetInt32(8), NeedVerify = r.GetInt32(9) == 1,
                Modified = r.GetInt32(10) == 1, Notes = r.IsDBNull(11) ? "" : r.GetString(11)
            });
        return list;
    }

    // ---------- Templates + Dimensions ----------
    public async Task<List<GradeTemplate>> GetTemplatesAsync(CancellationToken ct = default)
    {
        var list = new List<GradeTemplate>();
        await using var c = Open();
        await using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = "SELECT id,name,total_score,is_default FROM templates ORDER BY id";
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
                list.Add(new GradeTemplate
                {
                    Id = r.GetInt32(0), Name = r.GetString(1), TotalScore = r.GetInt32(2),
                    IsDefault = r.GetInt32(3) == 1
                });
        }
        await using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = "SELECT id,template_id,name,max_score,rule FROM dimensions";
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                var t = list.FirstOrDefault(x => x.Id == r.GetInt32(1));
                if (t != null)
                    t.Dimensions.Add(new GradeDimension
                    {
                        Id = r.GetInt32(0), TemplateId = r.GetInt32(1), Name = r.GetString(2),
                        MaxScore = r.GetInt32(3), Rule = r.IsDBNull(4) ? "" : r.GetString(4)
                    });
            }
        }
        return list;
    }

    public async Task<GradeTemplate> SaveTemplateAsync(GradeTemplate t, CancellationToken ct = default)
    {
        await using var c = Open();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = """
            INSERT INTO templates(name,total_score,is_default,updated_at)
            VALUES($n,$ts,$id,$ua)
            """;
        cmd.Parameters.AddWithValue("$n", t.Name);
        cmd.Parameters.AddWithValue("$ts", t.TotalScore);
        cmd.Parameters.AddWithValue("$id", t.IsDefault ? 1 : 0);
        cmd.Parameters.AddWithValue("$ua", DateTime.Now.ToString("O"));
        await cmd.ExecuteNonQueryAsync(ct);
        t.Id = (int)await LastInsertIdAsync(c, ct);

        foreach (var d in t.Dimensions)
        {
            await using var dc = c.CreateCommand();
            dc.CommandText = "INSERT INTO dimensions(template_id,name,max_score,rule) VALUES($t,$n,$m,$r)";
            dc.Parameters.AddWithValue("$t", t.Id);
            dc.Parameters.AddWithValue("$n", D(d.Name));
            dc.Parameters.AddWithValue("$m", d.MaxScore);
            dc.Parameters.AddWithValue("$r", D(d.Rule));
            await dc.ExecuteNonQueryAsync(ct);
        }
        return t;
    }

    /// <summary>更新模板主体与维度（先覆盖维度，再更新主表）。</summary>
    public async Task UpdateTemplateAsync(GradeTemplate t, CancellationToken ct = default)
    {
        await using var c = Open();
        await using (var del = c.CreateCommand())
        {
            del.CommandText = "DELETE FROM dimensions WHERE template_id=$t";
            del.Parameters.AddWithValue("$t", t.Id);
            await del.ExecuteNonQueryAsync(ct);
        }
        foreach (var d in t.Dimensions)
        {
            await using var dc = c.CreateCommand();
            dc.CommandText = "INSERT INTO dimensions(template_id,name,max_score,rule) VALUES($t,$n,$m,$r)";
            dc.Parameters.AddWithValue("$t", t.Id);
            dc.Parameters.AddWithValue("$n", D(d.Name));
            dc.Parameters.AddWithValue("$m", d.MaxScore);
            dc.Parameters.AddWithValue("$r", D(d.Rule));
            await dc.ExecuteNonQueryAsync(ct);
        }
        await using var cmd = c.CreateCommand();
        cmd.CommandText = "UPDATE templates SET name=$n, total_score=$ts, is_default=$id, updated_at=$ua WHERE id=$t";
        cmd.Parameters.AddWithValue("$n", t.Name);
        cmd.Parameters.AddWithValue("$ts", t.TotalScore);
        cmd.Parameters.AddWithValue("$id", t.IsDefault ? 1 : 0);
        cmd.Parameters.AddWithValue("$ua", DateTime.Now.ToString("O"));
        cmd.Parameters.AddWithValue("$t", t.Id);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    public async Task DeleteTemplateAsync(int id, CancellationToken ct = default)
    {
        await using var c = Open();
        await using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = "DELETE FROM dimensions WHERE template_id=$t";
            cmd.Parameters.AddWithValue("$t", id);
            await cmd.ExecuteNonQueryAsync(ct);
        }
        await using var cmd2 = c.CreateCommand();
        cmd2.CommandText = "DELETE FROM templates WHERE id=$t";
        cmd2.Parameters.AddWithValue("$t", id);
        await cmd2.ExecuteNonQueryAsync(ct);
    }

    // ---------- Grading ----------
    public async Task<int> SaveGradingAsync(GradingResult g, CancellationToken ct = default)
    {
        await using var c = Open();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = """
            INSERT INTO gradings(essay_id,template_id,total,level,summary,raw_json,created_at)
            VALUES($e,$t,$x,$l,$s,$rj,$ca)
            """;
        cmd.Parameters.AddWithValue("$e", g.EssayId);
        cmd.Parameters.AddWithValue("$t", g.TemplateId);
        cmd.Parameters.AddWithValue("$x", g.Total);
        cmd.Parameters.AddWithValue("$l", D(g.Level));
        cmd.Parameters.AddWithValue("$s", D(g.Summary));
        cmd.Parameters.AddWithValue("$rj", D(g.RawJson));
        cmd.Parameters.AddWithValue("$ca", g.CreatedAt.ToString("O"));
        await cmd.ExecuteNonQueryAsync(ct);
        g.Id = (int)await LastInsertIdAsync(c, ct);

        foreach (var d in g.DimensionScores)
        {
            await cmd2Insert(c, "grading_items", g.Id, (int)Enums.GradingItemKind.Pro, d.DimName,
                $"{d.Score}/{d.MaxScore} 分", null, ct);
        }
        foreach (var item in g.Items)
        {
            await cmd2Insert(c, "grading_items", g.Id, (int)item.Kind, "",
                item.Text, item.SourceSentence, ct);
        }
        return g.Id;
    }

    private static async Task cmd2Insert(SqliteConnection c, string table, int gradingId, int kind,
        string dimName, string text, string? source, CancellationToken ct)
    {
        await using var cmd = c.CreateCommand();
        cmd.CommandText = $"INSERT INTO {table}(grading_id,kind,dim_name,text,source_sentence) VALUES($g,$k,$d,$t,$s)";
        cmd.Parameters.AddWithValue("$g", gradingId);
        cmd.Parameters.AddWithValue("$k", kind);
        cmd.Parameters.AddWithValue("$d", dimName);
        cmd.Parameters.AddWithValue("$t", text);
        cmd.Parameters.AddWithValue("$s", (object?)source ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    /// <summary>读取某作文最近一次批阅结果（无则 null）。</summary>
    public async Task<GradingResult?> GetGradingByEssayAsync(int essayId, CancellationToken ct = default)
    {
        await using var c = Open();
        GradingResult? g = null;
        await using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = "SELECT id,essay_id,template_id,total,level,summary,created_at FROM gradings WHERE essay_id=$e ORDER BY id DESC LIMIT 1";
            cmd.Parameters.AddWithValue("$e", essayId);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            if (await r.ReadAsync(ct))
                g = new GradingResult
                {
                    Id = r.GetInt32(0), EssayId = r.GetInt32(1), TemplateId = r.GetInt32(2),
                    Total = r.GetInt32(3), Level = r.IsDBNull(4) ? "" : r.GetString(4),
                    Summary = r.IsDBNull(5) ? "" : r.GetString(5),
                    CreatedAt = DateTime.Parse(r.GetString(6))
                };
        }
        if (g == null) return null;

        await using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = "SELECT kind,dim_name,text,source_sentence,grading_id FROM grading_items WHERE grading_id=$g ORDER BY id";
            cmd.Parameters.AddWithValue("$g", g.Id);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                var kind = (Enums.GradingItemKind)r.GetInt32(0);
                var dimName = r.IsDBNull(1) ? "" : r.GetString(1);
                var text = r.IsDBNull(2) ? "" : r.GetString(2);
                var src = r.IsDBNull(3) ? null : r.GetString(3);
                if (!string.IsNullOrEmpty(dimName))
                {
                    // 维度分数以 "8/10 分" 形式存放，解析出数字
                    var dash = text.IndexOf('/');
                    var score = 0; var max = 0;
                    if (dash > 0 && int.TryParse(text[..dash], out score)) int.TryParse(text[(dash + 1)..].TrimEnd('分', ' '), out max);
                    g.DimensionScores.Add(new DimensionScore { GradingId = g.Id, DimName = dimName, Score = score, MaxScore = max });
                }
                else
                    g.Items.Add(new GradingItem { Kind = kind, Text = text, SourceSentence = src });
            }
        }
        return g;
    }

    // ---------- Properties (settings 等简单的键值) ----------
    public async Task SetPropertyAsync(string key, string value, CancellationToken ct = default)
    {
        await using var c = Open();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = "INSERT INTO props(key,value) VALUES($k,$v) ON CONFLICT(key) DO UPDATE SET value=excluded.value";
        cmd.Parameters.AddWithValue("$k", key);
        cmd.Parameters.AddWithValue("$v", value);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    public async Task<string?> GetPropertyAsync(string key, CancellationToken ct = default)
    {
        await using var c = Open();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT value FROM props WHERE key=$k";
        cmd.Parameters.AddWithValue("$k", key);
        var v = await cmd.ExecuteScalarAsync(ct);
        return v as string;
    }
}