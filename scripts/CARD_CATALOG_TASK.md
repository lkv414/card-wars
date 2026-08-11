# CARD CATALOG TASK — Hermes Agent

> **Executor:** Hermes (MiniMax M3) via `vision_analyze` + terminal tools  
> **Project:** `C:\Users\<redacted>\WebstormProjects\card_game`  
> **Image root:** `C:\Users\<redacted>\Music\Adventure Time Card Wars`  
> **Output DB:** `C:\Users\<redacted>\WebstormProjects\card_game\data\cards.db`  
> **Progress log:** `C:\Users\<redacted>\WebstormProjects\card_game\data\card_catalog_progress.json`

## Goal

Build a complete SQLite catalog of all Card Wars physical deck scans:

1. **`cards`** — unique cards (deduplicated by stable identity: name + card_type + cost + attack + health + land_type, or visual hash if needed)
2. **`card_art`** — every cut image linked to a card, with filesystem path
3. **`preset_decks`** — one row per ready 40-card hero deck (e.g. Fiona, Jake, BMO…)
4. **`preset_deck_cards`** — exactly 40 slots per preset deck, linked to `cards` + `cuts` filename
5. **`card_grid_scans`** (NEW) — raw OCR from each of the 5 grid photos (8 cards each), before matching to cuts

Also store **grid photo paths** so each card slot can trace back to source grid image + position (1–8).

## Folder layout (7 sets, ~13 hero decks)

Each `Card Wars * vs *` folder has **2 hero subfolders**. Inside each hero folder:

| Path | Content |
|------|---------|
| `{hero}_1.png` … `{hero}_5.png` | Grid photos: **8 cards each** → 5×8 = **40 cards per deck** |
| `cuts/` | Individual card PNGs: `{hero}_card_1.png` … `{hero}_card_40.png` |
| `back.png` | Card back (ignore) |

**Sets to process:**

| Set folder | Hero subfolders (Cyrillic names — discover via filesystem) |
|------------|-----------------------------------------------------------|
| Card Wars Finn vs Jake | finn grids + jake grids |
| Card Wars Fiona vs Cake | fiona + cake |
| Card Wars BMO vs Lady Rainicorn | BMO + ladyraincorn |
| Card Wars Ice King vs Marceline | iceking + Marceline |
| Card Wars Lemongrab vs Gunter | lemon + gunter |
| Card Wars Princess Bubblegum vs Lumpy Space Princess | PB + LSP |
| Card Wars Doubles Tournament | 1 folder, different layout — handle separately |

Skip `all heroes small`, `all_heroes`, `All_Lands`, booster folders unless they contain the 5+5 grid pattern.

## Existing DB (extend, do NOT drop blindly)

Current `data/cards.db` has partial data (69 cards). **Backup first:**

```powershell
Copy-Item data\cards.db data\cards.db.bak -Force
```

Existing tables: `cards`, `card_art`, `preset_decks`, `preset_deck_cards`.

### Target schema additions

```sql
-- Raw grid OCR results (one row per card position in a grid photo)
CREATE TABLE IF NOT EXISTS card_grid_scans (
  id TEXT PRIMARY KEY,
  set_folder TEXT NOT NULL,           -- e.g. "Card Wars Fiona vs Cake"
  hero_slug TEXT NOT NULL,            -- e.g. "fiona"
  hero_folder TEXT NOT NULL,          -- actual subfolder name on disk
  grid_index INTEGER NOT NULL,        -- 1..5
  grid_image_path TEXT NOT NULL,      -- absolute path to {hero}_N.png
  slot_in_grid INTEGER NOT NULL,      -- 1..8 (reading order: left→right, top→bottom)
  global_slot INTEGER NOT NULL,       -- 1..40 = (grid_index-1)*8 + slot_in_grid
  cuts_filename TEXT,                 -- matched cuts file e.g. fiona_card_17.png
  cuts_path TEXT,                     -- absolute path to cuts PNG
  ocr_json TEXT,                      -- full vision JSON
  match_confidence REAL,              -- 0..1
  match_method TEXT,                  -- 'slot_order' | 'name_match' | 'vision_match'
  created_at TEXT DEFAULT (datetime('now'))
);

-- Optional: view for unique cards (already cards table, but add view)
CREATE VIEW IF NOT EXISTS v_cards_unique AS
  SELECT * FROM cards;

-- Optional: view for complete 40-card decks
CREATE VIEW IF NOT EXISTS v_preset_decks_complete AS
  SELECT pd.*, COUNT(pdc.card_id) AS card_count
  FROM preset_decks pd
  LEFT JOIN preset_deck_cards pdc ON pdc.preset_deck_id = pd.id
  GROUP BY pd.id
  HAVING card_count = 40;
```

### `cards` columns (align with Supabase migration + project)

