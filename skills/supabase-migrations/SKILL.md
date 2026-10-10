---
name: supabase-migrations
description: Безопасные SQL-миграции Supabase и пересев каталога карт для Card Wars
metadata:
  audience: developers
  project: card_game
  opencode/autoinvoke: "true"
---

## Что делаю
Пишу миграции и генерирую reseed каталога, не трогая живую БД без подтверждения.

## Когда использовать
Любые изменения в `supabase/migrations/`, `docs/CURRENT_DB_SCHEMA.sql`,
`scripts/reseed-cards.mjs`, `scripts/build-individual-supabase-sql.mjs`.

## Правила
- Миграция идемпотентна: `IF NOT EXISTS`, `DROP ... IF EXISTS`.
- Имя миграции — `YYYYMMDDHHMMSS_описание.sql`, новее всех существующих.
- Любой CHECK пересоздавать через поиск по `pg_constraint`, не по угаданному имени.
- После миграции обновлять `docs/CURRENT_DB_SCHEMA.sql`, чтобы он совпадал.
- Каталог: источник — `individual_cards/cards.json`. `card_number` уникален в БД,
  поэтому дубли переназначаются скриптом, исходный номер в `notes`.
- SQL-файлы reseed генерируются скриптом, руками не редактировать.
- Применение к Supabase (`psql`, MCP) — только после явного подтверждения пользователя.
- SQL RPC боя не расширять и не вызывать параллельно с Worker.

## Проверка
- `node scripts/reseed-cards.mjs --dry-run`
- Проверить уникальность `card_number` в сгенерированном SQL.
- `npm test`
