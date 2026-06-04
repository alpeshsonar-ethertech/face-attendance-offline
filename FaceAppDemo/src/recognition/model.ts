// TFLite model + static-image pipeline: URI -> detect -> align -> warp -> embed.
import { loadTensorflowModel, TensorflowModel } from 'react-native-fast-tflite';
import { Image } from 'react-native';
import RNFS from 'react-native-fs';
import { Buffer } from 'buffer';
import jpeg from 'jpeg-js';
import FaceDetection from '@react-native-ml-kit/face-detection';
import { computeAlignMatrix, invertAffine, landmarksToSrc, ALIGNED_SIZE, Point } from './align';

export const MODEL_INPUT = 112;
export const DEBUG_DUMP = true; // when true, saves captured frame + aligned crop to /files for inspection
let _dumpN = 0;

async function dumpCrop(rgb: Uint8Array, tag: string) {
  try {
    // write RAW 112x112x3 RGB bytes (no jpeg encoder needed)
    const dest = `${RNFS.DocumentDirectoryPath}/dbg_${tag}_${_dumpN}.rgb`;
    await RNFS.writeFile(dest, Buffer.from(rgb.buffer, rgb.byteOffset, rgb.byteLength).toString('base64'), 'base64');
    console.log('[dump] wrote crop ->', dest, 'len', rgb.length);
  } catch (e) { console.log('[dump] crop failed:', String(e)); }
}

async function dumpFrame(uri: string, tag: string) {
  try {
    const src = uri.replace('file://', '');
    const dest = `${RNFS.DocumentDirectoryPath}/dbg_${tag}_frame_${_dumpN}.jpg`;
    await RNFS.copyFile(src, dest);
    console.log('[dump] wrote frame ->', dest);
  } catch (e) { console.log('[dump] frame failed:', String(e)); }
}
let _model: TensorflowModel | null = null;

export async function loadModel(): Promise<TensorflowModel> {
  if (_model) return _model;
  _model = await loadTensorflowModel(require('../../assets/models/w600k_mbf_float16.tflite'));
  return _model;
}

export interface DetectedFace {
  leftEye: Point; rightEye: Point; nose: Point; mouthLeft: Point; mouthRight: Point;
  box: { w: number; h: number };
  eyeOpen: number; // avg eye-open probability (0..1), -1 if unknown
}

export async function detectFace(uri: string): Promise<DetectedFace | null> {
  console.log('[embed] detectFace: calling ML Kit on', uri);
  // landmarkMode 'all' returns landmarks as an OBJECT keyed by type (ML Kit v2).
  const faces = await FaceDetection.detect(uri, { landmarkMode: 'all', classificationMode: 'all', performanceMode: 'accurate' });
  console.log('[embed] detectFace: ML Kit returned', faces ? faces.length : 0, 'face(s)');
  if (!faces || faces.length === 0) return null;
  // pick the largest face by frame area
  let f = faces[0];
  for (const c of faces) {
    if ((c.frame?.width || 0) * (c.frame?.height || 0) > (f.frame?.width || 0) * (f.frame?.height || 0)) f = c;
  }
  const lm: any = f.landmarks || {};
  const need = ['leftEye', 'rightEye', 'noseBase', 'mouthLeft', 'mouthRight'];
  const missing = need.filter((k) => !lm[k] || !lm[k].position);
  if (missing.length) { console.log('[embed] detectFace: missing landmarks', missing, 'have:', Object.keys(lm)); return null; }
  if (DEBUG_DUMP) console.log('[embed] frame=', JSON.stringify(f.frame),
    'le=', lm.leftEye.position.x.toFixed(1) + ',' + lm.leftEye.position.y.toFixed(1),
    're=', lm.rightEye.position.x.toFixed(1) + ',' + lm.rightEye.position.y.toFixed(1),
    'nose=', lm.noseBase.position.x.toFixed(1) + ',' + lm.noseBase.position.y.toFixed(1),
    'ml=', lm.mouthLeft.position.x.toFixed(1) + ',' + lm.mouthLeft.position.y.toFixed(1),
    'mr=', lm.mouthRight.position.x.toFixed(1) + ',' + lm.mouthRight.position.y.toFixed(1));
  return {
    leftEye: { x: lm.leftEye.position.x, y: lm.leftEye.position.y },
    rightEye: { x: lm.rightEye.position.x, y: lm.rightEye.position.y },
    nose: { x: lm.noseBase.position.x, y: lm.noseBase.position.y },
    mouthLeft: { x: lm.mouthLeft.position.x, y: lm.mouthLeft.position.y },
    mouthRight: { x: lm.mouthRight.position.x, y: lm.mouthRight.position.y },
    box: { w: f.frame?.width || 0, h: f.frame?.height || 0 },
    eyeOpen: (typeof f.leftEyeOpenProbability === 'number' && typeof f.rightEyeOpenProbability === 'number')
      ? (f.leftEyeOpenProbability + f.rightEyeOpenProbability) / 2 : -1,
  };
}


