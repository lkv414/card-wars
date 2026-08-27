# Build & Environment — как это работает

> Гайд для тех, кто запускает проект впервые. Если ты **полный ноль** — начни с секции 1.

---

## 1. За 5 минут: запустить локально

```bash
# 1. Клонируем
git clone <repo>
cd card_game

# 2. Ставим зависимости
npm install

# 3. Создаём .env из шаблона (один раз)
cp .env.example .env
# (можно ничего не менять — для локальной разработки дефолты рабочие)

# 4. Поднимаем Worker realtime в отдельном терминале
npm run workers:dev
#   ⏳ ждём пока wrangler напишет "Ready on http://127.0.0.1:8787"

# 5. Запускаем фронт
npm run dev
#   🌐 открываем http://localhost:5173
```

**Готово.** Если ошибок нет — ты в игре.

---

## 2. Зачем нужны env-переменные

Карточный движок использует **два** бэкенда:

| Бэкенд | Что делает | Где крутится |
|---|---|---|
| **Supabase** | Auth, Postgres (каталог карт, лобби, профили), Admin CRUD | Облако Supabase |
| **Cloudflare Worker** | Realtime мультиплеер (GameRoom, LobbyRoom), KV-каталог, in-memory game engine | Cloudflare Edge |

Фронт должен знать, куда стучаться в каждом случае — это и есть env-переменные.

---

## 3. Три env-файла — зачем каждый

```
.env.example       шаблон, закоммичен      →  что копировать в свой .env
.env.production    рабочий для build,      →  Vite читает при `npm run build`
                   закоммичен
.env               личные overrides         →  Vite читает при `npm run dev`
                   (gitignored!)
```

**Правило:** переменные с префиксом `VITE_` попадают в браузерный bundle, остальные — нет.

---

## 4. Production-build: как Vite подхватывает env

`npm run build` запускается в production-режиме. Vite автоматически читает `.env.production`. Чтобы build был рабочим, в `.env.production` **должны быть**:

```
VITE_SUPABASE_URL              ← куда фронт ходит за данными
VITE_SUPABASE_PUBLISHABLE_KEY  ← anon-ключ (НЕ service_role!)
VITE_GAME_WS_URL               ← куда WebSocket коннектится
VITE_ALLOW_CLIENT_FALLBACK     ← false для прода
```

Эти переменные уже закоммичены в репо. Build работает «из коробки».

### Что если хочешь НЕ коммитить `.env.production`?

Удали `.env.production` из репо и задай переменные в **Cloudflare Pages → Settings → Environment variables (Production)** — Cloudflare Pages подставит их в build через API.

---

## 5. Cloudflare Pages: переменные окружения

URL: https://dash.cloudflare.com → Workers & Pages → card-wars-game → Settings → Environment variables

| Переменная | Production | Preview | Development |
|---|:---:|:---:|:---:|
| `VITE_SUPABASE_URL` | ✅ | ✅ | ✅ |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | ✅ | ✅ | ✅ |
| `VITE_GAME_WS_URL` | ✅ | ✅ | ✅ |
| `VITE_ALLOW_CLIENT_FALLBACK` | `false` | `true` | `true` |

После изменения — redeploy (не retry, а именно **redeploy**).

---

## 6. Worker secrets (НЕ для фронта!)

Worker-у читает секреты через `wrangler secret put` — они **не** попадают в бандл.

```bash
# Один раз при первой настройке:
npx wrangler secret put SUPABASE_URL --config workers/wrangler.jsonc
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config workers/wrangler.jsonc
```

`SUPABASE_SERVICE_ROLE_KEY` — это **другой** ключ, чем `VITE_SUPABASE_PUBLISHABLE_KEY`. Service role имеет полный доступ к БД (обходит RLS) и должен жить только в Worker.

---

## 7. Типичные ошибки

### "Не заданы VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY"

`App.jsx` рендерит `SupabaseConfigMissing`. Значит `import.meta.env.VITE_SUPABASE_URL` пуст. Возможные причины:
1. **`npm run build` без `.env.production`** в репо. Решение: `git pull`, чтобы получить `.env.production`.
2. **Закешированный bundle в браузере**. Решение: Ctrl+Shift+R.
3. **Cloudflare Pages env vars не заданы** (если удалил `.env.production`). Решение: задай в UI.

### Multiplayer не работает в проде

Проверь `VITE_GAME_WS_URL` — должен указывать на **деплоенный** Worker, не `http://127.0.0.1:8787`. Деплой Worker:

```bash
npm run workers:deploy
```

### "RPC missing" / "Schema cache"

Supabase-миграции не применены. Запусти:

```bash
npx supabase db push
```

---

## 8. Чек-лист перед прод-деплоем

- [ ] `.env.production` закоммичен в `main`
- [ ] Cloudflare Pages → Build command: `npm run build`, Build output: `dist`
- [ ] Cloudflare Pages → Environment variables → все 4 переменные заданы
- [ ] `npx wrangler secret put SUPABASE_URL ...` — выполнен
- [ ] `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY ...` — выполнен
- [ ] `npx supabase db push` — все миграции применены
- [ ] `npm run workers:deploy` — Worker задеплоен
- [ ] `npm run catalog:migrate` — каталог залит в KV (один раз после деплоя Worker)
- [ ] `npm run build` локально проходит без ошибок
- [ ] Smoke-тесты: `npx vitest run --config vitest.config.js`

---

## 9. Полезные команды

```bash
npm run dev              # Фронт (HMR)
npm run build            # Production build → dist/
npm run preview          # Запустить dist/ локально
npm run lint             # ESLint
npm run test:smoke       # Vitest smoke (29 тестов)
npm run workers:dev      # Worker в wrangler dev mode
npm run workers:deploy   # Worker → production
npm run catalog:migrate  # Залить каталог cards/lands → KV
npm run db:push          # Применить Supabase-миграции
```