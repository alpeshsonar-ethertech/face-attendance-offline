# Face Attendance — Integration & Architecture

How the pieces fit together: the recognition model, the on-device pipeline, local
storage, and the sync-and-purge REST service.

---

## 1. System overview

```
 Camera ─▶ Face detect ─▶ Align (112x112) ─▶ Embed (TFLite) ─▶ Match ─▶ Mark attendance
 (VisionCamera)  (ML Kit)      (5-pt warp)     (w600k_mbf)     (cosine)        │
                                                                               ▼
                                                              Local outbox (AsyncStorage)
                                                                               │
                                              network restored ─▶ POST batch ─▶ REST endpoint
                                                                               │
                                                                  on 200 OK ─▶ purge synced
```

Everything from capture to match runs **fully offline on the device**. The only network
step is uploading recorded attendance when connectivity returns.

---

## 2. The recognition model

- **File:** `assets/models/w600k_mbf_float16.tflite` (~6.5 MB)
- **Architecture:** MobileFaceNet embedding network
- **Input:** `[1, 112, 112, 3]`, RGB, normalized `(pixel - 127.5) / 127.5`
- **Output:** `[1, 512]` embedding
- **Matching:** L2-normalize the embedding, compare by **cosine similarity**

The model is loaded once and kept warm (`src/recognition/model.ts`). A single
recognition pass (detect → align → embed) completes in well under a second on device.

### Alignment contract
Faces are aligned to the standard 5-point ArcFace template using a similarity
(umeyama) transform before embedding:
```
left_eye  (38.29, 51.70)
right_eye (73.53, 51.50)
nose      (56.03, 71.74)
mouth_l   (41.55, 92.37)
mouth_r   (70.73, 92.20)
```
This exact geometry is shared between the app and the offline training/benchmark
pipeline, so embeddings are consistent across both.

---

## 3. On-device recognition pipeline (`src/recognition/`)

| File | Responsibility |
|------|----------------|
| `model.ts` | Load TFLite model; capture frame → ML Kit detect → JPEG decode → align → run model → 512-d embedding. Handles EXIF orientation so the crop matches the detector's coordinate space. |
| `align.ts` | 5-point similarity transform + 112x112 warp. |
| `match.ts` | Cosine similarity of probe vs. enrolled embeddings; returns best match + score; `DEFAULT_THRESHOLD` gates accept/reject. |

**Matching threshold** is defined in `src/recognition/match.ts` (`DEFAULT_THRESHOLD`).
It is chosen from the verification benchmark to sit comfortably between genuine and
impostor score distributions. Raise it for stricter matching (fewer false accepts),
lower it for more lenient matching.

---

## 4. Local storage (`src/storage/store.ts`)

Backed by AsyncStorage (no server needed for normal operation):

- **Enrolled people:** name + averaged face embedding (+ optional thumbnail).
- **Attendance outbox:** queued attendance records awaiting sync.

Outbox record shape:
```json
{ "id": "1780500000000_ab12c", "personId": "p1", "name": "Asha", "ts": 1780500000000, "synced": false }
```
API: `addAttendance`, `getOutbox`, `markSynced`, `purgeSynced`, `outboxCounts`.

---

## 5. Sync & Purge service

### 5.1 Config (`src/config/sync.config.json`)
```json
{
  "syncEnabled": true,
  "demoMode": false,
  "awsEndpoint": "https://<your-endpoint>/attendance",
  "batchSize": 50,
  "purgeAfterSync": true,
  "retryIntervalSec": 30
}
```
| Field | Meaning |
|-------|---------|
| `syncEnabled` | master on/off |
| `demoMode` | `true` = simulate upload (no network needed, safe for demos); `false` = real HTTP POST |
| `awsEndpoint` | the REST URL that receives attendance |
| `batchSize` | max records per POST |
| `purgeAfterSync` | delete records locally once the server confirms (the "purge" requirement) |
| `retryIntervalSec` | retry cadence while offline |

### 5.2 Behaviour (`src/sync/syncService.ts`)
- `startAutoSync()` is called on app launch; it listens for connectivity via NetInfo.
- When the network transitions to **online**, it uploads queued records in batches.
- On HTTP `200`, those records are marked synced and **purged** from the device.
- A manual **"Sync now"** action (Admin → Sync status) triggers the same flow on demand.

### 5.3 REST contract
The app sends:
```
POST {awsEndpoint}
Content-Type: application/json

{ "records": [ { "id": "...", "personId": "...", "name": "...", "ts": 1780500000000 }, ... ] }
```
The server must respond `200 OK` to confirm receipt (any body). Recommended response:
```json
{ "ok": true, "accepted": ["id1","id2"], "duplicates": [] }
```
The endpoint should be **idempotent** by record `id` so retries don't double-count.

### 5.4 Production endpoint
A typical production deployment is **API Gateway → Lambda → DynamoDB** behind HTTPS.
The device should authenticate with a short-lived token or pre-signed URL issued by your
backend — **never embed AWS keys in the app or config**.

### 5.5 Local testing (no AWS account)
Point `awsEndpoint` at a local server and run a Flask stub:
- Emulator → host PC alias: `http://10.0.2.2:5000/attendance`
- Physical phone on same Wi-Fi: `http://<PC-LAN-IP>:5000/attendance`

Android blocks cleartext HTTP by default, so for local HTTP testing add
`android/app/src/main/res/xml/network_security_config.xml` permitting cleartext to
`10.0.2.2`/`localhost`, and reference it from `<application
android:networkSecurityConfig="@xml/network_security_config">`. Use HTTPS in production
(no config needed).

---

## 6. Training / benchmark pipeline (separate)
The model can be re-trained or adapted to a custom population using the offline pipeline
documented separately (`split_dataset.py`, `align_dataset.py`, `finetune_w600k.py`,
`benchmark_recognition.py`). The app consumes the resulting
`w600k_mbf_float16.tflite`; the input/preprocessing contract above must stay unchanged
for compatibility.

---

## 7. Configuration checklist before shipping a build
- [ ] `sync.config.json` → set `awsEndpoint`, choose `demoMode` (true for stage demos)
- [ ] `DEBUG_DUMP` in `src/recognition/model.ts` → set `false` for release (stops writing
      debug frames/crops to app storage)
- [ ] Camera permission string present in the Android manifest / iOS Info.plist
- [ ] HTTPS endpoint + token auth for production sync
