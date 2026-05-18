#!/usr/bin/env python3
import sys
import os
import json
import base64
import uuid

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "no input file"}))
        return

    with open(sys.argv[1]) as f:
        payload = json.load(f)

    audio_base64 = payload.get("audioBase64", "")
    mime_type = payload.get("mimeType", "audio/mp4")

    if not audio_base64:
        print(json.dumps({"error": "no audio data"}))
        return

    api_key = os.getenv("DASHSCOPE_API_KEY") or os.getenv("ALIYUN_API_KEY")
    if not api_key:
        try:
            api_key = open("/www/pocketbase/pb_hooks/api_key.txt").read().strip()
        except Exception:
            pass

    if not api_key:
        print(json.dumps({"error": "no API key"}))
        return

    ext = "mp4" if "mp4" in mime_type else "webm"
    filename = f"{uuid.uuid4().hex}.{ext}"
    tmp_dir = "/www/pocketbase/pb_public/tmp_asr"
    os.makedirs(tmp_dir, exist_ok=True)
    tmp_path = os.path.join(tmp_dir, filename)

    try:
        audio_bytes = base64.b64decode(audio_base64)
        with open(tmp_path, "wb") as f:
            f.write(audio_bytes)

        from dashscope.audio.asr import Transcription
        import urllib.request

        file_url = f"https://zjcnex.top/tmp_asr/{filename}"

        task_response = Transcription.async_call(
            model="paraformer-v2",
            file_urls=[file_url],
            language_hints=["en", "zh"],
            api_key=api_key
        )

        result = Transcription.wait(task=task_response.output.task_id, api_key=api_key)

        if result.status_code == 200 and result.output.get("task_status") == "SUCCEEDED":
            results = result.output.get("results", [])
            if results and "transcription_url" in results[0]:
                with urllib.request.urlopen(results[0]["transcription_url"]) as r:
                    data = json.loads(r.read().decode("utf-8"))

                transcripts = data if isinstance(data, list) else data.get("transcripts", [])
                if transcripts:
                    sentences = transcripts[0].get("sentences", [])
                    text = " ".join(s.get("text", "") for s in sentences).strip()
                    if not text:
                        text = transcripts[0].get("text", "")
                    print(json.dumps({"text": text}))
                else:
                    print(json.dumps({"text": ""}))
            else:
                print(json.dumps({"error": "no transcription URL"}))
        else:
            err = result.output.get("message", "transcription failed")
            print(json.dumps({"error": err}))

    except Exception as e:
        print(json.dumps({"error": str(e)}))

    finally:
        try:
            os.remove(tmp_path)
        except Exception:
            pass

if __name__ == "__main__":
    main()
