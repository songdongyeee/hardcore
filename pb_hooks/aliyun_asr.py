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

# 🧠 Smart Phrase Chunking with spaCy
def add_phrase_chunks(transcription_data):
    """
    Add intelligent phrase chunking using spaCy NLP.
    Groups words into meaningful phrases based on linguistic structure.
    """
    try:
        import spacy
        # Load English model (small, fast)
        try:
            nlp = spacy.load("en_core_web_sm")
        except OSError:
            # Model not installed, skip phrase chunking
            log("warning: spaCy model not found. Skipping phrase chunking.")
            return transcription_data
        
        # Process each sentence
        for sentence in transcription_data:
            text = sentence.get('text', '')
            words = sentence.get('words', [])
            
            if not text or not words:
                continue
            
            # Analyze with spaCy
            doc = nlp(text)
            chunks = []
            
            # Extract noun chunks (natural phrase boundaries)
            for noun_chunk in doc.noun_chunks:
                # Get token indices in the doc
                start_idx = noun_chunk.start
                end_idx = noun_chunk.end
                
                # Map to original words using token positions
                chunk_words = []
                if start_idx < len(words) and end_idx <= len(words):
                    chunk_words = words[start_idx:end_idx]
                
                if chunk_words:
                    chunks.append({
                        'text': noun_chunk.text,
                        'begin_time': chunk_words[0].get('begin_time', 0),
                        'end_time': chunk_words[-1].get('end_time', 0),
                        'words': chunk_words
                    })
            
            # Add chunks to sentence data
            sentence['phrase_chunks'] = chunks
        
        return transcription_data
        
    except ImportError:
        # spaCy not installed, skip
        log("warning: spaCy not installed. Skipping phrase chunking.")
        return transcription_data
    except Exception as e:
        # Any other error, log and continue without chunks
        log(f"error: Phrase chunking error: {e}")
        return transcription_data

def translate_sentences(data, api_key, language='en'):
    """使用 Qwen-Flash 批量翻译，使用ID锚点防止错位"""
    log("🔍 translate_sentences called with ID-Anchor logic")
    
    try:
        from dashscope import Generation
        import re
    except ImportError:
        log("❌ dashscope import failed")
        return data

    if isinstance(data, list):
        transcripts = data
    else:
        transcripts = data.get('transcripts', [])
        
    if not transcripts:
        return data
    
    transcript_obj = transcripts[0]
    sentences_list = transcript_obj.get('sentences', [])
    if not sentences_list:
        return data

    log(f"📋 Found {len(sentences_list)} sentences to translate")

    # Determine prompts based on language
    if language == 'zh':  # Source is Chinese -> Translate to English
        prompt_template = "Translate the following lines to English. Keep the ID prefix (e.g. [0]). Do not merge/split lines. No dictionary/pinyin/explanation:\n{text}"
    else:                 # Source is English (default) -> Translate to Chinese
        prompt_template = "请将以下句子逐句翻译成中文。保持每行的ID前缀不变（如[0]），不要合并或拆分行，不要输出任何额外解释：\n{text}"

    # Batch processing
    batch_size = 15
    total = len(sentences_list)
    
    for i in range(0, total, batch_size):
        batch = sentences_list[i:i + batch_size]
        
        # 1. Build Prompt with IDs
        prompt_lines = []
        for j, sent in enumerate(batch):
            # Clean text to avoid confusing the model
            clean_text = sent.get('text', '').replace('\n', ' ').strip()
            # ID format: [0] Text
            prompt_lines.append(f"[{j}] {clean_text}")
        
        combined_prompt = prompt_template.format(text="\n".join(prompt_lines))
        
        try:
            response = Generation.call(
                model='qwen-flash',
                prompt=combined_prompt,
                api_key=api_key
            )

            if response.status_code == 200:
                result_text = response.output.text.strip()
                
                # 2. Parse with Regex to enforce alignment
                # Matches "[12] Translated Text..."
                pattern = re.compile(r'^\[(\d+)\]\s*(.*)', re.MULTILINE)
                
                matched_count = 0
                for match in pattern.finditer(result_text):
                    try:
                        local_idx = int(match.group(1))
                        trans_text = match.group(2).strip()
                        
                        # Safety check: is this ID valid for this batch?
                        if 0 <= local_idx < len(batch):
                            # DIRECT ASSIGNMENT BY ID - The core fix
                            # sentences_list indices are global, batch indices are local
                            # Wait, 'batch' is a slice of 'sentences_list' objects (references).
                            # So modifying 'batch[local_idx]' modifies the original object.
                            batch[local_idx]['translation'] = trans_text
                            matched_count += 1
                    except:
                        continue
                log(f"✅ Batch {i//batch_size + 1}: Matched {matched_count}/{len(batch)}")
            else:
                log(f"❌ API error: {response.code} - {response.message}")
        
        except Exception as e:
            log(f"❌ Batch Exception: {str(e)}")

    log(f"✅ Translation completed")
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
            print(json.dumps({"error": "Usage: python3 aliyun_asr.py <audio_url> [language] [--retranslate]"}))
            return

        arg1 = sys.argv[1]
        language = sys.argv[2] if len(sys.argv) >= 3 else 'en'
        is_retranslate = len(sys.argv) >= 4 and sys.argv[3] == '--retranslate'

        # --- MODE 1: RETRANSLATE (Skip ASR, just fix JSON) ---
        if is_retranslate:
            log(f"🔄 Retranslate Mode: Processing existing JSON...")
            try:
                # arg1 is passed as the JSON string (or path)
                if arg1.strip().startswith('{') or arg1.strip().startswith('['):
                    transcription_data = arg1
                else:
                    if os.path.exists(arg1):
                        with open(arg1, 'r') as f:
                            transcription_data = f.read()
                    else:
                        transcription_data = arg1

                transcription_json = json.loads(transcription_data)
                
                # Normalize transcripts for processing
                if isinstance(transcription_json, list):
                    work_transcripts = transcription_json
                else:
                    work_transcripts = transcription_json.get('transcripts', [])

                # 1. Add Phrase Chunks (Restore/Update)
                log(f"🧠 Adding phrase chunks...")
                if work_transcripts and len(work_transcripts) > 0:
                    sents = work_transcripts[0].get('sentences', [])
                    work_transcripts[0]['sentences'] = add_phrase_chunks(sents)

                # 2. Translate (Fix Misalignment)
                log(f"🔄 Re-Translating...")
                # translate_sentences now handles both list and dict signatures
                transcription_json = translate_sentences(transcription_json, api_key, language)
                
                print(json.dumps(transcription_json))
                return

            except Exception as e:
                log(f"❌ Retranslate Error: {e}")
                print(json.dumps({"error": str(e)}))
                sys.exit(1)

        # --- MODE 2: NORMAL (ASR + Translate) ---
        file_url = arg1
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
                        log(f"🧠 Adding phrase chunks...")
                        # 1. Add Phrase Chunks
                        # Normalize transcripts for processing
                        if isinstance(transcription_json, list):
                            work_transcripts = transcription_json
                        else:
                            work_transcripts = transcription_json.get('transcripts', [])

                        if work_transcripts and len(work_transcripts) > 0:
                            sents = work_transcripts[0].get('sentences', [])
                            work_transcripts[0]['sentences'] = add_phrase_chunks(sents)

                        log(f"🔄 Calling translate_sentences...")
                        
                        # 2. Call translation
                        transcription_json = translate_sentences(transcription_json, api_key, language)
                        
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