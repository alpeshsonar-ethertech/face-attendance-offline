import React, { useState } from 'react';
import { Alert } from 'react-native';
import CameraScan from './CameraScan';
import { buildGalleryEmbedding, identify } from '../recognition/match';
import { getGallery, getSettings, addAttendance } from '../storage/store';
import { ResultOk, ResultRetry } from './VerifyFile';
import { Nav } from '../../App';

type State = 'scan' | 'ok' | 'retry';

export default function ScanCamera({ nav }: { nav: Nav }) {
  const [state, setState] = useState<State>('scan');
  const [name, setName] = useState('');

  const onComplete = async (embeds: Float32Array[]) => {
    try {
      const probe = buildGalleryEmbedding(embeds);
      const [gallery, settings] = await Promise.all([getGallery(), getSettings()]);
      const r = identify(probe, gallery, settings.threshold);
      // --- diagnostic logging: see the actual cosine scores ---
      console.log('[FaceScan] VERIFY result -> matched:', r.matched, '| name:', r.name, '| bestScore:', r.score.toFixed(4), '| threshold:', settings.threshold);
      console.log('[FaceScan] ranking:', JSON.stringify(r.ranking.map((x) => ({ name: x.name, score: Number(x.score.toFixed(4)) }))));
      if (r.matched) {
        await addAttendance(r.personId!, r.name!); // queue to local outbox for sync & purge
        setName(r.name!); setState('ok');
      } else setState('retry');
    } catch (e: any) {
      console.log('[FaceScan] VERIFY error:', String(e?.message || e));
      Alert.alert('Error', String(e?.message || e));
      setState('retry');
    }
  };

  if (state === 'ok') return <ResultOk name={name} onDone={() => nav.go('verifyHome')} />;
  if (state === 'retry') return <ResultRetry onAgain={() => setState('scan')} onCancel={() => nav.go('verifyHome')} />;

  return (
    <CameraScan
      title="Camera scan" subtitle="Mark your attendance"
      prompt="Look at the camera"
      target={1} minNeeded={1} requireBlink
      onComplete={onComplete}
      onCancel={() => nav.go('verifyHome')}
    />
  );
}
