import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, Linking } from 'react-native';
import { Camera, useCameraDevice, useCameraDevices, useCameraFormat, useCameraPermission } from 'react-native-vision-camera';
import { Screen, Header, H2, Lead, Btn } from '../ui/components';
import { T } from '../ui/theme';
import { embedImageEx, probeFace, loadModel } from '../recognition/model';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: any[]) => console.log('[FaceScan]', ...a);

const SIZE = 230;
const SEGMENTS = 28;
const MIN_FACE_FRAC = 0.30;   // face must fill >=30% (else "move closer")
const EYE_OPEN = 0.6;         // > this = open
const EYE_CLOSED = 0.35;      // < this = closed (full blink = open->closed->open)
const LOCK_FRAMES = 2;        // good close frames needed to "lock"
const RED = '#ef4444';

type Phase = 'idle' | 'lock' | 'blink' | 'recognize';

function Ring({ filled, accent, children }: { filled: number; accent: string; children: React.ReactNode }) {
  return (
    <View style={{ width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' }}>
      {Array.from({ length: SEGMENTS }).map((_, i) => (
        <View key={i} pointerEvents="none"
          style={{ position: 'absolute', width: SIZE, height: SIZE, alignItems: 'center', transform: [{ rotate: `${(i / SEGMENTS) * 360}deg` }] }}>
          <View style={{ width: 5, height: 14, borderRadius: 3, marginTop: 1, backgroundColor: i < filled ? accent : '#e2e7f0' }} />
        </View>
      ))}
      <View style={{ width: SIZE - 38, height: SIZE - 38, borderRadius: (SIZE - 38) / 2, overflow: 'hidden', backgroundColor: '#cfd8e6', borderWidth: 3, borderColor: accent }}>
        {children}
      </View>
    </View>
  );
}

interface Props {
  title: string; subtitle: string; prompt: string;
  target: number; minNeeded: number;
  requireBlink?: boolean;
  recognizeHeadline?: string; // PHASE 2 headline (default 'Verifying…')
  recognizeSub?: string;      // PHASE 2 subtext (default 'Matching your face')
  onComplete: (embeds: Float32Array[], photoPaths: string[]) => void;
  onCancel: () => void;
}

export default function CameraScan({ title, subtitle, prompt, target, minNeeded, requireBlink, recognizeHeadline, recognizeSub, onComplete, onCancel }: Props) {
  const front = useCameraDevice('front');
  const back = useCameraDevice('back');
  const all = useCameraDevices();
  const device = front ?? back ?? (all && all.length ? all[0] : undefined);
  const format = useCameraFormat(device, [{ photoResolution: { width: 640, height: 480 } }]);
  const { hasPermission, requestPermission } = useCameraPermission();
  const cam = useRef<Camera>(null);
  const cancelled = useRef(false);
  const snapFailed = useRef(false);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [far, setFar] = useState(false);
  const [lockProg, setLockProg] = useState(0);
  const [blinked, setBlinked] = useState(false);
  const [verifyMs, setVerifyMs] = useState<number | null>(null);
  const [captured, setCaptured] = useState(0);

  useEffect(() => { if (!hasPermission) requestPermission(); }, [hasPermission, requestPermission]);
  useEffect(() => { loadModel().then(() => log('model warmed')).catch((e) => log('warmup err', String(e))); }, []);
  useEffect(() => () => { cancelled.current = true; }, []);

  // cheap preview grab for the gate: snapshot (fast) with takePhoto fallback
  const grab = async (): Promise<string | null> => {
    try {
      if (!snapFailed.current) {
        const s = await cam.current!.takeSnapshot({ quality: 80 });
        return s.path.startsWith('file') ? s.path : 'file://' + s.path;
      }
    } catch (e) { snapFailed.current = true; log('snapshot unavailable, using takePhoto:', String(e)); }
    const p = await cam.current!.takePhoto({ enableShutterSound: false });
    return p.path.startsWith('file') ? p.path : 'file://' + p.path;
  };

  const start = async () => {
    if (!cam.current) return;
    log('START two-phase scan, requireBlink', !!requireBlink);
    setRunning(true); setFar(false); setLockProg(0); setBlinked(false); setVerifyMs(null); setCaptured(0);
    cancelled.current = false; snapFailed.current = false;

    // ---------- PHASE 1: lock + blink (detect-only on fast snapshots) ----------
    setPhase('lock');
    let lock = 0; let sawOpen = false, sawClosed = false, blinkDone = false;
    let tries = 0;
    while (!cancelled.current && tries < 80 && (lock < LOCK_FRAMES || (requireBlink && !blinkDone))) {
      tries++;
      try {
        const uri = await grab();
        if (!uri) { await sleep(80); continue; }
        const pr = await probeFace(uri);
        if (!pr.found) { setFar(false); setPhase('lock'); await sleep(80); continue; }
        if (pr.faceFrac < MIN_FACE_FRAC) { setFar(true); await sleep(80); continue; }
        setFar(false);
        if (lock < LOCK_FRAMES) { lock++; setLockProg(lock / LOCK_FRAMES); }
        if (lock >= LOCK_FRAMES && requireBlink) {
          setPhase('blink');
          if (pr.eyeOpen >= 0) {
            if (pr.eyeOpen > EYE_OPEN) { if (sawClosed && sawOpen) blinkDone = true; sawOpen = true; }
            else if (pr.eyeOpen < EYE_CLOSED && sawOpen) sawClosed = true;
            if (blinkDone && !blinked) { setBlinked(true); log('BLINK ok'); }
          }
        }
      } catch (e) { log('gate err', String(e)); }
      await sleep(80); // fast sampling
    }
    if (cancelled.current) { setRunning(false); setPhase('idle'); return; }
    if (lock < LOCK_FRAMES) {
      setRunning(false); setPhase('idle');
      Alert.alert('Try again', 'Could not lock onto a close, centered face. Hold the phone at arm’s length in good light.');
      return;
    }
    if (requireBlink && !blinkDone) {
      setRunning(false); setPhase('idle');
      Alert.alert('Liveness check failed', 'We could not confirm a live person. Look at the camera and blink once.');
      return;
    }

    // ---------- PHASE 2: ONE sub-second recognition pass ----------
    setPhase('recognize');
    const embeds: Float32Array[] = []; const paths: string[] = [];
    let rtries = 0;
    const want = Math.max(1, target); // attendance=1 (fast); enroll=4
    const budget = want === 1 ? 5 : want * 3 + 2; // enough chances to reach target
    while (!cancelled.current && embeds.length < want && rtries < budget) {
      rtries++;
      try {
        const p = await cam.current.takePhoto({ enableShutterSound: false });
        const uri = p.path.startsWith('file') ? p.path : 'file://' + p.path;
        const { embedding, faceFrac, computeMs } = await embedImageEx(uri);
        if (faceFrac >= MIN_FACE_FRAC) {
          embeds.push(embedding); paths.push(uri);
          setVerifyMs(computeMs);
          setCaptured(embeds.length);
          log('captured frame', embeds.length, 'of', want, '-', computeMs, 'ms');
        } else {
          log('frame skipped (face too small/absent), faceFrac', faceFrac.toFixed(2));
        }
      } catch (e) { log('recog err', String(e)); }
      if (want > 1 && embeds.length < want) await sleep(160); // pace multi-frame capture; let user hold still
    }
    setRunning(false); setPhase('idle');
    if (cancelled.current) return;
    if (embeds.length < minNeeded) {
      Alert.alert('Try again', 'Could not capture a clear face. Please retry.');
      return;
    }
    onComplete(embeds, paths);
  };

  if (!hasPermission) {
    return (<Screen><Header title={title} subtitle={subtitle} /><H2>Camera permission</H2>
      <Lead>Please allow camera access to continue.</Lead>
      <Btn label="Grant permission" onPress={requestPermission} />
      <Btn label="Open settings" kind="ghost" onPress={() => Linking.openSettings()} />
      <Btn label="Back" kind="ghost" onPress={onCancel} /></Screen>);
  }
  if (!device) {
    return (<Screen><Header title={title} subtitle={subtitle} /><H2>No camera found</H2>
      <Lead>The app sees {all ? all.length : 0} camera device(s). On the emulator set AVD → Advanced → Back camera = VirtualScene → Cold Boot, or use a physical phone.</Lead>
      <Btn label="Back" kind="ghost" onPress={onCancel} /></Screen>);
  }

  const accent = far ? RED : phase === 'blink' ? T.amber : T.teal;
  const filled = phase === 'lock' ? Math.round(lockProg * SEGMENTS)
    : phase === 'blink' ? SEGMENTS
    : phase === 'recognize' ? (target > 1 ? Math.max(2, Math.round((captured / target) * SEGMENTS)) : SEGMENTS) : 0;
  const headline = !running ? prompt
    : far ? 'Move closer'
    : phase === 'lock' ? 'Hold steady'
    : phase === 'blink' ? (blinked ? 'Great — verifying' : 'Blink now')
    : phase === 'recognize' ? (recognizeHeadline || 'Verifying…') : prompt;
  const sub = !running ? 'Tap start, then look at the camera'
    : far ? 'Bring your face closer to fill the circle'
    : phase === 'lock' ? 'Locking onto your face'
    : phase === 'blink' ? (blinked ? 'Liveness confirmed' : 'Blink once to confirm you are live')
    : phase === 'recognize' ? (recognizeSub || 'Matching your face') : '';

  return (
    <Screen>
      <Header title={title} subtitle={subtitle} />
      <View style={{ alignItems: 'center', marginVertical: 14 }}>
        <Ring filled={filled} accent={accent}>
          <Camera ref={cam} style={StyleSheet.absoluteFill} device={device} isActive={true} photo={true} format={format} photoQualityBalance="speed" />
        </Ring>
      </View>
      <View style={{ alignItems: 'center' }}>
        <H2 style={far ? { color: RED } : phase === 'blink' && !blinked ? { color: T.amberDk } : undefined}>{headline}</H2>
        <Lead>{sub}</Lead>
        {running && requireBlink && (
          <Text style={[st.live, { color: blinked ? T.tealDk : T.muted }]}>{blinked ? '✓ Live person confirmed' : '• Liveness: blink to confirm'}</Text>
        )}
        {phase === 'recognize' && target > 1 && <Text style={st.timing}>Captured {captured} of {target} frames</Text>}
        {verifyMs != null && target <= 1 && <Text style={st.timing}>Recognition + liveness compute: {verifyMs} ms</Text>}
      </View>
      {!running && <Btn label="Start scan" onPress={start} />}
      {running && <View style={{ marginTop: 12, alignItems: 'center' }}><ActivityIndicator color={accent} /></View>}
      <Btn label="Cancel" kind="ghost" onPress={() => { cancelled.current = true; onCancel(); }} />
    </Screen>
  );
}

const st = StyleSheet.create({
  live: { fontSize: 12.5, fontWeight: '600', marginTop: 6 },
  timing: { fontSize: 12.5, fontWeight: '700', color: T.tealDk, marginTop: 6 },
});
