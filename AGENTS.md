# AGENTS.md

Guidelines and technical reference for AI coding agents working on `rigd-livive-net`.

## Project Overview

`rigd-livive-net` (deployed to `https://rigd.livive.net/`) is a zero-dependency, browser-based prototype of an articulated upper-body skeletal rig built with vanilla HTML, CSS, ES Modules, and the Canvas 2D API. It serves as the Level 1 kinematic foundation for the **Constrained Kinematic Pose Estimator (CKPE)** described in `ckpe.md`.

- **No build step or external dependencies:** Keep everything plain HTML, CSS, native ES Modules, and JSON.
- **Anatomical perspective:** Left/right always refer to the **model's** anatomical left and right (in the Front view, the model's right arm is on the viewer's left at `-X`, and the model's left arm is on the viewer's right at `+X`).
- **Right-handed pointing convention:** Single-arm pointing and gesture sequences (`Point You`, `Point It`, `Point Right`, `Point Left`, `Point Me`, `Hats Off`) use the **right arm** unless a sequence explicitly involves both arms (e.g., `Hands Up`).

## Repository Structure

- `index.html` — Landing page linking to `2.5d.html` and `3d/`.
- `2.5d.html` — Preserved standalone 2.5D front-view prototype. Do not break or remove unless explicitly asked.
- `3d.html` — Redirect stub forwarding to `3d/`.
- `ckpe.md` — Architectural specification for the Constrained Kinematic Pose Estimator ML pipeline.
- `scripts/prepare_asl_sign.py` — CLI utility that downloads ASL-LEX 2.0 sign metadata (`metadata.json`), reference video (`<sign>.mp4`), `10 fps` keyframe bitmaps (`frames/frame_*.png`), and a CKPE single-step transition manifest (`keyframes.json`) into `data/asl/<sign>/`.
- `data/asl/<sign>/` — Prepared ASL sign datasets (e.g., `data/asl/one/`).
- `3d/` — Modular 3D spatial rig application:
  - `3d/index.html` — HTML shell and DOM mount points.
  - `3d/style.css` — Styles for layout, sidebar, joint cards, and mobile breakpoints.
  - `3d/data/rig-spec.json` — Single source of truth for proportions (in head units `H`), palette colors, symmetry pairs, joint sections, joint limits, default pose values, and slider metadata.
  - `3d/data/sequences.json` — Declarative preset animations loaded into the Sequence dropdown.
  - `3d/js/math3d.js` — Pure 3D vector (`v3`) and 3×3 rotation matrix (`M3`) helpers.
  - `3d/js/rig.js` — `JointDefinition`, `Rig3D` state management, and `computeSkeleton()` forward kinematics.
  - `3d/js/renderer.js` — Camera definitions (`FRONT`, `SIDE`, `TOP`, `3D` isometric) and 4-viewport Canvas 2D projection/drawing.
  - `3d/js/animator.js` — `RigAnimator` managing mutually exclusive RAF loops (Auto Explore, Symmetrical/Asymmetrical pair tweens, 1-second Reset Pose tween, and preset Sequence playback).
  - `3d/js/ui.js` — `RigUI` data-driven sidebar generator and event bindings.
  - `3d/js/main.js` — Entry point that fetches `rig-spec.json` and `sequences.json`.

## UI & Coding Rules

1. **Alphabetized Sequences Dropdown:**
   - `RigUI.buildSequenceDropdown()` in `3d/js/ui.js` must always sort sequences alphabetically by `label` (`localeCompare` case-insensitive).
2. **Data-Driven Joint Controls:**
   - Do not hardcode joint slider HTML in `3d/index.html`. Add or modify joint degrees of freedom, limits, or defaults in `3d/data/rig-spec.json`.
3. **Animation Mutual Exclusion:**
   - Manual slider input, Auto Explore, Symmetry/Asymmetry tweens, Reset Pose, and preset Sequences must cleanly cancel conflicting RAF loops via `RigAnimator`.

