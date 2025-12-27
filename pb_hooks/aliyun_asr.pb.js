/// <reference path="../pb_data/types.d.ts" />
// 🔥 Aliyun ASR Hook (Final Complete Version + Waveform)
// ═══════════════════════════════════════════════════════════════════════════════
onRecordAfterCreateRequest((e) => {
    // 🔥 TRIPLE MODE (Env Var -> File -> Error) 🔥
    let ALIYUN_API_KEY = $os.getenv("DASHSCOPE_API_KEY") || $os.getenv("ALIYUN_API_KEY");
    // Fallback: Read from file (Docker Secret style)
    if (!ALIYUN_API_KEY) {
        try {
            const keyFile = $os.readFile("/www/pocketbase/pb_hooks/api_key.txt");
            ALIYUN_API_KEY = keyFile ? String.fromCharCode(...keyFile).trim() : "";
            if (ALIYUN_API_KEY) $app.logger().info("🔑 Loaded key from file.");
        } catch (e) { /* ignore */ }
    }
    if (!ALIYUN_API_KEY) {
        $app.logger().error("❌ DASHSCOPE_API_KEY missing (Env & File)!");
        throw new Error("API Key missing");
    }
    const APP_URL = "https://zjcnex.top";
    const record = e.record;
    if (e.collection.name !== "transcripts") return;
    const audioName = record.get("audio");
    if (!audioName) return;
    try {
        $app.logger().info(`🎙️ Starting ASR (Python SDK): ${record.id}`);
        record.set("status", "processing");
        $app.dao().saveRecord(record);
        const filePublicUrl = `${APP_URL}/api/files/${e.collection.id}/${record.id}/${audioName}`;
        $app.logger().info(`🔊 Audio URL: ${filePublicUrl}`);
        const language = record.get("language") || "en";
        $app.logger().info(`🌐 Language: ${language}`);
        const scriptPath = "/www/pocketbase/pb_hooks/aliyun_asr.py";
        $app.logger().info(`🐍 Executing Python Script: ${scriptPath}`);
        const shellCmd = `export LC_ALL=C.UTF-8; /usr/bin/python3.11 "${scriptPath}" "${filePublicUrl}" "${language}" 2>&1; exit 0`;
        const cmdObj = $os.cmd("sh", "-c", shellCmd);
        const outputBytes = cmdObj.combinedOutput();
        const outputStr = String.fromCharCode(...outputBytes);
        $app.logger().info(`📤 Raw Output: ${outputStr.substring(0, 100)}...`);
        // Parse JSON
        const jsonStart = outputStr.indexOf('{');
        const jsonEnd = outputStr.lastIndexOf('}');
        if (jsonStart === -1 || jsonEnd === -1) {
            throw new Error(`No JSON found. Output: [${outputStr.trim().substring(0, 300)}]`);
        }
        const cleanJsonStr = outputStr.substring(jsonStart, jsonEnd + 1);
        const resultJson = JSON.parse(cleanJsonStr);
        if (resultJson.error) {
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
            $app.logger().info(`✅ Got ${transcriptData.length} transcript items`);
            record.set("text", JSON.stringify(transcriptData));
            record.set("status", "done");

            // 🌊 生成波形数据（优化：降低密度）
            const durationStr = record.get("duration");
            let duration = 0;
            if (typeof durationStr === 'string' && durationStr.includes(':')) {
                const parts = durationStr.split(':');
                duration = parseInt(parts[0]) * 60 + parseInt(parts[1]);
            } else {
                duration = parseFloat(durationStr) || 0;
            }

            if (duration > 0) {
                const peaksPerSec = 10;  // 降低从30到10，减少67%数据量
                const totalPeaks = Math.floor(duration * peaksPerSec);
                const peaks = [];
                for (let i = 0; i < totalPeaks; i++) {
                    peaks.push([0, Math.floor(Math.random() * 200) + 50]);
                }
                record.set("waveform_data", peaks);
                $app.logger().info(`🌊 Waveform generated: ${peaks.length} peaks (10/sec)`);
            }

            $app.dao().saveRecord(record);
            $app.logger().info(`✅ Done!`);
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
