# OpenAI 语法提示模型说明与安装指南

## 1. 文档目标

这份文档面向你当前项目（`Hardcore English`）的真实约束：

1. 转写主链路在国内用阿里云。
2. 单词时间戳用本地 Whisper 修复。
3. 你希望第二步学习页的语法提示能回答：
   - 为什么是这个表达，不是那个表达；
   - 让用户更容易理解并背诵。

结论先行：

1. 语法提示建议放在本地 Worker 生成（与 Whisper 修复同一流水线）。
2. 模型建议优先 `GPT-5 mini`，复杂句升级到 `GPT-5 pro`。
3. 输出必须使用 Structured Outputs（严格 JSON Schema），否则很难稳定做到“是这个不是那个”的高质量结构化解释。

---

## 2. OpenAI 模型能力（聚焦语法提示）

## 2.1 你要的“语法提示”本质是什么

你要的不是普通释义，而是“对比型判别解释”。

高价值语法提示应至少包含：

1. `chosen_form`：正确表达。
2. `rejected_form`：常见错误表达。
3. `why_not`：为什么错（语法/语义/搭配）。
4. `minimal_pair`：最小对比例句。
5. `memory_hook`：背诵钩子（一句口诀）。

这类任务本质上对模型提出三点要求：

1. 较强推理能力（能做“反事实对比”）。
2. 较强指令遵循（严格按你要求字段输出）。
3. 稳定结构化输出（便于前端渲染、便于缓存）。

## 2.2 GPT 家族 vs 推理家族（对你有什么意义）

OpenAI 官方把模型分为两类：推理模型（o 系列）和 GPT 模型，它们不是“谁绝对更好”，而是适配场景不同。对你这种任务，核心是“复杂语法判别 + 稳定结构化输出”，两类都可用，但推荐先从 GPT-5 系列中做分层。

参考：

