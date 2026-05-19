/// <reference path="../pb_data/types.d.ts" />

// ── Quota Config (edit to adjust limits, takes effect on next request) ────────
var QUOTA = {
  free:      { daily:  5, monthly:  10 },
  monthly:   { daily: 30, monthly: 150 },
  quarterly: { daily: 30, monthly: 150 },
  yearly:    { daily: 60, monthly: 200 },
  lifetime:  { daily: 60, monthly: 200 },
};

// ── Init usage table (runs once on hook load) ─────────────────────────────────
try {
  $app.dao().db().newQuery(
    "CREATE TABLE IF NOT EXISTS nex_ai_usage (" +
    "  user_id   TEXT NOT NULL," +
    "  date      TEXT NOT NULL," +
    "  day_count INTEGER NOT NULL DEFAULT 0," +
    "  PRIMARY KEY (user_id, date)" +
    ")"
  ).execute();
} catch (_) {}

// ── Usage helpers ─────────────────────────────────────────────────────────────
function getDayCount(userId, today) {
  try {
    var row = $app.dao().db()
      .newQuery("SELECT day_count FROM nex_ai_usage WHERE user_id={:u} AND date={:d}")
      .bind({ u: userId, d: today })
      .one();
    return row.day_count || 0;
  } catch (_) { return 0; }
}

function getMonthCount(userId, monthPrefix) {
  try {
    var row = $app.dao().db()
      .newQuery("SELECT SUM(day_count) AS total FROM nex_ai_usage WHERE user_id={:u} AND date LIKE {:m}")
      .bind({ u: userId, m: monthPrefix + "%" })
      .one();
    return row.total || 0;
  } catch (_) { return 0; }
}

function incrementUsage(userId, today) {
  $app.dao().db().newQuery(
    "INSERT INTO nex_ai_usage (user_id, date, day_count) VALUES ({:u},{:d},1) " +
    "ON CONFLICT(user_id, date) DO UPDATE SET day_count = day_count + 1"
  ).bind({ u: userId, d: today }).execute();
}

// ── Python runner ─────────────────────────────────────────────────────────────
function runPython(scriptPath, payload) {
  var tmpPath = "/tmp/mnemonic_" + Date.now() + "_" + Math.random().toString(16).slice(2) + ".json";
  $os.writeFile(tmpPath, JSON.stringify(payload));
  try {
    var cmd = $os.cmd("/bin/bash", "-c",
      "unset PYTHONHOME PYTHONPATH; /usr/bin/python3.11 '" + scriptPath + "' '" + tmpPath + "'");
    var output = cmd.combinedOutput();
    var text = String.fromCharCode(...output).trim();
    var s = text.lastIndexOf("{");
    var e = text.lastIndexOf("}");
    if (s < 0 || e <= s) throw new Error("bad script output: " + text);
    return JSON.parse(text.slice(s, e + 1));
  } finally {
    try { $os.remove(tmpPath); } catch (_) {}
  }
}

// ── TTS ───────────────────────────────────────────────────────────────────────
routerAdd("POST", "/api/mnemonic/tts", (c) => {
  try {
    var info = $apis.requestInfo(c);
    var body = info.body || {};
    var text = (body.text || "").trim();
    if (!text) return c.json(400, { error: "text is required" });

    var result = runPython(__hooks + "/tts.py", { text: text });
    if (result.error) return c.json(502, result);

    var baseUrl = $app.settings().meta.appUrl || "";
    return c.json(200, { audioUrl: baseUrl + result.audioPath });
  } catch (e) {
    return c.json(500, { error: "hook_exception", message: String(e) });
  }
}, $apis.requireRecordAuth());

// ── Chat (Qwen LLM + quota guard) ─────────────────────────────────────────────
routerAdd("POST", "/api/mnemonic/chat", (c) => {
  try {
    var info = $apis.requestInfo(c);
    var userId = info.auth.id;
    var tier = String(info.auth.get("subscription_tier") || "free").toLowerCase();
    var quota = QUOTA[tier] || QUOTA.free;

    var now = new Date();
    var today = now.toISOString().slice(0, 10);       // YYYY-MM-DD
    var monthPrefix = now.toISOString().slice(0, 7);  // YYYY-MM

    var dayCount = getDayCount(userId, today);
    if (dayCount >= quota.daily) {
      return c.json(429, {
        error: "daily_limit_exceeded",
        used: dayCount,
        limit: quota.daily,
        tier: tier
      });
    }

    var monthCount = getMonthCount(userId, monthPrefix);
    if (monthCount >= quota.monthly) {
      return c.json(429, {
        error: "monthly_limit_exceeded",
        used: monthCount,
        limit: quota.monthly,
        tier: tier
      });
    }

    var body = info.body || {};
    var messages = body.messages || [];
    if (messages.length === 0) return c.json(400, { error: "messages required" });

    var result = runPython(__hooks + "/mnemonic_chat.py", {
      messages: messages,
      markedWords: body.markedWords || [],
      materialTitle: body.materialTitle || ""
    });
    if (result.error) return c.json(502, result);

    // Increment only after successful response
    incrementUsage(userId, today);

    return c.json(200, result);
  } catch (e) {
    return c.json(500, { error: "hook_exception", message: String(e) });
  }
}, $apis.requireRecordAuth());

// ── ASR (Paraformer) ──────────────────────────────────────────────────────────
routerAdd("POST", "/api/mnemonic/asr", (c) => {
  try {
    var info = $apis.requestInfo(c);
    var body = info.body || {};
    var audioBase64 = body.audioBase64 || "";
    var mimeType = body.mimeType || "audio/mp4";

    if (!audioBase64) return c.json(400, { error: "audioBase64 required" });

    var result = runPython(__hooks + "/mnemonic_asr.py", {
      audioBase64: audioBase64,
      mimeType: mimeType
    });
    if (result.error) return c.json(502, result);
    return c.json(200, result);
  } catch (e) {
    return c.json(500, { error: "hook_exception", message: String(e) });
  }
}, $apis.requireRecordAuth());
