// On-device face alignment — norm_crop similarity transform (verified == Python pipeline).
export const ARC_TEMPLATE: number[][] = [
  [38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041],
];
export const ALIGNED_SIZE = 112;
export type Point = { x: number; y: number };

export function landmarksToSrc(l: {
  leftEye: Point; rightEye: Point; nose: Point; mouthLeft: Point; mouthRight: Point;
}): number[][] {
  return [
    [l.leftEye.x, l.leftEye.y], [l.rightEye.x, l.rightEye.y], [l.nose.x, l.nose.y],
    [l.mouthLeft.x, l.mouthLeft.y], [l.mouthRight.x, l.mouthRight.y],
  ];
}

export function similarityTransform(src: number[][], dst: number[][]): number[][] {
  const ATA = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  const ATb = [0, 0, 0, 0];
  for (let i = 0; i < src.length; i++) {
    const x = src[i][0], y = src[i][1], xp = dst[i][0], yp = dst[i][1];
    const r1 = [x, -y, 1, 0], r2 = [y, x, 0, 1];
    for (let j = 0; j < 4; j++) {
      for (let k = 0; k < 4; k++) ATA[j][k] += r1[j] * r1[k] + r2[j] * r2[k];
      ATb[j] += r1[j] * xp + r2[j] * yp;
    }
  }
  const [a, b, tx, ty] = solve4(ATA, ATb);
  return [[a, -b, tx], [b, a, ty]];
}

function solve4(A: number[][], b: number[]): number[] {
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < 4; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 5; k++) M[r][k] -= f * M[c][k];
    }
  }
  return [M[0][4] / M[0][0], M[1][4] / M[1][1], M[2][4] / M[2][2], M[3][4] / M[3][3]];
}

export function computeAlignMatrix(src: number[][]): number[][] {
  return similarityTransform(src, ARC_TEMPLATE);
}

export function invertAffine(M: number[][]): number[][] {
  const a = M[0][0], b = M[0][1], tx = M[0][2], c = M[1][0], d = M[1][1], ty = M[1][2];
  const det = a * d - b * c;
  const ia = d / det, ib = -b / det, ic = -c / det, id = a / det;
  return [[ia, ib, -(ia * tx + ib * ty)], [ic, id, -(ic * tx + id * ty)]];
}
