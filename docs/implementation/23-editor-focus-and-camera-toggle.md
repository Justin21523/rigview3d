# 23 — 互動失效問題：Viewport Focus + Camera Mapping + 點選保護

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

## 3) 相機也「像壞掉」的原因：你可能只是用到不同的滑鼠按鍵 mapping

OrbitControls 有多種常見的「滑鼠操作習慣」：
- 有些工具用 RMB pan
- 有些工具用 MMB pan
- 有些工具用 RMB dolly（或用 wheel dolly）

為了讓操作更符合 3D 編輯器習慣，我們在 Tools → Camera 做了一個 mapping 開關：
- `Editor mouse mapping (MMB pan / RMB dolly)`

你可以把它想成：
- **開啟**：LMB orbit / MMB pan / RMB dolly（比較像常見 DCC/編輯器）
- **關閉**：回到 OrbitControls 預設（LMB orbit / MMB dolly / RMB pan）

這個設定會被存進 localStorage（`src/core/settings.ts`），重開不會跑掉。

---

## 4) 為什麼「點選選取」會看起來怪？（以及我們怎麼避免）

當你用滑鼠左鍵拖曳相機 orbit 時，瀏覽器有時仍會觸發 click，導致：
- 你只是想轉相機
- 但放開滑鼠時卻「順便選到物件」或「清掉選取」

所以我們改成更像編輯器的做法：
- 用 `pointerdown` 記住起點
- 用 `pointermove` 量測移動距離
- 超過一個容忍值（例如 6px）就當作「拖曳」→ 不做選取

此外，為了讓新手更容易「整隻角色一起移動」：
- Viewport 預設點到模型會選 **model root**
- 你要選單一 mesh/子物件時，按住 `Shift` 或 `Ctrl/Cmd` 再點（exact selection）
