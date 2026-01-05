# 16 — Undo/Redo：最小可用的 history（command pattern）

很多人剛開始做編輯器會卡在「Undo/Redo 怎麼設計？」。這一章用最小可用的方式，把整件事拆成你能理解的形狀。

## 1) 核心概念：Command Pattern

我們把「一個可復原的操作」抽象成一個 command：

- `redo()`：把操作做一次（通常你 push 時已經做完，所以 redo 用在重做）
- `undo()`：把操作反過來做一次

在本 repo：

- `src/core/editor/history.ts`
  - `EditorCommand`：`{ label, undo, redo }`
  - `HistoryStack`：兩個 stack（undoStack / redoStack）

### HistoryStack 怎麼運作？

1. 你 push 新 command：
   - 放進 undoStack
   - 清空 redoStack（因為「做了新事」後，舊 redo 不再合理）
2. undo：
   - 從 undoStack pop 一個 command
   - 呼叫 `command.undo()`
   - 把它 push 到 redoStack
3. redo：
   - 從 redoStack pop
   - 呼叫 `command.redo()`
   - push 回 undoStack

這就是你在很多軟體（Photoshop/Unity/Blender）體驗到的 undo/redo 行為。

## 2) Transform undo：為什麼要 snapshot？

Transform 是連續變化的：

- 你拖 gizmo 時會一直改 position/quaternion/scale
- 你在 Inspector 也會一直改數值

要能 undo，你必須記住「改之前」與「改之後」的狀態。

所以我們做一個最直接的快照：

- position（Vector3）
- quaternion（Quaternion）
- scale（Vector3）

在本 repo：

- `src/core/editor/transformSnapshot.ts`
  - `captureTransform(object)`
  - `applyTransform(object, snapshot)`
  - `isTransformDifferent(a, b)`：避免 push 沒有變化的 no-op command

## 3) Gizmo 變更怎麼變成 command？

Three.js 的 `TransformControls` 會發事件：

- `mouseDown`：開始拖曳
- `mouseUp`：結束拖曳
- `objectChange`：拖曳過程中物件有變動

我們的策略是：

1. mouseDown：拍一張 before snapshot
2. mouseUp：拍一張 after snapshot
3. 如果不同 → push command（undo=還原 before、redo=還原 after）

對應：

- `src/core/editor/editor.ts`：TransformControls 的事件監聽

## 4) Inspector 變更怎麼變成 command？

Inspector 的變更不是由 TransformControls 產生，所以我們在 UI 層做：

- focus：拍 before
- change：拍 after → push command

對應：

- `src/ui/inspector.ts`
  - name：`Rename`
  - transform：`Transform (Inspector)`
  - material：`Material`

## 5) 為什麼 model reload 要 clear history？

history 裡的 command 會閉包引用 `Object3D` / `Material`。  
如果你載入新模型，舊 command 指向的物件就不再有效，甚至會造成記憶體留著。

所以在：

- `src/core/editor/editor.ts` 的 `setModelRoot()`

會做：

- `history.clear()`

這樣你連續載入模型也不會越來越慢（至少在 undo 系統這塊不會）。

