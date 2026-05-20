/// <reference path="../pb_data/types.d.ts" />

var QUOTA = {
  free:      { daily:  5, monthly:  10 },
  monthly:   { daily: 30, monthly: 150 },
  quarterly: { daily: 30, monthly: 150 },
  yearly:    { daily: 60, monthly: 200 },
  lifetime:  { daily: 60, monthly: 200 },
};

// Ensure quota table exists. Wrapped in try-catch so a transient DB hiccup
// at startup does NOT prevent the hook file from loading (which would kill TTS too).
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
} catch(e) {
  // Log but don't crash — quota checks will surface the error at request time.
  $app.logger().error("nex_ai_usage table init failed", "err", String(e));
}

/**
 * Returns { dayCount, monthCount } for the given user/date.
 * Throws on DB error so the caller can surface a 500 instead of silently
 * bypassing quota.
 */
function getUsageCounts(userId, today, monthPrefix) {
  // Use SUM so the query always returns exactly one row (SUM of no rows = NULL → COALESCE → 0).
  // A plain SELECT with LIMIT 1 would return zero rows for a new user, causing .one() to throw.
  var dayRow = {};
  $app.dao().db().newQuery(
    "SELECT COALESCE(SUM(day_count), 0) AS day_count" +
    "  FROM nex_ai_usage" +
    "  WHERE user_id = {:u} AND date = {:d}"
  ).bind({ u: userId, d: today }).one(dayRow);
  var dayCount = (typeof dayRow["day_count"] === "number") ? dayRow["day_count"] : 0;

  var monthRow = {};
  $app.dao().db().newQuery(
    "SELECT COALESCE(SUM(day_count), 0) AS month_count" +
    "  FROM nex_ai_usage" +
    "  WHERE user_id = {:u} AND date LIKE {:m}"
  ).bind({ u: userId, m: monthPrefix + "%" }).one(monthRow);
  var monthCount = (typeof monthRow["month_count"] === "number") ? monthRow["month_count"] : 0;

  return { dayCount: dayCount, monthCount: monthCount };
}

/**
 * Atomically increments the day counter.
 * Throws on DB error so the caller knows the count was not recorded.
 */
function incrementUsage(userId, today) {
  $app.dao().db().newQuery(
    "INSERT INTO nex_ai_usage (user_id, date, day_count) VALUES ({:u}, {:d}, 1)" +
    " ON CONFLICT(user_id, date) DO UPDATE SET day_count = day_count + 1"
  ).bind({ u: userId, d: today }).execute();
}

// NOTE: runPython must be defined INSIDE each routerAdd handler (not at top level).
// PocketBase v0.22.x goja JSVM does not make top-level function declarations
// accessible inside routerAdd callbacks — they must be in the same local scope.

routerAdd("POST", "/api/mnemonic/tts", function(c) {
  function runPython(scriptPath, payload) {
    var tmpPath = "/tmp/mn_" + Date.now() + ".json";
    $os.writeFile(tmpPath, JSON.stringify(payload));
    try {
      var cmd = $os.cmd("/bin/bash", "-c",
        "unset PYTHONHOME PYTHONPATH; /usr/bin/python3.11 '" + scriptPath + "' '" + tmpPath + "'");
      var output = cmd.combinedOutput();
      var chars = [];
      for (var i = 0; i < output.length; i++) { chars.push(output[i]); }
      var text = String.fromCharCode.apply(null, chars).trim();
      var s = text.lastIndexOf("{");
      var e = text.lastIndexOf("}");
      if (s < 0 || e <= s) throw new Error("script output: " + text);
      return JSON.parse(text.slice(s, e + 1));
    } finally {
      try { $os.remove(tmpPath); } catch(_) {}
    }
  }
  try {
    var info = $apis.requestInfo(c);
    var body = info.data || {};
    var text = (body.text || "").trim();
    if (!text) return c.json(400, { error: "text is required" });
    var result = runPython(__hooks + "/tts.py", { text: text });
    if (result.error) return c.json(502, result);
    var baseUrl = ($app.settings().meta.appUrl || "https://zjcnex.top").replace(/\/$/, "");
    return c.json(200, { audioUrl: baseUrl + result.audioPath });
  } catch (e) {
    return c.json(500, { error: "hook_exception", message: String(e) });
  }
});

