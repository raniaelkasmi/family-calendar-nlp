import { Link } from 'expo-router';
import { useState } from 'react';

import { Button, ErrorText, TextField } from '@/components/form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { TimezonePicker } from '@/components/timezone-picker';
import { authErrorMessage } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { getDeviceTimezone } from '@/lib/timezones';

export default function SignUpScreen() {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [timezone, setTimezone] = useState(getDeviceTimezone);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function signUp() {
    if (!displayName.trim()) {
      setError('Please enter your name.');
      return;
    }
    if (!email.trim() || password.length < 6) {
      setError('Please enter an email and a password of at least 6 characters.');
      return;
    }
    setLoading(true);
    setError(null);
    // display_name and timezone travel with the account; a database trigger
    // uses them to create the profile row.
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: displayName.trim(), timezone } },
    });
    setLoading(false);
    if (error) {
      setError(authErrorMessage(error));
    } else if (!data.session) {
      // Only happens if "Confirm email" is turned on in Supabase.
      setInfo('Check your inbox to confirm your email, then log in.');
    }
  }

  return (
    <Screen>
      <ThemedText type="subtitle">Create your account</ThemedText>
      <ThemedText themeColor="textSecondary">
        Your timezone is used to show every event at the right local time.
      </ThemedText>

      <TextField
        label="Your name"
        value={displayName}
        onChangeText={setDisplayName}
        autoComplete="name"
        textContentType="name"
        placeholder="How your family and friends know you"
        maxLength={50}
      />
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        placeholder="you@example.com"
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        placeholder="At least 6 characters"
      />
      <TimezonePicker value={timezone} onChange={setTimezone} />

      <ErrorText message={error} />
      {info && <ThemedText type="small">{info}</ThemedText>}
      <Button title="Sign up" onPress={signUp} loading={loading} />

      <Link href="/sign-in" replace>
        <ThemedText type="linkPrimary">Already have an account? Log in</ThemedText>
      </Link>
    </Screen>
  );
}
