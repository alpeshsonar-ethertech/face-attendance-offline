import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Screen, Header, H2, Lead, Btn } from '../ui/components';
import { T } from '../ui/theme';
import { Nav } from '../../App';

export default function VerifyHome({ nav }: { nav: Nav }) {
  return (
    <Screen>
      <Header title="Face Attendance" subtitle="Mark your attendance" />
      <View style={st.hero}>
        <View style={st.ring}><Text style={{ fontSize: 64, color: '#c2cad8' }}>👤</Text></View>
      </View>
      <H2>Mark your attendance</H2>
      <Lead>Tap below, position your face in good light, and capture.</Lead>
      <Btn label="Scan with camera" onPress={() => nav.go('scanCamera')} />
      <TouchableOpacity style={st.admin} onPress={() => nav.go('adminGate')}>
        <Text style={st.adminT}>Admin</Text>
      </TouchableOpacity>
    </Screen>
  );
}

const st = StyleSheet.create({
  hero: { alignItems: 'center', marginVertical: 18 },
  ring: { width: 180, height: 180, borderRadius: 90, borderWidth: 8, borderColor: T.line, alignItems: 'center', justifyContent: 'center', backgroundColor: T.card },
  admin: { marginTop: 'auto', alignSelf: 'center', padding: 16 },
  adminT: { color: T.muted, fontWeight: '600', fontSize: 13 },
});
