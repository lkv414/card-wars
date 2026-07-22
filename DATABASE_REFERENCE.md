# Database Schema - Quick Reference

## Tables Overview

### Cards (Card Library)
```sql
SELECT * FROM cards;
-- Fields: id, card_number, name, description, card_type, cost, 
--         attack, health, has_flip, flip_description, mechanics, 
--         image_url, land_type, is_rainbow
```

### Lands (Battlefield Lands)
```sql
SELECT * FROM lands;
-- Fields: id, name, land_type (UNIQUE), description, image_url
```

### Decks (Player Decks)
```sql
SELECT * FROM decks;
-- Fields: id, user_id, name, code (UNIQUE), 
--         cards (jsonb array), lands (jsonb array)
```

### Lobbies (Game Lobbies)
```sql
SELECT * FROM lobbies;
-- Fields: id, code (UNIQUE), host_id, status (waiting/active/finished),
--         deck_host, deck_guest
```

### Lobby Players (Players in Lobby)
```sql
SELECT * FROM lobby_players;
-- Fields: lobby_id (FK), player_id, deck, ready (bool), 
--         joined_at, nickname
```

### Games (Active Game Instances)
```sql
SELECT * FROM games;
-- Fields: id, lobby_id (FK), status (setup/active/finished), 
--         current_turn, current_player_id, game_state (jsonb)
```

### Game Players (Player State During Game)
```sql
SELECT * FROM game_players;
-- Fields: game_id (FK), player_id, health (default 25), 
--         hand (jsonb), deck_remaining, position (player1/player2)
```

### Game Zones (4 Zones Per Player)
```sql
SELECT * FROM game_zones;
-- Fields: id, game_id (FK), zone_position (1-4), player_id,
--         cards (jsonb array), land_id (FK)
```

### Game Chat (In-Game Messages)
```sql
SELECT * FROM game_chat;
-- Fields: id, game_id (FK), player_id, message, created_at
```

---

## Key Relationships

```
┌─────────────┐
│   cards     │
└─────────────┘
       ↓
┌─────────────────────────────┐
│ decks (cards stored as JSON)│
└─────────────────────────────┘
       ↓
┌──────────────┐      ┌──────────────────┐
│  lobbies     │──→   │  lobby_players   │
└──────────────┘      └──────────────────┘
       ↓
┌──────────────┐      ┌────────────────┐
│   games      │──→   │  game_players  │
└──────────────┘      └────────────────┘
       ↓
┌──────────────┐      ┌────────────────┐
│ game_zones   │      │  game_chat     │
└──────────────┘      └────────────────┘
       ↓
┌──────────────┐
│   lands      │
└──────────────┘
```

---

## Useful Queries

### Get Active Games
```sql
SELECT * FROM games WHERE status = 'active' ORDER BY updated_at DESC;
```

### Get Player's Decks
```sql
SELECT * FROM decks WHERE user_id = $1 ORDER BY created_at DESC;
```

### Get Game Board State
```sql
SELECT gz.zone_position, gz.cards, l.name as land
FROM game_zones gz
LEFT JOIN lands l ON gz.land_id = l.id
WHERE gz.game_id = $1
ORDER BY gz.player_id, gz.zone_position;
```

### Get Game History
```sql
SELECT * FROM game_chat WHERE game_id = $1 ORDER BY created_at ASC;
```

### Create New Game
```sql
INSERT INTO games (lobby_id, status, current_turn, current_player_id)
VALUES ($1, 'setup', 0, $2)
RETURNING *;
```

### Initialize Player State
```sql
INSERT INTO game_players (game_id, player_id, health, deck_remaining, position)
VALUES 
  ($1, $2, 25, 35, 'player1'),
  ($1, $3, 25, 35, 'player2')
RETURNING *;
```

### Update Player Health
```sql
UPDATE game_players 
SET health = health - $1 
WHERE game_id = $2 AND player_id = $3;
```

---

## JSONB Data Structures

### Deck Cards (stored in decks.cards)
```json
[
  {
    "card_id": "uuid",
    "name": "Card Name",
    "cost": 1,
    "attack": 3,
    "health": 2,
    "quantity": 1
  }
]
```

### Game State (stored in games.game_state)
```json
{
  "status": "active",
  "currentTurn": 5,
  "currentPlayerId": "player1_id",
  "turnPhase": "main",
  "winner": null,
  "log": [
    {
      "timestamp": 1234567890,
      "message": "Player1 played Fire Elemental"
    }
  ]
}
```

### Card Instance in Zone
```json
{
  "id": "instance_id",
  "name": "Card Name",
  "cost": 1,
  "attack": 3,
  "health": 2,
  "tapped": false,
  "flipped": false
}
```

---

## Indexes (For Performance)

- `idx_cards_card_number` - Fast card lookup
- `idx_decks_user_id` - Fast user deck lookup
- `idx_lobbies_code` - Fast lobby lookup by code
- `idx_games_status` - Fast active game lookup
- `idx_games_current_player` - Fast current player's game lookup
- `idx_game_zones_game_id` - Fast zone lookup
- `idx_game_chat_game_id` - Fast chat messages lookup

---

## Connection String (Supabase)

```bash
# In .env.local
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

---

## RLS Policies (To Implement)

```sql
-- Players can only see their own games
CREATE POLICY "see_own_games" ON games
  FOR SELECT USING (
    auth.uid()::text IN (
      SELECT player_id FROM game_players WHERE game_id = games.id
    )
  );

-- Players can only see their own game state
CREATE POLICY "see_own_game_state" ON game_players
  FOR SELECT USING (player_id = auth.uid()::text);

-- Players can only update their own zones
CREATE POLICY "update_own_zones" ON game_zones
  FOR UPDATE USING (player_id = auth.uid()::text);
```

---

**Last Updated:** 2026-07-22
**Version:** 1.0
