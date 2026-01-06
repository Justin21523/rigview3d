# 17 — Keyboard Shortcuts：為什麼要「避開輸入框」？

快捷鍵的 UX 重點不是「加很多鍵」，而是：

1. 行為一致（像 Unity 一樣）
2. 不要妨礙使用者打字（例如在 name/number input 裡按 Ctrl+Z 不應該去 undo 模型）

在本 repo 對應：

- `src/ui/shortcuts.ts`

## 1) 我們支援哪些快捷鍵？

（你可以直接看右側 Shortcuts 面板的列表）

- Q：Select
- W：Move
- E：Rotate
- R：Scale
- G：Toggle snap（切換 snapping）
- X：Toggle local/world（切換 gizmo space）
- F：Frame selection（沒有選取時就 frame 整個模型）
- Esc：Clear selection
- Del / Backspace：Delete selection（可 undo）
- Ctrl/Cmd + D：Duplicate selection（可 undo，注意瀏覽器預設是書籤，我們會攔截）
- Ctrl/Cmd + Z：Undo（Shift+Z 也當作 redo）
- Ctrl/Cmd + Y：Redo
- Arrow keys：Nudge（依 Tools 面板的 nudge step，移動是 world X/Z）
- [ / ]：Rotate（依 Tools 面板的 rotate step）
- - / =：Scale（依 Tools 面板的 scale step）

## 2) 為什麼要忽略「正在輸入」的事件？

如果你正在編輯 `Name` 欄位：

- 你按 Ctrl+Z 的直覺是「回到上一個字」
- 不是「把模型的 transform 撤銷」

所以 `src/ui/shortcuts.ts` 會先判斷：

- event target 是不是 `input / textarea / select`
- 或者是 `contentEditable`

如果是，就直接 return，不做任何 editor shortcut。

## 3) Arrow keys 的 Nudge 怎麼定義？

因為沒有 Unity 那麼完整的操作系統，我們先做一個好理解的版本：

- Left/Right：world X 軸 ± step
- Up/Down：world Z 軸 ± step（Three.js 常用 -Z 當作 forward）
- Shift：把 step * 10（加速）

這個 step 來源是：

- Tools 面板的 `Nudge step`（`#tool-nudge`）

對應：

- `src/ui/tools.ts`：把 input value 存到 `editor.setNudgeStep()`
- `src/ui/shortcuts.ts`：讀 `editor.getNudgeStep()`

## 4) 為什麼鍵盤移動/旋轉/縮放也要進 Undo？

如果鍵盤操作不能 undo，你會很難放心調整（尤其是 step 很小時按了很多次）。

所以 `src/ui/shortcuts.ts` 做法是：

1. keydown 時先拍 transform before snapshot
2. 套用變更（nudge / rotate / scale）
3. 再拍 after snapshot
4. 如果真的有變 → `editor.pushCommand(...)`

這樣你按箭頭或 `[` `]` `-` `=` 都可以 Ctrl+Z 回去。
