import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Platform, Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDay, formatTime } from '@/lib/datetime';

type Props = {
  value: Date;
  mode: 'date' | 'time';
  /** IANA zone the picker shows and edits in (the user's timezone, or UTC for all-day). */
  timeZoneName: string;
  onChange: (date: Date) => void;
  accessibilityLabel: string;
};

/**
 * Native date or time picker. iOS shows a compact pill that opens a popover;
 * Android opens the system dialog (the library's recommended imperative API).
 */
export function DateTimeField({ value, mode, timeZoneName, onChange, accessibilityLabel }: Props) {
  const theme = useTheme();

  if (Platform.OS === 'ios') {
    return (
      <DateTimePicker
        value={value}
        mode={mode}
        display="compact"
        timeZoneName={timeZoneName}
        onChange={(_event, date) => date && onChange(date)}
        accessibilityLabel={accessibilityLabel}
      />
    );
  }

  const label = mode === 'date' ? formatDay(value, timeZoneName) : formatTime(value, timeZoneName);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${accessibilityLabel}: ${label}`}
      onPress={() =>
        DateTimePickerAndroid.open({
          value,
          mode,
          timeZoneName,
          onChange: (event, date) => {
            if (event.type === 'set' && date) onChange(date);
          },
        })
      }
      style={[styles.pill, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
});
