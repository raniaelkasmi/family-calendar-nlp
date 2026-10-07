import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props<T extends string> = {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
};

/** A small two-or-three-way switch, e.g. Feed | Calendar. */
export function Segmented<T extends string>({ options, value, onChange }: Props<T>) {
  const theme = useTheme();
  return (
    <ThemedView type="backgroundElement" style={styles.container} accessibilityRole="tablist">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(o.value)}
            style={[styles.option, selected && { backgroundColor: theme.background }]}>
            <ThemedText type={selected ? 'smallBold' : 'small'} themeColor={selected ? 'text' : 'textSecondary'}>
              {o.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderRadius: Spacing.two + Spacing.one,
    padding: Spacing.half + 1,
  },
  option: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two - Spacing.half,
    borderRadius: Spacing.two,
  },
});
