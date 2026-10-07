// Core of the parser: prompt → Gemini → validated JSON → normalized event.
// Pure TypeScript with no dependencies, so the Edge Function (Deno) and the
// evaluation script (Node) run exactly the same code.

import { addDays, dateToUtcMidnight, utcToWall, wallToUtc } from '../_shared/zoned-time.ts';

/** Bump when the prompt or normalization rules change, to compare versions in the dataset. */
export const PROMPT_VERSION = 'v1';

/** Free tier: Flash-Lite has a usable daily quota (Flash: 20 requests/day). Override with GEMINI_MODEL. */
export const DEFAULT_MODEL = 'gemini-flash-lite-latest';

export type Member = { id: string; name: string };

export type ParseInput = {
  text: string;
  timezone: string; // author's IANA timezone
  now: Date; // reference instant for relative dates
  author: Member;
  members: Member[]; // everyone in the group, author included
};

/** Exactly what the model returns (local wall times, member names). */
export type ModelOutput = {
  is_event: boolean;
  title: string | null;
  date: string | null; // YYYY-MM-DD, local
  start_time: string | null; // HH:MM, local
  end_date: string | null;
  end_time: string | null;
  all_day: boolean;
  location: string | null;
  participants: string[];
  confidence: number;
  clarification_question: string | null;
  language: 'fr' | 'en' | 'ar' | 'other';
};

/** What gets stored as an event (UTC instants, member ids). */
export type NormalizedEvent = {
  title: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location: string | null;
  participant_ids: string[];
};

export type ParseResult = {
  raw: ModelOutput;
  event: NormalizedEvent | null;
  unmatchedParticipants: string[];
  modelVersion: string;
  latencyMs: number;
};

// ----------------------------------------------------------------------------- prompt

