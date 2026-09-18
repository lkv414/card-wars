# План: переключение на локальный Docker Supabase — ИТОГ

> Стратегия (C) мягкий путь. **Статус: ✅ выполнено.**

## Результат

### БД (контейнер `supabase_db_card_game`, порт 54322)
- Справочники полные: `cards: 396`, `Heroes: 23`, `preset_decks: 18`, `lands: 6`, `deck_heroes: 6`, `preset_deck_cards: 640`, `card_art: 640`.
- `lobbies`: 101 (тестовые RNDM-лобби из Cloud-дампа).
- Игровые таблицы пусты: `games`, `game_players`, `game_zones`, `lobby_players`, `decks`, `game_chat` (нет FK-связей между dump-играми и локальными lobbies; создадутся естественно при первом матче).
- 65/396 карт имеют заполненный `mechanics`. Остальные требуют свежей OCR-выгрузки (TODO).
- Применены все 33 миграции + 16 функций RPC (включая `play_card`, `end_turn`, `forfeit_game`, `get_full_game_state`, `start_game_for_lobby`, `confirm_land_setup`, `flip_card`, `leave_lobby`, и т.д.).
- RLS включён, политики работают, ownership таблиц/функций = `postgres`.

### Фронт (`npm run dev`)
- Подключается к `http://127.0.0.1:54321` (из `.env.local`).
- Подтверждено: страница `/decks` показывает **18 готовых колод** из `preset_decks` локального Supabase.
- `npm run build` всё ещё билдит с Cloud-URL из `.env.production`.

### Что изменилось в коде
1. `vite.config.js`:
   - В dev читает `.env.local` (через новый `parseLocalEnv`) с приоритетом над `.env.production`.
   - В build читает только `.env.production` (как раньше).
   - Комментарий объясняет разделение dev/build.
2. `.env.local` — добавлен блок `VITE_SUPABASE_URL=http://127.0.0.1:54321` + ключи + WS-URL + `VITE_ALLOW_CLIENT_FALLBACK=true`. Не ломает `.env.example`/production.
3. `supabase/full_dump.sql` — была очищена от ~94 невалидных UUID (синтетические данные с буквами g..z в третьей группе UUID). Файл сохранён в рабочей ветке.

### Что НЕ менялось
- Cloud-проект Supabase не трогали.
- Все 34 миграции в `supabase/migrations/` остались идемпотентными (доказательство — успешный второй прогон).
- `add_missing_columns.sql` не удалял (он дублирует уже-применённые миграции — оставил для истории, можно удалить отдельной задачей).
- `.env.production` (Cloud) не трогал.

## TODO (отдельная задача)
1. **Свежий OCR / mechanics** — ре-парсить `карты/` для оставшихся 331 карты через MiniMax/OCR.space → нагенерировать новый `mechanics_data.sql` и применить.
2. **`add_missing_columns.sql`** — удалить (он дублирует функционал миграций, теперь они применены). Стоит сделать одной строкой: `git rm add_missing_columns.sql`.
3. **`supabase/full_dump.sql`** — закоммитить почищенную версию (сейчас untracked). Перед этим — заглянуть на строки 8-44 с тестовыми лобби и решить, оставлять как есть или отфильтровать только реалистичные lobbies.
4. **Workers (Cloudflare Durable Objects)** — на них в `.env.local` я поставил `ws://127.0.0.1:8787`, но реально Workers крутятся на Cloudflare, не локально. Перед реальным локальным тестом WebSocket нужен `wrangler dev`. Нужно обсудить, действительно ли Workers надо разворачивать локально.

## Что сделали по шагам
| # | Шаг | Команда |
|---|---|---|
| 0 | Бэкап | `pg_dump → backups/local_pre_migration_*.sql` |
| 1 | Миграции | Прогнаны через `docker exec` + `psql` (после передачи ownership и переключения на `psql -c` для проблемных файлов) |
| 2 | Дамп | `sed-n` + `python` UUID-cleanup → `psql -f empty_v4.sql` |
| 3 | Env | Рефакторинг `vite.config.js` (parseLocalEnv) + добавление VITE_-блока в `.env.local` |
| 4 | Проверка | `curl localhost` не из bash; `open_preview` http://127.0.0.1:5173/decks → видны 18 preset колод |
| 5 | Mechanics | `psql -f supabase/seed/mechanics_data.sql` — 65/396 карт заполнены |
