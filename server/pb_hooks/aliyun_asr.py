# -*- coding: utf-8 -*-
import os
import sys
import json

def log(msg):
    """安全的日志输出"""
    try:
        with open('/tmp/asr_translation.log', 'a') as f:
            f.write(msg + '\n')
            f.flush()
    except:
        pass

def translate_sentences(data, api_key):
    """使用 Qwen-Flash 逐句翻译转写结果"""
    log("🔍 translate_sentences called")
    
    try:
        from dashscope import Generation
    except ImportError:
        log("❌ dashscope import failed")
        return data
    
    # 🔥 正确处理 Aliyun ASR 的真实数据结构
    # 数据格式：{file_url, properties, transcripts: [{channel_id, sentences: [...]}]}
    transcripts = data.get('transcripts', [])
    if not transcripts or len(transcripts) == 0:
        log("❌ No transcripts found")
        return data
    
    # 获取第一个 transcript
    transcript_obj = transcripts[0]
    sentences_list = transcript_obj.get('sentences', [])
    log(f"📋 Found {len(sentences_list)} sentences")
    
    if not sentences_list:
        return data
    
    # 提取文本
    sentence_texts = [item.get('text', '') for item in sentences_list if item.get('text')]
    if not sentence_texts:
        return data
    
    log(f"📝 Translating {len(sentence_texts)} sentences...")
    
    # 构造 Prompt
    prompt = f"""请将以下句子逐句翻译成中文，保持原有顺序，每行一个翻译结果：
{chr(10).join(f"{i+1}. {s}" for i, s in enumerate(sentence_texts))}
要求：
- 只输出翻译结果，不要解释
- 每行一个翻译，用换行符分隔
- 保持句子顺序
- 去掉序号"""
    
    try:
        response = Generation.call(
            model='qwen-flash',
            prompt=prompt,
            api_key=api_key
        )
        
        log(f"📡 API status: {response.status_code}")
        
        if response.status_code == 200:
            # 🔥 FIX: 过滤掉空行！Filter out empty lines to prevent offset
            raw_lines = response.output.text.strip().split('\n')
            translations = [line.strip() for line in raw_lines if line.strip()]
            
            log(f"🎯 Received {len(translations)} translations (from {len(raw_lines)} raw lines)")
            log(f"Sample: {translations[:3]}")
            
            # 写回 JSON
            for i, item in enumerate(sentences_list):
                if i < len(translations):
                    # 去掉可能的序号 B.C. "1. " 或 "1."
                    translation = translations[i].lstrip('0123456789. ')
                    item['translation'] = translation
            
            log(f"✅ Translation completed")
        else:
            log(f"❌ API error: {response.code} - {response.message}")
    
    except Exception as e:
        log(f"❌ Exception: {type(e).__name__}: {str(e)}")
    
    return data

def main():
    try:
        # Load Key
        api_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("ALIYUN_API_KEY")
        if not api_key:
            try:
                script_dir = os.path.dirname(os.path.abspath(__file__))
                with open(os.path.join(script_dir, "api_key.txt"), "r") as f:
                    api_key = f.read().strip()
            except:
                pass
        if not api_key:
            print(json.dumps({"error": "Missing DASHSCOPE_API_KEY"}))
            return

        # Import
        try:
            from dashscope.audio.asr import Transcription
        except ImportError as e:
            print(json.dumps({"error": f"dashscope not found: {str(e)}"}))
            return

        # Get Args
        if len(sys.argv) < 2:
            print(json.dumps({"error": "Usage: python3 aliyun_asr.py <audio_url> [language]"}))
            return

        file_url = sys.argv[1]
        language = sys.argv[2] if len(sys.argv) >= 3 else 'en'
        log(f"🎙️ Starting ASR for language: {language}")

        # Run ASR
        task_response = Transcription.async_call(
            model='paraformer-v2',
            file_urls=[file_url],
            language_hints=[language],
            timestamp_alignment_enabled=True,
            api_key=api_key
        )

        transcription_response = Transcription.wait(task=task_response.output.task_id, api_key=api_key)

        if transcription_response.status_code == 200:
            if transcription_response.output['task_status'] == 'SUCCEEDED':
                results = transcription_response.output.get('results', [])
                if results and len(results) > 0 and 'transcription_url' in results[0]:
                    transcription_url = results[0]['transcription_url']
                    
                    import urllib.request
                    with urllib.request.urlopen(transcription_url) as response:
                        transcription_data = response.read().decode('utf-8')
                        transcription_json = json.loads(transcription_data)
                        
                        log(f"📥 ASR completed")
                        log(f"🔄 Calling translate_sentences...")
                        
                        # Call translation
                        transcription_json = translate_sentences(transcription_json, api_key)
                        
                        log(f"🔙 translate_sentences returned")
                        
                        # 返回完整数据
                        print(json.dumps(transcription_json))
                else:
                    print(json.dumps({"error": "No transcription URL in response"}))
                    sys.exit(1)
            else:
                error_msg = transcription_response.output.get('message', 'Unknown Error')
                print(json.dumps({"error": f"Task Failed: {error_msg}"}))
                sys.exit(1)
        else:
            print(json.dumps({"error": f"API Error: {transcription_response.message}"}))
            sys.exit(1)

    except Exception as e:
        log(f"❌ Exception: {str(e)}")
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()