import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Image, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import RNFS from 'react-native-fs';
import CameraScan from './CameraScan';
import { Screen, Header, H2, Lead, Btn } from '../ui/components';
import { T } from '../ui/theme';
import { buildGalleryEmbedding } from '../recognition/match';
import { getGallery, addPerson, removePerson, getSettings, saveSettings, outboxCounts, getOutbox } from '../storage/store';
import { runSync, syncConfig } from '../sync/syncService';
import { EnrolledPerson } from '../recognition/match';
import { Nav } from '../../App';

export function AdminHome({ nav }: { nav: Nav }) {
  return (
    <Screen>
      <Header title="Admin" subtitle="Manage the system" />
      <H2>Admin tools</H2>
      <Lead>Enroll people, review who’s registered, and adjust settings.</Lead>
      <Btn label="Enroll a person" onPress={() => nav.go('enrollFile')} />
      <Btn label="Manage enrolled people" kind="ghost" onPress={() => nav.go('managePeople')} />
      <Btn label="Sync status" kind="ghost" onPress={() => nav.go('syncStatus')} />
      <Btn label="Settings" kind="ghost" onPress={() => nav.go('settings')} />
      <Btn label="Exit admin" kind="ghost" onPress={() => nav.go('verifyHome')} />
    </Screen>
  );
}

export function EnrollFile({ nav }: { nav: Nav }) {
  const [step, setStep] = useState<'name' | 'scan'>('name');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const onComplete = async (embeds: Float32Array[], photoPaths: string[]) => {
    setBusy(true);
    try {
      const id = `${Date.now()}`;
      // persist one snapshot so we can show the enrolled face later
      let photoUri: string | undefined;
      if (photoPaths.length) {
        try {
          const src = photoPaths[photoPaths.length - 1].replace('file://', '');
          const dest = `${RNFS.DocumentDirectoryPath}/face_${id}.jpg`;
          await RNFS.copyFile(src, dest);
          photoUri = 'file://' + dest;
        } catch (e) { console.log('[enroll] could not save snapshot:', String(e)); }
      }
      await addPerson({
        id, name: name.trim(),
        embedding: buildGalleryEmbedding(embeds),
        photoCount: embeds.length, enrolledAt: Date.now(), photoUri,
      });
      Alert.alert('Enrolled', `${name.trim()} enrolled from a face scan (${embeds.length} frames).`,
        [{ text: 'OK', onPress: () => nav.go('adminHome') }]);
    } catch (e: any) {
      Alert.alert('Error', String(e?.message || e));
    } finally { setBusy(false); }
  };

  if (step === 'scan') {
    return (
      <CameraScan
        title="Enroll" subtitle={name.trim()}
        prompt="Scan the face"
        target={4} minNeeded={2}
        recognizeHeadline="Hold still" recognizeSub="Capturing face frames — keep looking at the camera"
        onComplete={onComplete}
        onCancel={() => setStep('name')}
      />
    );
  }

  return (
    <Screen>
      <Header title="Enroll" subtitle="Add a person" />
      <H2>Who are you enrolling?</H2>
      <Lead>Enter a name, then scan the face. We capture several frames automatically to build the template.</Lead>
      <TextInput style={st.field} value={name} onChangeText={setName} placeholder="Name" placeholderTextColor="#aeb7c7" />
      <Btn label="Start face scan" busy={busy} onPress={() => {
        if (!name.trim()) { Alert.alert('Name required', 'Enter a name first.'); return; }
        setStep('scan');
      }} />
      <Btn label="Back" kind="ghost" onPress={() => nav.go('adminHome')} />
    </Screen>
  );
}

