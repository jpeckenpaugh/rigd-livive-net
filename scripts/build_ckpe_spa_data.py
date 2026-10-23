#!/usr/bin/env python3
"""
CKPE SPA Data Compiler
Processes all 100 ASL signs from data/asl/ and authored sequences from 3d/data/sequences.json,
generating:
- ckpe-livive-net/data/index.json (lightweight catalog of ~109 terms)
- ckpe-livive-net/data/terms/<term>.json (per-term frame data with DIS rig_state, phase, reward)
- ckpe-livive-net/data/thumbs/<term>.jpg (240px optimized thumbnail for fast mobile grid)
- ckpe-livive-net/data/videos/<term>.mp4 (compressed sample video for front-view overlay)
"""

import os
import sys
import glob
import json
import math
import shutil
import subprocess
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_ASL = BASE_DIR / "data" / "asl"
OUT_DIR = BASE_DIR / "ckpe-livive-net" / "data"
TERMS_DIR = OUT_DIR / "terms"
THUMBS_DIR = OUT_DIR / "thumbs"
VIDEOS_DIR = OUT_DIR / "videos"

OUT_DIR.mkdir(parents=True, exist_ok=True)
TERMS_DIR.mkdir(parents=True, exist_ok=True)
THUMBS_DIR.mkdir(parents=True, exist_ok=True)
VIDEOS_DIR.mkdir(parents=True, exist_ok=True)

# 1. Load rig default state from rig-spec.json
with open(BASE_DIR / "3d" / "data" / "rig-spec.json", "r") as f:
    rig_spec = json.load(f)

default_rig_state = {}
for sec in rig_spec.get("sections", []):
    for ctrl in sec.get("controls", []):
        default_rig_state[ctrl["stateKey"]] = ctrl["default"]


