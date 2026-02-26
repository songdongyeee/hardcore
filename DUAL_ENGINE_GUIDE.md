# 双引擎转写系统 - 使用指南

## 系统架构

```
┌─────────────────────┐
│   用户 App 上传      │ → asr_engine = 'aliyun' (默认)
│   (手机/前端)       │   → 阿里云 ASR (自动处理)
└─────────────────────┘

┌─────────────────────┐
│  管理员后台上传      │ → asr_engine = 'whisper' (手动设置)
│   (PB Admin)       │   → Mac Worker 处理
└─────────────────────┘
```

## 部署步骤

### 1. 数据库迁移

在 PocketBase 后台执行迁移（或手动添加字段）：

**手动方式**：
1. 登录 PB Admin 后台
2. 进入 Collections → transcripts
3. 添加新字段：
   - 名称: `asr_engine`
   - 类型: Select
   - 选项: `aliyun`, `whisper`
   - 默认值: 留空（程序会默认 aliyun）

### 2. 更新后端钩子

**备份现有文件**：
```bash
# 备份
cp pb_hooks/aliyun_asr.pb.js pb_hooks/aliyun_asr.pb.js.backup

# 部署新文件
cp pb_hooks/dual_engine_asr.pb.js server_backup/
```

**上传到服务器**：
```bash
scp pb_hooks/dual_engine_asr.pb.js user@server:/www/pocketbase/pb_hooks/

# 重命名（替换原文件）
ssh user@server
cd /www/pocketbase/pb_hooks
mv aliyun_asr.pb.js aliyun_asr.pb.js.old
mv dual_engine_asr.pb.js aliyun_asr.pb.js
```

**重启 PocketBase**：
```bash
pm2 restart pocketbase
```

### 3. 启动 Mac Worker

**配置 Worker**：
```bash
# 编辑脚本
nano scripts/mac_whisper_worker.py

# 修改配置：
POCKETBASE_URL = "https://zjcnex.top"
ADMIN_EMAIL = "你的管理员邮箱"
ADMIN_PASSWORD = "你的管理员密码"
```

**测试运行**：
```bash
cd /Users/geo/Downloads/hardcoreEnglish
python3 scripts/mac_whisper_worker.py
```

你会看到：
```
[18:45:30] 🚀 Mac Whisper Worker 启动
[18:45:30] 📍 PocketBase: https://zjcnex.top
[18:45:30] ⏰ 检查间隔: 10秒
[18:45:31] ✅ 管理员登录成功
[18:45:31] 👀 开始监听转写任务...
```

**保持运行**：
- 在你上传材料时，保持这个脚本运行
- 可以用 `tmux` 或 `screen` 保持后台运行

### 4. 使用方式

#### 用户 App 上传（自动用阿里云）
用户正常使用 App，什么都不用改，自动使用阿里云转写。

#### 管理员后台上传（用 Whisper）

**方法 1: PB 后台上传**
1. 登录 PB Admin
2. Collections → transcripts → New Record
3. 上传音频文件
4. **关键**: 设置 `asr_engine = whisper`
5. 保存
6. Worker 会自动检测并处理

**方法 2: API 上传**
```bash
curl -X POST https://zjcnex.top/api/collections/transcripts/records \
  -F "audio=@audio.mp3" \
  -F "asr_engine=whisper" \
  -F "language=en" \
  -H "Authorization: YOUR_TOKEN"
```

### 5. 监控和日志

**Worker 日志**：
在运行 Worker 的终端可以看到实时日志：
```
[18:46:15] 📬 发现 1 个待处理任务
[18:46:15] ==================================================
[18:46:15] 📋 处理任务: abc123xyz
[18:46:16] 📥 音频已下载: audio.mp3
[18:46:16] 🎙️ 开始 Whisper 转写...
[18:46:45] ✅ 转写完成！生成 12 个句子
[18:46:45] 🔄 调用阿里云翻译...
[18:46:50] ✅ 翻译完成
[18:46:51] ✅ 结果已上传到服务器
[18:46:51] 🎉 任务完成: abc123xyz
```

**PB 后台查看**：
1. Collections → transcripts
2. 查看记录的 `status` 字段：
   - `pending` - 等待处理
   - `processing` - 正在转写
   - `done` - 完成
   - `error` - 失败

## 工作流程详解

### Whisper 模式流程

```
1. 后台上传音频 + 设置 asr_engine='whisper'
   ↓
2. dual_engine_asr.pb.js 检测到 whisper
   → 设置 status='pending'
   → 不处理，直接返回
   ↓
3. Mac Worker 每 10 秒检查一次
   → 发现 status='pending' && asr_engine='whisper'
   ↓
4. Worker 下载音频到 Mac
   ↓
5. Mac Whisper 转写（单词级时间戳）
   ↓
6. 调用阿里云翻译
   ↓
7. 上传结果到 PB
   → 设置 status='done'
   ↓
8. 完成！可在 App 中查看
```

### 阿里云模式流程

```
1. App 上传音频（asr_engine 默认为空或 'aliyun'）
   ↓
2. dual_engine_asr.pb.js 检测到 aliyun
   → 直接调用 aliyun_asr.py
   ↓
3. 阿里云 ASR + 翻译
   ↓
4. 返回结果
   ↓
5. 设置 status='done'
   ↓
6. 触发波形生成
   ↓
7. 完成！
```

## 常见问题

### Q: Worker 运行慢不慢？
A: 取决于音频长度和你的 Mac 性能。参考：
- 1分钟音频 ≈ 15-30秒
- 5分钟音频 ≈ 2-3分钟

### Q: 可以同时处理多个任务吗？
A: 当前是单线程，一次处理一个。可以修改代码支持并发。

### Q: Worker 断了怎么办？
A: 重新启动即可，未完成的任务会继续处理。

### Q: 用户会感知到吗？
A: 完全不会！用户继续用阿里云，你的管理材料用 Whisper。

### Q: 可以批量转换旧材料吗？
A: 可以！写个脚本修改旧材料的 `asr_engine` 字段为 `whisper`，Worker 会自动重新转写。

### Q: 延迟是多少？
A: 检查间隔 10 秒 + 转写时间。平均延迟 10-40 秒。

## 优化建议

### 减少延迟
修改 `CHECK_INTERVAL = 5`（5秒检查一次）

### 后台运行
```bash
# 使用 tmux
tmux new -s whisper
python3 scripts/mac_whisper_worker.py
# Ctrl+B, D 退出

# 重新连接
tmux attach -t whisper
```

### 自动启动
创建 `launchd` 或 cron 任务，Mac 启动时自动运行 Worker。

## 回滚方案

如果出问题，快速回滚：

```bash
# 恢复旧钩子
ssh user@server
cd /www/pocketbase/pb_hooks
mv aliyun_asr.pb.js.old aliyun_asr.pb.js
pm2 restart pocketbase
```

## 下一步

1. ✅ 测试阿里云模式（App 上传）
2. ✅ 测试 Whisper 模式（后台上传）
3. ✅ 对比转写质量
4. ✅ 调整检查间隔
5. ✅ 配置自动启动
