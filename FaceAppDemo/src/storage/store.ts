import AsyncStorage from '@react-native-async-storage/async-storage';
import { EnrolledPerson } from '../recognition/match';

const GKEY = 'faceapp.gallery';
const SKEY = 'faceapp.settings';

export async function getGallery(): Promise<EnrolledPerson[]> {
  const raw = await AsyncStorage.getItem(GKEY);
  return raw ? (JSON.parse(raw) as EnrolledPerson[]) : [];
}
async function saveGallery(people: EnrolledPerson[]) {
  await AsyncStorage.setItem(GKEY, JSON.stringify(people));
}
export async function addPerson(p: EnrolledPerson) {
  const people = (await getGallery()).filter((x) => x.id !== p.id);
  people.push(p);
  await saveGallery(people);
}
export async function removePerson(id: string) {
  await saveGallery((await getGallery()).filter((p) => p.id !== id));
}

export interface Settings { adminPin: string; threshold: number; }
const DEFAULTS: Settings = { adminPin: '1234', threshold: 0.40 };

export async function getSettings(): Promise<Settings> {
  const raw = await AsyncStorage.getItem(SKEY);
  return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
}
export async function saveSettings(s: Partial<Settings>) {
  const cur = await getSettings();
  await AsyncStorage.setItem(SKEY, JSON.stringify({ ...cur, ...s }));
}


// ---------- Attendance outbox (offline queue for sync & purge) ----------
const OKEY = 'faceapp.outbox';

export interface AttendanceRecord {
  id: string;          // local uuid
  personId: string;
  name: string;
  ts: number;          // epoch ms
  synced: boolean;
}

export async function getOutbox(): Promise<AttendanceRecord[]> {
  const raw = await AsyncStorage.getItem(OKEY);
  return raw ? (JSON.parse(raw) as AttendanceRecord[]) : [];
}
async function saveOutbox(rs: AttendanceRecord[]) {
  await AsyncStorage.setItem(OKEY, JSON.stringify(rs));
}
export async function addAttendance(personId: string, name: string) {
  const rs = await getOutbox();
  rs.push({ id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, personId, name, ts: Date.now(), synced: false });
  await saveOutbox(rs);
}
export async function markSynced(ids: string[]) {
  const set = new Set(ids);
  await saveOutbox((await getOutbox()).map((r) => (set.has(r.id) ? { ...r, synced: true } : r)));
}
// purge = delete synced records from the device (sync-and-purge requirement)
export async function purgeSynced(): Promise<number> {
  const rs = await getOutbox();
  const keep = rs.filter((r) => !r.synced);
  await saveOutbox(keep);
  return rs.length - keep.length;
}
export async function outboxCounts(): Promise<{ pending: number; synced: number; total: number }> {
  const rs = await getOutbox();
  const synced = rs.filter((r) => r.synced).length;
  return { pending: rs.length - synced, synced, total: rs.length };
}
