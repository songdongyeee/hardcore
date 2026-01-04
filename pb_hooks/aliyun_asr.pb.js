/// <reference path="../pb_data/types.d.ts" />

// 🔥 Aliyun ASR Hook (Debug Version)
// ═══════════════════════════════════════════════════════════════════════════════

function logToDisk(msg) {
    try {
        const time = new Date().toISOString();
        // 使用 shell echo 追加日志到文件
        $os.cmd("sh", "-c", `echo "[${time}] ${msg}" >> /www/pocketbase/pb_hooks/hook_debug.log`).run();
    } catch (e) {
        // ignore
    }
}

onRecordAfterCreateRequest((e) => {
    logToDisk(`🚀 Hook Triggered for record: ${e.record.id}`);

    // 🔥 TRIPLE MODE (Env Var -> File -> Error) 🔥
    let ALIYUN_API_KEY = $os.getenv("DASHSCOPE_API_KEY") || $os.getenv("ALIYUN_API_KEY");

    // Fallback: Read from file (Docker Secret style)
    if (!ALIYUN_API_KEY) {
        try {
            const keyFile = $os.readFile("/www/pocketbase/pb_hooks/api_key.txt");
            ALIYUN_API_KEY = keyFile ? String.fromCharCode(...keyFile).trim() : "";
            if (ALIYUN_API_KEY) logToDisk("🔑 Loaded key from file.");
        } catch (e) { /* ignore */ }
    }

    if (!ALIYUN_API_KEY) {
        logToDisk("❌ DASHSCOPE_API_KEY missing (Env & File)!");
        throw new Error("API Key missing");
    }

    const APP_URL = "https://zjcnex.top";
    const record = e.record;

    if (e.collection.name !== "transcripts") return;

    const audioName = record.get("audio");
    if (!audioName) return;

    try {
        logToDisk(`🎙️ Starting ASR (Python SDK): ${record.id}`);
        record.set("status", "processing");
        $app.dao().saveRecord(record);

        const filePublicUrl = `${APP_URL}/api/files/${e.collection.id}/${record.id}/${audioName}`;
        logToDisk(`🔊 Audio URL: ${filePublicUrl}`);

        const language = record.get("language") || "en";
        const scriptPath = "/www/pocketbase/pb_hooks/aliyun_asr.py";
        logToDisk(`🐍 Executing Python Script...`);

        const shellCmd = `export LC_ALL=C.UTF-8; /usr/bin/python3.11 "${scriptPath}" "${filePublicUrl}" "${language}" 2>&1; exit 0`;

        const cmdObj = $os.cmd("sh", "-c", shellCmd);
        const outputBytes = cmdObj.combinedOutput();
        const outputStr = String.fromCharCode(...outputBytes);

        if (outputStr.length < 200) logToDisk(`📤 Raw Output Short: ${outputStr}`);

        // Parse JSON
        const jsonStart = outputStr.indexOf('{');
        const jsonEnd = outputStr.lastIndexOf('}');

        if (jsonStart === -1 || jsonEnd === -1) {
            logToDisk("❌ No JSON found in output");
            throw new Error(`No JSON found.`);
        }

        const cleanJsonStr = outputStr.substring(jsonStart, jsonEnd + 1);
        const resultJson = JSON.parse(cleanJsonStr);

        if (resultJson.error) {
            logToDisk(`❌ Python Error: ${resultJson.error}`);
            throw new Error(resultJson.error);
        }

        // 🔥 正确处理 Aliyun ASR 的数据结构
        let transcriptData;
        if (resultJson.transcripts && Array.isArray(resultJson.transcripts)) {
            transcriptData = resultJson.transcripts;
        } else if (Array.isArray(resultJson)) {
            transcriptData = resultJson;
        } else {
            throw new Error("Invalid transcript format from Python");
        }

        if (transcriptData && transcriptData.length > 0) {
            logToDisk(`✅ Got ${transcriptData.length} transcript items`);
            record.set("text", JSON.stringify(transcriptData));
            record.set("status", "done");

            // 🚀 异步波形生成：直接在这里发送任务到 Redis
            logToDisk("🚀 Attempting to push to Redis...");
            try {
                const redisKey = 'bull:waveform-generation:wait';
                const jobData = JSON.stringify({
                    data: {
                        recordId: record.id,
                        timestamp: Date.now()
                    },
                    opts: {
                        attempts: 3,
                        backoff: {
                            type: 'exponential',
                            delay: 5000
                        }
                    }
                });

                // Check redis-cli availability
                const checkRedis = $os.cmd("which", "redis-cli");
                const redisPath = String.fromCharCode(...checkRedis.combinedOutput()).trim();
                logToDisk(`🔍 redis-cli path: ${redisPath}`);

                if (!redisPath) {
                    logToDisk("❌ FATAL: redis-cli not found in PATH!");
                    // 尝试使用绝对路径 fallback
                    const result = $os.exec('/usr/local/bin/redis-cli', 'RPUSH', redisKey, jobData);
                    if (result.code === 0) {
                        logToDisk(`✅ Redis Push OK (Absolute Path)!`);
                    } else {
                        const result2 = $os.exec('/usr/bin/redis-cli', 'RPUSH', redisKey, jobData);
                        if (result2.code === 0) {
                            logToDisk(`✅ Redis Push OK (Absolute Path 2)!`);
                        } else {
                            logToDisk(`❌ Redis Push Failed (All Paths).`);
                        }
                    }
                } else {
                    // 使用 $os.exec 执行 redis-cli 命令
                    const result = $os.exec('redis-cli', 'RPUSH', redisKey, jobData);

                    if (result.code === 0) {
                        logToDisk(`✅ [Queue] Sent waveform task for record: ${record.id}`);
                    } else {
                        logToDisk(`❌ [Queue] Failed to send task. Code: ${result.code}, Stderr: ${result.stderr}`);
                    }
                }
            } catch (queueErr) {
                logToDisk(`❌ [Queue] Exception: ${queueErr.message}`);
            }
            // 🚀 结束异步发送逻辑

            $app.dao().saveRecord(record);
            logToDisk(`✅ Done!`);
        } else {
            throw new Error("No transcripts found in Python output");
        }

    } catch (err) {
        logToDisk(`❌ Script Error: ${err.toString()}`);
        try {
            record.set("status", "error");
            record.set("text", `Error: ${err.message}`);
            $app.dao().saveRecord(record);
        } catch (_) { }
    }

}, "transcripts");
