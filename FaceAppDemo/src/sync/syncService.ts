import NetInfo from '@react-native-community/netinfo';
import cfg from '../config/sync.config.json';
import { getOutbox, markSynced, purgeSynced, AttendanceRecord } from '../storage/store';

const log = (...a: any[]) => console.log('[Sync]', ...a);

export interface SyncResult { attempted: number; uploaded: number; purged: number; ok: boolean; message: string; }

let inFlight = false;

// Upload one batch. In demoMode we simulate the network call so it works with no AWS account.
async function uploadBatch(batch: AttendanceRecord[]): Promise<boolean> {
  if ((cfg as any).demoMode) {
    log('demoMode: simulating upload of', batch.length, 'record(s) to', (cfg as any).awsEndpoint);
    await new Promise((r) => setTimeout(r, 600));
    return true;
  }
  try {
    const res = await fetch((cfg as any).awsEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: batch.map(({ id, personId, name, ts }) => ({ id, personId, name, ts })) }),
    });
    return res.ok;
  } catch (e) { log('upload failed:', String(e)); return false; }
}

// Sync pending records, then purge the synced ones. Safe to call manually or on reconnect.
export async function runSync(): Promise<SyncResult> {
  if (!(cfg as any).syncEnabled) return { attempted: 0, uploaded: 0, purged: 0, ok: true, message: 'Sync disabled in config' };
  if (inFlight) return { attempted: 0, uploaded: 0, purged: 0, ok: true, message: 'Sync already running' };
  inFlight = true;
  try {
    const pending = (await getOutbox()).filter((r) => !r.synced);
    if (pending.length === 0) { return { attempted: 0, uploaded: 0, purged: 0, ok: true, message: 'Nothing to sync' }; }
    const size = (cfg as any).batchSize || 50;
    let uploaded = 0;
    for (let i = 0; i < pending.length; i += size) {
      const batch = pending.slice(i, i + size);
      const ok = await uploadBatch(batch);
      if (!ok) { return { attempted: pending.length, uploaded, purged: 0, ok: false, message: 'Upload failed; will retry on next connection' }; }
      await markSynced(batch.map((b) => b.id));
      uploaded += batch.length;
    }
    let purged = 0;
    if ((cfg as any).purgeAfterSync) purged = await purgeSynced();
    log('sync complete: uploaded', uploaded, 'purged', purged);
    return { attempted: pending.length, uploaded, purged, ok: true, message: `Uploaded ${uploaded}, purged ${purged}` };
  } finally { inFlight = false; }
}

// Auto-sync: whenever connectivity is restored, attempt a sync.
let unsub: null | (() => void) = null;
export function startAutoSync() {
  if (unsub) return;
  log('auto-sync watcher started (demoMode=' + (cfg as any).demoMode + ')');
  unsub = NetInfo.addEventListener((state) => {
    if (state.isConnected && state.isInternetReachable !== false) {
      log('network up -> attempting sync');
      runSync().catch((e) => log('auto-sync err', String(e)));
    }
  });
}
export function stopAutoSync() { if (unsub) { unsub(); unsub = null; } }

export const syncConfig = cfg as any;
