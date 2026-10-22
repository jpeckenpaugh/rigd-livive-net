#!/usr/bin/env python3
"""
Deterministic 3D Rig Calibration, Reward Scorer & RL Policy Optimizer for CKPE.

1. Frame-0 Symmetrical Calibration (`calibrate_from_frame0`):
   Uses the resting symmetry of Frame 0 (`frame_0001.png`) to deterministically locate:
     - Centerline X (`cx`)
     - Top of head (`headCrown`)
     - Shoulders (`rightShoulder`, `leftShoulder`, `c7`)
     - Resting Elbows & Forearms (`rightElbow`, `leftElbow`)
   and computes the camera projection mapping `(cx, cy, scale_x, scale_y)` plus the
   calibrated resting rig state (`S_0`) when hands are below the bottom of the viewport.

2. Deterministic Pixel Reward Scorer (`score_rig_state`):
   Given any candidate `rig_state` (`S_t`), projects the 3D skeleton's limb capsules
   into 2D image space and returns a deterministic accuracy score in [0, 1] by measuring:
     - Forearm/wrist capsule overlap with active skin-tone / motion pixels
     - Upper-arm capsule containment within the body/sleeve silhouette (penalizing background bleed)
     - Elbow anchor consistency
     - Temporal smoothness penalty (`||S_t - S_{t-1}||^2`) to prevent "bamfing"

3. RL / Evolution Strategy Policy Trajectory Solver (`solve_trajectory_rl`):
   Optimizes `S_t` across all keyframes by maximizing the deterministic reward function,
   updating `keyframes.json` with `rig_state` + `reward_score` and exporting a playable
   sequence to `3d/data/sequences.json`.

Usage:
  python3 scripts/rig_rl_scorer.py --sign-dir data/asl/one --export-sequence
"""

from __future__ import annotations

import argparse
import glob
import json
import math
import random
import subprocess
from pathlib import Path

DEG = math.pi / 180.0
W_GRID = 160
H_GRID = 120


# ---------------------------------------------------------------------------
# 1. Exact Python port of 3d/js/math3d.js and 3d/js/rig.js Forward Kinematics
# ---------------------------------------------------------------------------

def v3(x: float = 0.0, y: float = 0.0, z: float = 0.0) -> tuple[float, float, float]:
    return (float(x), float(y), float(z))


def v_add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def m3_identity():
    return (1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0)


def m3_mul(A, B):
    return (
        A[0]*B[0] + A[1]*B[3] + A[2]*B[6],
        A[0]*B[1] + A[1]*B[4] + A[2]*B[7],
        A[0]*B[2] + A[1]*B[5] + A[2]*B[8],
        A[3]*B[0] + A[4]*B[3] + A[5]*B[6],
        A[3]*B[1] + A[4]*B[4] + A[5]*B[7],
        A[3]*B[2] + A[4]*B[5] + A[5]*B[8],
        A[6]*B[0] + A[7]*B[3] + A[8]*B[6],
        A[6]*B[1] + A[7]*B[4] + A[8]*B[7],
        A[6]*B[2] + A[7]*B[5] + A[8]*B[8],
    )


def m3_rot_x(a: float):
    c, s = math.cos(a), math.sin(a)
    return (1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c)


def m3_rot_y(a: float):
    c, s = math.cos(a), math.sin(a)
    return (c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c)


def m3_rot_z(a: float):
    c, s = math.cos(a), math.sin(a)
    return (c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0)


def m3_apply(M, v):
    return (
        M[0]*v[0] + M[1]*v[1] + M[2]*v[2],
        M[3]*v[0] + M[4]*v[1] + M[5]*v[2],
        M[6]*v[0] + M[7]*v[1] + M[8]*v[2],
    )


def make_transform(parent, offset, rotation):
    return (
        m3_mul(parent[0], rotation),
        v_add(parent[1], m3_apply(parent[0], offset))
    )


def apply_transform(transform, local):
    return v_add(transform[1], m3_apply(transform[0], local))


