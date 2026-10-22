# rigd-livive-net

Browser prototypes of an upper-body skeletal rig, built with Canvas 2D and no dependencies.

## Pages

- `index.html` — landing page linking both models
- `2.5d.html` — preserved front-view rig with hand-projected depth
- `3d/index.html` — modular 3D skeleton with front, side, top, and isometric views (`3d.html` redirects to `3d/`)
  - `3d/style.css` — layout, sidebar, joint cards, and responsive styling
  - `3d/data/rig-spec.json` — proportions, color palette, joint limits, defaults, UI metadata, and symmetry pairs
  - `3d/data/sequences.json` — declarative preset sequences
  - `3d/js/math3d.js` — 3D vector and 3×3 rotation matrix helpers
  - `3d/js/rig.js` — `JointDefinition`, `Rig3D` state, and forward kinematics
  - `3d/js/renderer.js` — orthographic/isometric camera setup and Canvas 2D projection
  - `3d/js/animator.js` — Auto Explore, Symmetry/Asymmetry pair tweens, Reset Pose easing, and sequence playback
  - `3d/js/ui.js` — data-driven sidebar generator and DOM bindings
  - `3d/js/main.js` — module entry point

Left/right labels use the model's anatomical perspective: in the front view, the model's left appears on the viewer's right.

## Current rig

- Pelvis root with planted hips and a forward/back bow
- Torso, shoulder girdle, neck, and head chain
- Shoulder girdle elevation and left/right tilt
- Head crown / ear-to-ear line, 3D face line, and hinged jaw
- 3D arms expose shoulder abduction (up to 120°), forward flexion (0°…180°), humeral rotation (−90°…+90°), and local elbow flexion (0°…140°)
- 3D loads in a hands-folded pose (right shoulder 8° / 6° / −60°, left −8° / 6° / −60°, elbows 40°); Reset Pose eases all joints back over 1 second
- Shoulder and elbow controls with clamped joint limits
- Per-joint explore checkboxes: check one to explore it alone, or Auto Explore to check all
- Symmetry/Asymmetry explore modes for paired left/right shoulder and elbow DOFs, with one-second alignment tweens
- Hover a control card to highlight its rig segments and joints
- Toggleable labels, joint nodes, and head guide

The 3D arm chain is composed as forward flexion → abduction/adduction → humeral rotation → local elbow flexion.

## Preset sequences

The 3D page has a Sequence dropdown. The first preset is **Disagree**: a one-second head-shake
with five ±40° neck-yaw cycles, returning to neutral. Selecting a sequence stops Auto Explore
and cancels any symmetry or reset tween.

The 3D page uses one shared skeleton and four cameras. Front, side, and top are orthographic;
the isometric view uses the same projected skeleton for depth reading.

Open `index.html` directly in a browser.
