import * as Linking from 'expo-linking';
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef } from 'react';
import { useColorScheme } from 'react-native';

import { AuthProvider, useAuth } from '@/lib/auth-context';
import { inviteCodeFromUrl } from '@/lib/invites';

// Keep the splash screen until we know whether the user is logged in.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </ThemeProvider>
  );
}

function RootNavigator() {
  const { session, isLoading } = useAuth();
  usePendingInvite(session !== null, isLoading);

  useEffect(() => {
    if (!isLoading) SplashScreen.hideAsync();
  }, [isLoading]);

  if (isLoading) return null;

  // Stack.Protected hides screens whose guard is false and redirects to the
  // first available one: logged-in users get (app), everyone else gets (auth).
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

/**
 * An invite link opened while logged out lands on sign-in (the join screen is
 * protected). Remember its code and open the join screen once logged in.
 */
function usePendingInvite(isLoggedIn: boolean, isLoading: boolean) {
  const url = Linking.useLinkingURL();
  const seenUrl = useRef<string | null>(null);
  const pendingCode = useRef<string | null>(null);

  useEffect(() => {
    if (isLoading || !url || url === seenUrl.current) return;
    seenUrl.current = url;
    // When logged in, Expo Router already opens the join screen by itself.
    if (!isLoggedIn) pendingCode.current = inviteCodeFromUrl(url);
  }, [url, isLoggedIn, isLoading]);

  useEffect(() => {
    if (!isLoggedIn || !pendingCode.current) return;
    const code = pendingCode.current;
    pendingCode.current = null;
    router.push({ pathname: '/join/[code]', params: { code } });
  }, [isLoggedIn]);
}