## Reference: Joint `stateKey` Dictionary (`3d/data/rig-spec.json`)

When authoring or debugging sequences in `3d/data/sequences.json`, always use the exact `stateKey` (not the `jointId` or section `id`):

| Section `id` | `stateKey` | Description | Range (`min` .. `max`) | Default |
| :--- | :--- | :--- | :--- | :--- |
| `head` | `headPitch` | Skull Base (C1) Pitch / Nod | `-45` .. `50` | `0` |
| `jaw` | `jawOpen` | Jaw (Mandible) Mouth Open | `0` .. `35` | `0` |
| `neck` | `neckRoll` | Neck Base (C7) Roll / Tilt | `-40` .. `40` | `0` |
| `neck` | `neckYaw` | Neck Base (C7) Yaw / Turn | `-70` .. `70` | `0` |
| `shoulderGirdle` | `shoulderElevation` | Shoulder Girdle Elevation (Both) | `-10` .. `25` | `0` |
| `shoulderGirdle` | `shoulderTilt` | Shoulder Girdle Tilt (R Up / L Down) | `-15` .. `15` | `0` |
| `rightShoulder` | `rightShoulderAngle` | Right Abduction (−) / Adduction (+) | `-120` .. `45` | `8` |
| `rightShoulder` | `rightShoulderFlexion` | Right Forward Flexion | `0` .. `180` | `6` |
| `rightShoulder` | `rightShoulderRotation` | Right Humeral Rotation (internal − / external +) | `-135` .. `90` | `-60` |
| `leftShoulder` | `leftShoulderAngle` | Left Adduction (−) / Abduction (+) | `-45` .. `120` | `-8` |
| `leftShoulder` | `leftShoulderFlexion` | Left Forward Flexion | `0` .. `180` | `6` |
| `leftShoulder` | `leftShoulderRotation` | Left Humeral Rotation (internal − / external +) | `-135` .. `90` | `-60` |
| `rightElbow` | `rightElbowBend` | Right Elbow Flexion | `0` .. `140` | `40` |
| `leftElbow` | `leftElbowBend` | Left Elbow Flexion | `0` .. `140` | `40` |
| `pelvis` | `pelvisTwist` | Pelvis Twist (Body Turn) | `-45` .. `45` | `0` |
| `pelvis` | `pelvisBow` | Pelvis Bow (Forward / Back) | `-20` .. `40` | `0` |

*Note on Humeral Rotation:* Because the upper arm and forearm are 1D segments along local `Y`, axial humeral rotation (`rightShoulderRotation` / `leftShoulderRotation`) only changes the wrist position when the elbow has a non-zero bend (`rightElbowBend > 0`).

## Sequence Track Types & Chaining (`3d/data/sequences.json`)

Each sequence in `3d/data/sequences.json` has `{ "id", "label", "duration", "tracks": [...] }` or `{ "id", "label", "chain": [...] }`.

Supported track types in `3d/js/animator.js`:
- **`"tween"`**: Smooth ease-in-out from current state to `"target"` (optional `"endAt": 0..1` to finish early and hold).
- **`"sine"`**: Oscillates around 0 with `"amplitude"`, `"cycles"`, `"blendIn"`, and `"endValue"`.
- **`"keyframes"`**: Multi-step eased keyframes via `"keyframes": [{ "t": 0.4, "value": -15 }, ...]`.
- **`"pulse"`**: Eases to `"target"`, holds for `"hold"` fraction of duration, and eases to `"endValue"` (or back to start).

Supported `"chain"` entries in `3d/js/animator.js`:
- **Single sequence ID** (e.g. `"point-you"`): Runs that sequence's tracks.
- **`"reset"` / `"reset-pose"`**: Eases all joints back to default pose over 1s (skipped automatically if already at default pose).
- **Parallel sequence IDs** (e.g. `["point-right", "agree"]` or `"point-right+agree"`): Merges tracks and runs them simultaneously.
