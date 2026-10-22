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

    // Ground grid is most useful in the top and isometric views.
    if (camera.id === 'top' || camera.id === 'iso') {
      this.drawGrid(ctx, project);
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

  drawGrid(ctx, project) {
    const extent = 260;
    const step = 52;
    ctx.save();
    ctx.lineWidth = 1;

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
