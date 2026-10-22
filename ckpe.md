# CKPE: Constrained Kinematic Pose Estimator
**Technical Summary & Proof-of-Concept Strategy**

### 1. Objective
Build a machine learning pipeline to replicate complex human body mechanics from 2D, front-facing, centered images using a custom 3D skeletal rig. 

While the initial Proof of Concept (POC) will use American Sign Language (ASL) as the test medium due to its structured nature, **CKPE is fundamentally domain-agnostic.** Because it relies on the universal physical mechanics of the human body, the underlying principles apply equally to any sign language, pantomime, storytelling gestures, or athletic/choreographic routines.

### 2. The Three Levels of Human Gesture (Decomposition)
To prevent the "curse of dimensionality," the problem is decomposed into three hierarchical levels. The current POC will focus exclusively on Level 1.
*   **Level 1 (Current POC):** Gross body shape (arms, shoulders, torso, head position).
*   **Level 2 (Deferred):** Hand shapes (finger extensions, rotations).
*   **Level 3 (Deferred):** Facial details (expressions, gaze, mouth morphemes).

*Rationale:* Deferring Levels 2 and 3 allows the network to master the macroscopic kinematics of the body without being overwhelmed by high-dimensional fine motor details.

### 3. Core Architecture: Single-Step Prediction
The system is **not** a recurrent sequence model. It does not look forward or backward to predict a long video. It operates as a single-step predictor for a single keyframe.
*   **Input:** 
    1. Previous frame bitmap (\(I_{t-1}\))
    2. Previous frame rig parameters (\(S_{t-1}\)) acting as a spatial "hint" and anchor.
    3. Target frame bitmap (\(I_t\)).
    4. Text/action descriptor (e.g., "right arm is being raised").
*   **Output:** The exact skeletal joint angles (\(S_t\)) required to match the target frame.
*   **Temporal Constraint:** A smoothness penalty is applied mathematically to prevent "bamfing" (teleportation of joints), enforcing the fluid physics of human movement between frames.

### 4. Kinematic Priors & Constraints (The "Cheat Codes")
By injecting human common sense into the math, the network is prevented from making physically impossible predictions.
*   **Known Bounds:** Gestures universally begin and end at a known "resting" position (neutral stance). The network knows its starting and finishing coordinates.
*   **Kinematic Chains:** Hands are mathematically bound to the ends of the arms; the head is bound above the torso and between the shoulders. (Eliminates the need for independent, absolute hand/head bounding box predictions at Level 1).
*   **Velocity Limits:** Joint movements are capped to mimic human fluidity and physical range of motion.

### 5. Input/Output Shape (CNN Concept)
To solve scale variance, the system utilizes a multi-scale, multi-crop input pipeline (Full Body, Face, Left Hand, Right Hand) with bounding box coordinates concatenated as spatial context.
*   *For the Level 1 POC:* The Face and Hand inputs are blanked out. This forces the CNN to focus entirely on the body's arm and torso kinematics without getting distracted by fingers or facial expressions.

### 6. Next Steps for Level 2 (Fine Motor)
Once the Level 1 POC is reliably predicting elbow and shoulder angles:
1.  Calculate the wrist's 2D location using Forward Kinematics (FK).
2.  Use that calculated wrist location to automatically generate the hand crop (no external object detector needed).
3.  Treat finger states (e.g., for ASL numbers) as a reduced-dimension classification problem (binary extended/curled states) rather than continuous 3D regression.

---

