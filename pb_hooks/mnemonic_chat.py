#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys
import os
import json
import re
import datetime


def strip_markdown(text):
    """Remove all markdown so TTS reads clean natural speech."""
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
    text = re.sub(r'\*(.+?)\*',     r'\1', text)
    text = re.sub(r'__(.+?)__',     r'\1', text)
    text = re.sub(r'_(.+?)_',       r'\1', text)
    text = re.sub(r'```[\s\S]*?```', '', text)
    text = re.sub(r'`(.+?)`',        r'\1', text)
    text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'^\s*[-*+]\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
    text = re.sub(
        u'[\U0001F300-\U0001F9FF\U00002600-\U000027BF\U0001FA00-\U0001FA9F]+',
        '', text
    )
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def detect_state_update(reply, current_index, total_words, attempt_count):
    """
    Analyse the AI's own reply to produce state-update signals for the frontend.
    Returns a dict with: advancement (bool), wordResult (str|None), sessionPhase (str).
    """
    advance_re = re.compile(
        r'(进入下一个|我们来看下一个|接下来看|接下来我们|下一个词|'
        r'next\s+word|move\s+on|让我们继续|继续下一个)',
        re.IGNORECASE
    )
    mastered_re = re.compile(
        r'(答对了|完全正确|太棒了|说得对|非常好|理解得很好|'
        r'great|correct|exactly right|well done|spot on|perfect)',
        re.IGNORECASE
    )
    explained_re = re.compile(
        r'(直接告诉你|这个词的意思是|它的意思是|'
        r'let me explain|it means|means\s+")',
        re.IGNORECASE
    )
    summary_re = re.compile(
        r'(总结一下|今天练了|都练完了|全部练完|练习结束|'
        r'all done|session complete|that\'s all the words)',
        re.IGNORECASE
    )

    advancement = bool(advance_re.search(reply))
    is_last_word = (current_index >= total_words - 1)

    word_result = None
    if mastered_re.search(reply) and not explained_re.search(reply):
        word_result = 'mastered'
    elif explained_re.search(reply) or attempt_count >= 3:
        word_result = 'struggling'

    if summary_re.search(reply) or (advancement and is_last_word):
        session_phase = 'summary'
    else:
        session_phase = 'drilling'

    return {
        'advancement': advancement,
        'wordResult': word_result,
        'sessionPhase': session_phase,
    }


