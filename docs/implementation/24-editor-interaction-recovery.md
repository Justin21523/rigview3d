# 24 — 互動穩定性：避免 gizmo 拖曳後相機「卡死」

你回報的現象是：
- 相機突然不能 orbit/pan/dolly（像壞掉）
- 物件也很難再操作，快捷鍵看起來也失效

這通常不是 Three.js 渲染壞掉，而是「控制權」被卡在某個互動狀態。

對應程式碼：
- `src/core/editor/editor.ts`
- `src/core/viewer.ts`

---

## 1) 根因：TransformControls 會暫時關掉 OrbitControls

RigView3D 同時有兩套互動：
- `OrbitControls`：負責相機 orbit/pan/dolly
- `TransformControls`：負責物件 move/rotate/scale gizmo

當你拖曳 gizmo 時，如果相機也同時在旋轉，手感會非常糟（兩者搶同一個滑鼠拖曳）。

所以我們在 `Editor` 內監聽 TransformControls 的 `dragging-changed` 事件：
- `dragging = true` 時：`viewer.setOrbitEnabled(false)`（暫停相機）
- `dragging = false` 時：`viewer.setOrbitEnabled(true)`（恢復相機）

這是「正確」且常見的做法。

---

## 2) 為什麼會卡死？（Web 的 pointer 事件不是 100% 保證完整）

在瀏覽器裡，以下情況可能讓 TransformControls **收不到** 正常的結束事件：
- 拖曳到 canvas 外面才放開
- OS/瀏覽器把 pointer cancel 掉（例如某些手勢、彈出系統 UI）
- 拖曳中途切換分頁 / 視窗失焦（blur）

如果 `dragging-changed(false)` 沒有被觸發：
- `Editor` 會以為還在拖曳
- `OrbitControls` 就一直保持 disabled → 你會覺得相機「死掉」

---

## 3) 修法：全域 pointerup/pointercancel/blur 的「保險恢復」

我們加了一個保險機制：
- 監聽 `window` 的 `pointerup` / `pointercancel` / `blur`
- 如果發現 `Editor` 還處於 `isDraggingTransform === true`，就：
  - 強制 `viewer.setOrbitEnabled(true)`
  - 清掉尚未完成的 gizmo history snapshot（避免下一次拖曳用到舊狀態）
  - 重新 attach gizmo（重置 TransformControls 的 axis/highlight 狀態）

為了避免干擾 TransformControls 正常的 `mouseUp` 流程，我們用 `queueMicrotask` 延後到同一輪事件處理完後再做恢復：
- 如果 TransformControls 正常結束拖曳，它會先把狀態清掉 → 我們的恢復就不會動作
- 如果真的漏掉結束事件，我們才會補救

