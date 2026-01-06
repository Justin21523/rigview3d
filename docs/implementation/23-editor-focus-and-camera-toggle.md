# 23 — 互動失效問題：Viewport Focus + Alt Orbit 開關

這一章解釋你遇到的「按鍵都失效 / 物件無法用快捷鍵切 Move/Rotate/Scale」這種常見 Web 編輯器問題，並說明我們怎麼修。

對應程式碼：
- `index.html`
- `src/ui/editor.ts`
- `src/core/settings.ts`
- `src/ui/tools.ts`
- `src/main.ts`

---

## 1) 為什麼你會覺得「所有快捷鍵都壞了」？

我們的快捷鍵模組（`src/ui/shortcuts.ts`）有一個保護機制：

- 當你正在輸入文字（例如 Inspector 的 Name、Hierarchy 的 Search、數字輸入框）時
- **快捷鍵不應該觸發**，不然你打字會一直切工具/刪物件

所以它會檢查 `keydown` 的 target 是否是 input/textarea/select：
> 如果是，就直接忽略這次按鍵。

問題在於：瀏覽器裡 **canvas 不是可 focus 的元素**。  
你點 3D 視窗並不一定會讓輸入框失焦，所以 `keydown` 的 target 仍然是輸入框 → 快捷鍵就一直被忽略。

在 Unity 裡你點 Scene View 會「拿到焦點」，Web 版要自己補。

---

## 2) 修法：讓 Canvas 可 Focus，並在點 Viewport 時 Focus 它

我們做了兩件事：

1. 在 `index.html` 給 `<canvas>` 加上 `tabindex="0"`，讓它可以被 focus：
   - `tabindex="0"` 代表它可以被 Tab 選到，也能被程式 `focus()`
2. 在 `src/ui/editor.ts` 監聽 `pointerdown`，使用者點 viewport 就 `canvas.focus()`：
   - 這會讓原本的輸入框失焦
   - 下一次 `keydown` 的 target 就不再是 input → 快捷鍵恢復正常

---

## 3) 相機也「像壞掉」的原因：Alt Orbit 被啟用但你不一定有按 Alt

在 `editor-phase-6` 我們做了 Unity-like camera 操作：
- Alt+LMB orbit / Alt+MMB pan / Alt+RMB dolly

如果你沒有按 Alt，OrbitControls 的滑鼠拖曳會被關掉，所以你會覺得「相機不能動」。

為了讓行為更明確，我們新增一個 Tools → Camera 的 checkbox：
- `Alt + mouse to orbit/pan/dolly (Unity)`

你可以關掉它，恢復「不用按 Alt 也能拖曳 orbit」的傳統 OrbitControls 行為。

而且這個設定會被存進 localStorage（`src/core/settings.ts`），重開不會跑掉。