- [Reasoning best practices](https://developers.openai.com/api/docs/guides/reasoning-best-practices)

## 2.3 推荐模型分层（按语法提示任务）

### A. 默认主力：`gpt-5-mini`

适用：

1. 批量句子语法提示生成。
2. 成本敏感且要求较高质量。

官方页面给出的关键信息（截至文档撰写时）：

1. “更快、更省成本，适合定义清晰任务”。
2. 价格约 `input $0.25 / output $2`（每 1M tokens）。
3. 支持 Structured outputs。
4. 上下文窗口 400,000。

参考：

- [GPT-5 mini](https://developers.openai.com/api/docs/models/gpt-5-mini)

### B. 难句升级：`gpt-5-pro`

适用：

1. 从句层级复杂、歧义大、要非常严谨的解释。
2. 你想把“错因解释”和“对比例句”拉到更高质量。

官方页面关键信息：

1. 使用更多计算，答案更精确。
2. 价格高（约 `input $15 / output $120` 每 1M tokens）。
3. 支持高强度 reasoning，可能较慢；官方建议重任务可用 background mode。

参考：

- [GPT-5 pro](https://developers.openai.com/api/docs/models/gpt-5-pro)
- [Background mode](https://developers.openai.com/api/docs/guides/background-mode)

### C. 兜底兼容：`gpt-4.1-mini`

适用：

1. 想要更保守的成本与稳定性。
2. 任务复杂度中等，且你已有 prompt 和 schema 约束。

官方页面关键信息：

1. 较快且便宜。
2. 价格约 `input $0.40 / output $1.60`（每 1M tokens）。
3. 1M 级上下文窗口。

参考：

- [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini)

### D. 不建议用于你这个核心目标

1. `gpt-5-nano`：极致便宜快，但更适合分类/摘要等轻任务，不适合高质量“为什么不是这个”。

参考：

- [GPT-5 nano](https://developers.openai.com/api/docs/models/gpt-5-nano)

## 2.4 和 qwen-flash 的优劣（结合你的场景）

### qwen-flash 的优势

1. 国内链路稳定性更好。
2. 成本和延迟通常更友好。
3. 做翻译、轻解释、批量任务性价比高。

### qwen-flash 的短板（在你这个目标下）

1. “对比型语法判别”一致性较难长期稳定。
2. 在复杂歧义句上，容易给泛化解释。
3. 要把输出稳定压进固定 JSON 结构，需要更重后处理。

### OpenAI 的优势（在你要的目标下）

1. 更适合做“正确 vs 错误”的反事实解释。
2. Structured Outputs 更容易把结果固定成前端可用结构。
3. 推理模型/高阶模型对复杂句法层级更稳。

### 推荐组合

1. 保留你现有：阿里云做转写与翻译主链路。
2. 本地 Worker 增加 OpenAI 语法提示生成。
3. 最终一次回写 PB（同一个 JSON 版本）。

---

## 3. 为什么语法提示必须结构化输出

如果只让模型返回自然语言段落，会出现：

1. 字段缺失（有时没有“错误表达”）。
2. 表达风格漂移（前端难渲染）。
3. 无法稳定评测与缓存。

Structured Outputs 的关键价值：

1. 输出“合法 JSON”且“符合 Schema”。
2. 便于做批处理、缓存、回归测试。

官方指南明确建议在可行时优先 Structured Outputs，并给出 `json_schema + strict` 用法。

参考：

- [Structured Outputs 指南](https://developers.openai.com/api/docs/guides/structured-outputs)

---

## 4. 本地安装（OpenAI 方案）

## 4.1 前置条件

1. 你本地已有 Python 3.9+（建议 3.10+）。
2. 已有 OpenAI API Key。
3. 你的网络环境可访问 OpenAI API（如果不可达，需要你的网络侧方案）。

## 4.2 安装 SDK

```bash
cd /Users/geo/Downloads/hardcoreEnglish
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install openai
```

官方参考：

- [Libraries（Python: pip install openai）](https://developers.openai.com/api/docs/libraries)

## 4.3 配置密钥

```bash
export OPENAI_API_KEY="你的key"
```

建议写入 `~/.zshrc`，避免每次手工 export。

官方参考：

- [Quickstart（OPENAI_API_KEY 环境变量）](https://developers.openai.com/api/docs/quickstart)

## 4.4 连通性最小测试

创建 `scripts/test_openai_basic.py`：

```python
from openai import OpenAI

client = OpenAI()
resp = client.responses.create(
    model="gpt-5.2",
    input="Reply only with: ok"
)
print(resp.output_text)
```

运行：

```bash
python scripts/test_openai_basic.py
```

---

## 5. 语法提示 Schema 设计（可直接用）

建议每句返回如下结构（`sentence_hints`）：

```json
{
  "sid": "s_001",
  "source_sentence": "I have lived here for three years.",
  "grammar_hints": [
    {
      "type": "tense_choice",
      "chosen_form": "have lived",
      "rejected_form": "lived",
      "why_not": "句子强调从过去持续到现在，用现在完成时更准确。",
      "minimal_pair": "I lived here in 2021. / I have lived here for three years.",
      "memory_hook": "for/since 连到现在，优先想现在完成时。"
    }
  ],
  "vocab_hints": [
    {
      "word": "live",
      "lemma": "live",
      "meaning_zh": "居住",
      "collocation": "live in + 地点"
    }
  ]
}
```

字段约束建议：

1. `grammar_hints`：每句最多 1-2 条。
2. `vocab_hints`：每句最多 2-3 条。
3. 全部字段必填，避免前端分支爆炸。

---

## 6. OpenAI 调用方式（语法提示）

## 6.1 调用建议

1. 使用 `responses.create`。
2. 强制 `json_schema + strict`（或等价的 Structured Outputs 配置）。
3. 使用低温度策略（如果你设置采样参数），减少风格漂移。

## 6.2 参考代码（Python，示例）

```python
from openai import OpenAI
import json

client = OpenAI()

schema = {
    "name": "grammar_hint_response",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "sid": {"type": "string"},
            "source_sentence": {"type": "string"},
            "grammar_hints": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {"type": "string"},
                        "chosen_form": {"type": "string"},
                        "rejected_form": {"type": "string"},
                        "why_not": {"type": "string"},
                        "minimal_pair": {"type": "string"},
                        "memory_hook": {"type": "string"}
                    },
                    "required": [
                        "type", "chosen_form", "rejected_form",
                        "why_not", "minimal_pair", "memory_hook"
                    ],
                    "additionalProperties": False
                }
            },
            "vocab_hints": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "word": {"type": "string"},
                        "lemma": {"type": "string"},
                        "meaning_zh": {"type": "string"},
                        "collocation": {"type": "string"}
                    },
                    "required": ["word", "lemma", "meaning_zh", "collocation"],
                    "additionalProperties": False
                }
            }
        },
        "required": ["sid", "source_sentence", "grammar_hints", "vocab_hints"],
        "additionalProperties": False
    }
}

prompt = """
你是英语语法教练。目标：让学习者明确知道“为什么是这个表达，不是那个表达”。
输出必须严格遵守给定 JSON Schema。
句子：I have lived here for three years.
sid：s_001
"""

resp = client.responses.create(
    model="gpt-5-mini",
    input=prompt,
    text={
        "format": {
            "type": "json_schema",
            "strict": True,
            "schema": schema["schema"],
            "name": schema["name"]
        }
    }
)

print(resp.output_text)
```

说明：

1. 具体参数命名可能随 SDK 小版本演进，建议以官方文档当期示例为准。
2. 你的生产代码应加重试、超时、失败降级。

参考：

- [Libraries（Responses API Python 示例）](https://developers.openai.com/api/docs/libraries)
- [Structured Outputs（Schema + strict）](https://developers.openai.com/api/docs/guides/structured-outputs)

---

## 7. 在你项目中的接入建议（不改业务主链路）

## 7.1 推荐流水线

1. 阿里云转写完成。
2. 本地 Worker 拉取待修复任务。
3. Whisper 重建句子与词时间戳。
4. 翻译对齐（你现有逻辑）。
5. 调 OpenAI 生成 `grammar_hints` / `vocab_hints`。
6. 一次性回写 PB `text`。

## 7.2 必做工程控制

1. 版本字段：`hint_model`, `hint_schema_version`, `hint_generated_at`。
2. 幂等：按 `material_id + sentence_hash` 缓存，重复执行不重复计费。
3. 失败回退：OpenAI 调用失败时，保留翻译与时间戳，不阻塞主流程。
4. 限流：并发与重试上限，防止瞬时成本飙升。

## 7.3 前端展示建议（第二步）

1. 每句加“语法提示”入口（灯泡图标）。
2. 面板固定展示顺序：
   - 正确表达
   - 常见错误
   - 为什么错
   - 最小对比
   - 记忆钩子
3. 默认折叠，避免信息过载。

---

## 8. 质量评估（必须做）

建议做一套最小评测集（50-100 句），人工打分：

1. 对比解释是否清楚（0-2分）
2. 错误示例是否典型（0-2分）
3. 最小对比例句是否可背（0-2分）
4. 中文说明是否自然准确（0-2分）
5. 结构化字段完整性（0-2分）

上线门槛建议：

1. 平均分 >= 8/10。
2. 字段缺失率 < 1%。
3. 高风险错误（语法结论反了）< 0.5%。

---

## 9. 你现在要做的事（最短路径）

1. 先在本地安装 `openai` 并跑通最小测试。
2. 在 Worker 里加一个 `generate_grammar_hints_openai()`，仅对 20 句样本跑。
3. 评估质量与成本。
4. 达标后再接全量自动化。

---

## 10. 官方参考链接

1. OpenAI Quickstart（API key 与首个调用）
   - [https://developers.openai.com/api/docs/quickstart](https://developers.openai.com/api/docs/quickstart)
2. OpenAI Libraries（Python SDK 安装与 Responses 示例）
   - [https://developers.openai.com/api/docs/libraries](https://developers.openai.com/api/docs/libraries)
3. Structured Outputs 指南
   - [https://developers.openai.com/api/docs/guides/structured-outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
4. Reasoning best practices
   - [https://developers.openai.com/api/docs/guides/reasoning-best-practices](https://developers.openai.com/api/docs/guides/reasoning-best-practices)
5. GPT-5
   - [https://developers.openai.com/api/docs/models/gpt-5](https://developers.openai.com/api/docs/models/gpt-5)
6. GPT-5 mini
   - [https://developers.openai.com/api/docs/models/gpt-5-mini](https://developers.openai.com/api/docs/models/gpt-5-mini)
7. GPT-5 pro
   - [https://developers.openai.com/api/docs/models/gpt-5-pro](https://developers.openai.com/api/docs/models/gpt-5-pro)
8. GPT-4.1 mini
   - [https://developers.openai.com/api/docs/models/gpt-4.1-mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini)

---

## 11. 重要说明（时效性）

模型价格、可用区域、限流、默认快照会变化。每次正式上线前，请以官方模型页和定价页为准做一次核对。
