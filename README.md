# Agenda Proches

A shared calendar for family and friends, where you type plans in plain language ("dinner at Sara's Thursday 7pm") and an LLM turns them into events.

**Stack**: React Native (Expo, TypeScript) · Supabase (Postgres + Row Level Security, Auth, Realtime, Edge Functions) · Gemini.

**Data science angle**: every message is stored with the model's parse and the user's correction, which builds a labeled dataset for measuring parsing accuracy across languages (FR/EN/AR) and relative-date expressions.

## Run it locally
1. `npm install`
2. `cp .env.example .env` and fill in your Supabase project URL and publishable key.
3. `npx supabase link --project-ref <your-ref>` then `npm run db:push`.
4. `npx expo start` and scan the QR code with Expo Go.

## Status
- [x] Phase 1: setup, schema with RLS, authentication
- [x] Phase 2: groups and invitations
- [x] Phase 3: natural-language parsing (Edge Function + Gemini)
- [ ] Phase 4: real-time shared calendar
- [ ] Phase 5: find a common time slot
