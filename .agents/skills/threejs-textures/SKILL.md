---
name: threejs-textures
description: Texture pipeline, caching, and fallback canvas generation for Card Wars v3 3D scene in React Three Fiber. Covers card WebP textures, cardId caching, SRGBColorSpace, CanvasTexture fallbacks, and VRAM cleanup.
---

# Three.js Textures — Card Wars v3

Руководство по управлению текстурами карт, земель и жетонов в 3D-сцене карточной игры в соответствии со спецификацией [docs/UI-3D.md](../../docs/UI-3D.md) и скиллом [r3f-best-practices](../r3f-best-practices/SKILL.md).

---

## 1. Пайплайн текстур карт ([UI-3D.md](../../docs/UI-3D.md) § «Карта»)

В игре 544 карты и 25 героев. Загрузка всех текстур сразу привела бы к исчерпанию оперативной памяти и падению мобильного браузера.

* **Асинхронная загрузка по требованию:** Скан карты (WebP из `content/cards/images`) загружается только тогда, когда карта появляется на столе или в руке.
* **Глобальный кэш текстур (`TextureCache`):**
  - Ключ кэша — `cardId`.
  - Если на столе лежат 3 одинаковых «Кукурузных рыцаря», они используют **один и тот же экземпляр `THREE.Texture`**, а не три отдельных объекта в VRAM.
  - Подсчёт ссылок (ref-counting): при удалении всех экземпляров карты со стола текстура может быть безопасно выгружена из VRAM через `texture.dispose()`.

---

## 2. Процедурная Canvas-заглушка (Fallback Texture)

До завершения асинхронной загрузки WebP-файла карта не должна быть пустой или невидимой:
- Генерируется легковесная `THREE.CanvasTexture` в памяти (на базе скрытого HTML Canvas):
  - Фон цвета соответствующей земли (`corn`, `ice`, `blue`, `sand`, `good`, `swamp`, `rainbow`).
  - Текстовое название карты и базовые статы (атака/защита).
- После того как реальный WebP загружен, текстура материала карты плавно заменяется на полноразмерный скан.

```tsx
import * as THREE from 'three';

export function createCardFallbackTexture(card: { name: string; type: string }): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 360; // Пропорции 63:89
  const ctx = canvas.getContext('2d')!;

  // Фоновая заливка по типу земли
  ctx.fillStyle = getLandColor(card.type);
  ctx.fillRect(0, 0, 256, 360);

  // Рамка и название
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, 240, 344);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(card.name, 128, 60);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
```

---

## 3. Цветовое пространство и фильтрация

* **`colorSpace = THREE.SRGBColorSpace`:** Все сканы карт, тайлов земель и портретов героев являются цветными изображениями (диффузные текстуры) и обязаны иметь `colorSpace = THREE.SRGBColorSpace`. В Three.js r152+ устаревшее свойство `encoding = sRGBEncoding` заменено на `colorSpace`.
* **Анизотропная фильтрация:** Карты лежат на столе под углом к камере. Чтобы текст и детали на дальнем краю стола не мылились, включается анизотропия:
```tsx
texture.anisotropy = Math.min(gl.capabilities.getMaxAnisotropy(), 4);
```
* **Mipmaps:** Для текстур карт включать `generateMipmaps = true` и `minFilter = THREE.LinearMipmapLinearFilter`.

---

## 4. Очистка видеопамяти (VRAM Disposal)

- Текстуры — самый тяжелый ресурс WebGL.
- При выходе из матча или смене экрана вызывается очистка неиспользуемых текстур:
```tsx
useEffect(() => {
  return () => {
    fallbackTexture.dispose();
  };
}, [fallbackTexture]);
```
