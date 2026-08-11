-- Fix land type naming: desert was a translation error; sand = Пустынная
UPDATE public.lands
SET name = 'Пустынная земля'
WHERE land_type = 'sand';

DELETE FROM public.lands
WHERE land_type = 'desert';
