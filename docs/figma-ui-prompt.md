# Figma UI-промт — веб-версия card_game

Готовый промт (вставить целиком в Figma Make / AI-генерацию). Промт на английском — Figma AI понимает его лучше; все тексты интерфейса в нём требуются на русском.

---

**PROMPT TO PASTE:**

You are designing a complete UI for a browser-based digital collectible card game — a fan-made web adaptation of the board game "Adventure Time Card Wars". One deliverable file: a design system (components, colors, typography, tokens) + 5 key screens in desktop and mobile versions.

## Product context

- **Platform:** responsive website (desktop 1440×900 and mobile 390×844). In-game 1v1 and 2v2 matches against real players over the network.
- **Audience:** fans of the cartoon; playful, friendly, not serious-competitive.
- **Content (real data must fit the UI):**
  - 19 deck sets (hero decks): Finn, Jake, BMO, Princess Bubblegum, Lumpy Space Princess, Lady Rainicorn, Marceline, Ice King, Lemongrab, Gunter, Cake, Charlie, Fiona, Tree Trunks, Monika (Lich deck), Lich, Grand Prix, FTG (For the Glory booster), Jake 2v2.
  - 26 heroes: 18 heroes with their own decks + 8 bonus heroes (Cosmic Owl, Prismo, Magic Man, Huntress Wizard, Ricardio, Billy, Abracadaniel, Strong Susan) that can be picked with any custom deck.
  - Card types: **Creature** (342), **Spell** (127), **Building** (65), **Partnership** (10, only used in 2v2 mode, landscape orientation).
  - 7 land types, each with its own color identity: Blue Plains (синие равнины — blue), Corn Fields (кукурузные поля — yellow/gold), Icy Lands (ледяные земли — light blue/white), Nice Lands (милые земли — pink), Sandy Lands (песчаные земли — sand/orange), Useless Swamp (болота — swamp green/purple), Ghostlands (призрачные земли — grey/translucent).
  - Card anatomy: cost (1–5, top-left circle), type line, attack (red X icon) and defense (blue shield icon) numbers for creatures, rules text, art (portrait ~3:4, partnership cards landscape). Cards are rendered from real scans — leave image placeholders.
  - Players have a hero portrait, a deck pile with back-of-card design, a hand, a discard pile, and track **Actions** (energy, 2 per turn) and **hit points with a shield** before HP.

## Visual style

- Cartoon look inspired by the show: thick dark outlines, slightly skewed "hand-drawn" panels, warm paper/wood table surface as the battlefield background, candy accents. Avoid any direct copyrighted artwork — use neutral placeholder illustrations and simple flat character silhouettes.
- Uppercase "bubble" display font for headings and numbers (rounded, game-UI style), highly legible sans-serif for body text. Cyrillic support is required — all game texts are in Russian.
- Priority: readability of numbers and rules text on small cards; playful but not cluttered.

## Screens to design (each in desktop + mobile)

### 1. Start menu (главное меню)
- Large game logo (placeholder), animated-ish background (table with cards).
- Primary buttons: **Играть** (matchmaking), **Приватная игра** (room with code), **Редактор колод**, **Коллекция**, **Профиль/Статистика**, **Настройки** (звук, язык, качество Графики).
- Corner elements: player avatar + nickname + currency/score, sound toggle, version.

### 2. Deck selection (выбор колоды)
- Gallery of 19 hero decks: hero portrait, deck name, color of its land type, set badge, short strength notes.
- Data shown per deck: количество существ/заклинаний/строений, средняя стоимость, краткое описание стратегии.
- Toggle: **Готовая колода** vs **Своя колода** (custom opens deck editor). Cupo heroes selectable for custom decks.
- Mobile: vertical card carousel + big "В бой" button.

### 3. Deck editor (редактор колод)
- Three zones (desktop): (a) hero + deck list on the left — rows "4× Название", grouped by card type, with counters and warnings "больше 4 копий" / "колода не заполнена"; (b) card gallery in the center with filters: набор (19), тип (существо/заклинание/строение/партнёрство), земля (7 типов), стоимость (1–5), поиск по названию; (c) detail panel on the right with big card view: cost, attack, defense, abilities, flavor text, "добавить/убрать".
- Deck meta: total cards (target **20 карт**), mana-curve histogram, ratio by land type.
- Button **Сохранить** + name input, **Сбросить**.
- Mobile: bottom sheet pattern — list collapses, filters open as overlay drawer.

### 4. Lobby (лобби)
- Room modes: **1×1** и **2×2 (Doubles Tournament)**. In 2v2: two teams of two players sitting opposite each other; partnership cards are legal.
- Player slots: avatar, hero, deck indicator (name or "Своя колода"), ready checkmark/status.
- Host controls: start game, mode switch, deck-change request (returns player to deck selection).
- Join by 6-character code, share button. General chat + quick emotes placeholders.
- Mobile: all slots stacked, code + chat in collapsible drawer.

### 5. Game screen (игровой интерфейс) — the most important one
Battle table as the central surface:
- **Board:** 2 lanes rows (my side / opponent side), each holding up to 4 **land cards** laid side by side; each land card is a slot for a creature or building. Lands show their land type art. Empty slot highlighted on drag/drop.
- **Opponent zone (top):** hero portrait, HP + shield display (number with shield badge), deck pile with card-back, hand shown as fanned face-down cards, actions counter.
- **My zone (bottom):** hero portrait, HP + shield, deck pile, discard, **action tokens (используемые «Действия», 2 за ход)**, fanned hand of readable cards (hover/tap to enlarge).
- **Turn phases banner:** "Фаза подготовки" (playing cards, costs Дейстия) → "Фаза сражения" (creatures attack). Prominent turn indicator "Твой ход / Ход противника" + turn timer.
- **Interaction states:** selected card glow, valid target highlighting (red targets for attack, green for friendly effects), damage previews ("-2"), attack arrow line.
- **Companion/partnership cards** rendered landscape, anchored between partners in 2v2.
- **Right corner stack:** battle log drawer, settings, concede button (with confirmation modal).
- **End screen overlay:** victory/defeat with stats (turns, damage dealt) + "Реванш" / "В меню".
- Mobile: board scrolls/pans vertically, hand becomes a bottom bar with swipe through mini-cards, full card view on tap as modal overlay.

## Deliverables checklist

- Design tokens: color palette (7 land colors + neutral/positive/negative), type scale (Cyrillic-ready), spacing, radii, shadows.
- Components: buttons (primary/secondary/icon), card frames for all 4 types × 2 orientations, tooltips, modals, slots, health/shield badge, action tokens, tabs, filter chips, drawers, toast for connection loss.
- All 5 screens in desktop (1440×900) and mobile (390×844) versions, in English frame names with Russian on-screen text (game strings are Russian).
- Empty/error states: no decks yet, empty collection filter, player disconnected mid-game.

---

## Русские заметки к промту (не вставлять в Figma)

- Целевой размер колоды 20 карт и «2 действия за ход» — по правилам Card Wars; если в твоей реализации правило другое — поправь цифры в промте перед вставкой.
- Все тексты в UI — на русском (промт это явно требует); названия наборов и земель можно оставить транслитом или перевести, как удобно.
- Для «Коллекции», экрана окончания боя и тултипов можно попросить AI отдельно после базовых 5 экранов.
