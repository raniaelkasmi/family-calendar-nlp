import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatTimezone, getDeviceTimezone, TIMEZONES } from '@/lib/timezones';

type Props = {
  value: string;
  onChange: (tz: string) => void;
};

/** A field showing the selected timezone; tapping it opens a searchable list. */
export function TimezonePicker({ value, onChange }: Props) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const options = useMemo(() => {
    // Always offer the phone's own timezone first, even if it's not in our list.
    const device = getDeviceTimezone();
    const all = [device, ...TIMEZONES.filter((tz) => tz !== device)];
    const q = query.trim().toLowerCase().replace(/\s+/g, '_');
    return q ? all.filter((tz) => tz.toLowerCase().includes(q)) : all;
  }, [query]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  return (
    <ThemedView style={styles.field}>
      <ThemedText type="smallBold">Timezone</ThemedText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Timezone: ${formatTimezone(value)}. Tap to change.`}
        onPress={() => setOpen(true)}
        style={[styles.trigger, { borderColor: theme.border }]}>
        <ThemedText>{formatTimezone(value)}</ThemedText>
        <ThemedText themeColor="primary">Change</ThemedText>
      </Pressable>

      <Modal visible={open} animationType="slide" onRequestClose={close}>
        <ThemedView style={styles.modal}>
          <SafeAreaView style={styles.modalInner}>
            <ThemedText type="subtitle">Choose your timezone</ThemedText>
            <TextInput
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder="Search a city (e.g. Paris, Casablanca)"
              placeholderTextColor={theme.textSecondary}
              autoCorrect={false}
              style={[styles.search, { color: theme.text, borderColor: theme.border }]}
            />
            <FlatList
              data={options}
              keyExtractor={(tz) => tz}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    onChange(item);
                    close();
                  }}
                  style={[
                    styles.row,
                    { borderBottomColor: theme.border },
                    item === value && { backgroundColor: theme.backgroundSelected },
                  ]}>
                  <ThemedText>{formatTimezone(item)}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {item}
                  </ThemedText>
                </Pressable>
              )}
              ListEmptyComponent={
                <ThemedText themeColor="textSecondary" style={styles.empty}>
                  No match.
                </ThemedText>
              }
            />
            <Button title="Cancel" variant="secondary" onPress={close} />
          </SafeAreaView>
        </ThemedView>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: Spacing.one,
  },
  trigger: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
  },
  modal: {
    flex: 1,
  },
  modalInner: {
    flex: 1,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  search: {
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
    fontSize: 16,
  },
  row: {
    paddingVertical: Spacing.two + Spacing.one,
    paddingHorizontal: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  empty: {
    textAlign: 'center',
    marginTop: Spacing.four,
  },
});
