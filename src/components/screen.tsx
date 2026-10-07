import type { PropsWithChildren, ReactElement } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, type RefreshControlProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';

type ScreenProps = PropsWithChildren<{
  /** Vertically center the content (forms). Lists start at the top. */
  centered?: boolean;
  /** The screen has a navigation header, which already handles the top inset. */
  hasHeader?: boolean;
  refreshControl?: ReactElement<RefreshControlProps>;
}>;

/** Full-screen scrollable container that stays clear of the keyboard and notch. */
export function Screen({ children, centered = true, hasHeader = false, refreshControl }: ScreenProps) {
  return (
    <ThemedView style={styles.flex}>
      <SafeAreaView style={styles.flex} edges={hasHeader ? ['bottom', 'left', 'right'] : undefined}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={[styles.content, centered && styles.centered]}
            keyboardShouldPersistTaps="handled"
            refreshControl={refreshControl}>
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    padding: Spacing.four,
    gap: Spacing.three,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  centered: {
    justifyContent: 'center',
  },
});
