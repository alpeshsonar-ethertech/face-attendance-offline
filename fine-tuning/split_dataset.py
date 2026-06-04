#!/usr/bin/env python3
"""
Split a folder-per-identity dataset into TRAIN and EVAL with NO data leakage.

Default = IDENTITY split: some celebrities go entirely to eval (model never sees them
in training). This measures true generalization -> the honest, defensible benchmark.

USAGE:
  python split_dataset.py --in ./raw --train ./raw_train --eval ./raw_eval --eval-frac 0.2
  # image split instead (same people, different photos):
  python split_dataset.py --in ./raw --train ./raw_train --eval ./raw_eval --mode image
"""
import os, glob, shutil, argparse, random

def copy(files, dst_person):
    os.makedirs(dst_person, exist_ok=True)
    for f in files: shutil.copy(f, os.path.join(dst_person, os.path.basename(f)))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--train", default="./raw_train")
    ap.add_argument("--eval", default="./raw_eval")
    ap.add_argument("--eval-frac", type=float, default=0.2)
    ap.add_argument("--mode", choices=["identity", "image"], default="identity")
    ap.add_argument("--seed", type=int, default=42)
    a = ap.parse_args()
    random.seed(a.seed)
    ids = sorted([d for d in os.listdir(a.src) if os.path.isdir(os.path.join(a.src, d))])
    if not ids: raise SystemExit("No identity folders under " + a.src)

    if a.mode == "identity":
        random.shuffle(ids)
        n_eval = max(1, int(len(ids) * a.eval_frac))
        eval_ids = set(ids[:n_eval])
        for pid in ids:
            files = [f for f in glob.glob(os.path.join(a.src, pid, "*"))
                     if f.lower().endswith((".jpg", ".jpeg", ".png"))]
            dst = a.eval if pid in eval_ids else a.train
            copy(files, os.path.join(dst, pid))
        print(f"[split] identity mode: {len(ids)-len(eval_ids)} train ids, {len(eval_ids)} held-out eval ids (no overlap)")
    else:
        for pid in ids:
            files = [f for f in glob.glob(os.path.join(a.src, pid, "*"))
                     if f.lower().endswith((".jpg", ".jpeg", ".png"))]
            random.shuffle(files)
            k = max(1, int(len(files) * a.eval_frac))
            copy(files[k:], os.path.join(a.train, pid))   # train = remaining
            copy(files[:k], os.path.join(a.eval, pid))    # eval = held-out images
        print(f"[split] image mode: {len(ids)} ids, ~{int(a.eval_frac*100)}% images held out per id")

if __name__ == "__main__":
    main()