export function ManagePeople({ nav }: { nav: Nav }) {
  const [people, setPeople] = useState<EnrolledPerson[]>([]);
  const [selected, setSelected] = useState<EnrolledPerson | null>(null);
  const load = async () => setPeople(await getGallery());
  useEffect(() => { load(); }, []);

  const del = (p: EnrolledPerson) => Alert.alert('Remove', `Remove ${p.name}?`, [
    { text: 'Cancel' },
    { text: 'Remove', style: 'destructive', onPress: async () => { await removePerson(p.id); setSelected(null); load(); } },
  ]);

  // detail view
  if (selected) {
    return (
      <Screen>
        <Header title={selected.name} subtitle="Enrolled person" />
        <View style={{ alignItems: 'center', marginVertical: 10 }}>
          {selected.photoUri
            ? <Image source={{ uri: selected.photoUri }} style={st.bigPhoto} />
            : <View style={[st.bigPhoto, st.noPhoto]}><Text style={{ fontSize: 64, color: '#c2cad8' }}>👤</Text></View>}
        </View>
        <View style={st.detailCard}>
          <Row k="Name" v={selected.name} />
          <Row k="Frames captured" v={String(selected.photoCount)} />
          <Row k="Enrolled on" v={new Date(selected.enrolledAt).toLocaleString()} />
          <Row k="ID" v={selected.id} />
        </View>
        <Btn label="Remove this person" kind="amber" onPress={() => del(selected)} />
        <Btn label="Back to list" kind="ghost" onPress={() => setSelected(null)} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Header title="Enrolled people" subtitle={`${people.length} registered`} />
      {people.length === 0 && <Lead>No one enrolled yet. Go to “Enroll a person” to add someone.</Lead>}
      {people.map((p) => (
        <TouchableOpacity key={p.id} style={st.row} onPress={() => setSelected(p)} activeOpacity={0.7}>
          {p.photoUri
            ? <Image source={{ uri: p.photoUri }} style={st.avatar} />
            : <View style={[st.avatar, st.noPhoto]}><Text style={{ fontSize: 22, color: '#c2cad8' }}>👤</Text></View>}
          <View style={{ flex: 1 }}>
            <Text style={st.rowName}>{p.name}</Text>
            <Text style={st.rowSub}>{p.photoCount} frame(s) · {new Date(p.enrolledAt).toLocaleDateString()}</Text>
          </View>
          <Text style={{ color: T.muted, fontSize: 18 }}>›</Text>
        </TouchableOpacity>
      ))}
      <Btn label="Back" kind="ghost" onPress={() => nav.go('adminHome')} />
    </Screen>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={st.kv}><Text style={st.k}>{k}</Text><Text style={st.v}>{v}</Text></View>
  );
}

export function SettingsScreen({ nav }: { nav: Nav }) {
  const [pin, setPin] = useState(''); const [thr, setThr] = useState('');
  useEffect(() => { getSettings().then((s) => { setPin(s.adminPin); setThr(String(s.threshold)); }); }, []);
  const save = async () => {
    const t = parseFloat(thr);
    await saveSettings({ adminPin: pin || '1234', threshold: isNaN(t) ? 0.40 : t });
    Alert.alert('Saved', 'Settings updated.', [{ text: 'OK', onPress: () => nav.go('adminHome') }]);
  };
  return (
    <Screen>
      <Header title="Settings" subtitle="Configuration" />
      <H2>Settings</H2>
      <Lead>Admin PIN and the match threshold. Higher threshold = stricter (fewer false matches). 0.40–0.45 recommended.</Lead>
      <Text style={st.lab}>Admin PIN</Text>
      <TextInput style={st.field} value={pin} onChangeText={setPin} keyboardType="number-pad" maxLength={8} />
      <Text style={st.lab}>Match threshold (0.30–0.50)</Text>
      <TextInput style={st.field} value={thr} onChangeText={setThr} keyboardType="decimal-pad" />
      <Btn label="Save" onPress={save} />
      <Btn label="Back" kind="ghost" onPress={() => nav.go('adminHome')} />
    </Screen>
  );
}

const st = StyleSheet.create({
  field: { borderWidth: 1.5, borderColor: T.line, borderRadius: 13, padding: 14, fontSize: 15, backgroundColor: T.soft, color: T.ink, marginBottom: 12 },
  lab: { fontSize: 12, color: T.muted, fontWeight: '600', marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: T.card, borderWidth: 1, borderColor: T.line, borderRadius: 13, padding: 12, marginBottom: 10 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: T.soft },
  noPhoto: { alignItems: 'center', justifyContent: 'center' },
  rowName: { fontSize: 15, fontWeight: '700', color: T.ink },
  rowSub: { fontSize: 11.5, color: T.muted, marginTop: 2 },
  bigPhoto: { width: 160, height: 160, borderRadius: 80, backgroundColor: T.soft },
  detailCard: { borderWidth: 1, borderColor: T.line, borderRadius: 14, padding: 6, marginBottom: 8, backgroundColor: T.card },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 11, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: T.line },
  k: { color: T.muted, fontSize: 13 },
  v: { color: T.ink, fontSize: 13, fontWeight: '600', maxWidth: '60%', textAlign: 'right' },
});


export function SyncStatus({ nav }: { nav: Nav }) {
  const [counts, setCounts] = useState({ pending: 0, synced: 0, total: 0 });
  const [recent, setRecent] = useState<{ name: string; ts: number; synced: boolean }[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = async () => {
    setCounts(await outboxCounts());
    const rs = await getOutbox();
    setRecent(rs.slice(-8).reverse().map((r) => ({ name: r.name, ts: r.ts, synced: r.synced })));
  };
  useEffect(() => { load(); }, []);

  const syncNow = async () => {
    setBusy(true); setMsg('');
    const res = await runSync();
    setMsg(res.message);
    await load();
    setBusy(false);
  };

  return (
    <Screen>
      <Header title="Sync status" subtitle="Offline queue & upload" />
      <View style={st.detailCard}>
        <Row k="Mode" v={syncConfig.demoMode ? 'Demo (simulated upload)' : 'Live'} />
        <Row k="Endpoint" v={syncConfig.demoMode ? '—' : String(syncConfig.awsEndpoint)} />
        <Row k="Pending (on device)" v={String(counts.pending)} />
        <Row k="Synced" v={String(counts.synced)} />
        <Row k="Total records" v={String(counts.total)} />
      </View>
      {!!msg && <Lead>{msg}</Lead>}
      <H2>Recent</H2>
      {recent.length === 0 && <Lead>No attendance records yet.</Lead>}
      {recent.map((r, i) => (
        <View key={i} style={st.row}>
          <View style={{ flex: 1 }}>
            <Text style={st.rowName}>{r.name}</Text>
            <Text style={st.rowSub}>{new Date(r.ts).toLocaleString()}</Text>
          </View>
          <Text style={{ color: r.synced ? T.tealDk : T.amberDk, fontWeight: '700', fontSize: 12 }}>{r.synced ? 'synced' : 'pending'}</Text>
        </View>
      ))}
      <Btn label="Sync now" busy={busy} onPress={syncNow} />
      <Btn label="Back" kind="ghost" onPress={() => nav.go('adminHome')} />
    </Screen>
  );
}