// --- EXIF orientation handling: jpeg-js ignores EXIF, but ML Kit honors it, so we
// rotate the decoded pixels into the same UPRIGHT space ML Kit used. Fixes sideways crops.
function readExifOrientation(buf: Buffer): number {
  try {
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return 1;
    let pos = 2;
    while (pos + 4 < buf.length) {
      if (buf[pos] !== 0xff) break;
      const marker = buf[pos + 1];
      if (marker === 0xd8 || marker === 0xd9) { pos += 2; continue; }
      if (marker === 0xda) break;
      const len = buf.readUInt16BE(pos + 2);
      if (marker === 0xe1 && buf.toString('ascii', pos + 4, pos + 8) === 'Exif') {
        const tiff = pos + 10;
        const little = buf[tiff] === 0x49;
        const u16 = (o: number) => (little ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
        const u32 = (o: number) => (little ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
        const ifd0 = tiff + u32(tiff + 4);
        const n = u16(ifd0);
        for (let i = 0; i < n; i++) {
          const e = ifd0 + 2 + i * 12;
          if (u16(e) === 0x0112) return u16(e + 8);
        }
      }
      pos += 2 + len;
    }
  } catch {}
  return 1;
}

function applyExifOrientation(src: Uint8Array, w: number, h: number, o: number): { data: Uint8Array; width: number; height: number } {
  if (o <= 1) return { data: src, width: w, height: h };
  const swap = o >= 5;
  const nw = swap ? h : w;
  const nh = swap ? w : h;
  const dst = new Uint8Array(nw * nh * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let X = x, Y = y;
      switch (o) {
        case 2: X = w - 1 - x; break;
        case 3: X = w - 1 - x; Y = h - 1 - y; break;
        case 4: Y = h - 1 - y; break;
        case 5: X = y; Y = x; break;
        case 6: X = h - 1 - y; Y = x; break;
        case 7: X = h - 1 - y; Y = w - 1 - x; break;
        case 8: X = y; Y = w - 1 - x; break;
      }
      const sIdx = (y * w + x) * 4;
      const dIdx = (Y * nw + X) * 4;
      dst[dIdx] = src[sIdx]; dst[dIdx + 1] = src[sIdx + 1]; dst[dIdx + 2] = src[sIdx + 2]; dst[dIdx + 3] = src[sIdx + 3];
    }
  }
  return { data: dst, width: nw, height: nh };
}

async function decodeJpeg(uri: string) {
  const path = uri.replace('file://', '');
  const b64 = await RNFS.readFile(path, 'base64');
  const raw = Buffer.from(b64, 'base64');
  const o = readExifOrientation(raw);
  const dec = jpeg.decode(raw, { useTArray: true } as any);
  const up = applyExifOrientation(dec.data as Uint8Array, dec.width, dec.height, o);
  console.log('[embed] exif orientation', o, '| raw', dec.width + 'x' + dec.height, '-> upright', up.width + 'x' + up.height);
  return { width: up.width, height: up.height, data: up.data };
}

export function warpAligned(src: Uint8Array, srcW: number, srcH: number, M: number[][]): Uint8Array {
  const S = ALIGNED_SIZE;
  const inv = invertAffine(M);
  const out = new Uint8Array(S * S * 3);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const sx = inv[0][0] * x + inv[0][1] * y + inv[0][2];
      const sy = inv[1][0] * x + inv[1][1] * y + inv[1][2];
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const o = (y * S + x) * 3;
      if (x0 >= 0 && x0 < srcW - 1 && y0 >= 0 && y0 < srcH - 1) {
        const fx = sx - x0, fy = sy - y0;
        for (let ch = 0; ch < 3; ch++) {
          const i00 = (y0 * srcW + x0) * 4 + ch, i10 = (y0 * srcW + x0 + 1) * 4 + ch;
          const i01 = ((y0 + 1) * srcW + x0) * 4 + ch, i11 = ((y0 + 1) * srcW + x0 + 1) * 4 + ch;
          out[o + ch] = src[i00] * (1 - fx) * (1 - fy) + src[i10] * fx * (1 - fy) + src[i01] * (1 - fx) * fy + src[i11] * fx * fy;
        }
      }
    }
  }
  return out;
}

