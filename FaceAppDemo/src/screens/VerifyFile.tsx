import React, { useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import { Screen, Header, H2, Lead, Btn } from '../ui/components';
import { T } from '../ui/theme';
import { embedImage } from '../recognition/model';
import { identify } from '../recognition/match';
import { getGallery, getSettings } from '../storage/store';
import { Nav } from '../../App';

type State = 'idle' | 'busy' | 'ok' | 'retry';

export default function VerifyFile({ nav }: { nav: Nav }) {
  const [state, setState] = useState<State>('idle');
  const [uri, setUri] = useState<string | null>(null);
  const [name, setName] = useState('');

  const pick = () => {
    launchImageLibrary({ mediaType: 'photo', selectionLimit: 1, maxWidth: 1024, maxHeight: 1024, quality: 0.9 }, async (res) => {
      const u = res.assets?.[0]?.uri;
      if (!u) return;
      setUri(u); setState('busy');
      try {
        const probe = await embedImage(u);
        const [gallery, settings] = await Promise.all([getGallery(), getSettings()]);
        const r = identify(probe, gallery, settings.threshold);
        if (r.matched) { setName(r.name!); setState('ok'); }
        else setState('retry');
      } catch { setState('retry'); }
    });
  };

  if (state === 'ok') return <ResultOk name={name} onDone={() => nav.go('verifyHome')} />;
  if (state === 'retry') return <ResultRetry onAgain={pick} onCancel={() => nav.go('verifyHome')} />;

  return (
    <Screen>
      <Header title="Verify" subtitle="From photos" />
      <H2>Verify a face</H2>
      <Lead>Pick a photo to check against enrolled people.</Lead>
      {uri && <Image source={{ uri }} style={st.preview} />}
      <Btn label="Pick a photo" onPress={pick} busy={state === 'busy'} />
      <Btn label="Back" kind="ghost" onPress={() => nav.go('verifyHome')} />
    </Screen>
  );
}

export function ResultOk({ name, onDone }: { name: string; onDone: () => void }) {
  return (
    <Screen>
      <View style={st.verdict}>
        <View style={[st.chip, { backgroundColor: 'rgba(15,174,142,0.12)' }]}><Text style={[st.chipT, { color: T.ok }]}>✓</Text></View>
        <Text style={st.big}>Attendance marked</Text>
        <Text style={st.name}>{name}</Text>
        <Text style={st.text}>Your attendance has been recorded successfully.</Text>
        <View style={st.stamp}><View style={st.dot} /><Text style={st.stampT}>{stamp()}</Text></View>
      </View>
      <Btn label="Done" onPress={onDone} />
    </Screen>
  );
}

export function ResultRetry({ onAgain, onCancel }: { onAgain: () => void; onCancel: () => void }) {
  return (
    <Screen>
      <View style={st.verdict}>
        <View style={[st.chip, { backgroundColor: 'rgba(245,158,11,0.14)' }]}><Text style={[st.chipT, { color: T.amberDk }]}>↺</Text></View>
        <Text style={st.big}>Couldn’t recognise you</Text>
        <Text style={st.text}>We couldn’t match your face. Please position your face and scan again.</Text>
      </View>
      <Btn label="Scan again" kind="amber" onPress={onAgain} />
      <Btn label="Cancel" kind="ghost" onPress={onCancel} />
    </Screen>
  );
}

function stamp() {
  const d = new Date();
  const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `Today · ${t}`;
}

const st = StyleSheet.create({
  preview: { width: '100%', height: 260, borderRadius: 14, backgroundColor: '#e4e9f2', marginBottom: 6 },
  verdict: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  chip: { width: 120, height: 120, borderRadius: 60, alignItems: 'center', justifyContent: 'center', marginBottom: 22 },
  chipT: { fontSize: 54, fontWeight: '700' },
  big: { fontSize: 24, fontWeight: '800', color: T.ink, marginBottom: 8 },
  name: { fontSize: 17, fontWeight: '700', color: T.tealDk, marginBottom: 6 },
  text: { color: T.muted, fontSize: 13.5, lineHeight: 21, textAlign: 'center', paddingHorizontal: 10 },
  stamp: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: T.soft, borderWidth: 1, borderColor: T.line, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16, marginTop: 18 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: T.ok },
  stampT: { fontSize: 12.5, color: T.ink, fontWeight: '600' },
});
