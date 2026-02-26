# TS Fix Worker 使用指南（手动标记模式）

## 1. 目标

在**不改阿里云后端脚本**的前提下，实现：

1. 你在 PB 后台把材料标成 `ts_fix_status = pending`
2. 本地 Worker 自动拉取任务
3. 本地跑 `fix_timestamps` 修复并自动回写 PB（支持全流程和只补翻译）
4. Worker 把状态改为 `done` 或 `error`

---

## 2. 已实现文件

1. Worker 脚本：`/Users/geo/Downloads/hardcoreEnglish/scripts/ts_fix_worker.py`
2. 修复脚本（已支持自动回写）：`/Users/geo/Downloads/hardcoreEnglish/scripts/fix_timestamps.py`
3. 字段迁移：`/Users/geo/Downloads/hardcoreEnglish/pb_migrations/1736201900_add_ts_fix_status.js`

---

## 3. 一次性准备

## 3.1 添加字段 `ts_fix_status`

方式 A（推荐）：跑 migration

```bash
# 在你的 PocketBase 部署环境执行迁移（按你现有部署流程）
# 文件：pb_migrations/1736201900_add_ts_fix_status.js
```

方式 B：PB 后台手动加字段

1. 打开 `transcripts` 集合
2. 新增字段 `ts_fix_status`（Select）
3. 值：`pending` / `pending_translate` / `processing` / `done` / `error`

## 3.2 本地依赖

```bash
cd /Users/geo/Downloads/hardcoreEnglish
pip3 install requests faster-whisper dashscope
```

## 3.3 配置环境变量（建议）

```bash
export PB_URL="https://zjcnex.top"
export PB_ADMIN_EMAIL="你的管理员邮箱"
export PB_ADMIN_PASSWORD="你的管理员密码"
export DASHSCOPE_API_KEY="你的阿里云key"

# 可选
export TS_FIX_CHECK_INTERVAL="15"
export TS_FIX_BATCH_SIZE="5"
export TS_FIX_PROCESS_RETRIES="2"
export TS_FIX_PROCESS_RETRY_BACKOFF="5"
export DASHSCOPE_MAX_RETRIES="4"
export DASHSCOPE_SINGLE_RETRIES="3"
export STRICT_TRANSLATION_COVERAGE="1"
export MIN_TRANSLATION_COVERAGE="0.98"
```

说明：

1. `fix_timestamps.py` 和 `ts_fix_worker.py` 都会读取这些环境变量。
2. 不配置时会回退到脚本里的默认值。
3. 重试机制：
   - 批次翻译失败会自动重试（指数退避）
   - 批次结束后仍失败的句子会逐句补翻
   - 单任务失败后 Worker 会自动再尝试 `TS_FIX_PROCESS_RETRIES` 次

---

## 4. 启动 Worker

```bash
cd /Users/geo/Downloads/hardcoreEnglish
python3 scripts/ts_fix_worker.py
```

正常日志会看到：

1. `TS Fix Worker 启动（手动标记模式）`
2. `监听条件：ts_fix_status in ['pending','pending_translate']`

---

## 5. 日常使用

1. 让材料先完成阿里云转写（`status=done`）
2. 在 PB 后台设置处理模式：
   - `pending`：全流程（重跑 Whisper + 翻译）
   - `pending_translate`：只补翻译（不重跑 Whisper）
3. Worker 会自动处理该材料
4. 处理完成后：
   - `text` 被修复并回写
   - `ts_fix_status` 变为 `done`
5. 若失败：`ts_fix_status = error`

---

## 6. 关键说明

1. 本方案不改 `pb_hooks/aliyun_asr.py` 或 `pb_hooks/dual_engine_asr.pb.js`。
2. 任务触发完全由你手动标记 `pending` 控制。
3. Worker 使用本地文件锁，避免同机重复启动多个实例。

---

## 7. 故障排查

1. 日志提示“未找到字段 ts_fix_status”
- 说明 DB 字段还没建好。

2. 状态卡在 `processing`
- 通常是 Worker 中断；可手动改回 `pending` 或 `pending_translate` 重新跑。

3. 登录失败
- 检查 `PB_ADMIN_EMAIL` / `PB_ADMIN_PASSWORD`。

4. 翻译失败
- 检查 `DASHSCOPE_API_KEY` 或网络。
