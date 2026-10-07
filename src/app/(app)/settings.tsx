import { useState } from 'react';

import { Button, ErrorText } from '@/components/form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { TimezonePicker } from '@/components/timezone-picker';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

export default function SettingsScreen() {
  const { session, profile, refreshProfile, signOut } = useAuth();
  const [error, setError] = useState<string | null>(null);

  async function changeTimezone(timezone: string) {
    if (!profile) return;
    setError(null);
    const { error } = await supabase.from('profiles').update({ timezone }).eq('id', profile.id);
    if (error) setError('Could not save your timezone. Please try again.');
    await refreshProfile();
  }

  return (
    <Screen hasHeader centered={false}>
      <ThemedText type="smallBold">{profile?.display_name}</ThemedText>
      <ThemedText themeColor="textSecondary">{session?.user.email}</ThemedText>

      {profile && <TimezonePicker value={profile.timezone} onChange={changeTimezone} />}
      <ErrorText message={error} />

      <Button title="Log out" variant="secondary" onPress={signOut} />
    </Screen>
  );
}
