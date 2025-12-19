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
        $app.logger().error("!!! DEBUG CHECK: RUNNING V4 CODE !!!"); // 🟢 CHECK THIS LOG

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

        const tryCurlDownload = (url) => {
            if (typeof $os === "undefined" || typeof $os.exec !== "function") {
                $app.logger().error("❌ Curl fallback unavailable: $os.exec is not defined.");
                return null;
            }

            try {
                const safeUrl = String(url).replace(/"/g, "\\\"");
                const cmd = `curl -L -s -w "\\n%{http_code}" "${safeUrl}"`;
                const execRes = $os.exec(cmd);
                const output = String(
                    (execRes && (execRes.stdout ?? execRes.output ?? execRes.result)) ??
                        (typeof execRes === "string" ? execRes : "")
                );

                if (!output || output === "[object Object]") {
                    $app.logger().error(`❌ Curl fallback returned empty output.`);
                    return null;
                }

                const lastNewline = output.lastIndexOf("\n");
                if (lastNewline === -1) {
                    $app.logger().error(`❌ Curl fallback output missing status code.`);
                    return null;
                }

                const body = output.slice(0, lastNewline).trim();
                const statusCode = parseInt(output.slice(lastNewline + 1).trim(), 10);

                if (!Number.isFinite(statusCode)) {
                    $app.logger().error(`❌ Curl fallback returned invalid status code.`);
                    return null;
                }

                return { statusCode, body };
            } catch (err) {
                $app.logger().error(`❌ Curl fallback failed: ${err}`);
                return null;
            }
        };

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
                $app.logger().info(`📥 Downloading Result from: ${resUrl}`);
                let downloadRes = $http.send({ url: resUrl, method: "GET" });

                if (downloadRes.statusCode !== 200) {
                    $app.logger().error(`❌ Download Failed [${downloadRes.statusCode}]: ${downloadRes.raw}`);
                    const curlRes = tryCurlDownload(resUrl);

                    if (curlRes && curlRes.statusCode === 200) {
                        try {
                            finalResult = JSON.parse(curlRes.body);
                        } catch (parseErr) {
                            $app.logger().error(`❌ Curl JSON parse failed: ${parseErr}`);
                            throw new Error("Curl download returned invalid JSON");
                        }
                    } else {
                        const curlCode = curlRes ? curlRes.statusCode : "n/a";
                        throw new Error(`Failed to download transcript: ${downloadRes.statusCode} (curl ${curlCode})`);
                    }
                } else {
                    finalResult = downloadRes.json;
                }

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
