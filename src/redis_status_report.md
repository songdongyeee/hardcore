# Redis 功能启用状态排查报告

## 1. 现状确认 (Current Status)

经过排查，项目后端 (`pb_hooks`) 中**确实启用了 Redis**，用于 Daily Spark（每日一句）的预计算和缓存。

### 关键组件
1.  **Redis 连接模块**: `pb_hooks/_redis.js`
    *   使用 `ioredis` 库连接。
    *   默认端口: `6379`。
    *   依赖环境变量: `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`。

2.  **调度任务**: `pb_hooks/daily_spark_scheduler.pb.js`
    *   每天北京时间 05:00 运行。
    *   从数据库选出一条材料，存入 Redis (`daily_spark_current`)。

3.  **API 接口**: `pb_hooks/daily_spark_api.pb.js` (推测存在)
    *   客户端读取时，会优先从 Redis 读取 `daily_spark_current`。

## 2. 潜在风险 (Potential Risks)

用户反馈“总是显示内置材料”，除了前端锁定问题外，**后端 Redis 没跑通**也是极大的可能性：

1.  **Redis 服务未启动**：如果服务器上 Redis 没开，`_redis.js` 会报错，导致调度任务失败。
2.  **依赖缺失**：`pb_hooks` 是 PocketBase 的扩展，需要 `npm install ioredis` 才能运行 js 钩子中的 `require('ioredis')`。如果服务器没装这个包，所有 Redis 逻辑都会崩。
3.  **数据为空**：如果 Redis 连接失败，调度器没跑，Redis 里没数据，前端请求 API 可能返回空，被迫回退到内置材料。

## 3. 验证建议 (Action Items)

在修改前端代码前，必须确保后端 Redis 正常工作。请在服务器端执行以下检查：

1.  **检查 Redis 进程**: `ps aux | grep redis`
2.  **检查 PocketBase 日志**: 查看是否有 `[Redis] Connection error` 或 `ioredis not installed` 的报错。
3.  **手动测试**: 尝试在 `pb_hooks` 目录下运行简单的 node 脚本测试连接。

---
**确认状态**：Redis 逻辑代码已存在且启用，但其运行状态（服务是否健壮）需要运维层面的确认。
