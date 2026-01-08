routerAdd("GET", "/api/fix-translation/:id", (c) => {
    const id = c.pathParam("id");
    const record = $app.dao().findRecordById("transcripts", id);

    // 1. Get existing JSON
    let originalJson = record.get("text");
    if (typeof originalJson !== 'string') {
        originalJson = JSON.stringify(originalJson);
    }

    // 2. Write to temp file
    const tempPath = `/tmp/fix_${id}.json`;
    $os.writeFile(tempPath, originalJson);

    try {
        // 3. Call Python script in RETRANSLATE mode
        // Note: passing tempPath as first arg, language as second, and flag as third
        const scriptPath = "/www/pocketbase/pb_hooks/aliyun_asr.py";
        const language = record.get("language") || "en";

        // Command: python3 aliyun_asr.py <json_path> <language> --retranslate
        const cmd = $os.cmd("/usr/bin/python3.11", scriptPath, tempPath, language, "--retranslate");
        const output = cmd.combinedOutput();
        const jsonStr = String.fromCharCode(...output);

        // 4. Parse result
        const jsonStart = jsonStr.indexOf('{');
        const jsonEnd = jsonStr.lastIndexOf('}');

        if (jsonStart === -1) {
            throw new Error("No JSON in output: " + jsonStr);
        }

        const cleanJson = jsonStr.substring(jsonStart, jsonEnd + 1);
        const newTranscript = JSON.parse(cleanJson);

        if (newTranscript.error) {
            throw new Error(newTranscript.error);
        }

        // 5. Update Record
        record.set("text", JSON.stringify(newTranscript));
        $app.dao().saveRecord(record);

        // Clean up
        $os.remove(tempPath);

        return c.json(200, { "success": true, "message": "Translation fixed!", "id": id });

    } catch (e) {
        // Clean up
        try { $os.remove(tempPath); } catch (_) { }
        return c.json(500, { "error": e.toString() });
    }

}, /* optional middlewares */);
