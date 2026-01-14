/// <reference path="../pb_data/types.d.ts" />

/**
 * Daily Spark API 接口
 * 提供极速读取预计算好的 Daily Spark 数据
 * GET /api/daily-spark
 */

const redis = require(`${__hooks}/_redis.js`);

// 提供快速读取接口
routerAdd("GET", "/api/daily-spark", (c) => {
    try {
        const cached = redis.get('daily_spark_current');

        if (!cached) {
            return c.json(404, {
                error: 'Daily Spark not ready yet',
                message: 'Please wait for the next scheduled update at 05:00 Beijing Time'
            });
        }

        const data = JSON.parse(cached);
        return c.json(200, data);

    } catch (error) {
        console.error('[Daily Spark API] Error:', error);
        return c.json(500, {
            error: 'Internal error',
            message: error.message
        });
    }
});

console.log('[Daily Spark API] GET /api/daily-spark registered');
