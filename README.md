# rigd-livive-net

Zero-dependency, browser-based articulated skeletal rig and the Level 1 kinematic testbed for the **Constrained Kinematic Pose Estimator (CKPE)**, built with native ES Modules and the Canvas 2D API.

Live deployment: [https://rigd.livive.net/](https://rigd.livive.net/)

---

## Architecture & Pages

- **`index.html`** — Landing hub linking the 2.5D model, the 3D spatial rig, and the CKPE architectural specification.
- **`2.5d.html`** — Standalone front-view prototype with hand-projected depth.
- **`3d/index.html`** — Modular 3D spatial rig with 4 simultaneous viewports (Front, Side, Top, and 3D Isometric) driven by a single unified skeleton (`3d.html` redirects to `3d/`).
  - `3d/style.css` — Layout, dark theme palette, sidebar controls, joint cards, and mobile responsiveness.
  - `3d/data/rig-spec.json` — Single source of truth for body proportions (in head units $H$), joint limits, defaults, UI metadata, and bilateral symmetry pairs.
  - `3d/data/sequences.json` — Declarative preset sequences (`sine`, `tween`, `pulse`, and `keyframes` tracks).
  - `3d/js/math3d.js` — Pure 3D vector (`v3`) and $3 \times 3$ rotation matrix (`M3`) primitives.
  - `3d/js/rig.js` — `JointDefinition`, `Rig3D` state management, and forward kinematics (FK).
  - `3d/js/renderer.js` — Orthographic/isometric cameras, reference grids, ground shadows, and front-view keyframe photo underlay projection.
  - `3d/js/animator.js` — Mutually exclusive RAF animation loops: Auto Explore, bilateral symmetry/anti-symmetry alignment tweens, 1-second Reset Pose easing, and sequence playback.
  - `3d/js/ui.js` — Data-driven sidebar generator with alphabetized preset selector, dynamic sign switcher, scrubbing controls, and real-time reward badge.
  - `3d/js/main.js` — Application entry point.
- **`ckpe.md`** — Architectural specification for the Constrained Kinematic Pose Estimator machine learning pipeline.
- **`scripts/train_asl.sh`** — Single-command end-to-end automated training and trajectory solving script.
- **`scripts/prepare_asl_sign.py`** — ASL-LEX 2.0 downloader, metadata extractor, and 30 fps keyframe slicer.
- **`scripts/rig_rl_scorer.py`** — Deterministic bidirectional trajectory optimizer, pixel reward scorer, and sequence exporter.

---

## Kinematic Features

- **Pelvis Root:** Planted hips with forward/backward bow ($-20^\circ \dots 40^\circ$) and pelvic twist ($-45^\circ \dots 45^\circ$).
- **Torso & Spine:** Spine column with neck base (C7) tilt/roll and yaw/turn.
- **Shoulder Girdle:** Bilateral elevation ($-10^\circ \dots 25^\circ$) and lateral tilt ($-15^\circ \dots 15^\circ$).
- **Head & Jaw:** Skull base (C1) pitch/nod, crown line, 3D face line, and hinged mandible (jaw opening).
- **3D Arm Kinematic Chain:**
  $$\text{Abduction / Adduction} \longrightarrow \text{Forward Flexion} \longrightarrow \text{Humeral Rotation} \longrightarrow \text{Elbow Flexion}$$
  - Abduction/Adduction: $-120^\circ \dots 45^\circ$
  - Forward Flexion: $0^\circ \dots 180^\circ$
  - Humeral Axial Rotation: $-135^\circ \dots 90^\circ$
  - Local Elbow Flexion: $0^\circ \dots 140^\circ$
- **Resting Stance:** Loads in a hands-folded resting stance; Reset Pose smoothly interpolates all joints back to neutral over 1.0 second.
- **Anatomical Perspective:** Left and right always refer to the **model's** anatomical perspective (in Front view, the model's right arm is on the viewer's left at $-X$).

---

## Preset Animations & ASL Sequences

The 3D viewer features an automatically alphabetized **Sequence** selector driven by `3d/data/sequences.json`:

### Standard Gestural Presets
- **Agree** — Head nod (`headPitch` $\pm 20^\circ$ sinusoidal oscillation)
- **Disagree** — Head shake (`neckYaw` $\pm 40^\circ$ sinusoidal oscillation)
- **Hands Up** — Overhead bilateral reach (`shoulderElevation: 10°`, `flexion: 150°`, `elbow: 20°`)
- **Hats Off** — Raises right hand to head crown and tips outward (`flexion: 115°`, angle `-15° → 0° → -15°`)
- **Point It** — Outward forward point (`flexion: 60°`, humeral rotation: $50^\circ$)
- **Point Left** — Cross-body point to the model's left (`shoulderAngle: 45°`, rotation: $-90^\circ$)
- **Point Me** — Points back toward own chest (`angle: 20°`, `flexion: 60°`, `elbow: 130°`)
- **Point Right** — Points outward to the model's right (`shoulderAngle: -60°`, rotation: $70^\circ$)
- **Point You** — Straight-ahead point (`flexion: 60°`, rotation: $0^\circ$)
- **We Don't Go Left** — Chained sequence (`reset` $\to$ `point-you` $\to$ `point-me` $\to$ `point-left + disagree`)
- **We Go Right** — Chained sequence (`reset` $\to$ `point-you` $\to$ `point-me` $\to$ `point-right + agree`)

### Trained ASL Signs (100 Solved via CKPE Level 1 RL Policy)

All 100 signs are extracted at 30 fps, calibrated from Frame 0, optimized via bidirectional Hermite rollout, and guaranteed zero-bamf ($\max \Delta \le 12.0^\circ/\text{frame}$):

- **Neutral Chest Space & Motion Verbs:**
  `one`, `two`, `three`, `four`, `find`, `water`, `milk`, `give`, `walk`, `open`, `push`, `pull`, `egg`, `bacon`, `yes`, `no`, `where`, `what_1`, `how`, `finish`, `more`, `now`, `later`, `decide_2`, `friend`, `family`, `meet`, `baby`
- **Cranial, Temple & Directional Targets:**
  `father`, `boy`, `hello`, `think`, `see`, `why`, `airplane`, `sun`, `moon`, `who`, `know`, `understand`, `remember`, `listen`, `tomorrow`, `yesterday`, `teach`, `surprise`, `star`
- **Facial, Oral & Chin Targets:**
  `mother`, `girl`, `drink`, `apple`, `flower`, `thank_you`, `eat_1`, `sleep`, `candy_1`, `orange`, `fruit`, `corn_2`, `bird`, `cat`, `bored`, `shy`, `bed`
- **Thoracic & Sternum Gestures:**
  `my`, `please`, `sorry`, `shirt`, `fine_1`, `like`, `feel`, `pride`, `angry`, `excited`, `tired`, `bear`, `boss`
- **Bilateral Coordination & Base Hands:**
  `box`, `house`, `tree`, `money`, `work`, `stand_1`, `stop`, `bread`, `coffee`, `tea`, `cheese`, `butter`, `door`, `window`, `key`, `chair`, `fish`, `turtle`, `plant`, `again`, `help`, `name`, `student`, `learn`, `read`, `write`, `all`, `night`, `week`, `clock`, `doctor`

---

## Training New ASL Signs

The repository includes a single-command automated pipeline runner, [`scripts/train_asl.sh`](file:///Users/jarad/git/rigd-livive-net/scripts/train_asl.sh), to ingest, calibrate, solve, and export any ASL sign from [ASL-LEX 2.0](https://asl-lex.org/):

```bash
# Train a single word:
./scripts/train_asl.sh water

# Train multiple words in a batch:
./scripts/train_asl.sh water candy hello girl
./scripts/train_asl.sh "water, candy, hello"

# Specify custom extraction fps (default: 30):
./scripts/train_asl.sh --fps 30 boy

# Re-run the kinematic solver on an existing downloaded sign:
./scripts/train_asl.sh --scorer-only mother
```

### What `train_asl.sh` Does Under the Hood:
1. **Ingestion (`prepare_asl_sign.py`):** Downloads metadata (`metadata.json`), video (`<sign>.mp4`), and extracts normalized bitmaps (`frames/frame_*.png`) at 30 fps into `data/asl/<sign>/`.
2. **Trajectory Optimization (`rig_rl_scorer.py`):**
   - Calibrates camera and skeleton proportions from Frame 0.
   - Extracts active skin/motion pixels and locates apex hold nucleus.
   - Executes a **bidirectional two-pass rollout**: forward $S_0 \to S_{\text{apex}}$ and reverse $S_T \to S_{\text{apex}}$, fused with cubic Hermite smoothstep weighting.
   - Enforces physical velocity bounds ($\le 12.0^\circ/\text{frame}$) to guarantee smooth biological movement.
   - Writes solved states to `data/asl/<sign>/keyframes.json` and exports keyframe animation tracks to `3d/data/sequences.json`.
3. **Dynamic UI Registration:**
   - Both the top **Sequence** dropdown and the **ASL Keyframe Calibration Overlay** sign selector dynamically detect and list the new sign upon page refresh without needing any manual HTML edits.

---

## Running Locally

Serve the repository with any static HTTP server:

```bash
python3 -m http.server 8000
```

Then visit:
- Landing Page: `http://localhost:8000/`
- 3D Rig & Gesture Reviewer: `http://localhost:8000/3d/`
- 2.5D Prototype: `http://localhost:8000/2.5d.html`