const SYSTEM_PROMPT = `You turn one message from a family or friends group chat into a calendar event.
Messages can be in French, English or Arabic (including Moroccan Darija), and may mix languages.
You receive a JSON context (current local date and time, the author's timezone, the author, the group members, and a calendar of the coming days) and the message.

Fill the JSON fields as follows.

is_event: true if the message announces or plans something that happens at a given time (meal, outing, trip, flight, appointment, birthday, meeting, call). false for greetings, opinions, questions without a plan, and things in the past.

title: short (max 6 words), in the language of the message, without the date or time. Keep names and the key noun ("Dîner chez Sara", "Mom's flight", "عشاء عند سارة").

date: the local start date, YYYY-MM-DD. Use the "calendar" in the context to resolve:
- today / aujourd'hui / اليوم, tonight / ce soir / هذا المساء → today. tomorrow / demain / غدا → +1 day. after tomorrow / après-demain / بعد غد → +2 days.
- A weekday name, with or without next / prochain / القادم, means the first such day strictly after today.
- this weekend / ce week-end → the coming Saturday.
- in N days / dans N jours / بعد N أيام → today + N days. in N weeks → today + 7×N days.
- A date without a year → its next occurrence (this year if not passed yet, otherwise next year).
- Numeric dates: "14/11" is day/month (French, Arabic); "11/14" is month/day only when the first number cannot be a day-of-month order (English US style).
- If no date can be determined, date = null.

start_time: local start time, 24-hour HH:MM. Understand "19h", "19h30", "7pm", "7.30", Arabic-Indic digits (١٩:٣٠) and Arabic words (السابعة مساء = 19:00).
If only a part of the day is given, use: morning / matin / صباحا 09:00, noon / midi / lunch time / الظهر 12:00, afternoon / après-midi / بعد الظهر 15:00, evening / soir / مساء 19:00, night / nuit / ليلا 21:00, and lower confidence to at most 0.7.
If there is no time at all, start_time = null and all_day = true.

end_date / end_time: only if the message states an end or a duration ("until 22h", "for 2 hours", "du 24 au 26"). Otherwise null.

all_day: true for events without a time (birthdays, holidays, multi-day trips), else false.

location: the place as written ("chez Sara", "Gare de Lyon", "stade municipal"), otherwise null.

participants: group members mentioned or clearly implied, using the exact names from the members list (match nicknames, case and accents). "me / moi / je / nous / we / أنا / نحن" includes the author. "everyone / tout le monde / الجميع" means all members. People who are not members (e.g. "maman") are not participants. Empty list if nobody is mentioned.

confidence: between 0 and 1, how sure you are that title, date and time are right. 0.85+ when everything is explicit, 0.5–0.8 when you had to assume something, below 0.5 when the date is missing or the message is unclear.

clarification_question: if confidence < 0.6 or is_event is false, one short question in the language of the message asking for what is missing. Otherwise null.

language: the main language of the message: "fr", "en", "ar" or "other".

Never invent a date that the message does not imply.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    is_event: { type: 'boolean' },
    title: { type: ['string', 'null'] },
    date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
    start_time: { type: ['string', 'null'], description: 'HH:MM, 24h' },
    end_date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
    end_time: { type: ['string', 'null'], description: 'HH:MM, 24h' },
    all_day: { type: 'boolean' },
    location: { type: ['string', 'null'] },
    participants: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    clarification_question: { type: ['string', 'null'] },
    language: { type: 'string', enum: ['fr', 'en', 'ar', 'other'] },
  },
  required: [
    'is_event', 'title', 'date', 'start_time', 'end_date', 'end_time', 'all_day',
    'location', 'participants', 'confidence', 'clarification_question', 'language',
  ],
};

const CALENDAR_DAYS = 21;

export function buildUserPrompt(input: ParseInput): string {
  const today = utcToWall(input.now, input.timezone);
  const calendar = Array.from({ length: CALENDAR_DAYS }, (_, i) => {
    const date = addDays(today.date, i);
    const weekday = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    return `${date} ${weekday}${i === 0 ? ' (today)' : i === 1 ? ' (tomorrow)' : ''}`;
  });
  const context = {
    now: `${today.date} ${today.time} (${today.weekday})`,
    timezone: input.timezone,
    author: input.author.name,
    members: input.members.map((m) => m.name),
    calendar,
  };
  return `Context:\n${JSON.stringify(context, null, 2)}\n\nMessage:\n"""${input.text}"""`;
}

// ----------------------------------------------------------------------------- Gemini call

export type GeminiOptions = { apiKey: string; model: string; timeoutMs?: number };

async function callGemini(input: ParseInput, opts: GeminiOptions) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:generateContent`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: buildUserPrompt(input) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: RESPONSE_SCHEMA,
    },
  });

  // One retry on rate limits / temporary errors.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
      body,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 25000),
    });
    if (res.ok) {
      const data = await res.json();
      const text: string | undefined = data?.candidates?.[0]?.content?.parts
        ?.map((p: { text?: string }) => p.text ?? '')
        .join('');
      if (!text) throw new Error(`Gemini returned no text (finishReason: ${data?.candidates?.[0]?.finishReason})`);
      return { json: JSON.parse(text) as unknown, modelVersion: String(data?.modelVersion ?? opts.model) };
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 1) {
      throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

// ----------------------------------------------------------------------------- validation

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function validDate(v: unknown): string | null {
  const s = str(v);
  if (!s || !DATE_RE.test(s)) return null;
  // Rejects impossible dates such as 2026-02-31.
  return dateToUtcMidnight(s).toISOString().slice(0, 10) === s ? s : null;
}

function validTime(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const padded = /^\d:\d{2}$/.test(s) ? `0${s}` : s;
  return TIME_RE.test(padded) ? padded : null;
}

/** Coerces whatever the model sent into a well-typed ModelOutput. */
export function validateModelOutput(json: unknown): ModelOutput {
  const o = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const confidence = typeof o.confidence === 'number' ? Math.min(1, Math.max(0, o.confidence)) : 0;
  const language = ['fr', 'en', 'ar'].includes(o.language as string) ? (o.language as ModelOutput['language']) : 'other';
  return {
    is_event: o.is_event === true,
    title: str(o.title),
    date: validDate(o.date),
    start_time: validTime(o.start_time),
    end_date: validDate(o.end_date),
    end_time: validTime(o.end_time),
    all_day: o.all_day === true,
    location: str(o.location),
    participants: Array.isArray(o.participants) ? o.participants.map(str).filter((p): p is string => !!p) : [],
    confidence,
    clarification_question: str(o.clarification_question),
    language,
  };
}

// ----------------------------------------------------------------------------- normalization

function simplify(name: string): string {
  return name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

/** Maps names from the model to member ids (full name, then unique first name). */
export function matchParticipants(names: string[], members: Member[]) {
  const ids = new Set<string>();
  const unmatched: string[] = [];
  for (const name of names) {
    const target = simplify(name);
    const exact = members.filter((m) => simplify(m.name) === target);
    const byFirst = members.filter((m) => simplify(m.name).split(/\s+/)[0] === target.split(/\s+/)[0]);
    const match = exact.length === 1 ? exact[0] : byFirst.length === 1 ? byFirst[0] : null;
    if (match) ids.add(match.id);
    else unmatched.push(name);
  }
  return { ids: [...ids], unmatched };
}

const DEFAULT_DURATION_MIN = 60;

/** Turns local wall times into UTC instants. All-day events are stored as UTC midnight dates. */
export function normalize(out: ModelOutput, input: ParseInput) {
  const { ids, unmatched } = matchParticipants(out.participants, input.members);
  if (!out.is_event || !out.date) return { event: null, unmatched };

  const title = out.title ?? input.text.trim().slice(0, 60);
  const allDay = out.all_day || !out.start_time;
  let start: Date;
  let end: Date;

  if (allDay) {
    const lastDay = out.end_date && out.end_date >= out.date ? out.end_date : out.date;
    start = dateToUtcMidnight(out.date);
    end = dateToUtcMidnight(addDays(lastDay, 1)); // exclusive end
  } else {
    start = wallToUtc(out.date, out.start_time!, input.timezone);
    if (out.end_time) {
      end = wallToUtc(out.end_date ?? out.date, out.end_time, input.timezone);
      // "20h–1h" crosses midnight.
      if (end <= start && !out.end_date) end = wallToUtc(addDays(out.date, 1), out.end_time, input.timezone);
    } else if (out.end_date && out.end_date > out.date) {
      end = wallToUtc(out.end_date, out.start_time!, input.timezone);
    } else {
      end = new Date(start.getTime() + DEFAULT_DURATION_MIN * 60000);
    }
    if (end <= start) end = new Date(start.getTime() + DEFAULT_DURATION_MIN * 60000);
  }

  const event: NormalizedEvent = {
    title,
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    all_day: allDay,
    location: out.location,
    participant_ids: ids,
  };
  return { event, unmatched };
}

// ----------------------------------------------------------------------------- entry point

export async function parseMessage(input: ParseInput, opts: GeminiOptions): Promise<ParseResult> {
  const started = Date.now();
  const { json, modelVersion } = await callGemini(input, opts);
  const raw = validateModelOutput(json);
  const { event, unmatched } = normalize(raw, input);
  return { raw, event, unmatchedParticipants: unmatched, modelVersion, latencyMs: Date.now() - started };
}
