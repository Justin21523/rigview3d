# 14 — TransformControls：Unity 的 Move/Rotate/Scale gizmo 怎麼做？

Unity 的核心操作體驗之一就是「拖曳 gizmo 來移動/旋轉/縮放」。Three.js 也有類似工具：`TransformControls`（位於 examples）。

## 1) TransformControls 是什麼？

你可以把 `TransformControls` 想成一個特殊的 `Object3D`：

- 它會畫出三軸箭頭/圓環/方塊（gizmo）
- 它會在 canvas 上監聽 pointer 事件（mouse/touch）
- 它用 raycast 判斷你抓到哪個軸
- 拖曳時把變化量轉成 position/quaternion/scale 的修改

在本 repo 對應：

- `src/core/editor/editor.ts`
  - `new TransformControls(viewer.getCamera(), viewer.getDomElement())`
  - `scene.add(transformControls)`
  - `setToolMode()`：切 translate/rotate/scale

## 2) 為什麼拖 gizmo 的時候要關 OrbitControls？

如果 OrbitControls 還在工作，你拖 gizmo 的同時，camera 也會跟著旋轉/平移 → 變成「兩套控制器搶同一個滑鼠事件」。

所以做法是：

- TransformControls 觸發 `dragging-changed`：
  - `value === true` → `viewer.setOrbitEnabled(false)`
  - `value === false` → `viewer.setOrbitEnabled(true)`

對應：

- `src/core/editor/editor.ts`：`dragging-changed` 事件監聽

## 3) Tool modes：Select / Move / Rotate / Scale

UI 是 Unity 習慣的四個模式：

- Select（不顯示 gizmo）
- Move（translate）
- Rotate（rotate）
- Scale（scale）

對應：

- `src/ui/tools.ts`：按鈕點擊 → `editor.setToolMode(...)`
- `src/core/editor/editor.ts`：把 "move" 映射成 `TransformControls.setMode("translate")`

## 4) Local / World space 是什麼？

想像一個角色的手臂骨骼：

- **Local**：gizmo 軸會跟著手臂自己的旋轉方向
- **World**：gizmo 軸固定是世界座標 X/Y/Z

在 TransformControls 裡就是：

- `transformControls.setSpace("local")` 或 `setSpace("world")`

對應：

- `src/ui/tools.ts`：`#tool-space-local` checkbox
- `src/core/editor/editor.ts`：`setSpace()` + `applyTransformSettings()`

## 5) Snapping（步進對齊）

Snap 的概念是：把連續的拖曳結果「吸附」到固定步距。

這裡做了三種 snap：

- translation snap：每次移動固定 0.1 unit（可調）
- rotation snap：每次旋轉固定 15°（可調，內部會轉 radians）
- scale snap：每次縮放固定 0.1（可調）

對應：

- `src/ui/tools.ts`：各種 step input + `Snap` checkbox
- `src/core/editor/editor.ts`：`setTranslationSnap` / `setRotationSnapDegrees` / `setScaleSnap`

## 6) 為什麼還要做「Inspector」？

gizmo 很直覺，但精準數值很難拉到「剛好 1.0」。Inspector 的數字欄位可以：

- 精準輸入 position/rotation/scale
- 做微調（配合 nudge step 和快捷鍵）

下一章會把 Inspector 的資料流拆解給你看。

## 7) Gizmo size：為什麼需要調整？

有些模型非常大/非常小，gizmo 在畫面上可能：

- 太小不好抓
- 太大遮住模型

所以 Tools 面板提供 `Gizmo size` slider，它只影響「gizmo 顯示大小」，不會改變實際的 transform 數值。

對應：

- `src/ui/tools.ts`：`#tool-gizmo-size` → `editor.setGizmoSize(value)`
- `src/core/editor/editor.ts`：`TransformControls.setSize(size)`
