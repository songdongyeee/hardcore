/// <reference path="../pb_data/types.d.ts" />

/**
 * Redis 共享配置模块
 * 用于 Daily Spark 预计算和缓存
 * 
 * 使用方法：
 * const redis = require(`${__hooks}/_redis.js`);
 * redis.set('key', 'value');
 */

// 动态导入 ioredis（需要先安装）
let Redis;
try {
    Redis = require('ioredis');
} catch (e) {
    console.error('[Redis Config] ❌ ioredis not installed. Run: npm install ioredis');
    throw e;
}

// Redis 配置
const config = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || '',  // 如果没有密码留空
    db: parseInt(process.env.REDIS_DB || '0'),

    // 连接超时配置
    connectTimeout: 10000,
    retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        console.log(`[Redis] Retrying connection (attempt ${times}), delay: ${delay}ms`);
        return delay;
    }
};

// 创建 Redis 客户端实例
const redis = new Redis(config);

// 连接事件监听
redis.on('connect', () => {
    console.log('✅ [Redis] Connected successfully');
});

redis.on('error', (err) => {
    console.error('❌ [Redis] Connection error:', err.message);
});

redis.on('ready', () => {
    console.log('🚀 [Redis] Client ready');
});

// 导出 Redis 客户端
module.exports = redis;

console.log('[Redis Config] Module loaded. Config:', {
    host: config.host,
    port: config.port,
    db: config.db,
    hasPassword: !!config.password
});
