import { router } from 'expo-router';
import { useState } from 'react';

import { Button, ErrorText, TextField } from '@/components/form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { supabase } from '@/lib/supabase';

export default function NewGroupScreen() {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!name.trim()) {
      setError('Please give your group a name.');
      return;
    }
    setLoading(true);
    setError(null);
    // created_by defaults to the current user; a trigger makes them the owner.
    const { data, error } = await supabase.from('groups').insert({ name: name.trim() }).select('id').single();
    setLoading(false);
    if (error) {
      setError('Could not create the group. Please try again.');
      return;
    }
    router.replace({ pathname: '/groups/[id]', params: { id: data.id } });
  }

  return (
    <Screen hasHeader>
      <ThemedText themeColor="textSecondary">
        A group shares one calendar. You can invite people once it&apos;s created.
      </ThemedText>
      <TextField
        label="Group name"
        value={name}
        onChangeText={setName}
        placeholder="e.g. Family, Roommates, Book club"
        maxLength={60}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={create}
      />
      <ErrorText message={error} />
      <Button title="Create group" onPress={create} loading={loading} />
    </Screen>
  );
}
