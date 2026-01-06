# 11 — 下一步你可以怎麼練習（循序漸進）

下面是一些「很適合新手」的小改動，讓你可以跟著做，慢慢熟悉 Three.js 與這個 repo。

## Level 1：只改 UI
1. 在 `index.html` 加一個「Auto-rotate」checkbox
2. 在 `src/ui/controls.ts` 讀這個 checkbox
3. 先用 console.log 確認事件有觸發

## Level 2：改 Editor（但不碰 Loader/Animator）
1. 讓 Tools 設定存到 localStorage（snap/steps/space/gizmo size）
2. App 啟動時讀回並套用（避免每次重開都要重設）
3. 注意：資料要做版本/預設值處理（避免改欄位後讀到舊資料壞掉）

## Level 3：改 Helpers
1. 新增一個「Grid size」slider
2. 研究 `THREE.GridHelper(size, divisions)`
3. 嘗試在切換 slider 時重建 grid（注意 dispose 舊的 grid geometry/material）

## Level 4：改 Animator
1. 新增「Scrub time」slider（0 ~ clip duration）
2. 研究 `AnimationAction.time` / `mixer.setTime(...)`
3. 做一個可以拖動時間的簡單 scrubber

## 維護習慣（你未來會感謝自己）
每次你做一個新功能：
- 程式碼：維持 core / ui 分離
- 文件：在 `docs/implementation/` 補一篇「你這次加了什麼、概念是什麼」

如果你願意，我也可以在你下一個功能需求時，繼續用「Phase → 自檢 → docs」的方式陪你往下做。
