import React, { useState, useEffect } from 'react';
import { SafeAreaView, StatusBar } from 'react-native';
import VerifyHome from './src/screens/VerifyHome';
import ScanCamera from './src/screens/ScanCamera';
import AdminGate from './src/screens/AdminGate';
import { AdminHome, EnrollFile, ManagePeople, SettingsScreen, SyncStatus } from './src/screens/Admin';
import { startAutoSync } from './src/sync/syncService';

// Camera-only build: no file/gallery upload routes.
export type Route =
  | 'verifyHome' | 'scanCamera'
  | 'adminGate' | 'adminHome' | 'enrollFile' | 'managePeople' | 'settings' | 'syncStatus';

export interface Nav { go: (r: Route) => void; }

export default function App() {
  const [route, setRoute] = useState<Route>('verifyHome');
  const nav: Nav = { go: setRoute };

  // Watch connectivity; auto-upload + purge queued attendance when network returns.
  useEffect(() => { startAutoSync(); }, []);

  const screen = () => {
    switch (route) {
      case 'scanCamera': return <ScanCamera nav={nav} />;
      case 'adminGate': return <AdminGate nav={nav} />;
      case 'adminHome': return <AdminHome nav={nav} />;
      case 'enrollFile': return <EnrollFile nav={nav} />;
      case 'managePeople': return <ManagePeople nav={nav} />;
      case 'settings': return <SettingsScreen nav={nav} />;
      case 'syncStatus': return <SyncStatus nav={nav} />;
      default: return <VerifyHome nav={nav} />;
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#eef1f6' }}>
      <StatusBar barStyle="dark-content" backgroundColor="#eef1f6" />
      {screen()}
    </SafeAreaView>
  );
}
