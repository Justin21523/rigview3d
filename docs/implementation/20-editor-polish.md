# 20 — Editor Phase 5：Polish（Duplicate / Gizmo size / Keyboard transforms）

這一章整理 `editor-phase-5` 這一波的「更像 Unity/編輯器」的小功能：它們單獨看都不大，但合在一起會讓操作順很多。

## 1) Gizmo size（讓 TransformControls 好抓）

問題：不同模型尺度差很多，gizmo 可能太小或太大。  
解法：提供一個 slider 直接呼叫 `TransformControls.setSize(size)`。

對應：

- UI：`index.html` 的 `#tool-gizmo-size`
- UI wiring：`src/ui/tools.ts`
- Core：`src/core/editor/editor.ts` 的 `setGizmoSize()`（真正呼叫 setSize）

## 2) Duplicate selection（Ctrl/Cmd + D）

Unity 裡 Duplicate 是非常常用的操作，所以我們做：

- `Ctrl/Cmd + D`：duplicate selection
- 行為：duplicate 後會自動選取新物件（比較符合直覺）
- 支援 undo/redo：Ctrl+Z / Ctrl+Y

對應：

- Shortcut：`src/ui/shortcuts.ts`
- Core：`src/core/editor/editor.ts` 的 `duplicateSelection()`

### 為什麼用 SkeletonUtils.clone？

glTF 角色常常包含 `SkinnedMesh`。一般的 `Object3D.clone(true)` 在骨架綁定上可能會出問題，所以我們用：

- `three/examples/jsm/utils/SkeletonUtils.js` 的 `clone()`

它會做 skinned mesh 的特殊處理，duplicate 時比較安全。

## 3) Keyboard transforms（Nudge / Rotate / Scale）

除了 gizmo 拖曳，鍵盤微調也很重要，這裡做了：

- `Arrows`：Nudge（依 `Nudge step`）
- `[` / `]`：Rotate（依 `Rotate step`，Shift*10）
- `-` / `=`：Scale（依 `Scale step`，Shift*10）

而且它們都會進 undo/redo（不然按太多次很痛苦）。

對應：

- `src/ui/shortcuts.ts`
  - before/after snapshot
  - `editor.pushCommand(...)`

## 4) Toggle settings shortcuts（G / X）

為了更快切換狀態：

- `G`：toggle snapping
- `X`：toggle local/world

這兩個快捷鍵的技巧是：**不要只改 Editor state**，也要讓 UI checkbox 跟著改。  
所以我們直接 toggle checkbox 並 dispatch `change` 事件，讓既有的 UI wiring 流程照常跑。

