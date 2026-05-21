/// <reference path="../pb_data/types.d.ts" />

var QUOTA = {
  free:      { daily:  5, monthly:  10 },
  monthly:   { daily: 30, monthly: 150 },
  quarterly: { daily: 30, monthly: 150 },
  yearly:    { daily: 60, monthly: 200 },
  lifetime:  { daily: 60, monthly: 200 },
};

// NOTE: Do NOT create tables at file-load time — $app.dao() is null then in
// PocketBase v0.22.3 (the app isn't fully bootstrapped when hook files load).
// Instead, ensureUsageTable() is called lazily from the route handler.
var __usageTableReady = false;
function ensureUsageTable() {
  if (__usageTableReady) return;
  $app.dao().db().newQuery(
    "CREATE TABLE IF NOT EXISTS nex_ai_usage (" +
    "  id        TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(7))))," +
    "  user_id   TEXT NOT NULL," +
    "  date      TEXT NOT NULL," +
    "  day_count INTEGER NOT NULL DEFAULT 0," +
    "  UNIQUE(user_id, date)" +
    ")"
  ).execute();
  __usageTableReady = true;
}

/**
 * Returns { dayCount, monthCount } for the given user/date.
 * Throws on DB error so the caller can surface a 500 instead of silently
 * bypassing quota.
 */
