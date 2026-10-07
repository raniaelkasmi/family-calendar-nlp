import * as Linking from 'expo-linking';

import { supabase } from '@/lib/supabase';

const CODE_LENGTH = 16;

/** Keeps only the hex characters: "3F9A-12C4 77be0D21" → "3f9a12c477be0d21". */
export function normalizeInviteCode(raw: string): string {
  return raw.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
}

export function isValidInviteCode(code: string): boolean {
  return code.length === CODE_LENGTH;
}

/** "3f9a12c477be0d21" → "3F9A-12C4-77BE-0D21", easier to read out or type. */
export function formatInviteCode(code: string): string {
  return code.toUpperCase().match(/.{1,4}/g)?.join('-') ?? code;
}

/** Accepts a pasted invite link or a typed code and returns the normalized code. */
export function inviteCodeFromInput(input: string): string {
  const fromLink = input.match(/\/join\/([0-9a-fA-F-]+)/);
  return normalizeInviteCode(fromLink ? fromLink[1] : input);
}

/** The invite code inside a deep link URL, or null if it isn't an invite link. */
export function inviteCodeFromUrl(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/\/join\/([0-9a-fA-F-]+)/);
  const code = match ? normalizeInviteCode(match[1]) : '';
  return isValidInviteCode(code) ? code : null;
}

/** Deep link to the join screen. In Expo Go this is an exp:// URL. */
export function inviteLink(code: string): string {
  return Linking.createURL(`/join/${code}`);
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Reuses a group invite that's valid for at least another day, or creates one. */
export async function getOrCreateInvite(groupId: string) {
  const { data: existing, error: selectError } = await supabase
    .from('group_invites')
    .select('code, expires_at')
    .eq('group_id', groupId)
    .gt('expires_at', new Date(Date.now() + ONE_DAY_MS).toISOString())
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (selectError) throw selectError;
  if (existing) return existing;

  const { data, error } = await supabase
    .from('group_invites')
    .insert({ group_id: groupId })
    .select('code, expires_at')
    .single();
  if (error) throw error;
  return data;
}
