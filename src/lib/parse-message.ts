import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

/** The parse-message Edge Function's response. Times are UTC ISO strings. */
export type ParseResponse = {
  message_id: string;
  failed: boolean; // the model call failed; the user can still fill the card by hand
  is_event: boolean;
  confidence: number;
  clarification_question: string | null;
  language: string | null;
  event: DraftEvent | null;
  unmatched_participants: string[];
};

export type DraftEvent = {
  title: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location: string | null;
  participant_ids: string[];
};

/** Below this, the card highlights the model's clarifying question. */
export const LOW_CONFIDENCE = 0.6;

const ERROR_MESSAGES: Record<string, string> = {
  rate_limited: 'Too many messages in a minute. Please wait a little.',
  text_too_long: 'That message is too long (500 characters max).',
  not_a_member: 'You are no longer a member of this group.',
};

export async function requestParse(groupId: string, text: string): Promise<ParseResponse> {
  const { data, error } = await supabase.functions.invoke<ParseResponse>('parse-message', {
    body: { group_id: groupId, text },
  });
  if (error) {
    let code = '';
    if (error instanceof FunctionsHttpError) {
      code = await error.context
        .json()
        .then((b: { error?: string }) => b.error ?? '')
        .catch(() => '');
    }
    throw new Error(ERROR_MESSAGES[code] ?? 'Could not reach the assistant. Check your connection and try again.');
  }
  return data!;
}
