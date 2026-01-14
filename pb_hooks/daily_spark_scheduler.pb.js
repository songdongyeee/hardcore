/// <reference path="../pb_data/types.d.ts" />

/**
 * Daily Spark Cron Job Scheduler
 * 每天北京时间 05:00 (UTC 21:00) 自动预计算今天的 Daily Spark 材料
 */

const redis = require(`${__hooks}/_redis.js`);

// 每天 UTC 21:00 执行 (北京时间次日 05:00)
cronAdd("daily_spark_refresh", "0 21 * * *", () => {
    console.log('[Daily Spark Cron] Starting pre-computation...');

    try {
        // 1. 获取历史记录，避免重复
        const historyJson = redis.get('daily_spark_history') || '[]';
        const history = JSON.parse(historyJson);

        // 2. 查询候选材料 (排除历史)
        const excludeFilter = history.length > 0
            ? `id != "${history.join('" && id != "')}"`
            : '';
        const filter = `location = "daily_spark" && visibility = "public" ${excludeFilter ? '&& ' + excludeFilter : ''}`;

        const candidates = $app.dao().findRecordsByFilter(
            "transcripts",
            filter,
            "-created",
            10  // 取前10个
        );

        if (candidates.length === 0) {
            console.log('[Daily Spark Cron] No candidates, resetting history...');
            redis.del('daily_spark_history');
            return;
        }

        // 3. 随机选择
        const selected = candidates[Math.floor(Math.random() * candidates.length)];

        // 4. 计算北京时间日期
        const now = new Date();
        const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
        const dateStr = beijingTime.toISOString().split('T')[0]; // "2026-01-14"

        // 5. 构建完整数据
        const payload = {
            id: selected.id,
            date: dateStr,
            source: 'remote',
            location: 'daily_spark',
            title: selected.get('title'),
            title_translate: selected.get('title_translate'),
            subtitle: selected.get('subtitle'),
            audioUrl: selected.get('audio'),
            coverUrl: selected.get('cover'),
            transcript: selected.get('text'),
            waveform_data: selected.get('waveform_data'),
            visibility: selected.get('visibility'),
            createdAt: selected.get('created'),
            tags: selected.get('tags') || []
        };

        // 6. 写入 Redis (24小时 TTL)
        redis.setex('daily_spark_current', 86400, JSON.stringify(payload));

        // 7. 更新历史
        const newHistory = [...history, selected.id].slice(-30); // 保留最近30个
        redis.set('daily_spark_history', JSON.stringify(newHistory));

        console.log(`[Daily Spark Cron] ✅ Selected: ${selected.id} for ${dateStr}`);

    } catch (error) {
        console.error('[Daily Spark Cron] ❌ Failed:', error.message);
    }
});

console.log('[Daily Spark Scheduler] Cron job registered (UTC 21:00 / Beijing 05:00)');
