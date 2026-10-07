import { Stack } from 'expo-router';

export default function AuthLayout() {
  // sign-in is listed first so it's the screen logged-out users land on.
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="sign-up" />
    </Stack>
  );
}
