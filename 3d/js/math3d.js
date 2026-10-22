/**
 * 3D vector and 3x3 matrix helpers for forward kinematics and projection.
 */

export const DEG = Math.PI / 180;

export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const vAdd = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const vSub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const vScale = (a, k) => v3(a.x * k, a.y * k, a.z * k);
export const vDot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const vCross = (a, b) => v3(
  a.y * b.z - a.z * b.y,
  a.z * b.x - a.x * b.z,
  a.x * b.y - a.y * b.x
);
export const vNorm = (a) => {
  const len = Math.hypot(a.x, a.y, a.z) || 1;
  return vScale(a, 1 / len);
};

export const M3 = {
  identity: () => [1, 0, 0, 0, 1, 0, 0, 0, 1],
  mul: (A, B) => {
    const out = new Array(9);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        out[r * 3 + c] =
          A[r * 3] * B[c] +
          A[r * 3 + 1] * B[3 + c] +
          A[r * 3 + 2] * B[6 + c];
      }
    }
    return out;
  },
  rotX: (a) => {
    const c = Math.cos(a), s = Math.sin(a);
    return [1, 0, 0, 0, c, -s, 0, s, c];
  },
  rotY: (a) => {
    const c = Math.cos(a), s = Math.sin(a);
    return [c, 0, s, 0, 1, 0, -s, 0, c];
  },
  rotZ: (a) => {
    const c = Math.cos(a), s = Math.sin(a);
    return [c, -s, 0, s, c, 0, 0, 0, 1];
  },
  apply: (M, v) => v3(
    M[0] * v.x + M[1] * v.y + M[2] * v.z,
    M[3] * v.x + M[4] * v.y + M[5] * v.z,
    M[6] * v.x + M[7] * v.y + M[8] * v.z
  )
};

export function makeTransform(parent, offset, rotation) {
  return {
    R: M3.mul(parent.R, rotation),
    t: vAdd(parent.t, M3.apply(parent.R, offset))
  };
}

export function applyTransform(transform, local) {
  return vAdd(transform.t, M3.apply(transform.R, local));
}

export function midpoint3(a, b) {
  return v3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}
