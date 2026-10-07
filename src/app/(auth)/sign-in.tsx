import { Link } from 'expo-router';
import { useState } from 'react';

import { Button, ErrorText, TextField } from '@/components/form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { authErrorMessage } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    // On success, the auth listener updates the session and the router switches screens.
    if (error) setError(authErrorMessage(error));
  }

  return (
    <Screen>
      <ThemedText type="subtitle">Welcome back</ThemedText>
      <ThemedText themeColor="textSecondary">Log in to see your groups and shared calendar.</ThemedText>

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
        autoComplete="current-password"
        textContentType="password"
        onSubmitEditing={signIn}
      />

      <ErrorText message={error} />
      <Button title="Log in" onPress={signIn} loading={loading} />

      <Link href="/sign-up" replace>
        <ThemedText type="linkPrimary">No account yet? Sign up</ThemedText>
      </Link>
    </Screen>
  );
}
