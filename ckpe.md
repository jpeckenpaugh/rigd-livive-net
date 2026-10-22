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
