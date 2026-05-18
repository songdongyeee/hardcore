/// <reference path="../pb_data/types.d.ts" />

// ── Shared helper ────────────────────────────────────────────────────────────
function runPython(scriptPath, payload) {
    const tmpPath = "/tmp/mnemonic_" + Date.now() + "_" + Math.random().toString(16).slice(2) + ".json";
    $os.writeFile(tmpPath, JSON.stringify(payload));
    try {
        const cmd = $os.cmd("/bin/bash", "-c",
            "unset PYTHONHOME PYTHONPATH; /usr/bin/python3.11 '" + scriptPath + "' '" + tmpPath + "'");
        const output = cmd.combinedOutput();
        const text = String.fromCharCode(...output).trim();
        const s = text.lastIndexOf("{");
        const e = text.lastIndexOf("}");
        if (s < 0 || e <= s) throw new Error("bad script output: " + text);
        return JSON.parse(text.slice(s, e + 1));
    } finally {
        try { $os.remove(tmpPath); } catch (_) {}
    }
}

// ── TTS ──────────────────────────────────────────────────────────────────────
routerAdd("POST", "/api/mnemonic/tts", (c) => {
    try {
        const body = ($apis.requestInfo(c).body) || {};
        const text = (body.text || "").trim();
        if (!text) return c.json(400, { error: "text is required" });

        const result = runPython(__hooks + "/tts.py", { text });
        if (result.error) return c.json(502, result);

        const baseUrl = $app.settings().meta.appUrl || "";
        return c.json(200, { audioUrl: baseUrl + result.audioPath });
    } catch (e) {
        return c.json(500, { error: "hook_exception", message: String(e) });
    }
});

// ── Chat (Qwen LLM) ──────────────────────────────────────────────────────────
routerAdd("POST", "/api/mnemonic/chat", (c) => {
    try {
        const body = ($apis.requestInfo(c).body) || {};
        const messages = body.messages || [];
        const markedWords = body.markedWords || [];
        const materialTitle = body.materialTitle || "";

        if (messages.length === 0) return c.json(400, { error: "messages required" });

        const result = runPython(__hooks + "/mnemonic_chat.py", {
            messages,
            markedWords,
            materialTitle
        });
        if (result.error) return c.json(502, result);
        return c.json(200, result);
    } catch (e) {
        return c.json(500, { error: "hook_exception", message: String(e) });
    }
});

// ── ASR (Paraformer) ─────────────────────────────────────────────────────────
routerAdd("POST", "/api/mnemonic/asr", (c) => {
    try {
        const body = ($apis.requestInfo(c).body) || {};
        const audioBase64 = body.audioBase64 || "";
        const mimeType = body.mimeType || "audio/mp4";

        if (!audioBase64) return c.json(400, { error: "audioBase64 required" });

        const result = runPython(__hooks + "/mnemonic_asr.py", { audioBase64, mimeType });
        if (result.error) return c.json(502, result);
        return c.json(200, result);
    } catch (e) {
        return c.json(500, { error: "hook_exception", message: String(e) });
    }
});
