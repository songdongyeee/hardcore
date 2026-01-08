# -*- coding: utf-8 -*-
import os
import sys
import json
import logging

# Configure logging
logging.basicConfig(level=logging.ERROR)

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
            logging.warning("spaCy model not found. Skipping phrase chunking. Install with: python -m spacy download en_core_web_sm")
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
            
            # Build a clean word list for matching
            clean_words = []
            for word in words:
                clean_text = word.get('text', '').strip()
                if clean_text:
                    clean_words.append(clean_text)
            
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
        logging.warning("spaCy not installed. Skipping phrase chunking.")
        return transcription_data
    except Exception as e:
        # Any other error, log and continue without chunks
        logging.error(f"Phrase chunking error: {e}")
        return transcription_data

def main():
    # 1. Print a start marker (so we know it ran)
    # But strictly speaking, we want JSON at the end.
    # Let's collect result and print ONCE.

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
            print(json.dumps({"error": "Missing DASHSCOPE_API_KEY (Check Env or api_key.txt)"}))
            return

        # 2. Defensive Import
        try:
            from dashscope.audio.asr import Transcription
        except ImportError as e:
            print(json.dumps({"error": f"ImportError: dashscope not found. Install with: python3.11 -m pip install dashscope. Details: {str(e)}"}))
            return
        except Exception as e:
             print(json.dumps({"error": f"ImportError (Other): {str(e)}"}))
             return

        # 3. Get Args
        if len(sys.argv) < 2:
            print(json.dumps({"error": "Usage: python3 aliyun_asr.py <audio_url>"}))
            return

        file_url = sys.argv[1]

        # 4. Run Task
        task_response = Transcription.async_call(
            model='paraformer-v2',
            file_urls=[file_url],
            language_hints=['en', 'zh'],
            timestamp_alignment_enabled=True,
            api_key=api_key
        )

        transcription_response = Transcription.wait(task=task_response.output.task_id, api_key=api_key)

        if transcription_response.status_code == 200:
            if transcription_response.output['task_status'] == 'SUCCEEDED':
                # Get the transcription URL from results
                results = transcription_response.output.get('results', [])
                if results and len(results) > 0 and 'transcription_url' in results[0]:
                    transcription_url = results[0]['transcription_url']
                    
                    # Download the transcription JSON from OSS
                    import urllib.request
                    with urllib.request.urlopen(transcription_url) as response:
                        transcription_data = response.read().decode('utf-8')
                        transcription_json = json.loads(transcription_data)
                        
                        # 🧠 Add intelligent phrase chunking
                        if isinstance(transcription_json, list) and len(transcription_json) > 0:
                            # Handle array format: [{"channel_id": 0, "sentences": [...]}]
                            sentences = transcription_json[0].get('sentences', [])
                            transcription_json[0]['sentences'] = add_phrase_chunks(sentences)
                        elif isinstance(transcription_json, dict) and 'sentences' in transcription_json:
                            # Handle direct dict format
                            transcription_json['sentences'] = add_phrase_chunks(transcription_json['sentences'])
                        
                        # Return the complete transcription data (not the SDK output)
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
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()