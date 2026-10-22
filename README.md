# rigd-livive-net

Browser prototypes of an upper-body skeletal rig, built with Canvas 2D and no dependencies.

## Pages

- `index.html` — landing page linking both models
- `2.5d.html` — preserved front-view rig with hand-projected depth
- `3d.html` — true 3D skeleton with front, side, top, and isometric views

## Current rig

- Pelvis root with planted hips and a forward/back bow
- Torso, shoulder girdle, neck, and head chain
- Shoulder girdle elevation and left/right tilt
- Head crown / ear-to-ear line, 3D face line, and hinged jaw
- Shoulder and elbow controls with clamped joint limits
- Per-joint explore checkboxes: check one to explore it alone, or Auto Explore to check all
- Symmetry/Asymmetry explore modes for the left/right shoulders and elbows, with one-second alignment tweens
- Hover a control card to highlight its rig segments and joints
- Toggleable labels, joint nodes, and head guide

The 3D page uses one shared skeleton and four cameras. Front, side, and top are orthographic;
the isometric view uses the same projected skeleton for depth reading.

Open `index.html` directly in a browser.
