from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Prepare fixed 50-audio review data for transcript_player_app."
    )
    parser.add_argument(
        "--source-json",
        type=Path,
        default=Path(r"c:\Users\Ashit Rai\Downloads\results\khasi_qwen_accuracy_lora\stage1\run_seed_42\sample\hf_transcripts_50.json"),
    )
    parser.add_argument(
        "--app-root",
        type=Path,
        default=Path(r"c:\Users\Ashit Rai\Downloads\results\khasi_qwen_accuracy_lora\stage1\run_seed_42\transcript_player_app"),
    )
    args = parser.parse_args()

    if not args.source_json.exists():
        raise FileNotFoundError(f"Source transcript json not found: {args.source_json}")
    if not args.app_root.exists():
        raise FileNotFoundError(f"App root not found: {args.app_root}")

    out_review_dir = args.app_root / "public" / "review"
    out_audio_dir = out_review_dir / "audio"
    out_review_dir.mkdir(parents=True, exist_ok=True)
    out_audio_dir.mkdir(parents=True, exist_ok=True)

    payload = json.loads(args.source_json.read_text(encoding="utf-8"))
    items = payload.get("items", []) if isinstance(payload, dict) else []

    prepared = []
    copied = 0
    skipped = 0

    for item in items:
        chunk_id = (item.get("chunk_id") or "").strip()
        chunk_path = Path((item.get("chunk_path") or "").strip())
        if not chunk_id or not chunk_path.exists():
            skipped += 1
            continue

        dst_name = f"{chunk_id}.wav"
        dst_file = out_audio_dir / dst_name
        shutil.copy2(chunk_path, dst_file)
        copied += 1

        prepared.append(
            {
                "chunk_id": chunk_id,
                "transcript": item.get("transcript", ""),
                "audio_url": f"/review/audio/{dst_name}",
                "duration_sec": item.get("duration_sec", ""),
                "start_sec": item.get("start_sec", ""),
                "end_sec": item.get("end_sec", ""),
                "source_audio": item.get("source_audio", ""),
                "chunk_gcs_uri": item.get("chunk_gcs_uri", ""),
            }
        )

    out_json = out_review_dir / "review_items.json"
    out_json.write_text(
        json.dumps({"count": len(prepared), "items": prepared}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"Prepared items: {len(prepared)}")
    print(f"Copied audio files: {copied}")
    print(f"Skipped items: {skipped}")
    print(f"Review JSON: {out_json}")
    print(f"Audio dir: {out_audio_dir}")


if __name__ == "__main__":
    main()
