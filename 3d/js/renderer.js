/**
 * Multi-camera 3D projection and Canvas 2D renderer for Rig3D.
 */

import { DEG, v3, vAdd, vScale, vDot, vCross, vNorm } from './math3d.js';

export function makeCamera(id, label, right, up, forward) {
  return {
    id,
    label,
    right: vNorm(right),
    up: vNorm(up),
    forward: vNorm(forward)
  };
}

export function createDefaultCameras() {
  const cameras = [
    makeCamera('front', 'FRONT', v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, -1)),
    makeCamera('side', 'SIDE', v3(0, 0, 1), v3(0, 1, 0), v3(-1, 0, 0)),
    makeCamera('top', 'TOP', v3(1, 0, 0), v3(0, 0, -1), v3(0, -1, 0))
  ];

  const isoYaw = 35 * DEG;
  const isoPitch = 22 * DEG;
  const isoPosition = vNorm(v3(
    Math.sin(isoYaw) * Math.cos(isoPitch),
    Math.sin(isoPitch),
    Math.cos(isoYaw) * Math.cos(isoPitch)
  ));
  const isoForward = vScale(isoPosition, -1);
  const isoRight = vNorm(vCross(isoForward, v3(0, 1, 0)));
  const isoUp = vNorm(vCross(isoRight, isoForward));
  cameras.push(makeCamera('iso', '3D', isoRight, isoUp, isoForward));

  return cameras;
}

