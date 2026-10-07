import { router } from 'expo-router';
import { useState } from 'react';

import { Button, ErrorText, TextField } from '@/components/form';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { inviteCodeFromInput, isValidInviteCode } from '@/lib/invites';

export default function EnterInviteCodeScreen() {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  function next() {
    const code = inviteCodeFromInput(input);
    if (!isValidInviteCode(code)) {
      setError('An invitation code has 16 characters, like 3F9A-12C4-77BE-0D21.');
      return;
    }
    router.replace({ pathname: '/join/[code]', params: { code } });
  }

  return (
    <Screen hasHeader>
      <ThemedText themeColor="textSecondary">
        Enter the code someone shared with you. You can also paste the whole invitation link.
      </ThemedText>
      <TextField
        label="Invitation code"
        value={input}
        onChangeText={setInput}
        placeholder="3F9A-12C4-77BE-0D21"
        autoCapitalize="characters"
        autoCorrect={false}
        autoFocus
        returnKeyType="go"
        onSubmitEditing={next}
      />
      <ErrorText message={error} />
      <Button title="Continue" onPress={next} />
    </Screen>
  );
}
