# 11 — 下一步你可以怎麼練習（循序漸進）

下面是一些「很適合新手」的小改動，讓你可以跟著做，慢慢熟悉 Three.js 與這個 repo。

## Level 1：只改 UI
1. 在 `index.html` 加一個「Auto-rotate」checkbox
2. 在 `src/ui/controls.ts` 讀這個 checkbox
3. 先用 console.log 確認事件有觸發

## Level 2：改 Editor（但不碰 Loader/Animator）
1. 在 Tools 面板加一個「Gizmo size」slider
2. 在 `src/core/editor/editor.ts` 增加 `setGizmoSize(size)` 方法
3. 呼叫 `TransformControls.setSize(size)`，讓 gizmo 變大/變小（很像 Unity）

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
