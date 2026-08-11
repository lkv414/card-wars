# Agent Skills — Card Wars Online

Curated skills for AI agents working on this repo. **Read the matching skill before implementing** — do not guess patterns.

Source: [affaan-m/ECC](https://github.com/affaan-m/ECC) (Everything Claude Code). Installed copies live in `skills/` and are version-controlled.

## How to use (mandatory for agents)

1. Read [llms.txt](../llms.txt) first — project context, conventions, and file map.
2. Pick skills from the table below based on the task.
3. Open and follow `skills/<name>/SKILL.md` **before writing code**.
4. After changes: `npm test` → `npm run lint` → `npm run build`.
5. If you changed architecture or workflows, update `llms.txt`.

## Skill index

| Skill | When to read |
|-------|----------------|
| [search-first](search-first/SKILL.md) | New feature, dependency, or utility — research before coding |
| [context-budget](context-budget/SKILL.md) | Large task; audit what to load into context |
| [token-budget-advisor](token-budget-advisor/SKILL.md) | User asks about token cost or context limits |
| [strategic-compact](strategic-compact/SKILL.md) | Long session; summarize at phase boundaries |
| [react-patterns](react-patterns/SKILL.md) | Components, hooks, state, Suspense, error boundaries |
| [react-performance](react-performance/SKILL.md) | Bundle size, lazy loading, re-renders, waterfalls |
| [react-testing](react-testing/SKILL.md) | Component/hook unit tests (Vitest + RTL) |
| [frontend-patterns](frontend-patterns/SKILL.md) | UI structure, state, general frontend work |
| [frontend-a11y](frontend-a11y/SKILL.md) | Accessibility: ARIA, focus, keyboard, screen readers |
| [vite-patterns](vite-patterns/SKILL.md) | `vite.config.js`, env vars, code-splitting, build |
| [error-handling](error-handling/SKILL.md) | User-facing errors, logging, retries, boundaries |
| [postgres-patterns](postgres-patterns/SKILL.md) | SQL queries, indexes, Supabase Postgres tuning |
| [database-migrations](database-migrations/SKILL.md) | Schema changes in `supabase/migrations/` |
| [security-review](security-review/SKILL.md) | Auth, RLS, secrets, user input, RPC exposure |
| [e2e-testing](e2e-testing/SKILL.md) | Playwright flows (lobby → game) |
| [browser-qa](browser-qa/SKILL.md) | Visual/manual QA after deploy |
| [tdd-workflow](tdd-workflow/SKILL.md) | New features with test-first discipline |
| [verification-loop](verification-loop/SKILL.md) | Full verification before marking done |
| [coding-standards](coding-standards/SKILL.md) | Naming, readability, review baseline |
| [git-workflow](git-workflow/SKILL.md) | Branching, commits, PRs |

## Task → skill bundles

| Task type | Read these skills (in order) |
|-----------|------------------------------|
| React UI / hooks | `search-first` → `react-patterns` → `frontend-a11y` |
| Game logic / Supabase RPC | `search-first` → `postgres-patterns` → `error-handling` → `security-review` |
| Performance / bundle | `react-performance` → `vite-patterns` |
| New DB migration | `database-migrations` → `postgres-patterns` → `security-review` |
| Bug fix | `search-first` → relevant domain skill → `verification-loop` |
| Before PR / done | `verification-loop` → run `npm test && npm run lint && npm run build` |

## Local vs committed

| Path | Purpose |
|------|---------|
| `skills/` | **Committed** — canonical copy for all agents |
| `.agents/skills/` | Local Cursor install (gitignored); may mirror `skills/` |
| `skills-lock.json` | Lockfile for ECC skill sources |

To refresh from ECC: `npx skills add affaan-m/ECC --skill <name>` then copy into `skills/` and commit.
