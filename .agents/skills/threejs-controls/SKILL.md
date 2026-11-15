---
name: threejs-controls
description: Camera controls and table interaction for Card Wars v3 3D scene using React Three Fiber (@react-three/drei OrbitControls). Enforces right-click rotation, wheel zoom, table center anchoring, frameloop="demand" invalidation, and non-interference with card drag-and-drop.
---

# Three.js Controls — Card Wars v3

Руководство по управлению камерой и манипуляциям в 3D-сцене карточного стола на **React Three Fiber** и **@react-three/drei** в соответствии со спецификацией [docs/UI-3D.md](../../docs/UI-3D.md) и скиллом [r3f-best-practices](../r3f-best-practices/SKILL.md).

---

## 1. Разделение управления: Мышь vs Карты (Критично)

В Card Wars интерактивность на столе строго разделена между игровыми действиями и камерой:

* **Левая кнопка мыши (ЛКМ):** зарезервирована **исключительно** под игровые действия:
  - Drag-and-drop карты из руки в зону стола.
  - Клик по карте для флюпа.
  - Выбор целей для заклинаний и способностей.
* **Правая кнопка мыши (ПКМ):** свободное вращение камеры вокруг центрального якоря стола.
* **Колёсико мыши:** плавное приближение и отдаление камеры (зум).
* **Панорамирование (Pan):** **ОТКЛЮЧЕНО** (`enablePan={false}`), так как центр стола всегда зафиксирован в начале координат `(0, 0, 0)`.

```tsx
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

export function TableCameraControls() {
  return (
    <OrbitControls
      makeDefault
      enablePan={false}
      enableZoom={true}
      enableRotate={true}
      mouseButtons={{
        LEFT: null, // ЛКМ не крутит камеру!
        MIDDLE: null,
        RIGHT: THREE.MOUSE.ROTATE, // Вращение только по ПКМ
      }}
      // Ограничения углов, чтобы камера не уходила под стол:
      minPolarAngle={Math.PI / 8}       // Вид сверху (~22.5°)
      maxPolarAngle={Math.PI / 2.15}    // Чуть выше плоскости стола (~83°)
      minDistance={150}                  // Максимальный зум
      maxDistance={600}                  // Отдаление для обзора всего стола
      dampingFactor={0.05}
      enableDamping={true}
    />
  );
}
```

---

## 2. Согласование с `frameloop="demand"`

В проекте используется режим энергосбережения `frameloop="demand"`:
- Компонент `<OrbitControls>` из `@react-three/drei` автоматически слушает события `change` контроллера и запрашивает перерисовку через `invalidate()`, пока работает демпфирование (`enableDamping`).
- **Запрещено** создавать ручной непрерывный `requestAnimationFrame`-цикл в обход R3F.
- При программной анимации камеры (например, поворот к активному игроку) обязательно вызывать `invalidate()` в `useFrame`:

```tsx
import { useThree, useFrame } from '@react-three/fiber';

export function CameraRig() {
  const invalidate = useThree((state) => state.invalidate);
  
  useFrame((_, delta) => {
    if (isTransitioning) {
      // Плавная интерполяция позиции/вращения
      invalidate(); // Запрос следующего кадра при demand-рендере
    }
  });
  
  return null;
}
```

---

## 3. Предотвращение конфликтов (Raycasting & Event Propagation)

- При клике и перетаскивании карт обязательно вызывать `e.stopPropagation()`, чтобы событие указателя не триггерило посторонние объекты стола.
- На плоскости стола и декоративном окружении отключать перехват луча: `raycast={null}`.
