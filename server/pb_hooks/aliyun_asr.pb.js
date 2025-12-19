/// <reference path="../pb_data/types.d.ts" />

// ===================================
// ☁️ Aliyun ASR Hook (Polling Fix)
// ===================================

onRecordAfterCreateRequest((e) => {
    // ⬇️ CONFIG ⬇️
    const ALIYUN_API_KEY = "sk-1ef9603d81b74abda456a60d987e1833"; // 🟢 Real Key Injected
    const APP_URL = "http://8.138.201.147:8090";        // 🔴 YOUR SERVER IP

    const record = e.record;
    if (e.collection.name !== "transcripts") return;
    const audioName = record.get("audio");
    if (!audioName) return;

    try {
        $app.logger().info(`🎧 Starting ASR: ${record.id}`);
        record.set("status", "processing");
        $app.dao().saveRecord(record);

        const filePublicUrl = `${APP_URL}/api/files/${e.collection.id}/${record.id}/${audioName}`;
        $app.logger().info(`🔗 Audio URL: ${filePublicUrl}`);

        // --- STEP 1: SUBMIT TASK ---
        const taskRes = $http.send({
            url: "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription",
            method: "POST",
            headers: {
                "Authorization": `Bearer ${ALIYUN_API_KEY}`,
                "Content-Type": "application/json",
                "X-DashScope-Async": "enable" // 🟢 Async Enabled
            },
            body: JSON.stringify({
                "model": "paraformer-v2",
                "input": { "file_urls": [filePublicUrl] },
                "parameters": { "language_hints": ["en", "zh"], "timestamp_alignment_enabled": true }
            })
        });

        if (taskRes.statusCode !== 200) {
            throw new Error(`Task Create Failed [${taskRes.statusCode}]: ${JSON.stringify(taskRes.json)}`);
        }

        const taskId = taskRes.json.output?.task_id;
        if (!taskId) throw new Error(`No Task ID in response: ${JSON.stringify(taskRes.json)}`);

        $app.logger().info(`🆔 Task Started: ${taskId}`);

        // --- STEP 2: POLL RESULTS ---
        let finalResult = null;

        for (let i = 0; i < 300; i++) { // Increase timeout to ~10 mins
            sleep(2000); // Wait 2s

            const pollRes = $http.send({
                url: `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, // 🟢 Correct Endpoint
                method: "GET",
                headers: { "Authorization": `Bearer ${ALIYUN_API_KEY}` }
            });

            // ⚠️ DEBUGGING: Handle Polling Errors
            if (pollRes.statusCode !== 200) {
                // Log but don't crash immediately, maybe temporary? 
                // Actually for 400/403/404 we should properly throw to see the message.
                throw new Error(`Polling Error [${pollRes.statusCode}]: ${JSON.stringify(pollRes.json)}`);
            }

            const pollData = pollRes.json;
            if (!pollData.output) {
                // Unexpected response structure
                throw new Error(`Polling Missing Output: ${JSON.stringify(pollData)}`);
            }

            const status = pollData.output.task_status;

            if (status === "SUCCEEDED") {
                const resUrl = pollData.output.results[0].transcription_url;
                // ⚠️ FIX: Aliyun OSS 403 SignatureMismatch.
                // The URL path contains time (e.g. 21:00). Aliyun signs it as '21%3A00'.
                // If we send '21:00' (or if Go decodes it to '21:00'), signature fails.
                // We must ensure the path component has ':', replaced by '%3A'.
                // Since Go client preserves encoded path if we provide it, we manually encode the path.

                let safeUrl = resUrl;
                try {
                    const parts = resUrl.split("?");
                    let base = parts[0];
                    const query = parts.length > 1 ? "?" + parts.slice(1).join("?") : "";

                    // Separate protocol (http:// or https://)
                    const protoMatch = base.match(/^https?:\/\//);
                    const proto = protoMatch ? protoMatch[0] : "";
                    const path = base.substring(proto.length);

                    // Encode colons ONLY in the path
                    const encodedPath = path.replace(/:/g, "%3A");

                    safeUrl = proto + encodedPath + query;
                } catch (e) {
                    $app.logger().error(`URL Escape Error: ${e}`);
                }

                $app.logger().info(`📥 Downloading Result from: ${safeUrl}`);
                const downloadRes = $http.send({ url: safeUrl, method: "GET" });
                if (downloadRes.statusCode !== 200) {
                    $app.logger().error(`❌ Download Failed [${downloadRes.statusCode}]: ${downloadRes.raw}`);
                    throw new Error(`Failed to download transcript: ${downloadRes.statusCode}`);
                }
                finalResult = downloadRes.json;
                // Double check if finalResult is valid
                if (!finalResult) {
                    $app.logger().error(`❌ Invalid JSON Body: ${downloadRes.raw}`);
                    throw new Error("Downloaded result is empty or invalid JSON");
                }
                break;
            } else if (status === "FAILED") {
                throw new Error(`Aliyun Task FAILED: ${pollData.output.message}`);
            }
            // If RUNNING/PENDING, loop continues
        }

        if (!finalResult) throw new Error("Timeout waiting for transcription");

        record.set("text", JSON.stringify(finalResult.transcripts));
        record.set("status", "done");
        $app.dao().saveRecord(record);
        $app.logger().info("✅ Done!");

    } catch (err) {
        $app.logger().error(`❌ Script Error: ${err.toString()}`);
        try {
            record.set("status", "error");
            // Clean up error message for UI
            const msg = err.message ? err.message : err.toString();
            record.set("text", `Error: ${msg.substring(0, 500)}`); // Limit length
            $app.dao().saveRecord(record);
        } catch (_) { }
    }
}, "transcripts");
