# rigd-livive-net

Browser prototype of an upper-body skeletal rig, built with a single Canvas 2D surface and no dependencies.

## Current rig

- Pelvis root crossbar with planted hips: twist turns the upper body, bow adds forward flexion
- Torso, shoulder girdle, neck, and head chain
- Shoulder girdle elevation (both) and tilt (one up / one down), modeled as clavicles anchored at C7
- Head crown / ear-to-ear line that foreshortens and shifts with neck yaw and body twist
- Hinged mandible / jaw with a mouth-open control
- Shoulder and elbow controls with clamped joint limits
- Controls ordered head-to-pelvis; hovering a control card highlights its rig segments and joints
- Auto Explore mode that roams all controls within their joint limits
- Toggleable labels, joint nodes, and head oval

Open `index.html` directly in a browser.
