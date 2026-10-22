# rigd-livive-net

Browser prototypes of an upper-body skeletal rig, built with Canvas 2D and no dependencies.

## Pages

- `index.html` — landing page linking both models
- `2.5d.html` — preserved front-view rig with hand-projected depth
- `3d/index.html` — modular 3D skeleton with front, side, top, and isometric views (`3d.html` redirects to `3d/`)
  - `3d/style.css` — layout, sidebar, joint cards, and responsive styling
  - `3d/data/rig-spec.json` — proportions, color palette, joint limits, defaults, UI metadata, and symmetry pairs
  - `3d/data/sequences.json` — declarative preset sequences (`sine`, `tween`, `pulse`, and `keyframes` tracks)
  - `3d/js/math3d.js` — 3D vector and 3×3 rotation matrix helpers
  - `3d/js/rig.js` — `JointDefinition`, `Rig3D` state, and forward kinematics
  - `3d/js/renderer.js` — orthographic/isometric camera setup and Canvas 2D projection
  - `3d/js/animator.js` — Auto Explore, Symmetry/Asymmetry pair tweens, Reset Pose easing, and sequence playback
  - `3d/js/ui.js` — data-driven sidebar generator (with alphabetized sequence dropdown) and DOM bindings
  - `3d/js/main.js` — module entry point

Left/right labels use the model's anatomical perspective: in the front view, the model's left appears on the viewer's right.

## Current rig

- Pelvis root with planted hips and a forward/back bow
- Torso, shoulder girdle, neck, and head chain
- Shoulder girdle elevation and left/right tilt
- Head crown / ear-to-ear line, 3D face line, and hinged jaw
- 3D arms expose shoulder abduction (up to 120°), forward flexion (0°…180°), humeral rotation (−135°…+90°), and local elbow flexion (0°…140°)
- 3D loads in a hands-folded pose (right shoulder 8° / 6° / −60°, left −8° / 6° / −60°, elbows 40°); Reset Pose eases all joints back over 1 second
- Shoulder and elbow controls with clamped joint limits
- Per-joint explore checkboxes: check one to explore it alone, or Auto Explore to check all
- Symmetry/Asymmetry explore modes for paired left/right shoulder and elbow DOFs, with one-second alignment tweens
- Hover a control card to highlight its rig segments and joints
- Toggleable labels, joint nodes, and head guide

The 3D arm chain is composed as abduction/adduction → forward flexion → humeral rotation → local elbow flexion.

## Preset sequences

The 3D page has an alphabetized **Sequence** dropdown driven by `3d/data/sequences.json`:

- **Agree** — head nod (`headPitch` ±20° sine oscillation)
- **Disagree** — head shake (`neckYaw` ±40° sine oscillation)
- **Hands Up** — raises both arms overhead (`shoulderElevation: 10°`, `right/leftShoulderFlexion: 150°`, `right/leftElbowBend: 20°`)
- **Hats Off** — raises the right hand to the crown and tips outward (`rightShoulderAngle` keyframes `-15° → 0° → -15°` at `115°` flexion)
- **Point It** — right-handed forward/outward point (`rightShoulderFlexion: 60°`, `rightShoulderRotation: 50°`)
- **Point Left** — right-handed cross-body point to the model's left (`rightShoulderAngle: 45°`, `rightShoulderRotation: -90°`, `rightElbowBend: 50°`)
- **Point Me** — right-handed point back toward the chest (`rightShoulderAngle: 20°`, `rightShoulderFlexion: 60°`, `rightShoulderRotation: -110°`, `rightElbowBend: 130°`)
- **Point Right** — right-handed point to the model's right (`rightShoulderAngle: -60°`, `rightShoulderRotation: 70°`, `rightElbowBend: 50°`)
- **Point You** — right-handed straight-ahead point (`rightShoulderFlexion: 60°`, `rightShoulderRotation: 0°`)
- **We Don't Go Left** — chained sequence (`reset` → `point-you` → `point-me` → `point-left + disagree`)
- **We Go Right** — chained sequence (`reset` → `point-you` → `point-me` → `point-right + agree`)

Selecting a sequence stops Auto Explore and cancels any symmetry or reset tween.

The 3D page uses one shared skeleton and four cameras. Front, side, and top are orthographic;
the isometric view uses the same projected skeleton for depth reading. Each viewport includes a reference grid (back wall in Front, far wall in Side, and floor in Top/3D) and toggleable cast shadows from a directional light source.

## ASL-LEX Dataset & CKPE Keyframe Preparation

`scripts/prepare_asl_sign.py` downloads reference sign videos and lexical/phonological metadata from [ASL-LEX 2.0](https://asl-lex.org/visualization/) and extracts fixed-interval keyframe bitmaps (`10 fps` / `0.1s` default) along with a single-step transition manifest for the **Constrained Kinematic Pose Estimator (CKPE)** described in `ckpe.md`.

```bash
# Download by ASL-LEX visualization URL (defaults to 10 fps PNGs):
python3 scripts/prepare_asl_sign.py --url "https://asl-lex.org/visualization/?sign=one"

# Or by sign EntryID with custom frame rate / image format:
python3 scripts/prepare_asl_sign.py --sign one --fps 10 --format png
```

Output structure under `data/asl/<sign>/` (e.g. `data/asl/one/`):
- `metadata.json` — Raw ASL-LEX 2.0 record (`EntryID`, `Code`, `SignOnset(ms)`, `SignOffset(ms)`, `Handshape.2.0`, `MajorLocation.2.0`, `Movement.2.0`, etc.) and graph coordinates.
- `<sign>.mp4` — Remuxed reference video downloaded from the sign's embedded Vimeo stream.
- `frames/frame_0001.png` … `frame_NNNN.png` — Extracted keyframe bitmaps at `0.1s` (`10 fps`) intervals.
- `keyframes.json` — CKPE single-step target manifest pairing `(I_{t-1}, S_{t-1}, I_t, action_descriptor) -> S_t` with movement phases (`prep`, `stroke`, `retract`) derived from `SignOnset(ms)` and `SignOffset(ms)`.

Serve the repository over a local HTTP server (e.g., `python3 -m http.server 8000`) or visit `https://rigd.livive.net/`.
