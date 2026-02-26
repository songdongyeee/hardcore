/// <reference path="../pb_data/types.d.ts" />

/**
 * 双引擎转写系统 - 自动路由
 * 
 * 逻辑:
 * - 如果 asr_engine = 'whisper' → 不处理（等待 Mac Worker）
 * - 如果 asr_engine = 'aliyun' 或 未设置 → 使用阿里云
 * 
 * 用户 App 上传 → 默认使用阿里云
 * 管理员后台上传 → 手动设置 asr_engine = 'whisper'
 */

onRecordAfterCreateRequest((e) => {
    // 🔥 获取 API Key
    let ALIYUN_API_KEY = $os.getenv("DASHSCOPE_API_KEY") || $os.getenv("ALIYUN_API_KEY");

    if (!ALIYUN_API_KEY) {
        try {
            const keyFile = $os.readFile("/www/pocketbase/pb_hooks/api_key.txt");
            ALIYUN_API_KEY = keyFile ? String.fromCharCode(...keyFile).trim() : "";
        } catch (e) { /* ignore */ }
    }

    if (!ALIYUN_API_KEY) {
        $app.logger().error("❌ DASHSCOPE_API_KEY missing!");
        throw new Error("API Key missing");
    }

    const APP_URL = "https://zjcnex.top";
    const record = e.record;

    if (e.collection.name !== "transcripts") return;
    const audioName = record.get("audio");
    if (!audioName) return;

    // ✨ 检查引擎类型
    const asrEngine = record.get("asr_engine") || "aliyun";  // 默认阿里云

    if (asrEngine === "whisper") {
        // 🔄 Whisper 模式 - 设置状态为 pending，等待 Mac Worker 处理
        $app.logger().info(`⏳ Whisper 模式: ${record.id} - 等待 Mac Worker`);
        record.set("status", "pending");
        $app.dao().saveRecord(record);
        return;  // 不处理，直接返回
    }

    // 🚀 阿里云模式 - 正常处理
    try {
        $app.logger().info(`🎙️ 阿里云 ASR: ${record.id}`);
        record.set("status", "processing");
        $app.dao().saveRecord(record);

        const filePublicUrl = `${APP_URL}/api/files/${e.collection.id}/${record.id}/${audioName}`;
        const language = record.get("language") || "en";
        const scriptPath = "/www/pocketbase/pb_hooks/aliyun_asr.py";

        const shellCmd = `export LC_ALL=C.UTF-8; /usr/bin/python3.11 "${scriptPath}" "${filePublicUrl}" "${language}" 2>&1; exit 0`;
        const cmdObj = $os.cmd("sh", "-c", shellCmd);
        const outputStr = String.fromCharCode(...cmdObj.combinedOutput());

        const jsonStart = outputStr.indexOf('{');
        const jsonEnd = outputStr.lastIndexOf('}');
        if (jsonStart === -1) throw new Error("No JSON found");

        const resultJson = JSON.parse(outputStr.substring(jsonStart, jsonEnd + 1));
        if (resultJson.error) throw new Error(resultJson.error);

        let transcriptData = resultJson.transcripts || resultJson;

        if (transcriptData && transcriptData.length > 0) {
            $app.logger().info(`✅ Got ${transcriptData.length} items`);
            record.set("text", JSON.stringify(transcriptData));
            record.set("status", "done");

            // 🚀 异步波形生成
            try {
                $app.logger().info(`🚀 Calling retry-waveform.js for: ${record.id}`);
                $os.cmd('/www/server/nvm/versions/node/v24.11.1/bin/node', '/www/pocketbase/scripts/retry-waveform.js', record.id).run();
                $app.logger().info(`✅ [Queue] Waveform generation triggered for: ${record.id}`);
            } catch (queueErr) {
                $app.logger().error(`❌ [Queue] Error: ${queueErr.message}`);
            }

            $app.dao().saveRecord(record);
            $app.logger().info(`✅ Done!`);
        }

    } catch (err) {
        $app.logger().error(`❌ Error: ${err.toString()}`);
        try {
            record.set("status", "error");
            record.set("text", `Error: ${err.message}`);
            $app.dao().saveRecord(record);
        } catch (_) { }
    }

}, "transcripts");
