import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { Screen, Header, H2, Lead, Btn } from '../ui/components';
import { T } from '../ui/theme';
import { getSettings } from '../storage/store';
import { Nav } from '../../App';

export default function AdminGate({ nav }: { nav: Nav }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState(false);

  const check = async () => {
    const s = await getSettings();
    if (pin === s.adminPin) nav.go('adminHome');
    else { setErr(true); setPin(''); }
  };

  return (
    <Screen>
      <Header title="Admin" subtitle="Restricted area" />
      <H2>Enter admin PIN</H2>
      <Lead>Enrollment and settings are protected. (Demo PIN: 1234)</Lead>
      <TextInput
        style={[st.pin, err && { borderColor: T.amber }]}
        value={pin} onChangeText={(t) => { setPin(t); setErr(false); }}
        keyboardType="number-pad" secureTextEntry maxLength={8} placeholder="••••" placeholderTextColor="#aeb7c7"
      />
      {err && <Text style={st.err}>Incorrect PIN. Try again.</Text>}
      <Btn label="Unlock" onPress={check} />
      <Btn label="Back" kind="ghost" onPress={() => nav.go('verifyHome')} />
    </Screen>
  );
}

const st = StyleSheet.create({
  pin: { borderWidth: 1.5, borderColor: T.line, borderRadius: 13, padding: 16, fontSize: 22, letterSpacing: 8, textAlign: 'center', backgroundColor: T.soft, color: T.ink, marginBottom: 8 },
  err: { color: T.amberDk, fontSize: 13, marginBottom: 4 },
});
