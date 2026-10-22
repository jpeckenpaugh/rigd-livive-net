#!/usr/bin/env python3
"""
ASL-LEX Sign Downloader & CKPE Keyframe Extractor

Downloads sign metadata and reference video from ASL-LEX (e.g., https://asl-lex.org/visualization/?sign=one)
and extracts fixed-interval keyframe bitmaps (default: 0.1s / 10 fps) + a CKPE single-step transition manifest.

Usage:
  python3 scripts/prepare_asl_sign.py --url "https://asl-lex.org/visualization/?sign=one"
  python3 scripts/prepare_asl_sign.py --sign one --fps 10
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ASL_LEX_PROPS_URL = "https://asl-lex.org/visualization/data/sign_props.json"
ASL_LEX_GRAPH_URL = "https://asl-lex.org/visualization/data/graph.json"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def fetch_json(url: str, headers: dict | None = None):
    req_headers = {"User-Agent": USER_AGENT}
    if headers:
        req_headers.update(headers)
    req = urllib.request.Request(url, headers=req_headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_bytes(url: str, headers: dict | None = None) -> bytes:
    req_headers = {"User-Agent": USER_AGENT}
    if headers:
        req_headers.update(headers)
    req = urllib.request.Request(url, headers=req_headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def parse_sign_from_input(sign_arg: str | None, url_arg: str | None) -> str:
    if sign_arg:
        return sign_arg.strip().lower()
    if url_arg:
        parsed = urllib.parse.urlparse(url_arg)
        qs = urllib.parse.parse_qs(parsed.query)
        if "sign" in qs and qs["sign"]:
            return qs["sign"][0].strip().lower()
    raise ValueError("Please provide either --sign <entry_id> or --url 'https://asl-lex.org/visualization/?sign=...'")


def find_sign_metadata(entry_id: str) -> dict:
    print(f"[1/4] Fetching ASL-LEX lexical & phonological metadata for sign '{entry_id}'...")
    props_list = fetch_json(ASL_LEX_PROPS_URL)
    match = None
    for item in props_list:
        if str(item.get("EntryID", "")).lower() == entry_id or str(item.get("Code", "")).lower() == entry_id:
            match = item
            break

    if not match:
        raise LookupError(f"Sign '{entry_id}' not found in {ASL_LEX_PROPS_URL}")

    # Also attach network graph node coordinates if available
    try:
        graph = fetch_json(ASL_LEX_GRAPH_URL)
        for node in graph.get("nodes", []):
            if str(node.get("EntryID", "")).lower() == str(match.get("EntryID", "")).lower():
                match["_graph_node"] = node
                break
    except Exception as exc:
        print(f"  Warning: could not fetch graph node coordinates ({exc})")

    return match


def download_vimeo_mp4(vimeo_url: str, dest_mp4: Path) -> dict:
    """
    Resolves the embedded Vimeo player configuration (using the ASL-LEX Referer)
    and downloads the highest-resolution MP4 stream.
    """
    print(f"[2/4] Resolving video stream from {vimeo_url}...")
    html = fetch_bytes(vimeo_url, headers={"Referer": "https://asl-lex.org/"}).decode("utf-8", errors="replace")

    m = re.search(r"window\.playerConfig\s*=\s*(\{.*?\});?\s*</script>", html, re.S)
    if not m:
        m = re.search(r"playerConfig\s*=\s*(\{.*\})", html)
    if not m:
        raise RuntimeError(f"Could not locate playerConfig in Vimeo embed page: {vimeo_url}")

    player_config = json.loads(m.group(1))
    files = player_config.get("request", {}).get("files", {})

    # 1. Check if direct progressive MP4 links exist
    progressive = files.get("progressive", [])
    if progressive:
        best_prog = max(progressive, key=lambda x: x.get("width", 0) * x.get("height", 0))
        mp4_bytes = fetch_bytes(best_prog["url"], headers={"Referer": "https://player.vimeo.com/"})
        dest_mp4.write_bytes(mp4_bytes)
        return {
            "width": best_prog.get("width"),
            "height": best_prog.get("height"),
            "fps": best_prog.get("fps"),
            "source": "progressive"
        }

    # 2. Otherwise reconstruct MP4 from Vimeo's DASH playlist.json (init_segment + media segments)
    dash_cdns = files.get("dash", {}).get("cdns", {})
    if not dash_cdns:
        raise RuntimeError("No progressive or DASH video streams found in Vimeo playerConfig.")

    cdn = dash_cdns.get("akfire_interconnect_quic") or next(iter(dash_cdns.values()))
    playlist_url = cdn.get("avc_url") or cdn.get("url")
    playlist = fetch_json(playlist_url, headers={"Referer": "https://player.vimeo.com/"})

    playlist_base = urllib.parse.urljoin(playlist_url, playlist.get("base_url", ""))
    best_video = max(playlist.get("video", []), key=lambda v: v.get("width", 0) * v.get("height", 0))
    video_base_url = urllib.parse.urljoin(playlist_base, best_video.get("base_url", ""))

    raw_mp4_path = dest_mp4.with_suffix(".raw.mp4")
    with open(raw_mp4_path, "wb") as f:
        if best_video.get("init_segment"):
            f.write(base64.b64decode(best_video["init_segment"]))
        elif best_video.get("init_segment_url"):
            init_url = urllib.parse.urljoin(video_base_url, best_video["init_segment_url"])
            f.write(fetch_bytes(init_url, headers={"Referer": "https://player.vimeo.com/"}))

        for seg in best_video.get("segments", []):
            seg_url = urllib.parse.urljoin(video_base_url, seg.get("url", ""))
            seg_range = seg.get("range")
            headers = {"Referer": "https://player.vimeo.com/"}
            if seg_range:
                headers["Range"] = f"bytes={seg_range}"
            f.write(fetch_bytes(seg_url, headers=headers))

    # Remux fragmented MP4 into a clean standard MP4 container via ffmpeg
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", str(raw_mp4_path),
            "-c", "copy",
            "-movflags", "+faststart",
            str(dest_mp4)
        ],
        check=True
    )
    raw_mp4_path.unlink(missing_ok=True)

    return {
        "width": best_video.get("width"),
        "height": best_video.get("height"),
        "fps": best_video.get("framerate"),
        "duration_s": best_video.get("duration"),
        "codecs": best_video.get("codecs"),
        "source": "dash_avc"
    }


def extract_keyframes(
    video_path: Path,
    frames_dir: Path,
    fps: float,
    img_format: str,
    sign_meta: dict,
    video_info: dict
) -> dict:
    """
    Extracts keyframes at `fps` (e.g. 10 fps = every 0.1s) using ffmpeg and generates
    a CKPE single-step transition manifest pairing (I_{t-1}, I_t) with phase annotations.
    """
    frames_dir.mkdir(parents=True, exist_ok=True)
    for existing in frames_dir.glob(f"frame_*.{img_format}"):
        existing.unlink()

    interval_s = 1.0 / fps
    print(f"[3/4] Extracting keyframes at {fps:g} fps ({interval_s:.3f}s interval) into {frames_dir}...")

    pattern = str(frames_dir / f"frame_%04d.{img_format}")
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", str(video_path),
            "-vf", f"fps={fps}",
            pattern
        ],
        check=True
    )

    frame_files = sorted(frames_dir.glob(f"frame_*.{img_format}"))
    onset_ms = sign_meta.get("SignOnset(ms)")
    offset_ms = sign_meta.get("SignOffset(ms)")
    handshape = sign_meta.get("Handshape.2.0")
    location = sign_meta.get("MajorLocation.2.0")
    movement = sign_meta.get("Movement.2.0")

    frames_manifest = []
    for idx, fpath in enumerate(frame_files):
        timestamp_s = round(idx * interval_s, 4)
        timestamp_ms = round(timestamp_s * 1000)

        # Determine phase relative to ASL-LEX SignOnset(ms) and SignOffset(ms)
        if onset_ms is not None and offset_ms is not None:
            if timestamp_ms < onset_ms:
                phase = "prep"       # moving from resting stance toward sign onset
            elif timestamp_ms <= offset_ms:
                phase = "stroke"     # active sign execution window
            else:
                phase = "retract"    # returning from sign offset to resting stance
        else:
            phase = "unknown"

        frames_manifest.append({
            "frame_index": idx,
            "file": f"frames/{fpath.name}",
            "timestamp_s": timestamp_s,
            "timestamp_ms": timestamp_ms,
            "phase": phase
        })

    # Build CKPE single-step prediction pairs: (I_{t-1}, S_{t-1}, I_t, action_descriptor) -> S_t
    entry_id = sign_meta.get("EntryID", "unknown")
    single_step_pairs = []
    for i in range(1, len(frames_manifest)):
        prev_f = frames_manifest[i - 1]
        curr_f = frames_manifest[i]

        if curr_f["phase"] == "prep":
            descriptor = (
                f"Sign '{entry_id}' preparation: right arm raising from neutral resting pose "
                f"toward {location} location (target handshape '{handshape}')."
            )
        elif curr_f["phase"] == "stroke":
            descriptor = (
                f"Sign '{entry_id}' hold/stroke: right hand holding handshape '{handshape}' "
                f"in {location} space ({movement} movement)."
            )
        else:
            descriptor = (
                f"Sign '{entry_id}' retraction: right arm lowering from {location} space "
                f"back to neutral resting pose."
            )

        single_step_pairs.append({
            "step_index": i - 1,
            "t_minus_1": {
                "frame_index": prev_f["frame_index"],
                "image": prev_f["file"],
                "timestamp_ms": prev_f["timestamp_ms"],
                "phase": prev_f["phase"],
                "rig_state_hint_S_t_minus_1": "DEFAULT_POSE" if i == 1 else f"PREDICTED_S_{i - 1}"
            },
            "t": {
                "frame_index": curr_f["frame_index"],
                "target_image": curr_f["file"],
                "timestamp_ms": curr_f["timestamp_ms"],
                "phase": curr_f["phase"],
                "target_rig_state_S_t": "DEFAULT_POSE" if i == len(frames_manifest) - 1 else None
            },
            "action_descriptor": descriptor
        })

    return {
        "sign": entry_id,
        "code": sign_meta.get("Code"),
        "source_url": f"https://asl-lex.org/visualization/?sign={entry_id}",
        "vimeo_url": sign_meta.get("VimeoVideo"),
        "video": {
            "file": video_path.name,
            **video_info
        },
        "timing_ms": {
            "sign_onset_ms": onset_ms,
            "sign_offset_ms": offset_ms,
            "sign_duration_ms": sign_meta.get("SignDuration(ms)"),
            "clip_duration_ms": sign_meta.get("ClipDuration(ms)")
        },
        "phonology_level1_and_2": {
            "sign_type": sign_meta.get("SignType.2.0"),
            "major_location": location,
            "minor_location": sign_meta.get("MinorLocation.2.0"),
            "movement": movement,
            "repeated_movement": sign_meta.get("RepeatedMovement.2.0"),
            "contact": sign_meta.get("Contact.2.0"),
            "handshape": handshape,
            "selected_fingers": sign_meta.get("SelectedFingers.2.0"),
            "finger_flexion": sign_meta.get("Flexion.2.0"),
            "thumb_position": sign_meta.get("ThumbPosition.2.0"),
            "ulnar_rotation": sign_meta.get("UlnarRotation.2.0")
        },
        "extraction": {
            "fps": fps,
            "interval_s": interval_s,
            "format": img_format,
            "total_frames": len(frames_manifest)
        },
        "frames": frames_manifest,
        "ckpe_single_step_targets": single_step_pairs
    }


def main():
    parser = argparse.ArgumentParser(
        description="Download ASL-LEX sign video & metadata and extract CKPE keyframe targets."
    )
    parser.add_argument(
        "--url",
        default="https://asl-lex.org/visualization/?sign=one",
        help="ASL-LEX visualization URL (e.g., https://asl-lex.org/visualization/?sign=one)"
    )
    parser.add_argument(
        "--sign",
        default=None,
        help="Sign EntryID or Code (overrides --url if provided, e.g., 'one')"
    )
    parser.add_argument(
        "--fps",
        type=float,
        default=10.0,
        help="Keyframe extraction rate in frames per second (default: 10.0 = 0.1s per frame)"
    )
    parser.add_argument(
        "--format",
        choices=["png", "bmp", "jpg"],
        default="png",
        help="Output image format for extracted keyframe bitmaps (default: png)"
    )
    parser.add_argument(
        "--out-dir",
        default="data/asl",
        help="Base output directory (default: data/asl)"
    )
    args = parser.parse_args()

    entry_id = parse_sign_from_input(args.sign, args.url)
    sign_meta = find_sign_metadata(entry_id)

    canonical_id = str(sign_meta.get("EntryID", entry_id)).lower()
    sign_dir = Path(args.out_dir) / canonical_id
    sign_dir.mkdir(parents=True, exist_ok=True)

    # Save raw ASL-LEX metadata
    metadata_path = sign_dir / "metadata.json"
    metadata_path.write_text(json.dumps(sign_meta, indent=2) + "\n", encoding="utf-8")

    # Download video
    vimeo_url = sign_meta.get("VimeoVideo")
    if not vimeo_url:
        raise RuntimeError(f"Sign '{canonical_id}' does not have a VimeoVideo URL in ASL-LEX.")

    video_path = sign_dir / f"{canonical_id}.mp4"
    video_info = download_vimeo_mp4(vimeo_url, video_path)

    # Extract keyframes and build CKPE manifest
    frames_dir = sign_dir / "frames"
    ckpe_manifest = extract_keyframes(
        video_path=video_path,
        frames_dir=frames_dir,
        fps=args.fps,
        img_format=args.format,
        sign_meta=sign_meta,
        video_info=video_info
    )

    manifest_path = sign_dir / "keyframes.json"
    manifest_path.write_text(json.dumps(ckpe_manifest, indent=2) + "\n", encoding="utf-8")

    print(f"[4/4] Done! Saved dataset for '{canonical_id}' to {sign_dir}/:")
    print(f"  - Raw ASL-LEX Metadata : {metadata_path}")
    print(f"  - Reference Video      : {video_path} ({video_info.get('width')}x{video_info.get('height')})")
    print(f"  - Extracted Keyframes  : {frames_dir}/ ({ckpe_manifest['extraction']['total_frames']} {args.format} frames @ {args.fps:g} fps)")
    print(f"  - CKPE Target Manifest : {manifest_path} ({len(ckpe_manifest['ckpe_single_step_targets'])} single-step pairs)")


if __name__ == "__main__":
    main()