class Rig3DPython:
    """Exact Python mirror of 3d/js/rig.js configured from 3d/data/rig-spec.json."""

    def __init__(self, spec_path: str | Path = "3d/data/rig-spec.json"):
        spec = json.loads(Path(spec_path).read_text(encoding="utf-8"))
        self.scale_h = float(spec.get("scaleH", 100.0))
        p = spec["proportions"]
        self.proportions = {
            "pelvisHalfWidth": p["pelvisHalfWidth"] * self.scale_h,
            "torsoLength": p["torsoLength"] * self.scale_h,
            "neckLength": p["neckLength"] * self.scale_h,
            "headLength": p["headLength"] * self.scale_h,
            "shoulderHalfWidth": p["shoulderHalfWidth"] * self.scale_h,
            "upperArmLength": p["upperArmLength"] * self.scale_h,
            "lowerArmLength": p["lowerArmLength"] * self.scale_h,
        }
        self.default_state = {}
        self.limits = {}
        for sec in spec["sections"]:
            for ctrl in sec["controls"]:
                key = ctrl["stateKey"]
                self.default_state[key] = float(ctrl["default"])
                self.limits[key] = (float(ctrl["min"]), float(ctrl["max"]))

    def clamp_state(self, state: dict[str, float]) -> dict[str, float]:
        out = dict(self.default_state)
        for k, v in state.items():
            if k in self.limits:
                lo, hi = self.limits[k]
                out[k] = max(lo, min(hi, float(v)))
        return out

    def compute_skeleton(self, state: dict[str, float]) -> dict:
        p = self.proportions
        s = self.clamp_state(state)
        ident = m3_identity()

        pelvis = v3(0, 0, 0)
        root = (ident, pelvis)
        waist_rot = m3_mul(m3_rot_y(s["pelvisTwist"] * DEG), m3_rot_x(s["pelvisBow"] * DEG))
        waist = make_transform(root, v3(0, 0, 0), waist_rot)

        c7_t = make_transform(waist, v3(0, p["torsoLength"], 0), ident)
        c7 = c7_t[1]

        r_clav_rot = m3_rot_z(-(s["shoulderElevation"] + s["shoulderTilt"]) * DEG)
        l_clav_rot = m3_rot_z((s["shoulderElevation"] - s["shoulderTilt"]) * DEG)
        r_sh_t = make_transform(
            make_transform(c7_t, v3(0, 0, 0), r_clav_rot),
            v3(-p["shoulderHalfWidth"], 0, 0),
            ident
        )
        l_sh_t = make_transform(
            make_transform(c7_t, v3(0, 0, 0), l_clav_rot),
            v3(p["shoulderHalfWidth"], 0, 0),
            ident
        )
        right_shoulder = r_sh_t[1]
        left_shoulder = l_sh_t[1]

        # Right arm chain
        r_upper_t = make_transform(
            r_sh_t,
            v3(0, 0, 0),
            m3_mul(m3_rot_z(s["rightShoulderAngle"] * DEG), m3_rot_x(-s["rightShoulderFlexion"] * DEG))
        )
        r_hum_t = make_transform(r_upper_t, v3(0, 0, 0), m3_rot_y(-s["rightShoulderRotation"] * DEG))
        r_elb_t = make_transform(r_hum_t, v3(0, -p["upperArmLength"], 0), ident)
        right_elbow = r_elb_t[1]
        r_fore_t = make_transform(r_elb_t, v3(0, 0, 0), m3_rot_x(-s["rightElbowBend"] * DEG))
        r_wri_t = make_transform(r_fore_t, v3(0, -p["lowerArmLength"], 0), ident)
        right_wrist = r_wri_t[1]
        # Extended hand tip (approx 0.55 H past wrist along forearm direction for hand/index coverage)
        right_hand_tip = apply_transform(r_fore_t, v3(0, -(p["lowerArmLength"] + 0.55 * self.scale_h), 0))

        # Left arm chain
        l_upper_t = make_transform(
            l_sh_t,
            v3(0, 0, 0),
            m3_mul(m3_rot_z(s["leftShoulderAngle"] * DEG), m3_rot_x(-s["leftShoulderFlexion"] * DEG))
        )
        l_hum_t = make_transform(l_upper_t, v3(0, 0, 0), m3_rot_y(s["leftShoulderRotation"] * DEG))
        l_elb_t = make_transform(l_hum_t, v3(0, -p["upperArmLength"], 0), ident)
        left_elbow = l_elb_t[1]
        l_fore_t = make_transform(l_elb_t, v3(0, 0, 0), m3_rot_x(-s["leftElbowBend"] * DEG))
        l_wri_t = make_transform(l_fore_t, v3(0, -p["lowerArmLength"], 0), ident)
        left_wrist = l_wri_t[1]

        # Neck & Head
        neck_rot = m3_mul(m3_rot_y(s["neckYaw"] * DEG), m3_rot_z(s["neckRoll"] * DEG))
        neck_t = make_transform(c7_t, v3(0, 0, 0), neck_rot)
        c1_t = make_transform(neck_t, v3(0, p["neckLength"], 0), ident)
        c1 = c1_t[1]
        head_t = make_transform(c1_t, v3(0, 0, 0), m3_rot_x(s["headPitch"] * DEG))
        head_crown = apply_transform(head_t, v3(0, p["headLength"], 0))
        head_center = apply_transform(head_t, v3(0, p["headLength"] * 0.5, 0))

        return {
            "pelvis": pelvis,
            "c7": c7,
            "c1": c1,
            "headCrown": head_crown,
            "headCenter": head_center,
            "rightShoulder": right_shoulder,
            "leftShoulder": left_shoulder,
            "rightElbow": right_elbow,
            "leftElbow": left_elbow,
            "rightWrist": right_wrist,
            "leftWrist": left_wrist,
            "rightHandTip": right_hand_tip,
        }