### 7. Data Ingestion & Keyframe Pipeline (`scripts/prepare_asl_sign.py`)
To build training and evaluation targets from [ASL-LEX 2.0](https://asl-lex.org/visualization/), `scripts/prepare_asl_sign.py` automates video and metadata ingestion:

1.  **Lexical & Phonological Metadata (`data/asl/<sign>/metadata.json`):**
    *   Fetches the sign's full entry from `https://asl-lex.org/visualization/data/sign_props.json` (and node coordinates from `graph.json`).
    *   Extracts key temporal bounds (`SignOnset(ms)`, `SignOffset(ms)`, `ClipDuration(ms)`) and phonological priors (`SignType.2.0`, `MajorLocation.2.0`, `Movement.2.0`, `Handshape.2.0`, `SelectedFingers.2.0`, `Flexion.2.0`, `ThumbPosition.2.0`).
2.  **Reference Video Acquisition (`data/asl/<sign>/<sign>.mp4`):**
    *   Resolves the sign's embedded Vimeo stream (`VimeoVideo`) using the `https://asl-lex.org/` referer header and remuxes the highest-resolution AVC stream into a local MP4 via `ffmpeg`.
3.  **Fixed-Interval Keyframe Bitmaps (`data/asl/<sign>/frames/`):**
    *   Samples the video at `10 fps` (`0.1s` intervals, configurable via `--fps`) into sequential bitmaps (`frame_0001.png`, `frame_0002.png`, …).
4.  **Single-Step Target Manifest (`data/asl/<sign>/keyframes.json`):**
    *   Labels every keyframe with its gesture phase relative to `SignOnset(ms)` and `SignOffset(ms)`:
        *   `prep` ($t < \text{SignOnset}$): moving from neutral resting pose (`DEFAULT_POSE`) toward sign onset.
        *   `stroke` ($\text{SignOnset} \le t \le \text{SignOffset}$): active sign execution/hold in target location.
        *   `retract` ($t > \text{SignOffset}$): returning from sign offset back to `DEFAULT_POSE`.
    *   Emits `ckpe_single_step_targets`, pairing $(I_{t-1}, S_{t-1}, I_t, \text{action\_descriptor}) \rightarrow S_t$ for each $0.1\text{s}$ step.

---

### 8. Bidirectional Trajectory Solver & Physical Continuity (`scripts/rig_rl_scorer.py`)

To eliminate "bamfing" (discontinuous teleportation of limb angles between adjacent frames) without relying on external pre-trained pose models, `scripts/rig_rl_scorer.py` implements a **physics-constrained, bidirectional two-pass trajectory optimizer**:

1. **Newtonian Physical Velocity & Acceleration Bounds:**
   - Voluntary purposeful human arm movements operate at $150^\circ - 360^\circ/\text{sec}$. At $30\text{ fps}$ ($\Delta t \approx 33.3\text{ ms}$), physical velocity is strictly bounded by $\le 12^\circ/\text{frame}$.
   - Minimum-jerk acceleration damping is enforced by penalizing second differences:
     $$\Delta^2 S_t = S_t - 2 S_{t-1} + S_{t-2}$$
   - The temporal smoothness reward component is weighted at $25\%$ of the total score, mathematically forbidding greedy jumps that trade biological continuity for minor pixel overlap gains.

2. **Kinematic Inversion Property ($S_{\text{prep}} \leftrightarrow S_{\text{retract}}$):**
   - Because gestures start and finish at the identical resting stance ($S_0 \equiv S_T$), the preparation and retraction phases traverse symmetric topological paths in configuration space $\mathbb{R}^4$:
     $$S_{\text{retract}}(t) \approx S_{\text{prep}}(1 - t)$$
   - The trajectory solver exploits this property by modeling retraction not as an unguided forward decay, but as a time-inverted rollout anchored to resting stance $S_T$.

3. **Bidirectional Two-Pass Optimizer (Two-Point BVP):**
   - **Step 1: Apex Anchor:** Identifies the stroke hold nucleus $S_{\text{apex}}$ at the gesture apex (where skin-cloud confidence and hold stability are highest, $R \approx 0.72$).
   - **Step 2: Forward Rollout ($0 \to t_{\text{stroke\_end}}$):** Propagates motion forward from $S_0$ toward $S_{\text{apex}}$, dynamically guiding the cross-entropy action distributions.
   - **Step 3: Backward Rollout ($T \to t_{\text{stroke\_start}}$):** Propagates motion backward in reverse time from $S_T$ toward $S_{\text{apex}}$, ensuring exact resting landing at the final frame.
   - **Step 4: Hermite Consensus Fusion:** Fuses forward and backward passes using a $C^1/C^2$ continuous cubic Hermite smoothstep weight $w(\tau) = \tau^2 (3 - 2\tau)$:
     $$S_{\text{fused}}(t) = (1 - w(\tau)) S_{\text{forward}}(t) + w(\tau) S_{\text{backward}}(t)$$
   - **Step 5: Minimum-Jerk $C^2$ Filter:** Applies an anchored 3-tap smoothing kernel ($[0.20, 0.60, 0.20]$) with a hard velocity clamp ($\le 12^\circ/\text{frame}$), guaranteeing fluid, zero-bamf playback.

---

### 9. Empirical Level 1 Validation Suite & Pipeline Automation (`scripts/train_asl.sh`)

To validate Level 1 reach and vertical elevation hierarchy across anatomical contact zones, the test suite features four benchmark signs solved at $30\text{ fps}$:

| Sign | Category / Target | Frames @ 30 fps | Apex Flexion | Apex Elbow Bend | Max Velocity ($\Delta$) | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`one`** | Neutral chest space | 51 (1667 ms) | $30.8^\circ$ | $104.2^\circ$ | $\le 12.0^\circ / \text{frame}$ | Verified |
| **`two`** | Neutral chest space | 44 (1433 ms) | $48.5^\circ$ | $103.9^\circ$ | $\le 12.0^\circ / \text{frame}$ | Verified |
| **`mother`** | Chin contact ($Y \approx 37$ grid px) | 45 (1467 ms) | $73.2^\circ$ | $132.3^\circ$ | $\le 12.0^\circ / \text{frame}$ | Verified |
| **`father`** | Forehead contact ($Y \approx 20$ grid px) | 44 (1433 ms) | $129.0^\circ$ | $108.8^\circ$ | $\le 12.0^\circ / \text{frame}$ | Verified |

The automated runner script [`scripts/train_asl.sh`](file:///Users/jarad/git/rigd-livive-net/scripts/train_asl.sh) runs the entire pipeline end-to-end for any arbitrary word in ASL-LEX 2.0:
```bash
./scripts/train_asl.sh <word1> [word2 ...]
```
Both preset sequences and the interactive keyframe calibration overlay dynamically discover and render solved signs in the browser UI without manual code changes.
