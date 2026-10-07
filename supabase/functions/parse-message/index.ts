// parse-message: turns a natural-language message into a draft event.
//
// Request (from the app, with the user's session):  { group_id, text }
// The function looks up everything else itself (author timezone, group members,
// current time), so the client cannot fake them. The Gemini key never leaves
// this function (Supabase secret GEMINI_API_KEY).

import { withSupabase } from 'npm:@supabase/server@1';

import { DEFAULT_MODEL, parseMessage, PROMPT_VERSION, type Member } from './parse.ts';

const MODEL = Deno.env.get('GEMINI_MODEL') || DEFAULT_MODEL;
const MAX_TEXT_LENGTH = 500;
const MAX_MESSAGES_PER_MINUTE = 10;

const json = (body: unknown, status = 200) => Response.json(body, { status });

export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

    const body = await req.json().catch(() => null);
    const groupId = typeof body?.group_id === 'string' ? body.group_id : null;
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!groupId || !text) return json({ error: 'group_id and text are required' }, 400);
    if (text.length > MAX_TEXT_LENGTH) return json({ error: 'text_too_long' }, 400);

    const userId = ctx.userClaims!.id;

    // RLS-scoped reads: these only succeed if the caller is a member of the group.
    const [membersRes, profileRes, recentRes] = await Promise.all([
      ctx.supabase.from('group_members').select('user_id, profiles(display_name)').eq('group_id', groupId),
      ctx.supabase.from('profiles').select('display_name, timezone').eq('id', userId).single(),
      ctx.supabase
        .from('parsed_messages')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gt('created_at', new Date(Date.now() - 60_000).toISOString()),
    ]);
    if (membersRes.error || profileRes.error) return json({ error: 'lookup_failed' }, 500);

    const members: Member[] = (membersRes.data ?? []).map((m) => ({
      id: m.user_id,
      // deno-lint-ignore no-explicit-any
      name: (m as any).profiles?.display_name ?? 'Unknown',
    }));
    const author = members.find((m) => m.id === userId);
    if (!author) return json({ error: 'not_a_member' }, 403);
    if ((recentRes.count ?? 0) >= MAX_MESSAGES_PER_MINUTE) return json({ error: 'rate_limited' }, 429);

    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) return json({ error: 'parser_not_configured' }, 500);

    const timezone = profileRes.data.timezone;
    const now = new Date();

    let parsedJson: Record<string, unknown>;
    let modelVersion = MODEL;
    let result: Awaited<ReturnType<typeof parseMessage>> | null = null;
    try {
      result = await parseMessage({ text, timezone, now, author, members }, { apiKey, model: MODEL });
      modelVersion = result.modelVersion;
      parsedJson = {
        prompt_version: PROMPT_VERSION,
        reference_time: now.toISOString(),
        latency_ms: result.latencyMs,
        raw: result.raw,
        normalized: result.event,
        unmatched_participants: result.unmatchedParticipants,
      };
    } catch (err) {
      // Keep failures in the dataset too; the user can still create the event by hand.
      console.error('parse failed:', err);
      parsedJson = { prompt_version: PROMPT_VERSION, reference_time: now.toISOString(), error: String(err) };
    }

    // Written with the service role: users cannot insert into parsed_messages,
    // which guarantees parsed_json is genuine model output.
    const { data: row, error: insertError } = await ctx.supabaseAdmin
      .from('parsed_messages')
      .insert({
        group_id: groupId,
        user_id: userId,
        raw_text: text,
        parsed_json: parsedJson,
        model: modelVersion,
        author_timezone: timezone,
      })
      .select('id')
      .single();
    if (insertError) {
      console.error('insert failed:', insertError);
      return json({ error: 'save_failed' }, 500);
    }

    return json({
      message_id: row.id,
      failed: result === null,
      is_event: result?.raw.is_event ?? false,
      confidence: result?.raw.confidence ?? 0,
      clarification_question: result?.raw.clarification_question ?? null,
      language: result?.raw.language ?? null,
      event: result?.event ?? null,
      unmatched_participants: result?.unmatchedParticipants ?? [],
    });
  }),
};
