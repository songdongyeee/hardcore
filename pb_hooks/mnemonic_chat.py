#!/usr/bin/env python3
import sys
import os
import json

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "no input file"}))
        return

    with open(sys.argv[1]) as f:
        payload = json.load(f)

    messages = payload.get("messages", [])
    marked_words = payload.get("markedWords", [])
    material_title = payload.get("materialTitle", "")

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

        word_list = "、".join([f'"{w["text"]}"' for w in marked_words if w.get("text")])

        # Build word context with sentences
        word_context_lines = []
        for w in marked_words:
            word = w.get("text", "")
            sentence = w.get("sentence", "")
            if word:
                if sentence:
                    word_context_lines.append(f'- "{word}"，原文中的句子："{sentence}"')
                else:
                    word_context_lines.append(f'- "{word}"')
        word_context = "\n".join(word_context_lines) if word_context_lines else "（无）"

        system_prompt = f"""你叫 Nex，是一位专业的英语词汇助教，采用苏格拉底式主动回忆教学法。在开场或用户第一次问起时可以介绍自己叫 Nex，其他时候自然对话即可，不要反复强调名字。

材料标题：{material_title or "英语材料"}

用户标记的生词（附原文句子）：
{word_context}

【你的教学流程】
1. 每次只聚焦一个词，从第一个开始，逐一练完所有词
2. 先问用户这个词在原文里是什么意思，不要直接解释
3. 根据用户的回答灵活推进：
   - 答对了 → 简短表扬，可以追问一个造句或近义词，然后进入下一个词
   - 答得不完整 → 适当引导，比如提示词的使用场景或语境
   - 答不出来 → 引用原文中含有该词的句子，让用户从上下文猜测
   - 还是不会 → 直接解释这个词的意思，用简单中文+英文例句
4. 所有词练完后，做一个简短总结

【语言规则 — 中英混用】
必须使用中文的场景：
- 开场引导、流程说明（"我们来练一练""答不出来没关系"）
- 情绪反馈（"对了！""没关系，再想想"）
- 解释单词的中文含义
- 进入下一个词的过渡语
- 总结收尾

必须使用英文的场景：
- 目标单词本身，永远用英文
- 引用原文句子，原文怎么写就怎么说
- 给出的英文例句

每次回复控制在2-3句话，简洁自然，语气像朋友

【特别注意】
- 始终以原文句子为锚点，不要脱离原文语境编造例子
- 如果用户跑题或闲聊，温和地引回到生词练习"""

        qwen_messages = [{"role": "system", "content": system_prompt}]
        for msg in messages:
            role = "assistant" if msg.get("role") == "ai" else "user"
            qwen_messages.append({"role": role, "content": msg.get("text", "")})

        response = Generation.call(
            model="qwen-turbo",
            messages=qwen_messages,
            api_key=api_key,
            result_format="message"
        )

        if response.status_code != 200:
            print(json.dumps({"error": f"model error: {response.message}"}))
            return

        reply = response.output.choices[0].message.content
        print(json.dumps({"reply": reply}, ensure_ascii=False))

    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    main()
