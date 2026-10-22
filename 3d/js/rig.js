/**
 * Biomechanical joint definitions and 3D upper-body forward kinematics.
 */

import { DEG, v3, M3, makeTransform, applyTransform } from './math3d.js';

export const JointTypes = {
  HINGE: 'hinge',         // 1-DOF: Flexion / Extension
  UNIVERSAL: 'universal', // 2-DOF: Tilt + Twist
  SADDLE: 'saddle',       // 2-DOF: Twist + Bow (pelvis)
  GIRDLE: 'girdle',       // 2-DOF: Elevation + Tilt (shoulder girdle)
  BALL_SOCKET: 'ball'     // 3-DOF: Spherical rotation
};

export class JointDefinition {
  constructor({ name, type, limits = {} }) {
    this.name = name;
    this.type = type;
    this.limits = limits;
  }

  clamp(paramName, val) {
    if (!this.limits[paramName]) return val;
    const [min, max] = this.limits[paramName];
    return Math.max(min, Math.min(max, val));
  }
}

export function buildRigFromSpec(spec) {
  const joints = {};
  const sections = {};
  const defaultState = {};

  spec.sections.forEach(sec => {
    const limits = {};
    sec.controls.forEach(ctrl => {
      limits[ctrl.paramName] = [ctrl.min, ctrl.max];
      defaultState[ctrl.stateKey] = ctrl.default;
    });

    joints[sec.jointId] = new JointDefinition({
      name: sec.jointName,
      type: sec.type,
      limits
    });

    sections[sec.id] = sec.highlight;
  });

  return { joints, sections, defaultState };
}

export class Rig3D {
  constructor(spec) {
    this.spec = spec;
    this.scaleH = spec.scaleH || 100;
    const { joints, sections, defaultState } = buildRigFromSpec(spec);
    this.joints = joints;
    this.sections = sections;
    this.defaultState = defaultState;
    this.state = this.getDefaultState();

    // Proportions in Head Lengths (H)
    this.proportions = {
      pelvisHalfWidth: spec.proportions.pelvisHalfWidth * this.scaleH,
      torsoLength: spec.proportions.torsoLength * this.scaleH,
      neckLength: spec.proportions.neckLength * this.scaleH,
      headLength: spec.proportions.headLength * this.scaleH,
      shoulderHalfWidth: spec.proportions.shoulderHalfWidth * this.scaleH,
      upperArmLength: spec.proportions.upperArmLength * this.scaleH,
      lowerArmLength: spec.proportions.lowerArmLength * this.scaleH
    };

    this.palette = { ...spec.palette };
  }

  getDefaultState() {
    return { ...this.defaultState };
  }

  reset() {
    this.state = this.getDefaultState();
  }

