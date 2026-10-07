import { Link, Stack } from 'expo-router';
import { Pressable } from 'react-native';

import { ThemedText } from '@/components/themed-text';

export default function AppLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          title: 'My groups',
          headerRight: () => (
            <Link href="/settings" asChild>
              <Pressable accessibilityRole="button" hitSlop={8}>
                <ThemedText themeColor="primary">Settings</ThemedText>
              </Pressable>
            </Link>
          ),
        }}
      />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      <Stack.Screen name="groups/new" options={{ title: 'New group', presentation: 'modal' }} />
      <Stack.Screen name="groups/[id]/index" options={{ title: '' }} />
      <Stack.Screen name="groups/[id]/members" options={{ title: 'Members' }} />
      <Stack.Screen name="join/index" options={{ title: 'Join a group', presentation: 'modal' }} />
      <Stack.Screen name="join/[code]" options={{ title: 'Invitation' }} />
    </Stack>
  );
}
