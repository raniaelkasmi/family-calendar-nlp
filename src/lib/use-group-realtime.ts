import type { RealtimeChannel } from '@supabase/supabase-js';
import { useEffect, useRef } from 'react';

import { supabase } from '@/lib/supabase';

const DEBOUNCE_MS = 300;

/**
 * Calls `onChange` when anything in the group's calendar changes (an event or
 * its participants is created, edited or deleted), on any member's device.
 *
 * Uses the group's private broadcast channel 'group:<id>'. The database only
 * lets members of the group receive it (RLS on realtime.messages). Bursts of
 * changes (an event + its participants) are merged into one call.
 */
export function useGroupRealtime(groupId: string | undefined, onChange: () => void) {
  const callback = useRef(onChange);
  useEffect(() => {
    callback.current = onChange;
  });

  useEffect(() => {
    if (!groupId) return;
    let channel: RealtimeChannel | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    (async () => {
      // Private channels authorize with the user's session token.
      await supabase.realtime.setAuth();
      if (cancelled) return;
      channel = supabase
        .channel(`group:${groupId}`, { config: { private: true } })
        .on('broadcast', { event: '*' }, () => {
          clearTimeout(timer);
          timer = setTimeout(() => callback.current(), DEBOUNCE_MS);
        })
        .subscribe((status, err) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn(`Realtime ${status} for group ${groupId}`, err?.message ?? '');
          }
        });
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (channel) supabase.removeChannel(channel);
    };
  }, [groupId]);
}