function getUsageCounts(userId, today, monthPrefix) {
  ensureUsageTable();
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
  ensureUsageTable();
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

// ─── Chat (via PB Collection event, not HTTP route) ─────────────────────────
//
// Architecture: client creates a record in `nex_chat_requests` via PB's
// standard Collection API (auth handled by Collection Rules). This hook fires
// synchronously after creation, runs the LLM, and updates the record. The
// create-response sent back to the client already includes the final reply.
//
// Why not routerAdd: routerAdd routes require manually re-implementing auth,
// body parsing, quota, etc. PB Collections handle all of that natively.
//
// Collection schema (see PB admin):
//   user_id (relation→users, required), messages (json, required),
//   marked_words (json), material_title (text), conversation_state (json),
//   status (select: pending/processing/done/error, default=pending),
//   reply (text), state_update (json), error_msg (text), tier_at_request (text)
//
onRecordAfterCreateRequest((e) => {
  if (e.collection.name !== "nex_chat_requests") return;

  // PocketBase v0.22.x goja does NOT make top-level declarations accessible
  // inside event handlers — everything (QUOTA constants, helper functions,
  // runPython) must be redefined inside this closure.

  var QUOTA_LOCAL = {
    free:      { daily:  5, monthly:  10 },
    monthly:   { daily: 30, monthly: 150 },
    quarterly: { daily: 30, monthly: 150 },
    yearly:    { daily: 60, monthly: 200 },
    lifetime:  { daily: 60, monthly: 200 },
  };

  function ensureUsageTableLocal() {
    $app.dao().db().newQuery(
      "CREATE TABLE IF NOT EXISTS nex_ai_usage (" +
      "  id        TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(7))))," +
      "  user_id   TEXT NOT NULL," +
      "  date      TEXT NOT NULL," +
      "  day_count INTEGER NOT NULL DEFAULT 0," +
      "  UNIQUE(user_id, date)" +
      ")"
    ).execute();
  }

  function getUsageCountsLocal(uid, day, monthPrefix) {
    ensureUsageTableLocal();
    // PB v0.22 JSVM requires DynamicModel as the result target for .one()
    // — plain {} fails with "Invalid variable type: must be a NullStringMap"
    var dayRow = new DynamicModel({ day_count: 0 });
    $app.dao().db().newQuery(
      "SELECT COALESCE(SUM(day_count), 0) AS day_count" +
      "  FROM nex_ai_usage WHERE user_id = {:u} AND date = {:d}"
    ).bind({ u: uid, d: day }).one(dayRow);
    var dayCount = Number(dayRow.day_count) || 0;

    var monthRow = new DynamicModel({ month_count: 0 });
    $app.dao().db().newQuery(
      "SELECT COALESCE(SUM(day_count), 0) AS month_count" +
      "  FROM nex_ai_usage WHERE user_id = {:u} AND date LIKE {:m}"
    ).bind({ u: uid, m: monthPrefix + "%" }).one(monthRow);
    var monthCount = Number(monthRow.month_count) || 0;

    return { dayCount: dayCount, monthCount: monthCount };
  }

  function incrementUsageLocal(uid, day) {
    ensureUsageTableLocal();
    $app.dao().db().newQuery(
      "INSERT INTO nex_ai_usage (user_id, date, day_count) VALUES ({:u}, {:d}, 1)" +
      " ON CONFLICT(user_id, date) DO UPDATE SET day_count = day_count + 1"
    ).bind({ u: uid, d: day }).execute();
  }

  function runPython(scriptPath, payload) {
    var tmpPath = "/tmp/mn_" + Date.now() + ".json";
    $os.writeFile(tmpPath, JSON.stringify(payload));
    try {
      // Important: redirect stderr to stdout AND force exit 0. Otherwise if
      // Python crashes (exit != 0), $os.cmd's combinedOutput() throws a
      // GoError BEFORE we can read the actual Python traceback. Same pattern
      // as aliyun_asr.pb.js.
      var cmd = $os.cmd("/bin/bash", "-c",
        "unset PYTHONHOME PYTHONPATH; " +
        "/usr/bin/python3.11 '" + scriptPath + "' '" + tmpPath + "' 2>&1; exit 0");
      var output = cmd.combinedOutput();
      var chars = [];
      for (var i = 0; i < output.length; i++) { chars.push(output[i]); }
      var text = String.fromCharCode.apply(null, chars).trim();
      // Log raw output so we can see Python tracebacks in journalctl when
      // the JSON-extraction fails.
      $app.logger().info("[chat-event] python_raw_output",
        "len", text.length,
        "head", text.slice(0, 300));
      var s = text.indexOf("{");
      var ee = text.lastIndexOf("}");
      if (s < 0 || ee <= s) throw new Error("python script produced no JSON. Raw output: " + text.slice(0, 800));
      return JSON.parse(text.slice(s, ee + 1));
    } finally {
      try { $os.remove(tmpPath); } catch(_) {}
    }
  }

  var record = e.record;
  $app.logger().info("[chat-event] ENTERED", "recordId", record.id);

  // Helper to mark error and save (best-effort — swallow save errors)
  function finishWithError(errCode, errMsg) {
    try {
      record.set("status",    "error");
      record.set("error_msg", String(errMsg || errCode).slice(0, 500));
      $app.dao().saveRecord(record);
    } catch (saveErr) {
      $app.logger().error("[chat-event] failed to save error state", "err", String(saveErr));
    }
  }

  try {
    // Resolve auth user from record's user_id field.
    var userId = String(record.get("user_id") || "");
    if (!userId) {
      $app.logger().error("[chat-event] missing user_id", "recordId", record.id);
      return finishWithError("missing_user_id", "user_id field required");
    }

    var authRecord;
    try {
      authRecord = $app.dao().findRecordById("users", userId);
    } catch (lookupErr) {
      $app.logger().error("[chat-event] user lookup failed", "userId", userId, "err", String(lookupErr));
      return finishWithError("user_not_found", String(lookupErr));
    }
    var tier = String(authRecord.get("subscription_tier") || "free").toLowerCase();
    var quota = QUOTA_LOCAL[tier] || QUOTA_LOCAL.free;
    record.set("tier_at_request", tier);

    // Quota check
    var now = new Date();
    var today = now.toISOString().slice(0, 10);
    var monthPrefix = now.toISOString().slice(0, 7);

    var usage;
    try {
      usage = getUsageCountsLocal(userId, today, monthPrefix);
    } catch (dbErr) {
      $app.logger().error("[chat-event] quota_db_error", "err", String(dbErr));
      return finishWithError("quota_db_error", String(dbErr));
    }
    if (usage.dayCount >= quota.daily) {
      return finishWithError("daily_limit_exceeded",
        "daily_limit_exceeded (used " + usage.dayCount + "/" + quota.daily + ", tier=" + tier + ")");
    }
    if (usage.monthCount >= quota.monthly) {
      return finishWithError("monthly_limit_exceeded",
        "monthly_limit_exceeded (used " + usage.monthCount + "/" + quota.monthly + ", tier=" + tier + ")");
    }

    // Pull inputs from record. JSON fields in PB v0.22 are unreliable via
    // record.get() (may return goja-wrapped Go types or byte arrays). Use
    // record.getString() to get the raw JSON text and parse it ourselves.
    function parseJsonField(name, fallback) {
      var s = "";
      try { s = String(record.getString(name) || ""); } catch(_) {}
      if (!s) return fallback;
      try { return JSON.parse(s); } catch(_) { return fallback; }
    }

    var messages = parseJsonField("messages", []);
    if (!Array.isArray(messages) || messages.length === 0) {
      return finishWithError("messages_required", "messages field is empty or not an array");
    }
    var markedWords = parseJsonField("marked_words", []);
    if (!Array.isArray(markedWords)) markedWords = [];

    var materialTitle = String(record.getString("material_title") || "");

    var conversationState = parseJsonField("conversation_state", null);
    // Python expects a dict-shaped object or null — coerce anything else to null
    if (conversationState !== null && (Array.isArray(conversationState) || typeof conversationState !== "object")) {
      conversationState = null;
    }

    $app.logger().info("[chat-event] parsed inputs",
      "msgs", messages.length,
      "words", markedWords.length,
      "hasState", conversationState !== null);

    // Mark processing (mostly cosmetic — we'll overwrite below before response is sent)
    record.set("status", "processing");

    $app.logger().info("[chat-event] calling python",
      "userId", userId, "msgs", messages.length, "tier", tier);
    var result = runPython(__hooks + "/mnemonic_chat.py", {
      messages: messages,
      markedWords: markedWords,
      materialTitle: materialTitle,
      conversationState: conversationState
    });
    $app.logger().info("[chat-event] python returned",
      "hasError", !!result.error,
      "replyLen", (result.reply || "").length);

    if (result.error) {
      $app.logger().error("[chat-event] python_error",
        "result", JSON.stringify(result).slice(0, 500));
      return finishWithError("llm_error", JSON.stringify(result).slice(0, 480));
    }

    // Success — write reply + stateUpdate back to record and bump usage
    record.set("status",       "done");
    record.set("reply",        String(result.reply || "").slice(0, 2000));
    record.set("state_update", result.stateUpdate || {});
    record.set("error_msg",    "");

    try {
      $app.dao().saveRecord(record);
    } catch (saveErr) {
      $app.logger().error("[chat-event] saveRecord failed on success", "err", String(saveErr));
      throw saveErr; // bubble up so outer catch can mark error
    }

    try {
      incrementUsageLocal(userId, today);
    } catch (dbErr) {
      $app.logger().error("[chat-event] increment_failed", "err", String(dbErr));
      // already saved success; don't fail the request just because counter didn't bump
    }
  } catch (e) {
    $app.logger().error("[chat-event] hook_exception",
      "err", String(e),
      "stack", (e && e.stack) ? String(e.stack) : "");
    return finishWithError("hook_exception", String(e));
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
