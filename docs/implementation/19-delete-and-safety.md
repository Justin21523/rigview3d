# 19 — Delete：刪除節點與資源釋放要注意什麼？

在 3D 編輯器裡，「刪除」看起來很簡單，但真正的麻煩通常在：

- **共享資源**（shared geometry/material/texture）
- **undo/redo**（刪掉了要能復原）
- **動畫骨架**（刪骨頭會讓 skinning 失效）

這一章先把目前版本的策略講清楚，讓你知道「為什麼這樣做」以及「下一步怎麼改更完整」。

## 1) 我們刪的是什麼？

這裡的 Delete 是針對「目前 selection 的那個 Object3D 節點」：

- 從 parent 的 children 裡移除（`parent.remove(selection)`）
- 讓它不再 render、不再參與更新

對應：

- `src/core/editor/editor.ts`：`Editor.deleteSelection()`

## 2) 為什麼 delete 要做成 undoable command？

Unity 的 Delete 通常可以 Ctrl+Z 復原，所以我們也做成 command：

- redo：再刪一次
- undo：加回去（並盡量放回原本的 sibling index）

對應：

- `src/core/editor/editor.ts`：`HistoryStack.push({ undo, redo })`

## 3) 為什麼「刪除」現在沒有立刻 dispose？

重點原因是：**要能 undo**。

如果你刪掉 mesh 然後立刻 `geometry.dispose()` / `material.dispose()`：

- 你下一秒 undo 把節點加回來
- 但它的 GPU 資源已經被釋放 → 可能會變黑、報錯、或完全不 render

所以目前策略是：

- 刪除節點本身（從場景樹移除）
- 不立刻 dispose（因為還可能 undo）

這表示：

- 「刪掉很多東西但不關閉頁面」會讓記憶體佔用增加（因為 history 保留引用）

這在 MVP 教學專案是可接受的取捨，但你之後可以改得更完整。

## 4) 如果你想做「真正安全的 delete + dispose」

比較完整的做法通常會是：

1. 做一個 resource tracker（reference counting）
2. 只有當某個 geometry/material/texture 沒有任何 mesh 在用時才 dispose
3. 並且對 history 做最大長度限制，丟掉最舊的 delete command 時再真正釋放資源

這一塊可以當成你進階練習題：會學到很多實務的 three.js 資源管理細節。

