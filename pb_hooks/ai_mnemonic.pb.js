/// <reference path="../pb_data/types.d.ts" />

// ── Quota Config ──────────────────────────────────────────────────────────────
var QUOTA = {
  free:      { daily:  5, monthly:  10 },
  monthly:   { daily: 30, monthly: 150 },
  quarterly: { daily: 30, monthly: 150 },
  yearly:    { daily: 60, monthly: 200 },
  lifetime:  { daily: 60, monthly: 200 },
};

// ── Ensure nex_ai_usage table exists ─────────────────────────────────────────
// (top-level code runs once when the hook file loads)
try {
  $app.dao().db().newQuery(
    "CREATE TABLE IF NOT EXISTS nex_ai_usage (" +
    "  id        TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(7))))," +
    "  user_id   TEXT NOT NULL," +
    "  date      TEXT NOT NULL," +
    "  day_count INTEGER NOT NULL DEFAULT 0," +
    "  UNIQUE(user_id, date)" +
    ")"
  ).execute();
} catch(_) {}

// ── Usage helpers (raw SQL — works whether table is PB-managed or raw) ────────
function getDayCount(userId, today) {
  try {
    var row = {};
    $app.dao().db().newQuery(
      "SELECT COALESCE(day_count,0) AS cnt FROM nex_ai_usage WHERE user_id={:u} AND date={:d} LIMIT 1"
    ).bind({ u: userId, d: today }).one(row);
    return row.cnt || 0;
  } catch(_) { return 0; }
}

function getMonthCount(userId, monthPrefix) {
  try {
    var row = {};
    $app.dao().db().newQuery(
      "SELECT COALESCE(SUM(day_count),0) AS cnt FROM nex_ai_usage WHERE user_id={:u} AND date LIKE {:m}"
    ).bind({ u: userId, m: monthPrefix + "%" }).one(row);
    return row.cnt || 0;
  } catch(_) { return 0; }
}

function incrementUsage(userId, today) {
  try {
    $app.dao().db().newQuery(
      "INSERT INTO nex_ai_usage (user_id, date, day_count) VALUES ({:u}, {:d}, 1) " +
      "ON CONFLICT(user_id, date) DO UPDATE SET day_count = day_count + 1"
    ).bind({ u: userId, d: today }).execute();
  } catch(_) {}
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
    try { $os.remove(tmpPath); } catch(_) {}
  }
}

// ── TTS (no auth required — TTS has no quota, auth blocked body reading) ──────
// Fix: use $apis.requestInfo(c).body to read body BEFORE any middleware touches it.
// Do NOT use $apis.requireRecordAuth() — it conflicts with c.bind() body reading.
routerAdd("POST", "/api/mnemonic/tts", (c) => {
  try {
    var info = $apis.requestInfo(c);
    var body = info.body || {};
    var text = (body.text || "").trim();
    if (!text) return c.json(400, { error: "text is required" });

    var result = runPython(__hooks + "/tts.py", { text: text });
    if (result.error) return c.json(502, result);

    // Ensure audioUrl is always absolute so mobile Capacitor app can load it
    var baseUrl = ($app.settings().meta.appUrl || "https://zjcnex.top").replace(/\/$/, "");
    return c.json(200, { audioUrl: baseUrl + result.audioPath });
  } catch (e) {
    return c.json(500, { error: "hook_exception", message: String(e) });
  }
});

// ── Chat (Qwen LLM + quota guard) ─────────────────────────────────────────────
// Fix: read everything via requestInfo() once — auth via info.auth, body via info.body.
// Do NOT use requireRecordAuth() middleware + c.bind() together (body conflict).
routerAdd("POST", "/api/mnemonic/chat", (c) => {
  try {
    var info = $apis.requestInfo(c);
    var authRecord = info.auth;
    if (!authRecord) return c.json(401, { error: "unauthorized" });

    var userId = authRecord.id;
    var tier = String(authRecord.get("subscription_tier") || "free").toLowerCase();
    var quota = QUOTA[tier] || QUOTA.free;

    var now = new Date();
    var today = now.toISOString().slice(0, 10);
    var monthPrefix = now.toISOString().slice(0, 7);

    var dayCount = getDayCount(userId, today);
    if (dayCount >= quota.daily) {
      return c.json(429, { error: "daily_limit_exceeded", used: dayCount, limit: quota.daily, tier: tier });
    }

    var monthCount = getMonthCount(userId, monthPrefix);
    if (monthCount >= quota.monthly) {
      return c.json(429, { error: "monthly_limit_exceeded", used: monthCount, limit: quota.monthly, tier: tier });
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

    incrementUsage(userId, today);
    return c.json(200, result);
  } catch (e) {
    return c.json(500, { error: "hook_exception", message: String(e) });
  }
});

// ── ASR (Paraformer) ──────────────────────────────────────────────────────────
// Fix: same pattern — use requestInfo() for both auth and body.
routerAdd("POST", "/api/mnemonic/asr", (c) => {
  try {
    var info = $apis.requestInfo(c);
    var authRecord = info.auth;
    if (!authRecord) return c.json(401, { error: "unauthorized" });

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
});
