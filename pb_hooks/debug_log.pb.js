routerAdd("GET", "/api/debug-log", (c) => {
    try {
        const content = $os.readFile("/tmp/asr_translation.log");
        return c.string(200, String.fromCharCode(...content));
    } catch (e) {
        return c.string(404, "Log not found or empty: " + e.message);
    }
});
