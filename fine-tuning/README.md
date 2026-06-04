# Fine-Tuning w600k_mbf on Indian (Bollywood) Faces

## Objective

Evaluate whether fine-tuning the shipped face recognition model (`w600k_mbf`) on an Indian face dataset improves recognition performance on previously unseen Indian identities.

The experiment uses a strict identity-level train/evaluation split to prevent data leakage and ensure that any improvement reflects genuine generalization rather than memorization.

---

## Model

**Base Model:** `w600k_mbf`

* Architecture: MobileFaceNet + ArcFace
* Source: InsightFace
* Input: 112x112 RGB
* Normalization: `(pixel - 127.5) / 127.5`
* Output: 512-dimensional L2-normalized embedding
* Similarity Metric: Cosine Similarity

---

## Dataset

**Source:** 100 Bollywood Celebrity Faces

Dataset structure:

```text
raw/
├── celebrity_1/
│   ├── img1.jpg
│   ├── img2.jpg
│   └── ...
├── celebrity_2/
│   ├── img1.jpg
│   └── ...
```

For our experiment:

* Total identities: 170
* Training identities: 136
* Held-out evaluation identities: 34

The evaluation identities are completely excluded from training.

---

## Pipeline

### 1. Identity Split (No Leakage)

Create a strict train/evaluation split.

```bash
python split_dataset.py --in ./raw --train ./raw_train --eval ./raw_eval --eval-frac 0.2
```

This ensures identities appearing in evaluation are never seen during training.

---

### 2. Face Alignment

Align all images using the same preprocessing pipeline used by the application.

```bash
python align_dataset.py --in ./raw_train --out ./data_train
python align_dataset.py --in ./raw_eval  --out ./data_eval
```

Output:

* 112x112 RGB
* ArcFace 5-point alignment
* App-compatible geometry

---

### 3. Benchmark the Pretrained Model

Evaluate the shipped model on held-out identities.

```bash
python benchmark_recognition.py --model w600k_mbf.onnx --data ./data_eval
```

Metrics:

* Best Accuracy
* TAR @ FAR = 1%
* TAR @ FAR = 0.1%
* Genuine Mean Cosine
* Impostor Maximum Cosine

---

### 4. Fine-Tune the Model

Convert the shipped ONNX model into a trainable backbone and fine-tune using ArcFace classification.

```bash
python finetune_w600k.py \
    --onnx w600k_mbf.onnx \
    --data ./data_train \
    --epochs 15 \
    --out ./out
```

Training configuration:

* ONNX → Torch via onnx2torch
* First ~70% of backbone frozen
* ArcFace classification head
* AdamW optimizer
* Learning Rate: 1e-3
* Epochs: 15

Output:

```text
out/w600k_mbf_fine_tuned.onnx
```

---

### 5. Benchmark the Fine-Tuned Model

Evaluate using the exact same held-out identities.

```bash
python benchmark_recognition.py \
    --model out/w600k_mbf_fine_tuned.onnx \
    --data ./data_eval
```

---

## Recorded Results

The experiment was executed on:

* 170 Bollywood identities
* 136 training identities
* 34 held-out identities

Evaluation set:

* Genuine pairs: 101,592
* Impostor pairs: 20,000

### Verification Results

| Metric              | Pretrained | Fine-Tuned |
| ------------------- | ---------- | ---------- |
| Best Accuracy       | 94.41%     | **98.41%** |
| TAR @ FAR = 1%      | 75.46%     | **97.62%** |
| TAR @ FAR = 0.1%    | 48.51%     | **93.52%** |
| Genuine Mean Cosine | 0.481      | **0.491**  |
| Impostor Max Cosine | 0.563      | **0.398**  |

---

## Interpretation

The fine-tuned model outperformed the pretrained model across all evaluated verification metrics.

Key observations:

* Accuracy increased from **94.41% → 98.41%**
* TAR @ FAR = 1% increased from **75.46% → 97.62%**
* TAR @ FAR = 0.1% increased from **48.51% → 93.52%**
* Maximum impostor similarity decreased from **0.563 → 0.398**, indicating better separation between different identities and fewer false positives

Because evaluation identities were never used during training, the measured improvements represent genuine generalization rather than memorization.

---

## Decision

### Ship the Fine-Tuned Model

Selected model:

```text
w600k_mbf.onnx
w600k_mbf_float16.tflite
```

Validated performance on unseen Indian identities:

* Accuracy: **98.41%**
* TAR @ FAR = 1%: **97.62%**
* TAR @ FAR = 0.1%: **93.52%**

The fine-tuned model exceeds the target requirement of **95% accuracy on Indian faces**.

---

## TFLite Conversion

Convert the selected model for mobile deployment:

```bash
pip install onnx2tf

onnx2tf \
  -i out/w600k_mbf_fine_tuned.onnx \
  -o ./tflite_out \
  -oiqt
```

Copy the generated Float16 model into the application:

```text
assets/models/w600k_mbf_float16.tflite
```

---

## Reproduce

Install dependencies:

```bash
pip install torch onnx onnx2torch onnxruntime mediapipe==0.10.14 opencv-python numpy
```

Run:

```bash
python split_dataset.py --in ./raw --train ./raw_train --eval ./raw_eval --eval-frac 0.2

python align_dataset.py --in ./raw_train --out ./data_train
python align_dataset.py --in ./raw_eval  --out ./data_eval

python benchmark_recognition.py --model w600k_mbf.onnx --data ./data_eval

python finetune_w600k.py --onnx w600k_mbf.onnx --data ./data_train --epochs 15 --out ./out

python benchmark_recognition.py --model out/w600k_mbf.onnx --data ./data_eval
```

---

## Notes

* Identity-level splitting is critical to prevent data leakage.
* Evaluation identities must never appear in training.
* The model contract remains unchanged:

  * 112x112 RGB input
  * `(x - 127.5) / 127.5`
  * 512-dimensional embedding
  * Cosine similarity matching
* Application threshold: `0.40`

The fine-tuning pipeline has been validated and can be extended with larger Indian face datasets to further improve robustness and recognition performance.