# ---------------------------------------------------------------------------
# 2. Frame Loader & Symmetrical Frame-0 Calibration
# ---------------------------------------------------------------------------

def load_rgb_grid(image_path: str | Path, w: int = W_GRID, h: int = H_GRID) -> list[tuple[int, int, int]]:
    raw = subprocess.check_output([
        "ffmpeg", "-v", "error", "-i", str(image_path),
        "-vf", f"scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"
    ])
    return [(raw[i], raw[i + 1], raw[i + 2]) for i in range(0, len(raw), 3)]


def is_skin_pixel(r: int, g: int, b: int) -> bool:
    """Deterministic warm skin-tone classifier that separates skin from blue backdrop, black shirt, and blonde hair."""
    return r > 125 and g > 80 and b > 60 and (r - g) > 18 and (r - b) > 35


def is_backdrop_pixel(r: int, g: int, b: int) -> bool:
    """Blue studio backdrop classifier."""
    return (b - r) > 16 and b > 70


def is_shirt_pixel(r: int, g: int, b: int) -> bool:
    """Dark torso/sleeve shirt classifier."""
    return r < 70 and g < 70 and b < 80


def calibrate_from_frame0(rig: Rig3DPython, f0_pixels: list[tuple[int, int, int]], w: int = W_GRID, h: int = H_GRID) -> dict:
    """
    Uses the symmetrical resting pose of Frame 0 to find:
      1. Centerline X (from symmetrical foreground + shirt silhouette)
      2. Top of Head Y (crown)
      3. Shoulder line Y and Half-Width X
      4. Resting Elbows & Forearm entry points near the bottom of the viewport
    Returns the camera projection parameters and calibrated resting pose S_0.
    """
    fg_xs = []
    top_head_y = h
    shirt_rows: dict[int, list[int]] = {}
    lower_right_arm_skin = []  # viewer's left (x < w/2) = model's right arm
    lower_left_arm_skin = []   # viewer's right (x >= w/2) = model's left arm

    for y in range(h):
        for x in range(w):
            r, g, b = f0_pixels[y * w + x]
            if not is_backdrop_pixel(r, g, b):
                fg_xs.append(x)
                if y < top_head_y:
                    top_head_y = y
                if is_shirt_pixel(r, g, b):
                    shirt_rows.setdefault(y, []).append(x)

    # Symmetrical centerline X and deltoid profile from upper torso shirt rows
    torso_mid_xs = []
    upper_shirt_spans = {}
    for y in sorted(shirt_rows.keys()):
        xs = shirt_rows[y]
        span = max(xs) - min(xs)
        if y < 95 and span >= 45:
            torso_mid_xs.append(0.5 * (min(xs) + max(xs)))
            upper_shirt_spans[y] = span

    center_x = sum(torso_mid_xs) / len(torso_mid_xs) if torso_mid_xs else (sum(fg_xs) / len(fg_xs))

    # The anatomical shoulder joint line (acromion / clavicle line) is at the top curve of the shoulders
    # where the dark shirt meets the neck slope (around y=56..60 in the 160x120 grid, ~233 px in 480p)
    r_shoulder_top_ys = [y for y, xs in shirt_rows.items() if any(x < center_x - 15 for x in xs)]
    l_shoulder_top_ys = [y for y, xs in shirt_rows.items() if any(x > center_x + 15 for x in xs)]
    r_top = min(r_shoulder_top_ys) if r_shoulder_top_ys else 60.0
    l_top = min(l_shoulder_top_ys) if l_shoulder_top_ys else 56.0
    shoulder_y = 0.5 * (r_top + l_top) + 0.5  # ~58.5 grid px (~234 px in 480p)

    # Skeletal shoulder joint span (acromion to acromion): 190 native px = 47.5 grid px
    skeletal_shoulder_half_px = 23.75

    # Find exposed lower-arm skin on both sides below the chest
    for y in range(int(shoulder_y + 10), h):
        for x in range(w):
            r, g, b = f0_pixels[y * w + x]
            if is_skin_pixel(r, g, b) and abs(x - center_x) > 12:
                if x < center_x:
                    lower_right_arm_skin.append((x, y))
                else:
                    lower_left_arm_skin.append((x, y))

    # Elbow is near the top-outer boundary of the exposed lower-arm skin (just below the dark short sleeve)
    if lower_right_arm_skin and lower_left_arm_skin:
        r_elb_y = min(p[1] for p in lower_right_arm_skin) + 6
        l_elb_y = min(p[1] for p in lower_left_arm_skin) + 6
        elbow_y = 0.5 * (r_elb_y + l_elb_y)
        r_elb_x = min(p[0] for p in lower_right_arm_skin) + 4
        l_elb_x = max(p[0] for p in lower_left_arm_skin) - 4
        elbow_half_px = 0.5 * ((center_x - r_elb_x) + (l_elb_x - center_x))
    else:
        elbow_y = shoulder_y + 38.0
        elbow_half_px = skeletal_shoulder_half_px * 1.05

    # Map rig 3D coordinates (X, Y) -> 2D image coordinates (px, py)
    # The camera sensor has square pixels (1:1 isotropic aspect ratio)
    rig_upper_arm = rig.proportions["upperArmLength"]  # 135.0
    scale_x = skeletal_shoulder_half_px / rig.proportions["shoulderHalfWidth"]
    scale_y = scale_x

    # Calibrate slight resting pose subtleties (shoulder abduction angle so elbow X matches observed elbow_half_px)
    sin_abd = max(-0.5, min(0.5, (skeletal_shoulder_half_px - elbow_half_px) / max(1.0, rig_upper_arm * scale_x)))
    resting_abd_deg = round(math.asin(sin_abd) / DEG, 1)

    calibrated_rest_state = dict(rig.default_state)
    calibrated_rest_state["rightShoulderAngle"] = resting_abd_deg
    calibrated_rest_state["leftShoulderAngle"] = -resting_abd_deg
    calibrated_rest_state["rightShoulderFlexion"] = 6.0
    calibrated_rest_state["leftShoulderFlexion"] = 6.0
    calibrated_rest_state["rightShoulderRotation"] = -60.0
    calibrated_rest_state["leftShoulderRotation"] = -60.0
    calibrated_rest_state["rightElbowBend"] = 40.0
    calibrated_rest_state["leftElbowBend"] = 40.0

    return {
        "grid_width": w,
        "grid_height": h,
        "center_x": round(center_x, 2),
        "top_head_y": round(float(top_head_y), 2),
        "shoulder_y": round(float(shoulder_y), 2),
        "elbow_y": round(float(elbow_y), 2),
        "skeletal_shoulder_half_px": round(skeletal_shoulder_half_px, 2),
        "elbow_half_px": round(elbow_half_px, 2),
        "scale_x": round(scale_x, 4),
        "scale_y": round(scale_y, 4),
        "calibrated_rest_state": calibrated_rest_state,
    }


