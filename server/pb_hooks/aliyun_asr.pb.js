/// <reference path="../pb_data/types.d.ts" />

// ===================================
// ☁️ Aliyun ASR Hook (Final Fix)
// ===================================

onRecordAfterCreateRequest((e) => {
    // ⬇️ TRIPLE MODE (Env Var -> File -> Error) ⬇️
    let ALIYUN_API_KEY = $os.getenv("DASHSCOPE_API_KEY") || $os.getenv("ALIYUN_API_KEY");

    // Fallback: Read from file (Docker Secret style)
    if (!ALIYUN_API_KEY) {
        try {
            // Checks same directory as script (pb_hooks)
            const keyFile = $os.readFile("/www/pocketbase/pb_hooks/api_key.txt");
            ALIYUN_API_KEY = keyFile ? String.fromCharCode(...keyFile).trim() : "";
            if (ALIYUN_API_KEY) $app.logger().info("🔑 Loaded Key from file.");
        } catch (e) { /* ignore */ }
    }

    if (!ALIYUN_API_KEY) {
        $app.logger().error("❌ DASHSCOPE_API_KEY missing (Env & File)!");
        throw new Error("API Key missing");
    }
    const APP_URL = "https://zjcnex.top";        // 🔴 YOUR SERVER IP

    const record = e.record;
    if (e.collection.name !== "transcripts") return;
    const audioName = record.get("audio");
    if (!audioName) return;

    try {
        $app.logger().info(`🎧 Starting ASR (Python SDK): ${record.id}`);
        record.set("status", "processing");
        $app.dao().saveRecord(record);

        const filePublicUrl = `${APP_URL}/api/files/${e.collection.id}/${record.id}/${audioName}`;
        $app.logger().info(`🔗 Audio URL: ${filePublicUrl}`);

        // --- CALL PYTHON WORKER ---
        // Note: We use absolute path for safety. Assuming pb_hooks is at /www/pocketbase/pb_hooks/
        const scriptPath = "/www/pocketbase/pb_hooks/aliyun_asr.py";

        $app.logger().info(`🐍 Executing Python Script: ${scriptPath}`);

        // DIAGNOSTIC UPDATE: Capture STDERR by wrapping in shell
        // This is crucial to see "ImportError" or "SyntaxError" which normally go to stderr
        const shellCmd = `export LC_ALL=C.UTF-8; /usr/bin/python3.11 "${scriptPath}" "${filePublicUrl}" 2>&1; exit 0`;

        // ⚠️ CRITICAL FIX: $os.cmd() only PREPARES the command. 
        // We must call .combinedOutput() to actually RUN it and get the result!
        const cmdObj = $os.cmd("sh", "-c", shellCmd);
        const outputBytes = cmdObj.combinedOutput();
        const resultCmd = outputBytes; // Keep variable name for compatibility below

        // $os.cmd returns generic byte output. In older PB versions it might be different, 
        // but typically it returns the output directly if successful or throws.
        // If it throws, it failed.

        // ATTENTION: We need to handle the output being just bytes.
        // String.fromCharCode(...bytes) parses the byte array to string
        const outputStr = String.fromCharCode(...resultCmd);
        $app.logger().info(`🐍 Raw Output: ${outputStr.substring(0, 100)}...`);

        // 🛡️ ROBUST PARSING: Find the JSON part (ignore shell noise)
        const jsonStart = outputStr.indexOf('{');
        const jsonEnd = outputStr.lastIndexOf('}');

        if (jsonStart === -1 || jsonEnd === -1) {
            // 🔍 DEBUG: Show the user what the output actually was!
            throw new Error(`No JSON found. Output: [${outputStr.trim().substring(0, 300)}]`);
        }

        const cleanJsonStr = outputStr.substring(jsonStart, jsonEnd + 1);
        const resultJson = JSON.parse(cleanJsonStr);

        if (resultJson.error) {
            throw new Error(resultJson.error);
        }

        // Python now returns the complete transcription data directly
        // Structure: {file_url, transcripts: [{channel_id, text, begin_time, end_time, ...}]}
        if (resultJson.transcripts && resultJson.transcripts.length > 0) {
            $app.logger().info(`✅ Got ${resultJson.transcripts.length} transcript items`);
            record.set("text", JSON.stringify(resultJson.transcripts));
            record.set("status", "done");
            $app.dao().saveRecord(record);
            $app.logger().info("✅ Done!");
        } else {
            throw new Error("No transcripts found in Python output");
        }

    } catch (err) {
        $app.logger().error(`❌ Script Error: ${err.toString()}`);
        try {
            record.set("status", "error");
            const msg = err.message ? err.message : err.toString();
            record.set("text", `Error: ${msg.substring(0, 500)}`);
            $app.dao().saveRecord(record);
        } catch (_) { }
    }
}, "transcripts");
