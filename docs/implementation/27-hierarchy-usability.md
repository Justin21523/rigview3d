# 27 — Hierarchy 可用性深化（Filter / Expand Persistence / Perf）

這個階段的目標是讓 Hierarchy 在「大型角色 Rig」也能順手使用：

- **Filter**：一鍵隱藏 Bone 與 helper-like 空物件（避免上千行）
- **Expand state persistence**：展開/收合狀態會記住（同一個模型下次載入不用重點）
- **Performance**：選取變更不再整棵樹重畫（大型階層差很多）

對應的檔案：
- `index.html`：Hierarchy panel 新增 Bones/Helpers filter chips
- `src/ui/editor.ts`：Hierarchy 的 render/expand/filter/selection sync
- `src/core/settings.ts`：新增 `hierarchy` settings（localStorage persistence）
- `src/main.ts`：把 settings 套到 DOM（讓 UI init 時就讀到正確狀態）
- `src/ui/controls.ts`：調整 `setSourceFileName` 與 `setModelRoot` 順序（確保以檔名做 key 的狀態能正確載入）

---

## 1) 為什麼 Hierarchy 會「爆炸」？

帶骨架動畫的角色通常有：

- **Mesh**：你看到的表面（SkinnedMesh / Mesh）
- **Bones**：骨架節點（數量可能 50~500+，甚至更多）
- **Empty / Marker / Helper-like nodes**：一些控制點、定位點、攝影機/燈光等非渲染物件（有些 FBX 特別多）

如果把全部都列出來，Hierachy 很快會變成「一堆你用不到的節點」，導致你找不到真正想選的物件。

所以這階段加了兩個 filter：

- **Bones**：關掉時「不顯示 Bone rows」
- **Helpers**：關掉時「不顯示 leaf 的非 Mesh/非 Bone 節點」（常見的空物件/marker）

你仍然可以打開 toggle 看到完整結構（當你真的需要調骨架時）。

---

## 2) 展開/收合狀態如何跨 reload 保存？

Three.js 的 `Object3D.uuid` 每次載入都會重新產生，所以不能用 uuid 來記住 expand state。

這裡採用的做法是「**stable path key**」：

- Root key 固定是 `"0"`
- 走到第 N 個 child 就加上 `"/N"`，例如：
  - `"0/2"`：root 的第 3 個 child
  - `"0/2/1"`：root 第 3 個 child 的第 2 個 child

這種 key 的好處是：
- 同一個模型每次載入 children 順序通常穩定 → key 也穩定
- 不依賴 uuid

expand state 存在 `localStorage` 的 `rigview3d.settings` 內：
- `settings.hierarchy.expandedByAsset[fileName] = ["0/2", "0/2/1", ...]`
- 以 **來源檔名** 做 key（例如 `character.glb`）

另外有做保護：
- 只保留最近少量資產 key（避免 localStorage 變太大）
- 每個資產只保留有限數量的 expanded keys

---

## 3) 為什麼「選取變更」不應該整棵樹重畫？

以前的做法是：選到任何物件 → `render()` 重建整個 DOM tree。

對小模型沒差，但對大 rig（上千節點）會：
- UI 變得卡
- 甚至造成滑鼠/鍵盤互動延遲

這階段把邏輯拆成兩種更新：

1) **結構變更**（root/filter/expand/collapse）才重建 tree  
2) **選取變更**只更新對應 row 的 CSS class（`is-selected` / `is-primary`）

額外 UX：
- 選取物件時會 **自動展開 ancestors**，讓你在 Hierarchy 內能看見目前選到的節點
- 並 `scrollIntoView({ block: "nearest" })`，讓選取不會跑到看不到的地方

---

## 4) 建議你怎麼練習驗證

1. 載入一個骨架很大的角色
2. 先把 Bones/Helpers 關掉，再打開：感受 Hierarchy 的差異
3. 展開幾個你常用的節點 → Reload 網頁 → 再載入同一個檔案：確認展開狀態有記住
4. 在 viewport 點選物件：確認 Hierarchy 會自動展開並把選取 row 滾到視窗內

