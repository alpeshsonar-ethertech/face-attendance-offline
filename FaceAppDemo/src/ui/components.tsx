import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { T } from './theme';

export function Screen({ children }: { children: React.ReactNode }) {
  return <ScrollView style={{ flex: 1, backgroundColor: T.bg }} contentContainerStyle={s.body}>{children}</ScrollView>;
}

export function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={s.top}>
      <View style={s.badge}><Text style={s.badgeT}>F</Text></View>
      <View>
        <Text style={s.brand}>{title}</Text>
        {!!subtitle && <Text style={s.brandSub}>{subtitle}</Text>}
      </View>
    </View>
  );
}

export function Btn({ label, onPress, kind = 'primary', busy }: {
  label: string; onPress: () => void; kind?: 'primary' | 'amber' | 'ghost'; busy?: boolean;
}) {
  const bg = kind === 'amber' ? T.amber : kind === 'ghost' ? T.soft : T.teal;
  const fg = kind === 'ghost' ? T.ink : '#fff';
  return (
    <TouchableOpacity style={[s.btn, { backgroundColor: bg }, kind === 'ghost' && s.ghost]} onPress={onPress} disabled={busy} activeOpacity={0.85}>
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[s.btnT, { color: fg }]}>{label}</Text>}
    </TouchableOpacity>
  );
}

export function H2({ children }: { children: React.ReactNode }) { return <Text style={s.h2}>{children}</Text>; }
export function Lead({ children }: { children: React.ReactNode }) { return <Text style={s.lead}>{children}</Text>; }

const s = StyleSheet.create({
  body: { padding: 20, paddingTop: 48, minHeight: '100%' },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 },
  badge: { width: 36, height: 36, borderRadius: 11, backgroundColor: T.teal, alignItems: 'center', justifyContent: 'center' },
  badgeT: { color: '#fff', fontWeight: '800', fontSize: 16 },
  brand: { fontWeight: '700', fontSize: 15, color: T.ink },
  brandSub: { color: T.muted, fontSize: 10, fontWeight: '500' },
  h2: { fontSize: 22, fontWeight: '700', color: T.ink, marginBottom: 6 },
  lead: { color: T.muted, fontSize: 13, lineHeight: 20, marginBottom: 20 },
  btn: { borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 12 },
  ghost: { borderWidth: 1, borderColor: T.line },
  btnT: { fontWeight: '700', fontSize: 15 },
});