routerAdd("POST", "/api/mnemonic/chat", function(c) {
  function runPython(scriptPath, payload) {
    var tmpPath = "/tmp/mn_" + Date.now() + ".json";
    $os.writeFile(tmpPath, JSON.stringify(payload));
    try {
      var cmd = $os.cmd("/bin/bash", "-c",
        "unset PYTHONHOME PYTHONPATH; /usr/bin/python3.11 '" + scriptPath + "' '" + tmpPath + "'");
      var output = cmd.combinedOutput();
      var chars = [];
      for (var i = 0; i < output.length; i++) { chars.push(output[i]); }
      var text = String.fromCharCode.apply(null, chars).trim();
      // Use indexOf (first "{") so nested JSON objects don't confuse the extractor
      var s = text.indexOf("{");
      var e = text.lastIndexOf("}");
      if (s < 0 || e <= s) throw new Error("script output: " + text);
      return JSON.parse(text.slice(s, e + 1));
    } finally {
      try { $os.remove(tmpPath); } catch(_) {}
    }
  }
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
    var body = info.data || {};
    var messages = body.messages || [];
    if (messages.length === 0) return c.json(400, { error: "messages required" });

    var usage;
    try {
      usage = getUsageCounts(userId, today, monthPrefix);
    } catch (dbErr) {
      return c.json(500, { error: "quota_db_error", message: String(dbErr) });
    }
    if (usage.dayCount >= quota.daily) {
      return c.json(429, { error: "daily_limit_exceeded", used: usage.dayCount, limit: quota.daily, tier: tier });
    }
    if (usage.monthCount >= quota.monthly) {
      return c.json(429, { error: "monthly_limit_exceeded", used: usage.monthCount, limit: quota.monthly, tier: tier });
    }

    var result = runPython(__hooks + "/mnemonic_chat.py", {
      messages: messages,
      markedWords: body.markedWords || [],
      materialTitle: body.materialTitle || "",
      conversationState: body.conversationState || null
    });
    if (result.error) return c.json(502, result);
    try {
      incrementUsage(userId, today);
    } catch (dbErr) {
      result._usageWarning = "increment_failed: " + String(dbErr);
    }

    // Save to nex_chat_logs collection (best-effort, never blocks the reply)
    try {
      var convState  = body.conversationState || {};
      var stateUpd   = result.stateUpdate || {};
      var lastUserMsg = "";
      var msgs = body.messages || [];
      for (var mi = msgs.length - 1; mi >= 0; mi--) {
        if (msgs[mi].role === "user") { lastUserMsg = msgs[mi].text || ""; break; }
      }
      var logsCollection = $app.dao().findCollectionByNameOrId("nex_chat_logs");
      var logRecord = new Record(logsCollection);
      logRecord.set("user_id",   userId);
      logRecord.set("material",  (body.materialTitle || "").slice(0, 200));
      logRecord.set("word",      String(convState.currentWordIndex !== undefined
                                   ? (body.markedWords || [])[convState.currentWordIndex]
                                     ? (body.markedWords[convState.currentWordIndex].text || "")
                                     : ""
                                   : ""));
      logRecord.set("phase",     convState.sessionPhase || "drilling");
      logRecord.set("user_msg",  lastUserMsg.slice(0, 500));
      logRecord.set("ai_reply",  (result.reply || "").slice(0, 1000));
      logRecord.set("attempt",   Number(convState.attemptCount) || 0);
      logRecord.set("word_index",Number(convState.currentWordIndex) || 0);
      logRecord.set("rules",     stateUpd);
      logRecord.set("advancement", stateUpd.advancement === true);
      $app.dao().saveRecord(logRecord);
    } catch (logErr) {
      $app.logger().error("nex_chat_logs save failed", "err", String(logErr));
    }

    return c.json(200, result);
  } catch (e) {
    return c.json(500, { error: "hook_exception", message: String(e) });
  }
});

routerAdd("POST", "/api/mnemonic/asr", function(c) {
  function runPython(scriptPath, payload) {
    var tmpPath = "/tmp/mn_" + Date.now() + ".json";
    $os.writeFile(tmpPath, JSON.stringify(payload));
    try {
      var cmd = $os.cmd("/bin/bash", "-c",
        "unset PYTHONHOME PYTHONPATH; /usr/bin/python3.11 '" + scriptPath + "' '" + tmpPath + "'");
      var output = cmd.combinedOutput();
      var chars = [];
      for (var i = 0; i < output.length; i++) { chars.push(output[i]); }
      var text = String.fromCharCode.apply(null, chars).trim();
      var s = text.lastIndexOf("{");
      var e = text.lastIndexOf("}");
      if (s < 0 || e <= s) throw new Error("script output: " + text);
      return JSON.parse(text.slice(s, e + 1));
    } finally {
      try { $os.remove(tmpPath); } catch(_) {}
    }
  }
  try {
    var info = $apis.requestInfo(c);
    var body = info.data || {};
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
