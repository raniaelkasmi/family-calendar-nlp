import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { EventForm, type EventValues, type FormMember } from '@/components/event-form';
import { Button } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { LOW_CONFIDENCE, type ParseResponse } from '@/lib/parse-message';
import { supabase } from '@/lib/supabase';

const HOUR_MS = 60 * 60 * 1000;

type Props = {
  draft: ParseResponse;
  members: FormMember[];
  timeZone: string;
  onSaved: () => void;
  onDiscarded: () => void;
  /** Discard and put the text back in the input to rephrase it. */
  onRephrase: () => void;
};

function initialValues(draft: ParseResponse): EventValues {
  const e = draft.event;
  if (e) {
    return {
      title: e.title,
      allDay: e.all_day,
      start: new Date(e.start_at),
      end: new Date(e.end_at),
      location: e.location ?? '',
      participantIds: e.participant_ids,
    };
  }
  const start = new Date(Math.ceil(Date.now() / HOUR_MS) * HOUR_MS);
  return { title: '', allDay: false, start, end: new Date(start.getTime() + HOUR_MS), location: '', participantIds: [] };
}

/** What the assistant understood from a message, editable before saving. */
export function EventDraftCard({ draft, members, timeZone, onSaved, onDiscarded, onRephrase }: Props) {
  const [initial] = useState(() => initialValues(draft));
  const [discarding, setDiscarding] = useState(false);

  const needsAttention = draft.failed || !draft.is_event || draft.confidence < LOW_CONFIDENCE || !draft.event;
  const notice = draft.failed
    ? "The assistant couldn't read this message. You can fill in the event yourself."
    : (draft.clarification_question ??
      (!draft.is_event ? "This doesn't look like an event. You can still create one by hand." : null));

  async function save(v: EventValues) {
    const { error } = await supabase.rpc('save_event_from_message', {
      p_message_id: draft.message_id,
      p_title: v.title,
      p_start_at: v.start.toISOString(),
      p_end_at: v.end.toISOString(),
      p_all_day: v.allDay,
      p_location: v.location,
      p_participant_ids: v.participantIds,
    });
    if (error) return 'Could not save the event. Please try again.';
    onSaved();
    return null;
  }

  async function discard(then: () => void) {
    setDiscarding(true);
    // Recorded for the dataset: the user rejected this parse.
    await supabase.from('parsed_messages').update({ outcome: 'discarded' }).eq('id', draft.message_id);
    setDiscarding(false);
    then();
  }

  return (
    <EventForm
      initial={initial}
      members={members}
      timeZone={timeZone}
      submitLabel="Save to calendar"
      onSubmit={save}
      participantsNote={
        draft.unmatched_participants.length > 0
          ? `Not in this group: ${draft.unmatched_participants.join(', ')}`
          : undefined
      }
      header={
        needsAttention &&
        notice && (
          <ThemedView type="backgroundElement" style={styles.notice}>
            <ThemedText>{notice}</ThemedText>
            <Pressable accessibilityRole="button" onPress={() => discard(onRephrase)} hitSlop={8}>
              <ThemedText themeColor="primary">Rephrase my message</ThemedText>
            </Pressable>
          </ThemedView>
        )
      }
      footer={<Button title="Discard" variant="secondary" onPress={() => discard(onDiscarded)} loading={discarding} />}
    />
  );
}

const styles = StyleSheet.create({
  notice: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
});
