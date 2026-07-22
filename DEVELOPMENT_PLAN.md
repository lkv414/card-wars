# 🎮 Card Wars Online - План разработки

## ✅ ЗАВЕРШЕНО (ФАЗА 1-2)

### 1. **Структура БД** ✓
- Файл: `DB_SCHEMA.sql`
- Таблицы:
  - `cards` - Все карты
  - `lands` - Типы земель
  - `decks` - Пользовательские колоды
  - `lobbies` & `lobby_players` - Лобби
  - `games` & `game_players` - Активные игры
  - `game_zones` - 4 зоны каждого игрока
  - `game_chat` - Чат игры
- Готово для: Supabase PostgreSQL

### 2. **Game Engine** ✓
- Файл: `src/game/gameEngine.js`
- Логика:
  - Инициализация игры (перемешивание, начальная рука)
  - Ходы: подготовка карт, розыгрыш, действия (2/ход)
  - Разыгрывание карт в 4 зон (как UNO)
  - Атаки и боевую механику
  - Урон и здоровье героя (25 HP)
  - История ходов (лог)
  - Проверка победы

### 3. **UNO-подобный UI** ✓
- **GameBoard** (`GameBoard.jsx`) - главный компонент (3-секционный лейаут)
  - Верхняя часть: Зоны противника (4 зоны в сетке)
  - Центр: Информация о ходе + лог
  - Нижняя часть: Ваши зоны (4 зоны) + рука карт

### 4. **React Компоненты** ✓
- `GameBoard.jsx` - Главная доска с управлением
- `GameZone.jsx` - Зона с картами (поддержка карт)
- `Card3D.jsx` - 3D карта с анимациями флипа
- `PlayerHand.jsx` - Рука игрока с выбором карт
- `GameStatus.jsx` - Статус здоровья, морозных жетонов
- `GameLog.jsx` - История последних 5 ходов

### 5. **CSS Styling** ✓
- `GameBoard.css` - Основной лейаут с градиентом
- `GameZone.css` - Стиль зон (UNO-подобный)
- `Card3D.css` - 3D карты с flip-анимацией + перспектива
- `PlayerHand.css` - Рука с горизонтальным скроллом
- `GameStatus.css` - Полоса здоровья + информация
- `GameLog.css` - Лог с автоскроллом

**Особенности UI:**
- 🎨 Градиентный фон (фиолетово-розовый, как UNO)
- 🃏 3D переворот карт (CSS transform)
- 💫 Анимации карт (enter, flip, tap)
- 📱 Responsive дизайн (мобильные + планшеты)
- ✨ Glass-морфизм (backdrop blur)

### 6. **Realtime Hook** ✓
- Файл: `src/hooks/useGameRealtimeSync.js`
- Supabase Realtime подписка на изменения game_players и games таблиц
- Синхронизация между игроками в реальном времени

---

## ⏳ В ОЖИДАНИИ (ФАЗА 3-4)

### Backend Setup (Pending)
- Supabase Edge Functions для валидации ходов
- Webhooks для синхронизации
- Аутентификация (JWT)

### WebSocket Connection (Pending)
- Подключение к Supabase Realtime
- Обработка задержек и переподключения
- Синхронизация состояния между вкладками

### Test Pages (Pending)
- **Page 1**: Connection Debug
  - Статус подключения
  - Ping/Latency
  - Network status
  - Лог всех событий
  
- **Page 2**: Actual Game
  - Полная игра
  - 2 игрока в разных браузерных вкладках

### Local Testing (Pending)
- Открыть сайт в 2 вкладках
- Протестировать:
  - Синхронизацию ходов
  - Разыгрывание карт
  - Атаки
  - Обновление руки в реальном времени

### Cloudflare Setup (Pending)
- Cloudflare Workers для API routing
- Proxy к Supabase

### RLS Security (Pending)
- Row-level security policies
- Защита от читинга (игроки видят только свои данные)
- Валидация ходов на сервере

---

## 🚀 Как начать тестирование?

1. **Установить зависимости:**
   ```bash
   npm install
   ```

2. **Запустить dev сервер:**
   ```bash
   npm run dev
   ```

3. **Конфигурировать Supabase:**
   - Создать проект на supabase.com
   - Выполнить SQL из `DB_SCHEMA.sql`
   - Добавить `.env.local`:
     ```
     VITE_SUPABASE_URL=your_url
     VITE_SUPABASE_ANON_KEY=your_key
     ```

4. **Тестирование на 2 вкладках:**
   - Открыть `localhost:5173` в вкладке 1
   - Открыть `localhost:5173` в вкладке 2
   - Каждому игроку выбрать разные колоды
   - Участвовать в лобби
   - Начать игру

---

## 📁 Структура проекта

```
src/
├── game/
│   └── gameEngine.js          # Game logic engine
├── components/
│   └── Game/
│       ├── GameBoard.jsx      # Main board
│       ├── GameZone.jsx       # Zone with cards
│       ├── Card3D.jsx         # 3D card
│       ├── PlayerHand.jsx     # Player's hand
│       ├── GameStatus.jsx     # Player status
│       ├── GameLog.jsx        # Move log
│       └── *.css              # Styles
├── hooks/
│   └── useGameRealtimeSync.js # Realtime sync
└── ...

DB_SCHEMA.sql                  # Database schema
```

---

## 🎯 Следующие шаги

1. **Backend Setup** - Настроить Supabase webhooks и validation
2. **Real-time Sync** - Интегрировать WebSocket подписки
3. **Test Pages** - Создать 2 тестовые страницы (connection debug + game)
4. **Local Testing** - Протестировать на 2 вкладках браузера
5. **Deploy** - Настроить Cloudflare Workers + Vercel (опционально)
6. **RLS Security** - Добавить строковую безопасность в Supabase

---

## 📋 Технологический стек

- **Frontend:** React 19 + Vite
- **Backend:** Supabase (PostgreSQL + Realtime)
- **Hosting:** Cloudflare (Workers) + Vercel (опционально)
- **Real-time:** Supabase Realtime (WebSocket)
- **Database:** PostgreSQL (Supabase)
- **UI:** CSS3 (3D transforms, animations, glass-morphism)

---

**Создано:** 2026-07-22
**Версия:** 1.0
**Статус:** 🟢 Фаза 2 завершена, готово к фазе 3
