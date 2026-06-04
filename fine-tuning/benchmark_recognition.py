#!/usr/bin/env python3
"""
Before/after recognition benchmark — verification protocol on an Indian face set.
Runs the SAME model contract the app uses, on an ALIGNED dataset, and reports
genuine vs impostor separation + accuracy. Use it on the pretrained model (BEFORE)
and the fine-tuned model (AFTER) to PROVE whether fine-tuning helped.

INSTALL:  pip install onnxruntime numpy opencv-python
DATA:     aligned 112x112 crops, folder per identity:  data/<person>/*.jpg
          (produce with align_dataset.py; use a HELD-OUT split not seen in training)

RUN:
  python benchmark_recognition.py --model w600k_mbf.onnx --data ./data_eval
  python benchmark_recognition.py --model out/finetuned.onnx --data ./data_eval
Compare the two summaries.
"""
import os, glob, argparse, itertools, random
import numpy as np, cv2
import onnxruntime as ort

SIZE = 112

def load_model(path):
    sess = ort.InferenceSession(path, providers=['CPUExecutionProvider'])
    iname = sess.get_inputs()[0].name
    def embed(img_rgb):
        x = (img_rgb.astype(np.float32) - 127.5) / 127.5     # same as app
        x = np.transpose(x, (2, 0, 1))[None, ...]            # NCHW
        e = sess.run(None, {iname: x})[0][0].astype(np.float32)
        return e / (np.linalg.norm(e) + 1e-9)
    return embed

def gather(data):
    items = []
    for person in sorted(os.listdir(data)):
        d = os.path.join(data, person)
        if not os.path.isdir(d): continue
        for f in glob.glob(os.path.join(d, "*")):
            if f.lower().endswith((".jpg", ".jpeg", ".png")):
                items.append((person, f))
    return items

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--max-impostor", type=int, default=20000)
    args = ap.parse_args()

    embed = load_model(args.model)
    items = gather(args.data)
    if len(items) < 4:
        print("Need more images (folder per identity)."); return

    # embed all
    embs, labels = [], []
    for person, f in items:
        img = cv2.imread(f)
        if img is None: continue
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        if img.shape[:2] != (SIZE, SIZE): img = cv2.resize(img, (SIZE, SIZE))
        embs.append(embed(img)); labels.append(person)
    embs = np.array(embs); labels = np.array(labels)
    ids = sorted(set(labels))
    print(f"[bench] {len(embs)} images, {len(ids)} identities, model={os.path.basename(args.model)}")

    # genuine pairs (same id) and impostor pairs (diff id)
    by = {i: np.where(labels == i)[0] for i in ids}
    gen, imp = [], []
    for i in ids:
        idx = by[i]
        for a, b in itertools.combinations(idx, 2):
            gen.append(float(embs[a] @ embs[b]))
    allidx = list(range(len(embs)))
    random.seed(0)
    tries = 0
    while len(imp) < args.max_impostor and tries < args.max_impostor * 5:
        tries += 1
        a, b = random.sample(allidx, 2)
        if labels[a] != labels[b]: imp.append(float(embs[a] @ embs[b]))
    gen, imp = np.array(gen), np.array(imp)
    if len(gen) == 0 or len(imp) == 0:
        print("Need >=2 images per identity AND >=2 identities."); return

    # sweep threshold for best accuracy
    ths = np.linspace(0.1, 0.9, 81)
    best_acc, best_th = 0, 0.4
    for t in ths:
        acc = ((gen >= t).sum() + (imp < t).sum()) / (len(gen) + len(imp))
        if acc > best_acc: best_acc, best_th = acc, t
    # TAR @ fixed FAR
    def tar_at_far(far_target):
        th = np.quantile(imp, 1 - far_target)  # threshold giving that FAR on impostors
        return (gen >= th).mean(), th
    tar1, th1 = tar_at_far(0.01)
    tar2, th2 = tar_at_far(0.001)

    print("=== RESULT ===")
    print(f"genuine  : mean {gen.mean():.3f}  min {gen.min():.3f}  (n={len(gen)})")
    print(f"impostor : mean {imp.mean():.3f}  max {imp.max():.3f}  (n={len(imp)})")
    print(f"best accuracy {best_acc*100:.2f}% @ threshold {best_th:.2f}")
    print(f"TAR@FAR=1%   {tar1*100:.2f}% (th {th1:.2f})")
    print(f"TAR@FAR=0.1% {tar2*100:.2f}% (th {th2:.2f})")
    print("Compare BEFORE vs AFTER: higher accuracy / higher TAR@low-FAR = fine-tuning helped.")

if __name__ == "__main__":
    main()