```
id, name, card_type, cost, attack, health, land_type, is_rainbow, has_flip,
flip_description, description, mechanics (JSON text), rarity, source, hero, tags,
card_number, notes, created_at, updated_at
```

- `id`: use `md5(normalized_name + type + cost + attack + health + land)` hex string (match existing style) OR uuid
- `card_type`: creature | spell | building | landscape
- `land_type`: blue | corn | nice | ice | sand | swamp | rainbow | any
- `source`: set code e.g. CP1, CP3, CP6, FCP6, FTG — infer from set folder name
- `hero`: hero slug (finn, jake, fiona, …)

### `card_art` columns

```
id, card_id, cuts_filename, deck_slug, source_url, grid_image_path, grid_slot,
is_primary, created_at
```

- `source_url`: **relative path from IMAGE_ROOT**, e.g. `Card Wars Fiona vs Cake/Фиона/cuts/fiona_card_3.png`
- `grid_image_path`: relative path to grid photo that contained this card
- `is_primary`: 1 for the main cut art

## Workflow per hero deck

For each hero folder (e.g. Fiona):

### Step 1 — Inventory

List `{hero}_1.png`…`{hero}_5.png` and all files in `cuts/`. Verify cuts count = 40.

### Step 2 — Grid vision OCR (5 images)

For each grid photo, call `vision_analyze` with prompt:

```
This is a Card Wars trading card sheet photo with exactly 8 cards in a 2×4 or 4×2 grid.
List cards in reading order (left to right, top to bottom).
For EACH of the 8 cards return JSON array element:
{
  "slot": 1-8,
  "name": "Russian card name exactly as printed",
  "card_type": "creature|spell|building|landscape",
  "land_type": "blue|corn|nice|ice|sand|swamp|rainbow|any",
  "cost": number,
  "attack": number or 0,
  "health": number or 0,
  "is_rainbow": boolean,
  "has_flip": boolean,
  "flip_description": string or null,
  "description": "full ability text in Russian"
}
Return ONLY a JSON array of 8 objects.
```

Save to `card_grid_scans` with `global_slot = (grid_index-1)*8 + slot`.

**ASCII path trick:** if vision fails on Cyrillic paths, copy image to `%TEMP%\grid_{hero}_{n}.png` first.

### Step 3 — Match grid slots → cuts files

Default assumption: **cuts are numbered in same order as grid reading**
- `fiona_card_1.png` ↔ global_slot 1 (from grid 1 slot 1)
- …
- `fiona_card_40.png` ↔ global_slot 40 (from grid 5 slot 8)

Validate by running `vision_analyze` on a sample of cuts and comparing names to grid OCR.
If mismatch, try name-based matching and set `match_method` accordingly.

### Step 4 — Upsert unique `cards`

Merge duplicates across heroes/sets (same card name + stats → one `cards.id`, multiple `card_art` rows).

### Step 5 — Upsert `preset_decks` + `preset_deck_cards`

One preset deck per hero with slug e.g. `fiona`, name `Fiona`, 40 rows in `preset_deck_cards` with `slot` 1..40.

### Step 6 — Progress checkpoint

After each hero deck, append to `data/card_catalog_progress.json`:

```json
{"hero_slug":"fiona","status":"done","cards":40,"grids_scanned":5,"timestamp":"..."}
```

Resume from last incomplete hero if interrupted.

## Python helper

Create `scripts/build_card_catalog.py` that Hermes can run incrementally:

- `--hero fiona` — process one deck
- `--all` — process all
- `--match-only` — re-run cuts matching without re-OCR
- Uses `vision_analyze` from Hermes tools OR subprocess to Hermes

Reference existing OCR prompt in `scripts/ocr_vision.py`.

## Compatibility with card_game project

- DB path: `data/cards.db` (local dev catalog)
- Supabase cloud has separate `cards` table — export script `scripts/export_cards_to_sql.py` optional later
- `card_art.source_url` must work when joined with IMAGE_ROOT for admin panel / deck builder
- Match field names to `src/components/CardForm.jsx` and `supabase/migrations/20260802100000_preset_decks.sql`

## Quality checks

After each deck:

```powershell
python scripts/validate_card_catalog.py --hero fiona
```

Checks:
- 40 cuts linked
- 40 preset_deck_cards
- 5 grid scans × 8 slots = 40 grid rows
- Every card_art has non-null source_url
- No duplicate slots in preset_deck_cards

## Deliverables

1. Updated `data/cards.db` with all tables populated
2. `scripts/build_card_catalog.py` — reusable pipeline
3. `scripts/validate_card_catalog.py` — validation
4. `data/card_catalog_progress.json` — progress
5. Short `data/CATALOG_REPORT.md` — counts per deck, errors, unmatched cards

## Start command

Process **one pilot deck first** (Fiona), validate, then `--all`.

Do NOT modify game source code unless needed for import paths.
Use `--accept-hooks` / auto-approve for batch vision calls.
