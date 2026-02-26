# 时间戳修复工具使用指南

## 🎯 功能

合并两种转写方案的优点：
- **Whisper**：重建句子与单词时间戳（更精确）
- **阿里云翻译模型**：按 Whisper 新分句重新生成翻译（对齐不串句）
- **自动回写 PB**：本地处理后自动更新 `text`

## 📋 使用步骤

### 1. 确保材料已用阿里云转写

材料必须满足：
- ✅ 已有转写文本（`text` 字段有内容）
- ✅ 有翻译
- ✅ `status = done`

### 2. 运行修复脚本

```bash
cd /Users/geo/Downloads/hardcoreEnglish

# 语法
python3 scripts/fix_timestamps.py <材料ID>

# 只补翻译，不重跑Whisper（默认仅补缺失翻译）
python3 scripts/fix_timestamps.py <材料ID> --translation-only

# 只补翻译并强制重翻全部句子（可选）
python3 scripts/fix_timestamps.py <材料ID> --translation-only --retranslate-all

# 仅本地生成，不自动回写（可选）
python3 scripts/fix_timestamps.py <材料ID> --no-upload

# 示例
python3 scripts/fix_timestamps.py 47j7723c9w7a5bd
```

### 3. 等待处理

脚本会自动：
1. 登录 PocketBase
2. 下载音频和阿里云 JSON
3. Whisper 转写（获取时间戳）
4. 翻译（批次重试 + 逐句补翻）
5. 输出修正后的 JSON

如果使用 `--translation-only`：
1. 仅获取 PB 中现有 JSON
2. 只补翻译（默认仅补缺失）
3. 不下载音频，不跑 Whisper，不改时间戳

**预计耗时**：
- 5 分钟音频 → 2-3 分钟
- 10 分钟音频 → 5-8 分钟
- 20 分钟音频 → 10-15 分钟

### 4. 自动回写到 PB（默认）

脚本默认会自动执行：
- 生成修复后的 JSON（`/tmp/material_xxx_fixed.json`）
- 自动 PATCH 回写到 PB 的 `text` 字段
- 自动把 `status` 设为 `done`

你不需要再手动复制粘贴。

如需手动模式，请使用 `--no-upload`。

默认开启翻译覆盖率保护：当翻译覆盖率低于阈值（默认 98%）时，脚本会报错并阻止回写，避免写入半成品数据。

---

## 🔬 技术细节

### 智能对齐算法

**工作原理**：

1. **句子隔离**：每个句子单独对齐，失败不影响其他
2. **单词匹配**：使用 Python difflib.SequenceMatcher
3. **容错处理**：
   - 完全匹配 → 直接映射时间戳
   - 替换（如 gonna → going to）→ 时间平均分配
   - Whisper 多词 → 跳过
   - 阿里云多词 → 保留推测时间

### 匹配示例

```
阿里云：["I'm", "gonna", "go", "home"]
Whisper：["I'm", "going", "to", "go", "home"]

对齐结果：
- "I'm" → Whisper "I'm" 的时间戳 ✅
- "gonna" → Whisper "going"+"to" 的时间范围平均 ✅
- "go" → Whisper "go" 的时间戳 ✅
- "home" → Whisper "home" 的时间戳 ✅
```

### 预期成功率

- **高质量音频**：95%+ 对齐成功
- **一般音频**：85-95%
- **低质量音频**：70-85%

即使部分句子失败，不会影响整体可用性。

---

## 🆚 与双引擎方案对比

| 特性 | 双引擎 Worker | fix_timestamps 脚本 |
|------|--------------|-------------------|
| 速度 | 慢（完整转写+翻译） | 中（只转写一次） |
| 翻译 | 可能失败（网络问题） | 重新生成翻译 ✅ |
| 文字质量 | Whisper | Whisper |
| 时间戳 | Whisper ✅ | Whisper ✅ |
| 自动化 | 全自动 | 自动回写（默认） ✅ |
| 稳定性 | 一般 | 高 ✅ |
| 适用场景 | 批量新材料 | 修复问题材料 |

---

## 💡 推荐工作流

### 日常上传新材料

**继续使用阿里云**：
- App 用户上传 → 自动阿里云转写
- 速度快、翻译稳定

### 发现时间戳不准

**使用 fix_timestamps**：
```bash
python3 scripts/fix_timestamps.py <材料ID>
```

### 批量修复旧材料

可以写个循环脚本：
```bash
for id in 材料ID1 材料ID2 材料ID3; do
    python3 scripts/fix_timestamps.py $id
done
```

---

## 🐛 常见问题

### Q: 脚本卡在 Whisper 转写很久

A: 正常，音频越长越慢。20 分钟音频可能需要 10-15 分钟。

### Q: 对齐成功率太低怎么办？

A: 查看日志中的成功率。如果低于 70%，可能是音频质量问题，直接用阿里云版本即可。

### Q: 如何验证修复效果？

A: 
1. 在 App 盲听页播放
2. 观察光标是否准确跟随单词
3. 对比修复前后的效果

### Q: 可以自动上传到 PB 吗？

A: 可以。当前脚本默认自动回写 PB。若不想自动回写，使用 `--no-upload`。

---

## 📝 日志说明

**正常流程日志**：
```
[19:30:01] ℹ️ === 开始处理材料: xxx ===
[19:30:01] 🔄 登录 PocketBase...
[19:30:02] ✅ 登录成功
[19:30:03] 🔄 下载材料: xxx
[19:30:05] ✅ 音频已下载: file.mp3
[19:30:05] ✅ 阿里云 JSON 已加载: 449 个句子
[19:30:08] 🔄 Whisper 转写中...
[19:38:15] ✅ Whisper 转写完成: 449 个句子
[19:38:16] 🔄 开始智能对齐...
[19:38:20] ✅ 对齐完成: 449/449 个句子 (100.0% 成功率)
[19:38:21] ✅ 已保存到: /tmp/material_xxx_fixed.json
[19:38:21] ✅ === 处理完成 ===
```

**异常情况**：
- `❌ 登录失败` → 检查管理员凭据
- `❌ 下载失败` → 检查材料 ID 是否正确
- `❌ Whisper 转写失败` → 检查 faster-whisper 是否安装
