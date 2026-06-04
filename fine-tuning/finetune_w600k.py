#!/usr/bin/env python3
"""
Fine-tune the EXACT shipped model (w600k_mbf) on an Indian face dataset.

Approach: convert the shipped ONNX into a trainable PyTorch backbone via onnx2torch,
attach an ArcFace head for the new identities, fine-tune with a LOW learning rate
(so we adapt, not destroy, the pretrained weights), then export back to ONNX.
This keeps it the SAME weights the app ships -> a truthful "fine-tuned" claim.

INSTALL (on your GPU machine):
  pip install torch onnx onnx2torch numpy opencv-python

DATA (aligned 112x112, folder per identity; use align_dataset.py):
  data_train/<person>/*.jpg   (training split)
  data_eval/<person>/*.jpg    (HELD-OUT split for benchmark_recognition.py)

RUN:
  python finetune_w600k.py --onnx w600k_mbf.onnx --data ./data_train --epochs 15 --out ./out
  # then benchmark BEFORE vs AFTER:
  python benchmark_recognition.py --model w600k_mbf.onnx        --data ./data_eval
  python benchmark_recognition.py --model out/w600k_mbf_ft.onnx --data ./data_eval

DECISION RULE (honesty):
  Only ship out/w600k_mbf_ft.onnx (convert to TFLite) and claim "fine-tuned" IF the
  AFTER benchmark is clearly better than BEFORE on the held-out split. If it is not
  better, keep the pretrained model and claim "selected + validated", not "fine-tuned".
"""
import os, glob, argparse, math, random
import numpy as np, cv2
import torch, torch.nn as nn, torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader

SIZE, EMB = 112, 512

class FaceFolder(Dataset):
    def __init__(self, root):
        self.classes = sorted([d for d in os.listdir(root) if os.path.isdir(os.path.join(root, d))])
        self.c2i = {c: i for i, c in enumerate(self.classes)}
        self.samples = [(f, self.c2i[c]) for c in self.classes
                        for f in glob.glob(os.path.join(root, c, "*"))
                        if f.lower().endswith((".jpg", ".jpeg", ".png"))]
        if not self.samples: raise RuntimeError("No images under " + root)
    def __len__(self): return len(self.samples)
    def __getitem__(self, i):
        f, y = self.samples[i]
        img = cv2.cvtColor(cv2.imread(f), cv2.COLOR_BGR2RGB)
        if img.shape[:2] != (SIZE, SIZE): img = cv2.resize(img, (SIZE, SIZE))
        if random.random() < 0.5: img = img[:, ::-1, :]
        x = (img.astype(np.float32) - 127.5) / 127.5
        return torch.from_numpy(np.transpose(x, (2, 0, 1)).copy()), y

class ArcFace(nn.Module):
    def __init__(self, emb, n, s=32.0, m=0.4):   # modest s/m for fine-tuning stability
        super().__init__()
        self.W = nn.Parameter(torch.empty(n, emb)); nn.init.xavier_uniform_(self.W)
        self.s, self.cos_m, self.sin_m = s, math.cos(m), math.sin(m)
        self.th, self.mm = math.cos(math.pi - m), math.sin(math.pi - m) * m
    def forward(self, e, y):
        cos = F.linear(F.normalize(e), F.normalize(self.W)).clamp(-1, 1)
        sin = torch.sqrt((1 - cos * cos).clamp(min=1e-9))
        phi = cos * self.cos_m - sin * self.sin_m
        phi = torch.where(cos > self.th, phi, cos - self.mm)
        oh = torch.zeros_like(cos); oh.scatter_(1, y.view(-1, 1), 1.0)
        return (oh * phi + (1 - oh) * cos) * self.s

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--onnx", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", default="./out")
    ap.add_argument("--epochs", type=int, default=15)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--lr", type=float, default=1e-3)   # LOW: fine-tune, don't wreck pretrained
    ap.add_argument("--freeze-frac", type=float, default=0.7)  # freeze first 70% of params
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    dev = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    # load the shipped ONNX as a trainable torch backbone.
    # NOTE: onnx2torch's internal shape-inference uses a NamedTemporaryFile and reopens it
    # by name, which fails on Windows (PermissionError). So we run shape inference ourselves
    # into a path we control, then hand the in-memory ModelProto to convert().
    import onnx
    from onnx import shape_inference
    from onnx2torch import convert
    inferred_path = os.path.join(args.out, "_w600k_inferred.onnx")
    onnx.save(shape_inference.infer_shapes(onnx.load(args.onnx)), inferred_path)
    model_proto = onnx.load(inferred_path)
    backbone = convert(model_proto).to(dev)

    # freeze early layers so we adapt the head/late layers, preserving pretrained features
    params = list(backbone.parameters())
    cut = int(len(params) * args.freeze_frac)
    for p in params[:cut]: p.requires_grad = False
    print(f"[ft] froze {cut}/{len(params)} backbone params")

    ds = FaceFolder(args.data); print(f"[ft] {len(ds)} imgs / {len(ds.classes)} ids")
    dl = DataLoader(ds, batch_size=args.batch, shuffle=True, num_workers=4, drop_last=True)
    head = ArcFace(EMB, len(ds.classes)).to(dev)
    opt = torch.optim.AdamW([p for p in backbone.parameters() if p.requires_grad] + list(head.parameters()),
                            lr=args.lr, weight_decay=1e-4)
    crit = nn.CrossEntropyLoss()

    for ep in range(args.epochs):
        backbone.train(); head.train(); tot = 0
        for x, y in dl:
            x, y = x.to(dev), y.to(dev)
            e = backbone(x)
            if isinstance(e, (tuple, list)): e = e[0]
            loss = crit(head(e, y), y)
            opt.zero_grad(); loss.backward(); opt.step(); tot += loss.item()
        print(f"[ft] epoch {ep+1}/{args.epochs} loss {tot/len(dl):.4f}")

    backbone.eval()
    dummy = torch.randn(1, 3, SIZE, SIZE, device=dev)
    out_onnx = os.path.join(args.out, "w600k_mbf_ft.onnx")
    torch.onnx.export(backbone, dummy, out_onnx, input_names=["input"], output_names=["embedding"],
                      opset_version=12, dynamic_axes={"input": {0: "b"}, "embedding": {0: "b"}})
    print(f"[ft] exported {out_onnx}")
    print("[ft] now benchmark BEFORE vs AFTER, and only ship if AFTER is better.")

if __name__ == "__main__":
    main()