def log_debug(payload):
    try:
        with open('/tmp/nex_chat.log', 'a', encoding='utf-8') as f:
            f.write('=== ' + datetime.datetime.now().isoformat() + ' ===\n')
            f.write(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
    except Exception:
        pass


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "no input file"}))
        return

    with open(sys.argv[1], encoding='utf-8') as f:
        payload = json.load(f)

    messages       = payload.get("messages", [])
    marked_words   = payload.get("markedWords", [])
    material_title = payload.get("materialTitle", "") or "英语听力材料"

    conv_state    = payload.get("conversationState") or {}
    current_index = int(conv_state.get("currentWordIndex", 0))
    word_status   = conv_state.get("wordStatus", {})
    attempt_count = int(conv_state.get("attemptCount", 0))
    session_phase = conv_state.get("sessionPhase", "drilling")

    total_words   = len(marked_words)
    current_index = max(0, min(current_index, total_words - 1)) if total_words > 0 else 0

    api_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("ALIYUN_API_KEY")
    if not api_key:
        try:
            api_key = open("/www/pocketbase/pb_hooks/api_key.txt").read().strip()
        except Exception:
            pass
    if not api_key:
        print(json.dumps({"error": "no API key"}))
        return

    try:
        from dashscope import Generation

        current_word_obj  = marked_words[current_index] if marked_words else {}
        current_word      = current_word_obj.get("text", "").strip()
        current_sentence  = current_word_obj.get("sentence", "").strip()

        mastered_words   = [w for w, s in word_status.items() if s == 'mastered']
        struggling_words = [w for w, s in word_status.items() if s == 'struggling']

        word_list_lines = []
        for i, w in enumerate(marked_words):
            word     = w.get("text", "").strip()
            sentence = w.get("sentence", "").strip()
            status   = word_status.get(word, 'unseen')
            marker   = "-> 当前" if i == current_index else "  "
            status_label = {
                'mastered':    '[已掌握]',
                'struggling':  '[较难]',
                'attempting':  '[练习中]',
                'unseen':      '[待练]',
            }.get(status, '[待练]')
            if word:
                entry = f'{marker} [{i+1}] "{word}"  {status_label}'
                if sentence:
                    entry += f'\n       原句："{sentence}"'
                word_list_lines.append(entry)

        word_list_block = "\n".join(word_list_lines) if word_list_lines else "（无）"

        phase_label = {
            'opening':  '开场引导',
            'drilling': '词汇练习中',
            'summary':  '总结收尾',
        }.get(session_phase, '词汇练习中')

        system_prompt = f"""你叫 Nex，是一位专业的英语词汇助教。

【背景】
用户正在学习《{material_title}》，他们是直接听音频的，没有文字稿，遇到听不懂的词就标记了下来。你帮他们通过主动回忆把这些词记住。

【当前会话状态（权威数据，直接使用，不要推断）】
- 会话阶段：{phase_label}
- 当前聚焦词："{current_word}"（第 {current_index + 1} 个，共 {total_words} 个）
- 用户本词已尝试：{attempt_count} 次
- 已掌握的词：{', '.join([f'"{w}"' for w in mastered_words]) or '（暂无）'}
- 较难的词：{', '.join([f'"{w}"' for w in struggling_words]) or '（暂无）'}

【所有标记词一览】
{word_list_block}

【当前词的原句】
{f'"{current_sentence}"' if current_sentence else '（原句暂无，请根据词义教学）'}

【教学流程】
1. 聚焦当前词 "{current_word}"，先问用户它在材料里是什么意思，不要直接解释。
2. 根据用户回答推进：
   - 答对 → 简短肯定（如"答对了！"），然后宣布进入下一个词（说"我们来看下一个词"），这样系统才能切换。
   - 部分正确 → 引导补充，提示词在原句里修饰什么、用在什么场景。
   - 尝试 {attempt_count} 次还没答出来 → {"直接解释这个词的意思，给一个英文例句，然后进入下一个词" if attempt_count >= 2 else "把原句说出来，让用户从上下文猜"}。
3. 所有词练完后，说"总结一下"并给出简短鼓励。

【意图识别】
- 用户在回答词义 → 按流程推进
- 用户在提问 → 先回答，再回到练习
- 用户说"下一个"/"skip" → 立即进入下一个词
- 用户跑题 → 一句话温和拉回

【语言规则】
- 开场、引导、反馈、过渡、总结：用中文
- 目标单词本身：始终用英文
- 引用原句：原文原样引用，不翻译
- 英文例句：用英文

【格式规则（严格执行）】
- 每次回复最多 2-3 句话，简洁自然
- 禁止 Markdown（不用 **粗体**、不用 _斜体_、不用 # 标题、不用 - 列表符号）
- 禁止 emoji
- 语气像朋友聊天，不要像机器人"""

        qwen_messages = [{"role": "system", "content": system_prompt}]
        for msg in messages:
            role = "assistant" if msg.get("role") == "ai" else "user"
            qwen_messages.append({"role": role, "content": msg.get("text", "")})

        response = Generation.call(
            model="qwen-plus",
            messages=qwen_messages,
            api_key=api_key,
            result_format="message",
            max_tokens=300,
            temperature=0.7,
        )

        if response.status_code != 200:
            print(json.dumps({"error": f"model error: {response.message}"}))
            return

        raw_reply   = response.output.choices[0].message.content
        clean_reply = strip_markdown(raw_reply)

        state_update = detect_state_update(
            clean_reply, current_index, total_words, attempt_count
        )

        # ── 详细 Debug 日志 ────────────────────────────────────────────────────
        # 用户本轮说了什么
        last_user_msg = next(
            (m.get("text", "") for m in reversed(messages) if m.get("role") == "user"),
            "(无用户消息)"
        )

        # 哪些规则在本轮被激活
        active_rules = []
        if attempt_count >= 3:
            active_rules.append(f"attempt={attempt_count} => 直接解释模式（已触发）")
        elif attempt_count == 2:
            active_rules.append(f"attempt={attempt_count} => 说出原句让用户从上下文猜")
        else:
            active_rules.append(f"attempt={attempt_count} => 正常提问模式")
        if mastered_words:
            active_rules.append(f"已掌握 {len(mastered_words)} 词: {mastered_words}")
        if struggling_words:
            active_rules.append(f"较难 {len(struggling_words)} 词: {struggling_words}")
        if current_sentence:
            active_rules.append(f"原句已注入: \"{current_sentence[:80]}\"")
        active_rules.append(f"阶段={phase_label}, 词=\"{current_word}\" ({current_index+1}/{total_words})")

        log_debug({
            "★ 用户说":         last_user_msg,
            "★ 模型回复":       clean_reply,
            "★ 触发规则":       active_rules,
            "★ 状态信号":       state_update,
            "-- word":          f"{current_word} [{current_index+1}/{total_words}]",
            "-- attempt":       attempt_count,
            "-- phase":         session_phase,
            "-- msg_count":     len(messages),
            "-- system_prompt": system_prompt,
            "-- dialogue":      [
                {"role": m["role"], "text": m["content"][:300]}
                for m in qwen_messages
            ],
        })

        print(json.dumps({"reply": clean_reply, "stateUpdate": state_update}))

    except Exception as e:
        import traceback
        log_debug({"error": str(e), "traceback": traceback.format_exc()})
        print(json.dumps({"error": str(e)}))


if __name__ == "__main__":
    main()