def project_3d_to_2d(pt3d: tuple[float, float, float], calib: dict, rig: Rig3DPython) -> tuple[float, float]:
    """Projects a 3D rig coordinate into the calibrated 2D frame grid (W_GRID x H_GRID)."""
    c7_y = rig.proportions["torsoLength"]
    px = calib["center_x"] + pt3d[0] * calib["scale_x"]
    py = calib["shoulder_y"] - (pt3d[1] - c7_y) * calib["scale_y"]
    return (px, py)


# ---------------------------------------------------------------------------
# 3. Deterministic Pixel Feature Extraction & Reward Scorer
# ---------------------------------------------------------------------------

def extract_frame_features(
    frame_pixels: list[tuple[int, int, int]],
    f0_pixels: list[tuple[int, int, int]],
    calib: dict,
    w: int = W_GRID,
    h: int = H_GRID
) -> dict:
    """
    Precomputes deterministic pixel masks for a single keyframe:
      - active_arm_skin: (x, y) pixels of the right forearm/hand (either moved skin over torso/bg or resting lower arm)
      - foreground_mask: set of (x, y) non-backdrop pixels (so upper arm is penalized if it leaves the body silhouette)
      - motion_count: number of moved arm pixels relative to Frame 0
    """
    cx = calib["center_x"]
    sh_y = calib["shoulder_y"]
    active_arm_skin: list[tuple[int, int]] = []
    foreground_mask: set[tuple[int, int]] = set()
    moved_skin_count = 0

    for y in range(h):
        for x in range(w):
            r, g, b = frame_pixels[y * w + x]
            if not is_backdrop_pixel(r, g, b):
                foreground_mask.add((x, y))

            # Right arm region (viewer's left side up to sternum: x <= cx + 4)
            if 18 <= y < h and 20 <= x <= int(cx + 4):
                r0, g0, b0 = f0_pixels[y * w + x]
                was_skin_f0 = is_skin_pixel(r0, g0, b0)
                now_skin = is_skin_pixel(r, g, b)
                l1_diff = abs(r - r0) + abs(g - g0) + abs(b - b0)

                if now_skin:
                    if not was_skin_f0 and l1_diff > 35:
                        active_arm_skin.append((x, y))
                        moved_skin_count += 1
                    elif x < (cx - 13) and y >= int(sh_y + 12):
                        # Resting lower-arm skin zone
                        active_arm_skin.append((x, y))

    # Compute deterministic target descriptors from the active skin cloud
    if active_arm_skin:
        ys = sorted(p[1] for p in active_arm_skin)
        # Top of forearm/wrist-hand blob (10th percentile Y) and bottom/elbow blob (90th percentile Y)
        top_y = ys[max(0, int(len(ys) * 0.10))]
        bot_y = ys[min(len(ys) - 1, int(len(ys) * 0.90))]
        top_pts = [p for p in active_arm_skin if abs(p[1] - top_y) <= 5]
        bot_pts = [p for p in active_arm_skin if abs(p[1] - bot_y) <= 5]
        top_x = sum(p[0] for p in top_pts) / len(top_pts)
        bot_x = sum(p[0] for p in bot_pts) / len(bot_pts)
    else:
        top_x, top_y = cx - 22.0, float(h - 10)
        bot_x, bot_y = cx - 26.0, float(h - 4)

    return {
        "active_arm_skin": active_arm_skin,
        "active_arm_skin_set": set(active_arm_skin),
        "foreground_mask": foreground_mask,
        "moved_skin_count": moved_skin_count,
        "skin_top": (top_x, float(top_y)),
        "skin_bot": (bot_x, float(bot_y)),
    }