export class RigRenderer {
  constructor(canvas, rig) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.rig = rig;
    this.cameras = createDefaultCameras();
  }

  render(options = {}) {
    const { ctx, canvas, rig } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const skel = rig.computeSkeleton();
    const highlight = options.highlightSection ? rig.sections[options.highlightSection] : null;
    const width = canvas.width;
    const height = canvas.height;
    const margin = 14;
    const gap = 12;
    const viewW = (width - margin * 2 - gap) / 2;
    const viewH = (height - margin * 2 - gap) / 2;

    const views = [
      { camera: this.cameras[0], x: margin, y: margin, w: viewW, h: viewH },
      { camera: this.cameras[1], x: margin + viewW + gap, y: margin, w: viewW, h: viewH },
      { camera: this.cameras[2], x: margin, y: margin + viewH + gap, w: viewW, h: viewH },
      { camera: this.cameras[3], x: margin + viewW + gap, y: margin + viewH + gap, w: viewW, h: viewH }
    ];

    views.forEach(view => this.drawView(ctx, skel, view, options, highlight));
  }

  drawView(ctx, skel, view, options, highlight) {
    const { camera, x, y, w, h } = view;

    // Fit the current pose into this viewport.
    const fitPoints = [];
    skel.segments.forEach(seg => {
      fitPoints.push(seg.from, seg.to);
    });
    const radius = skel.headRadius;
    fitPoints.push(
      vAdd(skel.headCenter, vScale(camera.right, radius)),
      vAdd(skel.headCenter, vScale(camera.right, -radius)),
      vAdd(skel.headCenter, vScale(camera.up, radius)),
      vAdd(skel.headCenter, vScale(camera.up, -radius))
    );

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    fitPoints.forEach(pt => {
      const px = vDot(pt, camera.right);
      const py = vDot(pt, camera.up);
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    });

    const spanX = Math.max(maxX - minX, 60);
    const spanY = Math.max(maxY - minY, 60);
    const pad = 28;
    const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY, 1.05);
    const worldCenterX = (minX + maxX) / 2;
    const worldCenterY = (minY + maxY) / 2;
    const viewCenterX = x + w / 2;
    const viewCenterY = y + h / 2;

    const project = (pt) => {
      const px = vDot(pt, camera.right);
      const py = vDot(pt, camera.up);
      return {
        x: viewCenterX + (px - worldCenterX) * scale,
        y: viewCenterY - (py - worldCenterY) * scale,
        depth: vDot(pt, camera.forward)
      };
    };

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
    ctx.fill();
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.clip();

    // Draw reference grid (back wall in Front, far wall in Side, floor in Top/3D).
    this.drawGrid(ctx, project, camera.id);

    // Optional Keyframe Overlay in FRONT view
    if (camera.id === 'front' && options.keyframeImage && options.showKeyframeOverlay) {
      this.drawKeyframeUnderlay(ctx, options.keyframeImage, view, project, options.keyframeCalib);
    }

    // Draw subtle cast shadow from a directional light source in front, above, and slightly to the side.
    if (options.showShadows !== false) {
      this.drawShadow(ctx, skel, project, camera, scale);
    }

    ctx.font = '600 10px system-ui, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(camera.label, x + 12, y + 10);

    if (options.showHeadMesh) {
      this.drawHeadSphere(ctx, skel, project, scale, highlight);
    }

    // Draw segments back-to-front.
    const segments = skel.segments
      .map(seg => {
        const a = project(seg.from);
        const b = project(seg.to);
        return { seg, a, b, depth: (a.depth + b.depth) / 2 };
      })
      .sort((a, b) => b.depth - a.depth);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    segments.forEach(({ seg, a, b }) => {
      ctx.lineWidth = seg.width || 5;
      ctx.strokeStyle = seg.color;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    });

    if (highlight) {
      ctx.save();
      ctx.shadowBlur = 16;
      segments.forEach(({ seg, a, b }) => {
        if (!highlight.segments.includes(seg.id)) return;
        ctx.shadowColor = seg.color;
        ctx.strokeStyle = seg.color;
        ctx.lineWidth = (seg.width || 5) + 4;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      });
      ctx.restore();
    }

    if (options.showJoints) {
      this.drawJoints(ctx, skel, project, highlight);
    }

    if (options.showLabels && (camera.id === 'front' || camera.id === 'iso')) {
      this.drawLabels(ctx, segments);
    }

    ctx.restore();
  }

  drawKeyframeUnderlay(ctx, img, view, project, calib) {
    const { x, y, w, h } = view;
    ctx.save();
    ctx.globalAlpha = 0.50;

    const natW = img.naturalWidth || 640;
    const natH = img.naturalHeight || 480;

    if (calib && calib.grid_width) {
      // Map calibrated grid coordinates to native image pixels
      const gridScaleX = natW / calib.grid_width;
      const gridScaleY = natH / calib.grid_height;

      // Project the neutral 3D rig reference frame in FRONT view
      const baseSkel = this.rig.computeSkeleton(this.rig.defaultState);
      const pC7 = project(baseSkel.c7);
      const pRightShoulder = project(baseSkel.rightShoulder);
      const pLeftShoulder = project(baseSkel.leftShoulder);

      // Model's reference shoulder span on screen
      const rigShoulderSpanPx = Math.hypot(
        pLeftShoulder.x - pRightShoulder.x,
        pLeftShoulder.y - pRightShoulder.y
      );

      // Signer's anatomical shoulder center & skeletal span in image pixels
      const imgCenter_x = (calib.center_x !== undefined ? calib.center_x : 78.75) * gridScaleX;
      // In ASL-LEX 640x480 portraits, the physical clavicle / shoulder line is at Y ≈ 235 px (58.75 grid px)
      const calibShoulderY = (calib.shoulder_y && calib.shoulder_y <= 65) ? calib.shoulder_y : 58.75;
      const imgShoulder_y = calibShoulderY * gridScaleY;

      // Skeletal shoulder half-width (acromion to midline: ~23.75 grid px / 95 native px)
      const skeletalHalfPx = (calib.skeletal_shoulder_half_px && calib.skeletal_shoulder_half_px <= 25)
        ? calib.skeletal_shoulder_half_px
        : 23.75;
      const imgShoulderSpanPx = skeletalHalfPx * 2 * gridScaleX;

      // Scale photo to match the 3D rig's shoulder width and upper-body proportions
      const alignScale = rigShoulderSpanPx / imgShoulderSpanPx;

      const drawW = natW * alignScale;
      const drawH = natH * alignScale;
      const drawX = pC7.x - imgCenter_x * alignScale;
      const drawY = pC7.y - imgShoulder_y * alignScale;

      ctx.drawImage(img, drawX, drawY, drawW, drawH);
    } else {
      // Fallback: fit aspect ratio centered
      const imgAspect = natW / natH;
      const boxAspect = w / h;
      let drawW, drawH, drawX, drawY;
      if (boxAspect > imgAspect) {
        drawH = h;
        drawW = h * imgAspect;
        drawX = x + (w - drawW) / 2;
        drawY = y;
      } else {
        drawW = w;
        drawH = w / imgAspect;
        drawX = x;
        drawY = y + (h - drawH) / 2;
      }
      ctx.drawImage(img, drawX, drawY, drawW, drawH);
    }

    ctx.restore();
  }

  drawGrid(ctx, project, cameraId) {
    const extent = 260;
    const step = 52;
    ctx.save();
    ctx.lineWidth = 1;

    if (cameraId === 'front') {
      // Back wall (XY plane at Z = 0) starting at the floor (Y = 0) and going up.
      const minY = 0;
      const maxY = extent * 2;
      for (let xVal = -extent; xVal <= extent; xVal += step) {
        const alpha = xVal === 0 ? 0.20 : 0.08;
        ctx.strokeStyle = `rgba(56, 189, 248, ${alpha})`;
        const a = project(v3(xVal, minY, 0));
        const b = project(v3(xVal, maxY, 0));
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      for (let yVal = minY; yVal <= maxY; yVal += step) {
        const alpha = yVal === 0 ? 0.24 : 0.08;
        ctx.strokeStyle = `rgba(56, 189, 248, ${alpha})`;
        const a = project(v3(-extent, yVal, 0));
        const b = project(v3(extent, yVal, 0));
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    } else if (cameraId === 'side') {
      // Far wall (ZY plane at X = 0) starting at the floor (Y = 0) and going up.
      const minY = 0;
      const maxY = extent * 2;
      for (let zVal = -extent; zVal <= extent; zVal += step) {
        const alpha = zVal === 0 ? 0.20 : 0.08;
        ctx.strokeStyle = `rgba(56, 189, 248, ${alpha})`;
        const a = project(v3(0, minY, zVal));
        const b = project(v3(0, maxY, zVal));
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      for (let yVal = minY; yVal <= maxY; yVal += step) {
        const alpha = yVal === 0 ? 0.24 : 0.08;
        ctx.strokeStyle = `rgba(56, 189, 248, ${alpha})`;
        const a = project(v3(0, yVal, -extent));
        const b = project(v3(0, yVal, extent));
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    } else {
      // Floor grid (XZ plane at Y = 0) for Top and 3D isometric views.
      for (let value = -extent; value <= extent; value += step) {
        const alpha = value === 0 ? 0.20 : 0.08;
        ctx.strokeStyle = `rgba(56, 189, 248, ${alpha})`;

        let a = project(v3(value, 0, -extent));
        let b = project(v3(value, 0, extent));
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();

        a = project(v3(-extent, 0, value));
        b = project(v3(extent, 0, value));
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  drawShadow(ctx, skel, project, camera, scale) {
    // Directional light source positioned in front (+Z), above (+Y), and slightly to the viewer's left (-X).
    // Light rays travel in direction L = (+0.32, -1.0, -0.62).
    const lightDir = vNorm(v3(0.32, -1.0, -0.62));
    const floorY = 0;

    let castPoint;
    if (camera.id === 'front') {
      // Back wall at Z = -110, clamped at the floor (Y = 0) so the shadow never sinks below the pelvis/ground.
      const wallZ = -110;
      castPoint = (pt) => {
        const tWall = (wallZ - pt.z) / lightDir.z;
        const hitWall = vAdd(pt, vScale(lightDir, tWall));
        if (hitWall.y < floorY) {
          const tFloor = (floorY - pt.y) / lightDir.y;
          return vAdd(pt, vScale(lightDir, tFloor));
        }
        return hitWall;
      };
    } else if (camera.id === 'side') {
      // Far wall at X = 135, clamped at the floor (Y = 0) so the shadow stays planted at the pelvis.
      const wallX = 135;
      castPoint = (pt) => {
        const tWall = (wallX - pt.x) / lightDir.x;
        const hitWall = vAdd(pt, vScale(lightDir, tWall));
        if (hitWall.y < floorY) {
          const tFloor = (floorY - pt.y) / lightDir.y;
          return vAdd(pt, vScale(lightDir, tFloor));
        }
        return hitWall;
      };
    } else {
      // Floor plane at Y = 0 for TOP and 3D isometric views
      castPoint = (pt) => {
        const t = (floorY - pt.y) / lightDir.y;
        return vAdd(pt, vScale(lightDir, t));
      };
    }

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(2, 6, 23, 0.45)';
    ctx.fillStyle = 'rgba(2, 6, 23, 0.30)';
    ctx.shadowColor = 'rgba(2, 6, 23, 0.55)';
    ctx.shadowBlur = 4;

    if (skel.headCenter && skel.headRadius) {
      const shCenter = project(castPoint(skel.headCenter));
      const shRadius = skel.headRadius * scale * (camera.id === 'top' || camera.id === 'iso' ? 0.92 : 0.96);
      ctx.beginPath();
      ctx.arc(shCenter.x, shCenter.y, shRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    skel.segments.forEach(seg => {
      const a = project(castPoint(seg.from));
      const b = project(castPoint(seg.to));
      ctx.lineWidth = (seg.width || 5) * 0.9;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    });

    ctx.restore();
  }

  drawHeadSphere(ctx, skel, project, scale, highlight) {
    const center = project(skel.headCenter);
    const radius = skel.headRadius * scale;
    const headHot = !!highlight && highlight.segments.includes('head');

    ctx.save();
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(167, 139, 250, 0.10)';
    ctx.fill();
    ctx.strokeStyle = headHot ? 'rgba(192, 132, 252, 0.95)' : 'rgba(167, 139, 250, 0.45)';
    ctx.lineWidth = headHot ? 3 : 1.5;
    if (headHot) {
      ctx.shadowColor = this.rig.palette.crown;
      ctx.shadowBlur = 16;
    }
    ctx.stroke();
    ctx.restore();

    const nose = project(skel.nose);
    ctx.fillStyle = 'rgba(192, 132, 252, 0.9)';
    ctx.beginPath();
    ctx.arc(nose.x, nose.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  drawJoints(ctx, skel, project, highlight) {
    const joints = [
      { id: 'pelvis', pt: skel.pelvis, label: 'Pelvis' },
      { id: 'rightHip', pt: skel.rightHip, label: 'R Hip' },
      { id: 'leftHip', pt: skel.leftHip, label: 'L Hip' },
      { id: 'c7', pt: skel.c7, label: 'C7' },
      { id: 'c1', pt: skel.c1, label: 'C1' },
      { id: 'headCrown', pt: skel.headCrown, label: 'Crown' },
      { id: 'rightEar', pt: skel.rightEar, label: 'R Ear' },
      { id: 'leftEar', pt: skel.leftEar, label: 'L Ear' },
      { id: 'chin', pt: skel.chin, label: 'Chin' },
      { id: 'rightShoulder', pt: skel.rightShoulder, label: 'R Shoulder' },
      { id: 'leftShoulder', pt: skel.leftShoulder, label: 'L Shoulder' },
      { id: 'rightElbow', pt: skel.rightElbow, label: 'R Elbow' },
      { id: 'leftElbow', pt: skel.leftElbow, label: 'L Elbow' },
      { id: 'rightWrist', pt: skel.rightWrist, label: 'R Wrist' },
      { id: 'leftWrist', pt: skel.leftWrist, label: 'L Wrist' }
    ];

    joints
      .map(joint => ({ ...joint, screen: project(joint.pt) }))
      .sort((a, b) => b.screen.depth - a.screen.depth)
      .forEach(({ id, screen }) => {
        const isHot = highlight && highlight.joints.includes(id);

        if (isHot) {
          ctx.save();
          ctx.shadowColor = this.rig.palette.highlight;
          ctx.shadowBlur = 16;
          ctx.fillStyle = 'rgba(251, 191, 36, 0.22)';
          ctx.beginPath();
          ctx.arc(screen.x, screen.y, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = this.rig.palette.joints;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, 2.8, 0, Math.PI * 2);
        ctx.fill();

        if (isHot) {
          ctx.strokeStyle = this.rig.palette.highlight;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(screen.x, screen.y, 6.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
  }

  drawLabels(ctx, segments) {
    ctx.font = '500 10px system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    segments.forEach(({ seg, a, b }) => {
      if (!seg.label) return;

      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;

      let offsetX = 12;
      let align = 'left';
      if (seg.id === 'rightUpperArm' || seg.id === 'rightLowerArm' || seg.id === 'torso') {
        offsetX = -12;
        align = 'right';
      } else if (seg.id === 'leftUpperArm' || seg.id === 'leftLowerArm') {
        offsetX = 14;
        align = 'left';
      } else if (seg.id === 'neck' || seg.id === 'head') {
        offsetX = 14;
        align = 'left';
      }

      ctx.textAlign = align;
      const metrics = ctx.measureText(seg.label);
      const padX = 4;
      const w = metrics.width + padX * 2;
      const h = 15;
      const posX = midX + offsetX;
      const drawX = align === 'right' ? posX - w : posX;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.strokeStyle = seg.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(drawX, midY - h / 2, w, h, 3);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = seg.color;
      ctx.fillText(seg.label, align === 'right' ? posX - padX : posX + padX, midY);
    });
  }
}