def process_learned_sign(sign_dir: Path):
    kf_path = sign_dir / "keyframes.json"
    if not kf_path.exists():
        return None

    with open(kf_path, "r") as f:
        kf = json.load(f)

    term = kf.get("sign", sign_dir.name)
    label = term.replace("_", " ").title()
    phonology = kf.get("phonology_level1_and_2", {})
    sign_type = phonology.get("sign_type", "OneHanded")
    major_loc = phonology.get("major_location", "Neutral")
    minor_loc = phonology.get("minor_location", "")
    movement = phonology.get("movement", "Unspecified")
    handshape = phonology.get("handshape", "")

    # Video & Thumbnails
    mp4_files = list(sign_dir.glob("*.mp4"))
    video_filename = f"{term}.mp4"
    if mp4_files:
        src_mp4 = mp4_files[0]
        dst_mp4 = VIDEOS_DIR / video_filename
        if not dst_mp4.exists() or dst_mp4.stat().st_size != src_mp4.stat().st_size:
            shutil.copy2(src_mp4, dst_mp4)

    # Thumbnail generation from frame 1
    thumb_filename = f"{term}.jpg"
    dst_thumb = THUMBS_DIR / thumb_filename
    frame_files = sorted((sign_dir / "frames").glob("*.png"))
    if frame_files and not dst_thumb.exists():
        first_frame = frame_files[0]
        subprocess.run(
            ["sips", "-Z", "240", "-s", "format", "jpeg", "-s", "formatOptions", "75", str(first_frame), "--out", str(dst_thumb)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )

    # Process frames
    raw_frames = kf.get("frames", [])
    processed_frames = []
    rewards = []
    phase_counts = {"prep": 0, "stroke": 0, "retract": 0}

    for idx, rf in enumerate(raw_frames):
        phase = rf.get("phase", "stroke").lower()
        if phase not in phase_counts:
            phase = "stroke"
        phase_counts[phase] += 1

        reward_data = rf.get("reward", {})
        if isinstance(reward_data, dict):
            tot_rew = float(reward_data.get("total_reward", 0.0))
            details = {
                "capsule_coverage": round(reward_data.get("capsule_coverage", 0.0), 3),
                "silhouette_containment": round(reward_data.get("silhouette_containment", 0.0), 3),
                "temporal_smoothness": round(reward_data.get("temporal_smoothness", 1.0), 3)
            }
            proj_2d = reward_data.get("projected_2d", {})
            right_hand_tip = proj_2d.get("rightHandTip", None)
        else:
            tot_rew = float(reward_data) if reward_data else 0.0
            details = {}
            right_hand_tip = None

        rewards.append(tot_rew)
        ts_ms = rf.get("timestamp_ms", int(idx * 33.33))
        ts_s = rf.get("timestamp_s", round(ts_ms / 1000.0, 3))

        processed_frames.append({
            "frame_index": idx,
            "timestamp_ms": ts_ms,
            "timestamp_s": ts_s,
            "phase": phase,
            "rig_state": rf.get("rig_state", default_rig_state),
            "reward": round(tot_rew, 4),
            "reward_details": details,
            "rightHandTip": right_hand_tip
        })

    mean_reward = round(sum(rewards) / max(len(rewards), 1), 4)
    duration_ms = kf.get("timing_ms", {}).get("clip_duration_ms", int(len(raw_frames) * 33.33))

    term_payload = {
        "term": term,
        "label": label,
        "source": "learned",
        "sign_type": sign_type,
        "location": {
            "major": major_loc,
            "minor": minor_loc
        },
        "movement": movement,
        "handshape": handshape,
        "code": kf.get("code", ""),
        "source_url": kf.get("source_url", f"https://asl-lex.org/visualization/?sign={term}"),
        "calibration": kf.get("calibration", {}),
        "mean_reward": mean_reward,
        "frame_count": len(processed_frames),
        "duration_ms": duration_ms,
        "phase_split": phase_counts,
        "video": f"data/videos/{video_filename}",
        "thumbnail": f"data/thumbs/{thumb_filename}",
        "frames": processed_frames
    }

    # Write term JSON
    with open(TERMS_DIR / f"{term}.json", "w", encoding="utf-8") as f:
        json.dump(term_payload, f, separators=(",", ":"))

    index_entry = {
        "term": term,
        "label": label,
        "source": "learned",
        "sign_type": sign_type,
        "location": {
            "major": major_loc,
            "minor": minor_loc
        },
        "movement": movement,
        "handshape": handshape,
        "mean_reward": mean_reward,
        "frame_count": len(processed_frames),
        "duration_ms": duration_ms,
        "thumbnail": f"data/thumbs/{thumb_filename}"
    }

    return index_entry


def generate_compound_chain(chain_id, label, spec_text, steps, default_rig_state):
    """
    Generates a smoothly interpolated compound gesture sequence from a list of steps.
    Each step can be a single action id or a list of simultaneous action ids.
    """
    actions_db = {
        "reset": {"type": "tween", "targets": dict(default_rig_state)},
        "point-you": {"type": "tween", "targets": {"rightShoulderFlexion": 60, "rightShoulderRotation": 0, "rightShoulderAngle": -2, "rightElbowBend": 40}},
        "point-me": {"type": "tween", "targets": {"rightShoulderAngle": 20, "rightShoulderFlexion": 60, "rightShoulderRotation": -110, "rightElbowBend": 130}},
        "point-right": {"type": "tween", "targets": {"rightShoulderAngle": -60, "rightShoulderFlexion": 0, "rightShoulderRotation": 70, "rightElbowBend": 50}},
        "point-left": {"type": "tween", "targets": {"rightShoulderAngle": 45, "rightShoulderFlexion": 45, "rightShoulderRotation": -90, "rightElbowBend": 50}},
        "point-it": {"type": "tween", "targets": {"rightShoulderFlexion": 60, "rightShoulderRotation": 50, "rightShoulderAngle": -2, "rightElbowBend": 40}},
        "hands-up": {"type": "tween", "targets": {"shoulderElevation": 10, "rightShoulderAngle": 8, "rightShoulderFlexion": 150, "rightShoulderRotation": -60, "leftShoulderAngle": -8, "leftShoulderFlexion": 150, "leftShoulderRotation": -60, "rightElbowBend": 20, "leftElbowBend": 20}},
        "hats-off": {"type": "tween", "targets": {"rightShoulderAngle": -15, "rightShoulderFlexion": 115, "rightShoulderRotation": 30, "rightElbowBend": 110}},
        "agree": {"type": "sine", "stateKey": "headPitch", "amplitude": 20, "cycles": 2},
        "disagree": {"type": "sine", "stateKey": "neckYaw", "amplitude": 40, "cycles": 2}
    }

    frames = []
    current_state = dict(default_rig_state)
    fps = 30
    step_duration_s = 0.8
    frames_per_step = int(fps * step_duration_s)
    total_duration_ms = int(len(steps) * step_duration_s * 1000)

    for step_idx, step in enumerate(steps):
        step_actions = step if isinstance(step, list) else [step]
        start_state = dict(current_state)

        # Collect tweens and sines for this step
        step_targets = {}
        step_sines = []

        for act in step_actions:
            def_act = actions_db.get(act, {})
            if def_act.get("type") == "tween":
                step_targets.update(def_act.get("targets", {}))
            elif def_act.get("type") == "sine":
                step_sines.append(def_act)

        for f_idx in range(frames_per_step):
            global_frame_idx = len(frames)
            t_norm = f_idx / max(frames_per_step - 1, 1)
            ts_ms = int((global_frame_idx / (len(steps) * frames_per_step)) * total_duration_ms)
            ts_s = round(ts_ms / 1000.0, 3)

            # Ease-in-out cosine
            ease = 0.5 - 0.5 * math.cos(t_norm * math.pi)

            frame_state = dict(start_state)
            for k, tgt_val in step_targets.items():
                s_val = start_state.get(k, default_rig_state.get(k, 0))
                frame_state[k] = round(s_val + (tgt_val - s_val) * ease, 2)

            for sine in step_sines:
                k = sine["stateKey"]
                amp = sine["amplitude"]
                cycles = sine["cycles"]
                frame_state[k] = round(amp * math.sin(t_norm * math.pi * 2 * cycles), 2)

            # Phase tagging
            progress_ratio = global_frame_idx / max((len(steps) * frames_per_step) - 1, 1)
            if progress_ratio < 0.25:
                phase = "prep"
            elif progress_ratio < 0.75:
                phase = "stroke"
            else:
                phase = "retract"

            frames.append({
                "frame_index": global_frame_idx,
                "timestamp_ms": ts_ms,
                "timestamp_s": ts_s,
                "phase": phase,
                "rig_state": frame_state,
                "reward": 1.0,
                "reward_details": {"authoring_fidelity": 1.0},
                "rightHandTip": None
            })

            current_state = frame_state

    phase_counts = {"prep": 0, "stroke": 0, "retract": 0}
    for f in frames:
        phase_counts[f["phase"]] += 1

    term_payload = {
        "term": chain_id,
        "label": label,
        "source": "authored",
        "sign_type": "CompoundGesture",
        "location": {"major": "Neutral", "minor": "Dynamic Space"},
        "movement": "Compound Chained Sequence",
        "handshape": "Authored",
        "authored_spec": spec_text,
        "code": "AUTH-" + chain_id.upper(),
        "source_url": "",
        "calibration": None,
        "mean_reward": None,
        "frame_count": len(frames),
        "duration_ms": total_duration_ms,
        "phase_split": phase_counts,
        "video": None,
        "thumbnail": None,
        "frames": frames
    }

    with open(TERMS_DIR / f"{chain_id}.json", "w", encoding="utf-8") as f:
        json.dump(term_payload, f, separators=(",", ":"))

    return {
        "term": chain_id,
        "label": label,
        "source": "authored",
        "sign_type": "CompoundGesture",
        "location": {"major": "Neutral", "minor": "Dynamic Space"},
        "movement": "Compound Chained Sequence",
        "handshape": "Authored",
        "mean_reward": None,
        "frame_count": len(frames),
        "duration_ms": total_duration_ms,
        "thumbnail": None
    }


def process_authored_sequences():
    with open(BASE_DIR / "3d" / "data" / "sequences.json", "r") as f:
        seq_data = json.load(f)

    target_ids = ["agree", "disagree", "hands-up", "hats-off", "point-it", "point-left", "point-me", "point-right", "point-you"]
    authored_entries = []

    spec_descriptions = {
        "agree": "Rhythmic vertical nod: head pitch sinusoidal oscillation ±20° at 2 cycles.",
        "disagree": "Rhythmic horizontal head shake: neck yaw sinusoidal oscillation ±40° at 2 cycles.",
        "hands-up": "Overhead reach: bilateral shoulder elevation +10°, forward flexion 150°, elbow flexion 20°.",
        "hats-off": "Salute and hat brim tipping: right shoulder flexion 115°, right humeral rotation 30°.",
        "point-you": "Direct forward index point: right shoulder forward flexion 60°, humeral rotation 0°.",
        "point-it": "Forward and lateral object pointing: right shoulder flexion 60°, humeral rotation 50°.",
        "point-right": "Lateral pointing: right shoulder abduction -60°, humeral rotation 70°, elbow flexion 50°.",
        "point-left": "Cross-body pointing: right shoulder adduction +20°, flexion 45°, internal rotation -90°.",
        "point-me": "Deictic self-point: right shoulder flexion 60°, humeral rotation -110°, elbow flexion 130°."
    }

    for s in seq_data.get("sequences", []):
        sid = s.get("id")
        if sid not in target_ids:
            continue

        label = s.get("label", sid.title())
        duration = s.get("duration", 1000)
        tracks = s.get("tracks", [])
        num_frames = 30  # 30 fps over 1 second

        frames = []
        for i in range(num_frames):
            t_norm = i / max(num_frames - 1, 1)
            ts_ms = int(t_norm * duration)
            ts_s = round(ts_ms / 1000.0, 3)

            # Determine phase
            if t_norm < 0.35:
                phase = "prep"
            elif t_norm < 0.70:
                phase = "stroke"
            else:
                phase = "retract"

            # Interpolate state
            current_state = dict(default_rig_state)
            for trk in tracks:
                k = trk.get("stateKey")
                ttype = trk.get("type")
                if ttype == "tween":
                    target = trk.get("target", default_rig_state.get(k, 0))
                    ease = 0.5 - 0.5 * math.cos(t_norm * math.pi)
                    start_val = default_rig_state.get(k, 0)
                    current_state[k] = round(start_val + (target - start_val) * ease, 2)
                elif ttype == "sine":
                    amp = trk.get("amplitude", 20)
                    cycles = trk.get("cycles", 2)
                    current_state[k] = round(amp * math.sin(t_norm * math.pi * 2 * cycles), 2)

            frames.append({
                "frame_index": i,
                "timestamp_ms": ts_ms,
                "timestamp_s": ts_s,
                "phase": phase,
                "rig_state": current_state,
                "reward": 1.0,
                "reward_details": {"authoring_fidelity": 1.0},
                "rightHandTip": None
            })

        term_payload = {
            "term": sid,
            "label": label,
            "source": "authored",
            "sign_type": "AuthoredGesture",
            "location": {
                "major": "Neutral" if "point" in sid else "Head",
                "minor": "Space"
            },
            "movement": "Kinematic Specification",
            "handshape": "Authored",
            "authored_spec": spec_descriptions.get(sid, "Authored upper-body kinematic sequence."),
            "code": "AUTH-" + sid.upper(),
            "source_url": "",
            "calibration": None,
            "mean_reward": None,
            "frame_count": len(frames),
            "duration_ms": duration,
            "phase_split": {"prep": 11, "stroke": 10, "retract": 9},
            "video": None,
            "thumbnail": None,
            "frames": frames
        }

        with open(TERMS_DIR / f"{sid}.json", "w", encoding="utf-8") as f:
            json.dump(term_payload, f, separators=(",", ":"))

        authored_entries.append({
            "term": sid,
            "label": label,
            "source": "authored",
            "sign_type": "AuthoredGesture",
            "location": {
                "major": "Neutral" if "point" in sid else "Head",
                "minor": "Space"
            },
            "movement": "Kinematic Specification",
            "handshape": "Authored",
            "mean_reward": None,
            "frame_count": len(frames),
            "duration_ms": duration,
            "thumbnail": None
        })

    # Add Compound Chained Sequences
    compound_1 = generate_compound_chain(
        "we-go-right",
        "We Go Right",
        "Compound Gesture: Reset → Point You → Point Me → Point Right → Agree (Yes).",
        ["reset", "point-you", "point-me", "point-right", "agree"],
        default_rig_state
    )
    authored_entries.append(compound_1)

    compound_2 = generate_compound_chain(
        "we-dont-go-left",
        "We Don't Go Left",
        "Compound Gesture: Reset → Point You → Point Me → [Point Left + Disagree (No)].",
        ["reset", "point-you", "point-me", ["point-left", "disagree"]],
        default_rig_state
    )
    authored_entries.append(compound_2)

    return authored_entries


def main():
    print("Building CKPE SPA dataset...")
    sign_dirs = sorted(DATA_ASL.glob("*/"))
    print(f"Processing {len(sign_dirs)} ASL sign directories...")

    index_entries = []
    for d in sign_dirs:
        entry = process_learned_sign(d)
        if entry:
            index_entries.append(entry)

    print(f"Processed {len(index_entries)} learned signs.")

    authored_entries = process_authored_sequences()
    print(f"Processed {len(authored_entries)} authored gestures.")

    all_index = index_entries + authored_entries
    # Sort index alphabetically by label
    all_index.sort(key=lambda x: x["label"].lower())

    with open(OUT_DIR / "index.json", "w", encoding="utf-8") as f:
        json.dump(all_index, f, indent=2)

    print(f"Successfully compiled index.json with {len(all_index)} total terms.")
    print("Done!")


if __name__ == "__main__":
    main()
