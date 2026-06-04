# Face Attendance — Offline Facial Recognition & Liveness

A secure, **offline-first** face-recognition attendance system for remote locations.
Face detection, blink liveness, and recognition run **entirely on the device**; recorded
attendance uploads automatically once connectivity returns and is then purged locally.

- **Platform:** React Native (Android 8+ / iOS 12+)
- **Model:** `w600k_mbf_float16.tflite` (MobileFaceNet + ArcFace), ~6.5 MB
- **Recognition + liveness:** on-device, sub-second
- **Validated accuracy (held-out Indian faces):** 98.41% · TAR@FAR=1% 97.62% · TAR@FAR=0.1% 93.52%
- **Liveness:** blink (offline anti-spoofing — defeats photo/screen replay)
- **Sync & purge:** offline outbox → batched upload on reconnect → local purge on confirm

---

## Demo video

<!-- INLINE PLAYER: open this README in GitHub's web editor, drag-drop media/demo.mp4 into
     the line below, and GitHub will replace it with a playable user-images URL. -->

https://github.com/USER/REPO/raw/main/media/demo.mp4

_If the player above doesn't load, download/watch the clip directly:_ **[media/demo.mp4](./media/demo.mp4)**



---

## Benchmark & validation

The shipped model (`w600k_mbf_float16.tflite`) was validated on a **held-out** Indian
(Bollywood) face set using a leakage-free identity split — the evaluation identities never
appear in any tuning, so the numbers reflect generalization, not memorization.

| Metric | Result |
|---|---|
| Best accuracy | **98.41%** |
| TAR @ FAR = 1% | **97.62%** |
| TAR @ FAR = 0.1% | **93.52%** |
| Genuine mean cosine | 0.491 |
| Impostor max cosine | 0.398 |
| Evaluation set | 101,592 genuine pairs · 20,000 impostor pairs · 34 held-out identities |

This **exceeds the >95% accuracy requirement** on diverse Indian faces. A full fine-tuning
pipeline is also provided (`fine-tuning/`) to adapt the model to a custom population.
Full method and details → **[fine-tuning/FINETUNING_REPORT.md](./fine-tuning/FINETUNING_REPORT.md)**

**On-device performance:** recognition + liveness complete in well under a second on a
phone; model size ~6.5 MB.

---

## Repository structure

| Folder / file | What it is |
|---|---|
| `FaceAppDemo/` | The React Native mobile app (Android + iOS source). |
| `fine-tuning/` | Offline model pipeline: dataset split, alignment, fine-tune, and benchmark. |
| `aws-rest/` | Reference attendance REST server (Flask) for testing sync & purge. |
| `media/` | Demo video. |
| `SETUP_GUIDE.md` | Build & run instructions (environment, install, troubleshooting). |
| `INTEGRATION.md` | Architecture, model contract, recognition pipeline, and sync/purge REST contract. |

---

## 1. The app — `FaceAppDemo/`

Camera-only attendance app. Enroll a person (guided multi-frame capture), then mark
attendance (face lock → blink liveness → on-device match). Attendance is queued locally
and synced when online.

**Quick start**
```bash
cd FaceAppDemo
npm install
npx react-native start          # terminal 1 (Metro)
npx react-native run-android    # terminal 2 (build + install)
```

- Full setup, prerequisites, and troubleshooting → **[SETUP_GUIDE.md](./SETUP_GUIDE.md)**
- Architecture, model & pipeline, sync/purge contract → **[INTEGRATION.md](./INTEGRATION.md)**
- Screen-by-screen walkthrough (PDF) → **[fine-tuning/Face_Attendance_User_Guide.pdf](./fine-tuning/Face_Attendance_User_Guide.pdf)**

---

## 2. Model pipeline — `fine-tuning/`

Reproducible, leakage-free pipeline to align a face dataset, (optionally) fine-tune the
model, and benchmark it on a held-out split. The app ships
`w600k_mbf_float16.tflite`; this pipeline lets the model be evaluated or adapted to a
custom population.

**Quick start**
```bash
cd fine-tuning
pip install torch onnx onnx2torch onnxruntime mediapipe==0.10.14 opencv-python numpy

python split_dataset.py --in ./raw --train ./raw_train --eval ./raw_eval --eval-frac 0.2
python align_dataset.py --in ./raw_train --out ./data_train
python align_dataset.py --in ./raw_eval  --out ./data_eval
python benchmark_recognition.py --model ./out/w600k_mbf.onnx --data ./data_eval
```

- Pipeline guide → **[fine-tuning/README.md](./fine-tuning/README.md)**
- Experiment & model-selection report → **[fine-tuning/FINETUNING_REPORT.md](./fine-tuning/FINETUNING_REPORT.md)**

Model contract (kept identical between app and pipeline): 112×112 RGB input,
`(x-127.5)/127.5` normalization, 512-d L2-normalized embedding, cosine similarity.

---

## 3. Attendance server — `aws-rest/`

A small Flask server that accepts the app's sync POST, used to test the
**sync & purge** flow without an AWS account.

**Quick start**
```bash
cd aws-rest
pip install flask
python attendance_server.py        # listens on 0.0.0.0:5000
```
Point the app at it in `FaceAppDemo/src/config/sync.config.json`
(`"demoMode": false`, `"awsEndpoint": "http://10.0.2.2:5000/attendance"` for the emulator).

- REST contract and production notes (API Gateway → Lambda → DynamoDB) → **[INTEGRATION.md](./INTEGRATION.md#5-sync--purge-service)**

---

## How it maps to the requirements

| Requirement | Where |
|---|---|
| Offline face recognition | `FaceAppDemo/src/recognition/` · model in `FaceAppDemo/assets/models/` |
| Offline liveness (anti-spoofing) | blink check in `FaceAppDemo/src/screens/CameraScan.tsx` |
| Sync & purge after reconnect | `FaceAppDemo/src/sync/` · `aws-rest/` · INTEGRATION.md |
| >95% accuracy on Indian faces | 98.41% held-out — see Benchmark & validation above |
| Cross-platform (Android + iOS) | `FaceAppDemo/android/` and `FaceAppDemo/ios/` |
| Documentation & presentation | SETUP_GUIDE.md · INTEGRATION.md · user-guide PDF · demo video |

---

## Notes

- Everything that identifies a face runs **offline**; the only network activity is
  uploading attendance records (name, id, timestamp).
- Before a release build, set `DEBUG_DUMP = false` in
  `FaceAppDemo/src/recognition/model.ts`.
- The app's model is open-source (MobileFaceNet / ArcFace, InsightFace).

_More detail in the linked guides; this README is the entry point._
