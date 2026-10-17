# Staging environment

Use a **separate Supabase project** for migration testing before production.

## Setup

1. Create a new project in [Supabase Dashboard](https://supabase.com/dashboard) (e.g. `card-game-staging`).
2. Copy `.env.example` to `.env.staging` with staging URL and anon key.
3. Link CLI: `npx supabase link --project-ref <staging-ref>`
4. Apply migrations: `npx supabase db push`

## Admin user (staging)

1. Authentication → Users → invite/create user.
2. Set **App Metadata**: `{ "role": "admin" }`.
3. Log in at `/admin/login` on the staging frontend.

## Local integration tests

```bash
npx supabase start
npm run test:supabase
```

CI runs the same contract checks on every PR (see `.github/workflows/ci.yml`).

## Schema snapshot

Generate a single schema file from remote (do not hand-copy RPC bodies into migrations):

```bash
SUPABASE_PROJECT_REF=<ref> npm run db:schema
```

Output: `supabase/CURRENT_DB_SCHEMA.sql`

## Production vs staging

| | Production | Staging |
|---|------------|---------|
| Migrations | after staging QA | first |
| `VITE_ALLOW_CLIENT_FALLBACK` | `false` | `false` |
| Admin RLS | `is_admin()` JWT | same |
