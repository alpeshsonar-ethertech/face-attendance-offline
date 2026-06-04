#!/usr/bin/env python3
"""
Prepare a raw photo dataset into 112x112 ALIGNED face crops for train_face.py.
Uses the SAME 5-point ArcFace template + similarity transform as the app, so crops
are identical in geometry to what the app feeds the model at inference.

INPUT:  raw/<person>/*.jpg   (any size, one or more faces; largest face used)
OUTPUT: data/<person>/*.jpg  (112x112 aligned RGB)

INSTALL:  pip install mediapipe==0.10.14 opencv-python numpy
RUN:      python align_dataset.py --in ./raw --out ./data
"""
import os, glob, argparse
import numpy as np, cv2

SIZE = 112
TEMPLATE = np.array([[38.2946,51.6963],[73.5318,51.5014],[56.0252,71.7366],
                     [41.5493,92.3655],[70.7299,92.2041]], dtype=np.float32)  # le,re,nose,ml,mr

def umeyama(src, dst):
    n, d = src.shape
    sm, dm = src.mean(0), dst.mean(0); sd, dd = src-sm, dst-dm
    A = dd.T @ sd / n; e = np.ones(d)
    if np.linalg.det(A) < 0: e[d-1] = -1
    U, S, V = np.linalg.svd(A); T = np.eye(d+1)
    if np.linalg.matrix_rank(A) == d-1:
        if np.linalg.det(U)*np.linalg.det(V) > 0: T[:d,:d] = U@V
        else: s=e[d-1]; e[d-1]=-1; T[:d,:d]=U@np.diag(e)@V; e[d-1]=s
    else: T[:d,:d] = U@np.diag(e)@V
    scale = 1.0/sd.var(0).sum()*(S@e)
    T[:d,d] = dm - scale*(T[:d,:d]@sm); T[:d,:d] *= scale
    return T[:d].astype(np.float32)

def landmarks(img, fm):
    res = fm.process(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
    if not res.multi_face_landmarks: return None
    L = res.multi_face_landmarks[0].landmark; h, w = img.shape[:2]
    P = lambda i: np.array([L[i].x*w, L[i].y*h], np.float32)
    eA=(P(33)+P(133)+P(159)+P(145))/4; eB=(P(362)+P(263)+P(386)+P(374))/4
    nose=P(1); mA,mB=P(61),P(291)
    le,re = sorted([eA,eB], key=lambda p:p[0]); ml,mr = sorted([mA,mB], key=lambda p:p[0])
    return np.array([le,re,nose,ml,mr], np.float32)

def main():
    import mediapipe as mp
    ap = argparse.ArgumentParser(); ap.add_argument("--in", dest="src", default="./raw"); ap.add_argument("--out", default="./data")
    a = ap.parse_args()
    fm = mp.solutions.face_mesh.FaceMesh(static_image_mode=True, max_num_faces=1, refine_landmarks=True)
    people = [d for d in os.listdir(a.src) if os.path.isdir(os.path.join(a.src, d))]
    total = ok = 0
    for person in people:
        os.makedirs(os.path.join(a.out, person), exist_ok=True)
        for f in glob.glob(os.path.join(a.src, person, "*")):
            if not f.lower().endswith((".jpg",".jpeg",".png")): continue
            total += 1
            img = cv2.imread(f)
            if img is None: continue
            kps = landmarks(img, fm)
            if kps is None: print("  no face:", f); continue
            M = umeyama(kps, TEMPLATE)
            crop = cv2.warpAffine(img, M, (SIZE, SIZE), borderValue=0)
            out = os.path.join(a.out, person, os.path.basename(f))
            cv2.imwrite(out, crop); ok += 1
    print(f"[align] aligned {ok}/{total} images -> {a.out}")

if __name__ == "__main__":
    main()