  computeSkeleton(customState = null) {
    const p = this.proportions;
    const s = customState || this.state;
    const identity = M3.identity();

    // Root pelvis and planted hip line.
    const pelvis = v3(0, 0, 0);
    const rightHip = v3(-p.pelvisHalfWidth, 0, 0);
    const leftHip = v3(p.pelvisHalfWidth, 0, 0);

    // Waist: twist (Y) after bow (X). The hips stay planted.
    const root = { R: identity, t: v3(0, 0, 0) };
    const waistRotation = M3.mul(
      M3.rotY(s.pelvisTwist * DEG),
      M3.rotX(s.pelvisBow * DEG)
    );
    const waist = makeTransform(root, v3(0, 0, 0), waistRotation);

    // Spine / shoulder center.
    const c7T = makeTransform(waist, v3(0, p.torsoLength, 0), identity);
    const c7 = c7T.t;

    // Clavicles: elevation raises both, tilt raises one and lowers the other.
    const rightClavicleRotation = M3.rotZ(-(s.shoulderElevation + s.shoulderTilt) * DEG);
    const leftClavicleRotation = M3.rotZ((s.shoulderElevation - s.shoulderTilt) * DEG);
    const rightShoulderT = makeTransform(
      makeTransform(c7T, v3(0, 0, 0), rightClavicleRotation),
      v3(-p.shoulderHalfWidth, 0, 0),
      identity
    );
    const leftShoulderT = makeTransform(
      makeTransform(c7T, v3(0, 0, 0), leftClavicleRotation),
      v3(p.shoulderHalfWidth, 0, 0),
      identity
    );
    const rightShoulder = rightShoulderT.t;
    const leftShoulder = leftShoulderT.t;

    // Right arm: abduction/adduction -> forward flexion -> humeral axial rotation -> local elbow flexion.
    const rightUpperArmT = makeTransform(
      rightShoulderT,
      v3(0, 0, 0),
      M3.mul(
        M3.rotZ(s.rightShoulderAngle * DEG),
        M3.rotX(-s.rightShoulderFlexion * DEG)
      )
    );
    const rightHumeralT = makeTransform(
      rightUpperArmT,
      v3(0, 0, 0),
      M3.rotY(-s.rightShoulderRotation * DEG)
    );
    const rightElbowT = makeTransform(rightHumeralT, v3(0, -p.upperArmLength, 0), identity);
    const rightElbow = rightElbowT.t;
    const rightForearmT = makeTransform(
      rightElbowT,
      v3(0, 0, 0),
      M3.rotX(-s.rightElbowBend * DEG)
    );
    const rightWristT = makeTransform(rightForearmT, v3(0, -p.lowerArmLength, 0), identity);
    const rightWrist = rightWristT.t;

    // Left arm: same chain; the humeral roll sign is mirrored so -90 = down for both.
    const leftUpperArmT = makeTransform(
      leftShoulderT,
      v3(0, 0, 0),
      M3.mul(
        M3.rotZ(s.leftShoulderAngle * DEG),
        M3.rotX(-s.leftShoulderFlexion * DEG)
      )
    );
    const leftHumeralT = makeTransform(
      leftUpperArmT,
      v3(0, 0, 0),
      M3.rotY(s.leftShoulderRotation * DEG)
    );
    const leftElbowT = makeTransform(leftHumeralT, v3(0, -p.upperArmLength, 0), identity);
    const leftElbow = leftElbowT.t;
    const leftForearmT = makeTransform(
      leftElbowT,
      v3(0, 0, 0),
      M3.rotX(-s.leftElbowBend * DEG)
    );
    const leftWristT = makeTransform(leftForearmT, v3(0, -p.lowerArmLength, 0), identity);
    const leftWrist = leftWristT.t;

    // Neck: roll (Z), then yaw (Y); the head inherits the yaw.
    const neckRotation = M3.mul(
      M3.rotY(s.neckYaw * DEG),
      M3.rotZ(s.neckRoll * DEG)
    );
    const neckT = makeTransform(c7T, v3(0, 0, 0), neckRotation);
    const c1T = makeTransform(neckT, v3(0, p.neckLength, 0), identity);
    const c1 = c1T.t;

    // Head: pitch at C1. The head points +Y, face points +Z.
    const headT = makeTransform(c1T, v3(0, 0, 0), M3.rotX(s.headPitch * DEG));
    const headCrown = applyTransform(headT, v3(0, p.headLength, 0));
    const headCenter = applyTransform(headT, v3(0, p.headLength * 0.5, 0));
    const headRadius = p.headLength * 0.5;
    const earY = p.headLength * 0.5;
    const earX = headRadius * 0.95;

    const rightEar = applyTransform(headT, v3(-earX, earY, 0));
    const leftEar = applyTransform(headT, v3(earX, earY, 0));

    // Mandible: hinge around the ear line, chin forward and below.
    const chinRestY = earY - p.headLength * 0.35;
    const chinRestZ = headRadius * 0.72;
    const jawRad = s.jawOpen * DEG;
    const chinLocalY = earY + (chinRestY - earY) * Math.cos(jawRad) - chinRestZ * Math.sin(jawRad);
    const chinLocalZ = (chinRestY - earY) * Math.sin(jawRad) + chinRestZ * Math.cos(jawRad);
    const chin = applyTransform(headT, v3(0, chinLocalY, chinLocalZ));

    const faceTop = applyTransform(headT, v3(0, earY + headRadius * 0.45, headRadius * 0.84));
    const faceBottom = applyTransform(headT, v3(0, earY - headRadius * 0.45, headRadius * 0.84));
    const nose = applyTransform(headT, v3(0, earY, headRadius));

    return {
      pelvis, rightHip, leftHip, c7, c1,
      headCrown, headCenter, headRadius,
      rightEar, leftEar, chin, nose, faceTop, faceBottom,
      rightShoulder, leftShoulder,
      rightElbow, leftElbow,
      rightWrist, leftWrist,
      segments: [
        { id: 'pelvis', label: 'Pelvis (Hip Line)', color: this.palette.pelvis, from: rightHip, to: leftHip },
        { id: 'torso', label: 'Torso Spine', color: this.palette.torso, from: pelvis, to: c7 },
        { id: 'rightShoulderGirdle', label: 'Shoulders', color: this.palette.shoulders, from: c7, to: rightShoulder },
        { id: 'leftShoulderGirdle', label: null, color: this.palette.shoulders, from: c7, to: leftShoulder },
        { id: 'neck', label: 'Neck (C7-C1)', color: this.palette.neck, from: c7, to: c1 },
        { id: 'head', label: 'Head (Crown)', color: this.palette.head, from: c1, to: headCrown },
        { id: 'crown', label: 'Crown Line (Ear-Ear)', color: this.palette.crown, from: rightEar, to: leftEar, width: 3 },
        { id: 'face', label: null, color: this.palette.crown, from: faceTop, to: faceBottom, width: 2 },
        { id: 'rightJaw', label: 'Jaw', color: this.palette.jaw, from: rightEar, to: chin, width: 3 },
        { id: 'leftJaw', label: null, color: this.palette.jaw, from: leftEar, to: chin, width: 3 },
        { id: 'rightUpperArm', label: 'Upper Arm (R)', color: this.palette.rightUpperArm, from: rightShoulder, to: rightElbow },
        { id: 'leftUpperArm', label: 'Upper Arm (L)', color: this.palette.leftUpperArm, from: leftShoulder, to: leftElbow },
        { id: 'rightLowerArm', label: 'Lower Arm (R)', color: this.palette.rightLowerArm, from: rightElbow, to: rightWrist },
        { id: 'leftLowerArm', label: 'Lower Arm (L)', color: this.palette.leftLowerArm, from: leftElbow, to: leftWrist }
      ]
    };
  }
}