function preprocess(rgb: Uint8Array): Float32Array {
  const n = MODEL_INPUT * MODEL_INPUT * 3;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (rgb[i] - 127.5) / 127.5;
  return out;
}

// Cheap liveness/lock probe: ML Kit detect ONLY (no jpeg decode, no model run).
// Returns face presence, proximity (box width), and eye-open probability. Fast enough to sample a blink.
export async function probeFace(uri: string): Promise<{ found: boolean; faceFrac: number; eyeOpen: number }> {
  const face = await detectFace(uri);
  if (!face) return { found: false, faceFrac: 0, eyeOpen: -1 };
  // get the actual image width cheaply (header only) to compute true proximity
  let imgW = 0;
  try {
    imgW = await new Promise<number>((res) => Image.getSize(uri, (w) => res(w), () => res(0)));
  } catch {}
  const frac = imgW > 0 && face.box.w > 0 ? Math.min(1, face.box.w / imgW) : 0;
  return { found: true, faceFrac: frac, eyeOpen: face.eyeOpen };
}

export async function embedImageEx(uri: string): Promise<{ embedding: Float32Array; faceFrac: number; eyeOpen: number; computeMs: number }> {
  const _t0 = Date.now();
  console.log('[embed] START', uri);
  const face = await detectFace(uri);
  if (!face) { console.log('[embed] no face -> throw NO_FACE_DETECTED'); throw new Error('NO_FACE_DETECTED'); }
  console.log('[embed] decoding jpeg...');
  const { width, height, data } = await decodeJpeg(uri);
  console.log('[embed] decoded', width, 'x', height, 'bytes', data.length);
  const M = computeAlignMatrix(landmarksToSrc(face));
  console.log('[embed] warping to 112x112...');
  const crop = warpAligned(data, width, height, M);
  let sum = 0, nonzero = 0;
  for (let i = 0; i < crop.length; i++) { sum += crop[i]; if (crop[i] !== 0) nonzero++; }
  console.log('[embed] crop mean=', (sum / crop.length).toFixed(1), 'nonzero%=', ((nonzero / crop.length) * 100).toFixed(0));
  if (DEBUG_DUMP) { _dumpN++; await dumpFrame(uri, 'in'); await dumpCrop(crop, 'crop'); }
  console.log('[embed] loading model...');
  const model = await loadModel();
  console.log('[embed] running model...');
  const out = await model.run([preprocess(crop)]);
  const emb = out[0] as Float32Array;
  const faceFrac = width > 0 ? face.box.w / width : 0;
  const computeMs = Date.now() - _t0;
  console.log('[embed] DONE len', emb.length, 'faceFrac=', faceFrac.toFixed(2), 'eyeOpen=', face.eyeOpen.toFixed(2), 'computeMs=', computeMs, 'first3=', emb[0].toFixed(3), emb[1].toFixed(3), emb[2].toFixed(3));
  return { embedding: emb, faceFrac, eyeOpen: face.eyeOpen, computeMs };
}

// Backward-compatible wrapper (used by legacy VerifyFile)
export async function embedImage(uri: string): Promise<Float32Array> {
  return (await embedImageEx(uri)).embedding;
}
