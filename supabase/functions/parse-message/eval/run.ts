// Parser evaluation: runs every case in cases.json through the real parser
// (same code as the Edge Function) and reports per-field accuracy.
//
//   npm run eval                 # all cases
//   npm run eval -- fr-01 ar-04  # only some cases
//
// Needs GEMINI_API_KEY in supabase/functions/.env (git-ignored).
// Results are saved to eval/results/<timestamp>.json.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { DEFAULT_MODEL, parseMessage, PROMPT_VERSION, type Member, type ParseResult } from '../parse.ts';

type Expect = {
  is_event?: boolean;
  date?: string;
  start_time?: string;
  end_date?: string;
  end_time?: string;
  all_day?: boolean;
  location_contains?: string;
  participants_include?: string[];
  low_confidence?: boolean;
  start_at_utc?: string;
};
type Case = { id: string; lang: string; text: string; expect: Expect };
type Suite = {
  context: { now: string; timezone: string; author: string; members: string[] };
  cases: Case[];
};

const MODEL = process.env.GEMINI_MODEL || DEFAULT_MODEL;
const DELAY_MS = Number(process.env.EVAL_DELAY_MS ?? 4500); // stay under free-tier rate limits

const envFile = new URL('../../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('Missing GEMINI_API_KEY. Put it in supabase/functions/.env (see .env.example).');
  process.exit(1);
}

const suite: Suite = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8'));
const only = process.argv.slice(2);
const cases = only.length ? suite.cases.filter((c) => only.includes(c.id)) : suite.cases;

const members: Member[] = suite.context.members.map((name) => ({ id: `id-${name}`, name }));
const author = members.find((m) => m.name === suite.context.author)!;
const idOf = (name: string) => members.find((m) => m.name === name)?.id;

/** Returns field → pass/fail for the fields this case specifies. */
function score(expect: Expect, r: ParseResult): Record<string, boolean> {
  const raw = r.raw;
  const checks: Record<string, boolean> = {};
  if (expect.is_event !== undefined) checks.is_event = raw.is_event === expect.is_event;
  if (expect.date !== undefined) checks.date = raw.date === expect.date;
  if (expect.start_time !== undefined) checks.start_time = raw.start_time === expect.start_time;
  if (expect.end_date !== undefined) checks.end_date = raw.end_date === expect.end_date;
  if (expect.end_time !== undefined) checks.end_time = raw.end_time === expect.end_time;
  if (expect.all_day !== undefined) checks.all_day = (r.event?.all_day ?? raw.all_day) === expect.all_day;
  if (expect.location_contains !== undefined) {
    checks.location = (raw.location ?? '').toLowerCase().includes(expect.location_contains.toLowerCase());
  }
  if (expect.participants_include !== undefined) {
    const got = new Set(r.event?.participant_ids ?? []);
    checks.participants = expect.participants_include.every((n) => got.has(idOf(n)!));
  }
  if (expect.low_confidence !== undefined) {
    checks.low_confidence = (!raw.is_event || raw.confidence < 0.6) === expect.low_confidence;
  }
  if (expect.start_at_utc !== undefined) checks.start_at_utc = r.event?.start_at === expect.start_at_utc;
  return checks;
}

const results: { case: Case; result?: ParseResult; checks: Record<string, boolean>; error?: string }[] = [];

console.log(`Evaluating ${cases.length} cases with ${MODEL} (prompt ${PROMPT_VERSION})…\n`);
for (const [i, c] of cases.entries()) {
  if (i > 0) await new Promise((r) => setTimeout(r, DELAY_MS));
  try {
    const result = await parseMessage(
      { text: c.text, timezone: suite.context.timezone, now: new Date(suite.context.now), author, members },
      { apiKey, model: MODEL },
    );
    const checks = score(c.expect, result);
    const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
    results.push({ case: c, result, checks });
    console.log(`${failed.length ? '✗' : '✓'} ${c.id.padEnd(7)} ${c.text}`);
    if (failed.length) {
      const r = result.raw;
      console.log(`    failed: ${failed.join(', ')} | got date=${r.date} time=${r.start_time} end=${r.end_date ?? ''} ${r.end_time ?? ''} all_day=${r.all_day} loc=${r.location} participants=[${r.participants}] conf=${r.confidence} is_event=${r.is_event}`);
    }
  } catch (err) {
    results.push({ case: c, checks: { error: false }, error: String(err) });
    console.log(`! ${c.id.padEnd(7)} ERROR ${String(err).slice(0, 160)}`);
  }
}

// ----------------------------------------------------------------------------- report
function pct(ok: number, total: number) {
  return total ? `${((100 * ok) / total).toFixed(0)}% (${ok}/${total})` : '—';
}

const fieldTotals = new Map<string, { ok: number; total: number }>();
const langTotals = new Map<string, { ok: number; total: number }>();
for (const r of results) {
  for (const [field, ok] of Object.entries(r.checks)) {
    const t = fieldTotals.get(field) ?? { ok: 0, total: 0 };
    fieldTotals.set(field, { ok: t.ok + Number(ok), total: t.total + 1 });
  }
  const allOk = Object.values(r.checks).every(Boolean);
  const l = langTotals.get(r.case.lang) ?? { ok: 0, total: 0 };
  langTotals.set(r.case.lang, { ok: l.ok + Number(allOk), total: l.total + 1 });
}
const exact = results.filter((r) => Object.values(r.checks).every(Boolean)).length;
const latencies = results.flatMap((r) => (r.result ? [r.result.latencyMs] : [])).sort((a, b) => a - b);

console.log(`\nModel: ${results.find((r) => r.result)?.result?.modelVersion ?? MODEL} · prompt ${PROMPT_VERSION}`);
console.log(`Fully correct cases: ${pct(exact, results.length)}`);
console.log('\nPer field:');
for (const [field, t] of fieldTotals) console.log(`  ${field.padEnd(15)} ${pct(t.ok, t.total)}`);
console.log('\nFully correct per language:');
for (const [lang, t] of langTotals) console.log(`  ${lang.padEnd(15)} ${pct(t.ok, t.total)}`);
if (latencies.length) {
  console.log(`\nLatency: median ${latencies[Math.floor(latencies.length / 2)]} ms, max ${latencies.at(-1)} ms`);
}

const outDir = new URL('./results/', import.meta.url);
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outFile = new URL(`./${stamp}.json`, outDir);
writeFileSync(
  outFile,
  JSON.stringify(
    {
      model: results.find((r) => r.result)?.result?.modelVersion ?? MODEL,
      prompt_version: PROMPT_VERSION,
      run_at: new Date().toISOString(),
      fully_correct: { ok: exact, total: results.length },
      per_field: Object.fromEntries(fieldTotals),
      per_language: Object.fromEntries(langTotals),
      results: results.map((r) => ({
        id: r.case.id,
        text: r.case.text,
        expect: r.case.expect,
        checks: r.checks,
        error: r.error,
        raw: r.result?.raw,
        event: r.result?.event,
        latency_ms: r.result?.latencyMs,
      })),
    },
    null,
    2,
  ),
);
console.log(`\nSaved ${outFile.pathname}`);