def sample_segment_points(p_from: tuple[float, float], p_to: tuple[float, float], n: int = 12) -> list[tuple[float, float]]:
    return [
        (p_from[0] + (p_to[0] - p_from[0]) * (i / (n - 1)),
         p_from[1] + (p_to[1] - p_from[1]) * (i / (n - 1)))
        for i in range(n)
    ]


def point_to_segment_dist_sq(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    c1 = vx * wx + vy * wy
    if c1 <= 0:
        return (px - ax) ** 2 + (py - ay) ** 2
    c2 = vx * vx + vy * vy
    if c2 <= c1:
        return (px - bx) ** 2 + (py - by) ** 2
    t = c1 / c2
    proj_x, proj_y = ax + t * vx, ay + t * vy
    return (px - proj_x) ** 2 + (py - proj_y) ** 2


def score_rig_state(
    rig: Rig3DPython,
    state: dict[str, float],
    frame_feat: dict,
    calib: dict,
    prev_state: dict[str, float] | None = None
) -> dict:
    """
    Deterministic reward function R(S_t | I_t, S_{t-1}) in [0, 1].
    Evaluates how well the 3D rig state projects onto the video frame's pixel evidence.
    """
    skel = rig.compute_skeleton(state)

    r_sh = project_3d_to_2d(skel["rightShoulder"], calib, rig)
    r_el = project_3d_to_2d(skel["rightElbow"], calib, rig)
    r_wr = project_3d_to_2d(skel["rightWrist"], calib, rig)
    r_tip = project_3d_to_2d(skel["rightHandTip"], calib, rig)

    skin_pts = frame_feat["active_arm_skin"]
    fg_mask = frame_feat["foreground_mask"]
    skin_top = frame_feat["skin_top"]
    skin_bot = frame_feat["skin_bot"]

    # 1. Forearm + Hand Capsule Coverage Score (how well the forearm segment covers the active skin cloud)
    if skin_pts:
        dists_sq = [
            point_to_segment_dist_sq(px, py, r_el[0], r_el[1], r_tip[0], r_tip[1])
            for (px, py) in skin_pts
        ]
        mean_dist_sq = sum(dists_sq) / len(dists_sq)
        capsule_coverage_score = math.exp(-mean_dist_sq / (9.5 ** 2))
    else:
        capsule_coverage_score = 1.0

    # 2. Endpoint Alignment Score (elbow -> skin_bot, wrist/hand tip -> skin_top)
    is_resting_frame = frame_feat["moved_skin_count"] < 35 and frame_feat.get("phase") != "retract"
    if is_resting_frame:
        rest_s = calib["calibrated_rest_state"]
        rest_diff_sq = sum(
            ((state.get(k, 0.0) - rest_s[k]) / 25.0) ** 2
            for k in ("rightShoulderAngle", "rightShoulderFlexion", "rightShoulderRotation", "rightElbowBend")
        )
        endpoint_score = math.exp(-0.5 * rest_diff_sq)
    else:
        # Match r_el to skin_bot and r_tip/r_wr midpoint to skin_top
        hand_center = (0.45 * r_wr[0] + 0.55 * r_tip[0], 0.45 * r_wr[1] + 0.55 * r_tip[1])
        d_top_sq = (hand_center[0] - skin_top[0]) ** 2 + (hand_center[1] - skin_top[1]) ** 2
        d_bot_sq = (r_el[0] - skin_bot[0]) ** 2 + (r_el[1] - skin_bot[1]) ** 2
        endpoint_score = 0.60 * math.exp(-d_top_sq / (10.0 ** 2)) + 0.40 * math.exp(-d_bot_sq / (10.0 ** 2))

    # 3. Upper-Arm Foreground Silhouette Containment (penalize elbow/upper arm sticking out into blue backdrop)
    upper_samples = sample_segment_points(r_sh, r_el, n=10)
    inside_fg = 0
    for (sx, sy) in upper_samples:
        ix = max(0, min(W_GRID - 1, int(round(sx))))
        iy = max(0, min(H_GRID - 1, int(round(sy))))
        if (ix, iy) in fg_mask:
            inside_fg += 1
    silhouette_score = inside_fg / len(upper_samples)

    # 4. Biomechanical Prior & Temporal Smoothness (anti-bamfing penalty from ckpe.md)
    smooth_score = 1.0
    if prev_state is not None:
        max_step_deg = 35.0
        vel_penalty = 0.0
        for k in ("rightShoulderAngle", "rightShoulderFlexion", "rightShoulderRotation", "rightElbowBend"):
            delta = abs(state.get(k, 0.0) - prev_state.get(k, 0.0))
            if delta > max_step_deg:
                vel_penalty += ((delta - max_step_deg) / 25.0) ** 2
        smooth_score = math.exp(-vel_penalty)

    total_reward = (
        0.40 * capsule_coverage_score
        + 0.40 * endpoint_score
        + 0.12 * silhouette_score
        + 0.08 * smooth_score
    )

    return {
        "total_reward": round(total_reward, 4),
        "capsule_coverage": round(capsule_coverage_score, 4),
        "endpoint_alignment": round(endpoint_score, 4),
        "silhouette_containment": round(silhouette_score, 4),
        "temporal_smoothness": round(smooth_score, 4),
        "projected_2d": {
            "rightShoulder": [round(r_sh[0], 1), round(r_sh[1], 1)],
            "rightElbow": [round(r_el[0], 1), round(r_el[1], 1)],
            "rightWrist": [round(r_wr[0], 1), round(r_wr[1], 1)],
            "rightHandTip": [round(r_tip[0], 1), round(r_tip[1], 1)],
        }
    }


# ---------------------------------------------------------------------------
# 4. RL / Cross-Entropy Evolution Strategy Policy Optimizer
# ---------------------------------------------------------------------------

ACTIVE_DOFS = [
    "rightShoulderAngle",
    "rightShoulderFlexion",
    "rightShoulderRotation",
    "rightElbowBend",
]


def optimize_frame_rl(
    rig: Rig3DPython,
    frame_feat: dict,
    calib: dict,
    init_state: dict[str, float],
    prev_state: dict[str, float] | None,
    rng: random.Random,
    iterations: int = 18,
    pop_size: int = 64,
    elite_frac: float = 0.20,
) -> tuple[dict[str, float], dict]:
    """
    Uses Cross-Entropy Method / Evolution Strategies (RL policy search over Gaussian action distributions)
    to find the joint angles S_t that maximize the deterministic reward score.
    """
    mean = {k: float(init_state[k]) for k in ACTIVE_DOFS}
    std = {
        "rightShoulderAngle": 18.0,
        "rightShoulderFlexion": 25.0,
        "rightShoulderRotation": 25.0,
        "rightElbowBend": 25.0,
    }
    n_elite = max(4, int(pop_size * elite_frac))

    best_state = rig.clamp_state(init_state)
    best_eval = score_rig_state(rig, best_state, frame_feat, calib, prev_state)

    # Also seed population with canonical exploring candidates (resting pose + high-flexion stroke pose)
    seed_poses = [
        dict(init_state),
        dict(calib["calibrated_rest_state"]),
        {
            **calib["calibrated_rest_state"],
            "rightShoulderAngle": -10.0,
            "rightShoulderFlexion": 25.0,
            "rightShoulderRotation": -35.0,
            "rightElbowBend": 125.0,
        },
    ]

    for it in range(iterations):
        candidates = []
        if it == 0:
            for sp in seed_poses:
                clamped = rig.clamp_state(sp)
                ev = score_rig_state(rig, clamped, frame_feat, calib, prev_state)
                candidates.append((ev["total_reward"], clamped, ev))

        for _ in range(pop_size):
            sample = dict(calib["calibrated_rest_state"])
            for k in ACTIVE_DOFS:
                sample[k] = rng.gauss(mean[k], std[k])
            clamped = rig.clamp_state(sample)
            ev = score_rig_state(rig, clamped, frame_feat, calib, prev_state)
            candidates.append((ev["total_reward"], clamped, ev))

        candidates.sort(key=lambda item: item[0], reverse=True)
        if candidates[0][0] > best_eval["total_reward"]:
            best_state = candidates[0][1]
            best_eval = candidates[0][2]

        elites = candidates[:n_elite]
        for k in ACTIVE_DOFS:
            new_mean = sum(item[1][k] for item in elites) / n_elite
            new_var = sum((item[1][k] - new_mean) ** 2 for item in elites) / n_elite
            mean[k] = new_mean
            std[k] = max(1.2, math.sqrt(new_var) * 0.85)

    # Round final angles to 1 decimal place
    final_state = {k: round(v, 1) for k, v in best_state.items()}
    final_eval = score_rig_state(rig, final_state, frame_feat, calib, prev_state)
    return final_state, final_eval


def main():
    parser = argparse.ArgumentParser(description="Deterministic RL Rig Scorer & Keyframe Solver")
    parser.add_argument("--sign-dir", default="data/asl/one", help="Path to prepared ASL sign folder")
    parser.add_argument("--export-sequence", action="store_true", help="Export learned sequence to 3d/data/sequences.json")
    args = parser.parse_args()

    sign_dir = Path(args.sign_dir)
    manifest_path = sign_dir / "keyframes.json"
    if not manifest_path.exists():
        raise FileNotFoundError(f"Missing {manifest_path}. Run scripts/prepare_asl_sign.py first.")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    rig = Rig3DPython("3d/data/rig-spec.json")

    frame_entries = manifest["frames"]
    frame_grids = [load_rgb_grid(sign_dir / f["file"]) for f in frame_entries]

    # Step 1: Calibrate camera & resting pose from Frame 0 symmetry
    calib = calibrate_from_frame0(rig, frame_grids[0])
    print(f"[1/3] Frame-0 Symmetrical Calibration ({W_GRID}x{H_GRID} grid):")
    print(f"      Centerline X = {calib['center_x']} px | Crown Y = {calib['top_head_y']} px | Shoulder Y = {calib['shoulder_y']} px | Elbow Y = {calib['elbow_y']} px")
    print(f"      Scale = ({calib['scale_x']}, {calib['scale_y']}) px/unit | Resting Abduction = {calib['calibrated_rest_state']['rightShoulderAngle']}°")

    # Step 2: Optimize each keyframe via RL Policy Search against the deterministic reward
    print(f"[2/3] Running RL Policy Search across {len(frame_entries)} keyframes...")
    rng = random.Random(42)
    prev_state = calib["calibrated_rest_state"]
    solved_states = []

    for idx, (f_entry, grid) in enumerate(zip(frame_entries, frame_grids)):
        feat = extract_frame_features(grid, frame_grids[0], calib)
        feat["phase"] = f_entry.get("phase")
        if idx == 0 or idx == len(frame_entries) - 1:
            # Known bounds prior from ckpe.md: gesture begins and ends at calibrated resting stance
            best_state = dict(calib["calibrated_rest_state"])
            best_eval = score_rig_state(rig, best_state, feat, calib, prev_state)
        else:
            # During retraction, if the arm moves below the chest, guide it steadily back to resting pose
            if f_entry.get("phase") == "retract":
                t_retract = (idx - 32) / max(1, len(frame_entries) - 1 - 32)
                target_rest = calib["calibrated_rest_state"]
                # Interpolate anchor prior toward resting pose
                interp_prior = {
                    k: (1.0 - t_retract) * prev_state[k] + t_retract * target_rest[k]
                    for k in ACTIVE_DOFS
                }
                best_state, best_eval = optimize_frame_rl(
                    rig=rig,
                    frame_feat=feat,
                    calib=calib,
                    init_state=interp_prior,
                    prev_state=prev_state,
                    rng=rng,
                )
            else:
                best_state, best_eval = optimize_frame_rl(
                    rig=rig,
                    frame_feat=feat,
                    calib=calib,
                    init_state=prev_state,
                    prev_state=prev_state,
                    rng=rng,
                )

        f_entry["rig_state"] = best_state
        f_entry["reward"] = best_eval
        solved_states.append(best_state)
        prev_state = best_state

        print(
            f"      Frame {idx+1:2d} ({f_entry['timestamp_ms']:4d}ms, {f_entry['phase']:7s}): "
            f"reward={best_eval['total_reward']:.3f} | "
            f"R.Shoulder=({best_state['rightShoulderAngle']:5.1f}°, {best_state['rightShoulderFlexion']:5.1f}°, {best_state['rightShoulderRotation']:6.1f}°) "
            f"R.Elbow={best_state['rightElbowBend']:5.1f}°"
        )

    # Update single-step target pairs with the solved states
    for step in manifest.get("ckpe_single_step_targets", []):
        i_prev = step["t_minus_1"]["frame_index"]
        i_curr = step["t"]["frame_index"]
        step["t_minus_1"]["rig_state_S_t_minus_1"] = solved_states[i_prev]
        step["t"]["target_rig_state_S_t"] = solved_states[i_curr]
        step["t"]["reward_score"] = frame_entries[i_curr]["reward"]["total_reward"]

    manifest["calibration"] = calib
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"[3/3] Updated {manifest_path} with calibration, per-frame rig_state, and deterministic reward scores.")

    if args.export_sequence:
        seq_path = Path("3d/data/sequences.json")
        seq_data = json.loads(seq_path.read_text(encoding="utf-8"))
        sign_name = manifest.get("sign", "one")
        seq_id = f"asl-{sign_name}"
        seq_label = f"ASL: {sign_name.capitalize()}"
        duration_ms = int(round((len(frame_entries) - 1) * manifest["extraction"]["interval_s"] * 1000))

        tracks = []
        for dof in ACTIVE_DOFS:
            kfs = []
            for idx, st in enumerate(solved_states):
                t_norm = round(idx / max(1, len(solved_states) - 1), 4)
                kfs.append({"t": t_norm, "value": st[dof]})
            tracks.append({
                "stateKey": dof,
                "type": "keyframes",
                "keyframes": kfs,
            })

        new_seq = {
            "id": seq_id,
            "label": seq_label,
            "duration": duration_ms,
            "tracks": tracks,
        }

        existing = [s for s in seq_data["sequences"] if s.get("id") != seq_id]
        existing.append(new_seq)
        seq_data["sequences"] = existing
        seq_path.write_text(json.dumps(seq_data, indent=2) + "\n", encoding="utf-8")
        print(f"      Exported playable sequence '{seq_label}' ({duration_ms}ms) to {seq_path}")


if __name__ == "__main__":
    main()
