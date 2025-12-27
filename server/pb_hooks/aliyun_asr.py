# -*- coding: utf-8 -*-
import os
import sys
import json
import logging

# Configure logging
logging.basicConfig(level=logging.ERROR)

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