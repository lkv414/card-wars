-- Исправление синтаксических ошибок в триггерах
-- Проблема: "EXECUTE FUNCTION public.EXECUTE FUNCTION" вместо "EXECUTE FUNCTION public."
-- Это предотвращало правильное выполнение валидационных функций при обновлении игры
-- (в том числе при передаче хода через RPC end_turn)

-- Исправляем триггер для game_players INSERT
DROP TRIGGER IF EXISTS game_players_validate ON public.game_players;
CREATE TRIGGER game_players_validate
  BEFORE INSERT ON public.game_players
  FOR EACH ROW EXECUTE FUNCTION public.validate_game_player_before_write();

-- Исправляем триггер для game_players UPDATE
DROP TRIGGER IF EXISTS game_players_validate ON public.game_players;
CREATE TRIGGER game_players_validate
  BEFORE UPDATE ON public.game_players
  FOR EACH ROW EXECUTE FUNCTION public.validate_game_player_before_write();

-- Исправляем триггер для game_zones INSERT
DROP TRIGGER IF EXISTS game_zones_validate ON public.game_zones;
CREATE TRIGGER game_zones_validate
  BEFORE INSERT ON public.game_zones
  FOR EACH ROW EXECUTE FUNCTION public.validate_game_zone_before_write();

-- Исправляем триггер для game_zones UPDATE
DROP TRIGGER IF EXISTS game_zones_validate ON public.game_zones;
CREATE TRIGGER game_zones_validate
  BEFORE UPDATE ON public.game_zones
  FOR EACH ROW EXECUTE FUNCTION public.validate_game_zone_before_write();

-- Исправляем триггер для games INSERT
DROP TRIGGER IF EXISTS games_validate ON public.games;
CREATE TRIGGER games_validate
  BEFORE INSERT ON public.games
  FOR EACH ROW EXECUTE FUNCTION public.validate_game_before_write();

-- Исправляем триггер для games UPDATE
DROP TRIGGER IF EXISTS games_validate ON public.games;
CREATE TRIGGER games_validate
  BEFORE UPDATE ON public.games
  FOR EACH ROW EXECUTE FUNCTION public.validate_game_before_write();
