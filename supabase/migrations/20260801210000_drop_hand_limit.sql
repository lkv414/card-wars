-- Remove hand-length limit trigger (Фаза 5)
-- Причина: триггер game_players_hand_length_check блокирует refill руки
-- когда клиент отправляет hand с 5+ картами (из-за двойного onClick+onDrop
-- или дрифта state). Drag-and-drop требует большей толерантности.

DROP TRIGGER IF EXISTS game_players_hand_length_check ON public.game_players;
DROP FUNCTION IF EXISTS public.check_game_players_hand_length();
