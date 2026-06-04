# Face Attendance — Setup & Build Guide

Offline face-recognition attendance app (React Native). This guide takes you from a
clean machine to the app running on an Android device/emulator.

---

## 1. Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 20.x LTS | `node -v` |
| JDK | 17 | `java -version` |
| Android Studio | latest | for SDK + emulator |
| Android SDK | API 34/35 | installed via Android Studio |
| Python | 3.10+ | only for the local sync test server |

Supported targets: **Android 8.0+ (API 26)**, iOS 12+ (iOS requires a Mac to build).

### Environment variables (Windows PowerShell)
Set these in **every** terminal you build from:
```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path = "$env:Path;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator"
```
(macOS/Linux: set `ANDROID_HOME` to `~/Library/Android/sdk` or `~/Android/Sdk` and add
`platform-tools`/`emulator` to `PATH`.)

---

## 2. Install dependencies
From the project root (`D:\dev\FaceAppDemo`):
```powershell
npm install
```

Key native dependencies (already in package.json):
- `react-native-vision-camera` — camera capture
- `@react-native-ml-kit/face-detection` — face + landmark + eye-open detection
- `react-native-fast-tflite@1.6.1` — TFLite inference (pinned to 1.6.x on purpose; see Troubleshooting)
- `react-native-fs`, `jpeg-js`, `buffer` — image decode pipeline
- `@react-native-async-storage/async-storage` — local enrollment + attendance store
- `@react-native-community/netinfo` — connectivity detection for sync

---

## 3. Start the emulator
Launch an emulator from Android Studio (or `emulator -avd <name>`), then confirm it's
visible:
```powershell
adb devices
```
You should see one device listed.

---

## 4. Run the app (two terminals)

**Terminal 1 — Metro bundler:**
```powershell
cd D:\dev\FaceAppDemo
npx react-native start
```
Leave it running.

**Terminal 2 — build + install (env vars set as in step 1):**
```powershell
cd D:\dev\FaceAppDemo
npx react-native run-android
```
First build takes several minutes. When it completes, the app launches on the device.

---

## 5. When to rebuild vs. reload

| Change type | Action |
|-------------|--------|
| JS / TS edit (screens, logic, config JSON) | Press `r` in Metro (or shake → Reload) |
| Native change (new module, manifest, gradle, assets) | Full `npx react-native run-android` |

---

## 6. Troubleshooting (known issues + fixes)

**"Unable to load script" / blank red screen**
Metro isn't reachable from the device. Fix:
```powershell
adb reverse tcp:8081 tcp:8081
```
Then reload (`adb shell input keyevent 82` → Reload). If it persists, restart Metro clean:
```powershell
npx react-native start --reset-cache
```

**`TfliteModule.createModel: Value is undefined`**
This appears with `react-native-fast-tflite` v3.x, which requires the New Architecture.
This project pins **v1.6.1** (no Nitro, same API). Keep it pinned; don't upgrade to 3.x
unless you enable the New Architecture project-wide.

**VisionCamera "Frame Processors are disabled" log**
Expected and intentional. `VisionCamera_enableFrameProcessors=false` in
`android/gradle.properties` avoids the worklets-core dependency; the app uses
photo capture, not frame processors.

**`resource xml/network_security_config not found` (build fails)**
The manifest references a config file that isn't in place. Put
`network_security_config.xml` at
`android/app/src/main/res/xml/network_security_config.xml` and rebuild. (Only needed if
you enable cleartext HTTP for local sync testing — see INTEGRATION.md.)

**Camera permission**
On first launch the app requests camera access; grant it. If denied, enable it in
device Settings → Apps → Face Attendance → Permissions.

**Logs (Windows)**
```powershell
adb logcat *:S ReactNativeJS:V
```
(The `logkitty`/`log-android` helpers can hang on Windows; use `adb logcat` directly.)

---

## 7. Project layout (quick map)
```
FaceAppDemo/
├── App.tsx                      app entry + screen router
├── assets/models/
│   └── w600k_mbf_float16.tflite face embedding model (6.5 MB)
├── src/
│   ├── recognition/             align.ts, model.ts, match.ts (the recognition pipeline)
│   ├── screens/                 VerifyHome, ScanCamera, Admin, ... (UI)
│   ├── storage/store.ts         enrolled people + attendance outbox (AsyncStorage)
│   ├── sync/syncService.ts      connectivity-driven upload + purge
│   ├── config/sync.config.json  sync endpoint + flags
│   └── ui/                      theme + shared components
└── android/                     native Android project
```

See **INTEGRATION.md** for how the model, recognition pipeline, and sync service fit
together, and **USER_GUIDE.md** for day-to-day operation.
