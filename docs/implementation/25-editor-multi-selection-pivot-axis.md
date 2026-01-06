# 25 — Phase 10：Multi-selection + Group Gizmo + Pivot/Center + Axis Locks

這一階段的目標是讓「移動/旋轉/縮放」的工作流更像常見 3D 編輯器：

- Shift 點選可多選（Viewport + Hierarchy）
- 多選時 gizmo 以 selection center 做群組操作
- 可切換 Pivot/Center（類似 Unity 的 Pivot/Center）
- 可鎖定 X/Y/Z 軸（只允許某些軸可操作）
- Inspector 會顯示多選狀態，並提供一鍵 Select Root

對應程式碼：
- `src/core/editor/editor.ts`
- `src/ui/editor.ts`
- `src/ui/tools.ts`
- `src/ui/inspector.ts`
- `src/core/settings.ts`
- `index.html`

---

## 1) Multi-selection：Shift 不是「替代」單選，而是「toggle」集合

我們把 selection 的資料結構從「單一物件」升級成：
- `selectionList`：有順序的陣列（最後一個是 primary selection）
- `selectionSet`：Set（用來快速判斷某物件是否被選到）

UI 互動規則（偏好新手方便）：
- **單擊**：選 model root（整隻角色方便移動）
- **Ctrl/Cmd + 單擊**：選到滑鼠下的「真正物件」（exact）
- **Shift + 單擊**：toggle 多選（會自動用 exact，避免一直選到 root）

實作點：
- Viewport：`src/ui/editor.ts` 在 `pointerup` 呼叫 `editor.pick(..., { exact, toggle })`
- Hierarchy：`src/ui/editor.ts` 點 row 時 `editor.select(object, { toggle: shiftKey })`

---

## 2) Group gizmo：為什麼要 selection proxy？

Three.js 的 `TransformControls` 一次只能 attach 到 **一個** `Object3D`。

但多選時我們要做到：
- 你拖動 gizmo → 所有選到的物件一起動

所以我們新增一個「看不見的」代理物件：
- `selectionProxy: Object3D`

做法：
1. 多選（或 Center 模式）時，TransformControls attach 到 `selectionProxy`
2. 拖曳開始（mouseDown）記錄：
   - proxy 的起始 world matrix
   - 每個物件的起始 world matrix
3. 拖曳中（objectChange）計算：
   - `delta = proxyNowWorld * inverse(proxyStartWorld)`
   - `newWorld = delta * objectStartWorld`
   - 再把 `newWorld` 轉回 parent-local（`parentWorldInverse * newWorld`）並 decompose 回 position/quaternion/scale

這樣你不需要自己分別計算 translate/rotate/scale 的公式，用矩陣一次搞定。

---

## 3) Pivot/Center：gizmo 放哪裡？

Tools 裡新增 Pivot 下拉：
- Pivot：以 primary selection 的 pivot（world position）當 gizmo 位置
- Center：以 selection bounds 的中心點當 gizmo 位置（用 `Box3` union 後取 center）

核心是在 `Editor.updateSelectionProxyFromSelection()`：
- Pivot 模式：`primary.getWorldPosition(...)`
- Center 模式：對 `selectionList` 做 bounds union，取 `box.getCenter(...)`

---

## 4) Axis Locks：鎖 X/Y/Z 軸的原理

`TransformControls` 有三個布林：
- `showX`, `showY`, `showZ`

把它們關掉，對應軸就不會出現，也不能被拖曳。
Tools 面板的 X/Y/Z checkbox 就是直接控制這三個值。

---

## 5) Inspector：多選狀態 + Select Root

多選時 Inspector 會：
- 顯示 `N objects selected`
- Name 變成 `—` 並 disable
- Transform inputs disable（提示改用 gizmo 做群組變形）
- Visible 會用 `indeterminate` 顯示混合狀態，切換時會套用到所有選取物件

同時提供 `Select Root`：
你隨時可以一鍵回到整隻角色的選取，避免在骨架樹裡迷路。

