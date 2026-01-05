# 09 — 重複載入不爆：dispose 的必要性（非常重要）

對照檔案：
- `src/core/dispose.ts`
- `src/ui/controls.ts`（load 成功後處理 previousRoot）
- `src/core/viewer.ts`（`disposeRenderLists()`）

## 先講結論（很多人踩雷）

在 Three.js：
**把 mesh 從 scene remove 掉，不代表 GPU 記憶體就釋放了。**

你如果一直載入模型：
- JS 物件可能被 GC 回收
- 但 GPU buffer / texture 可能還留著

久了就會：
- 越來越慢
- 瀏覽器 tab 吃爆記憶體
- 甚至 WebGL context lost

## 你需要 dispose 哪些東西？

1. Geometry：`geometry.dispose()`
2. Material：`material.dispose()`
3. Texture：`texture.dispose()`

而且要注意：
- 多個 mesh 可能共用同一個 material/texture
- 所以不能暴力 traverse 就 dispose（可能 double-dispose）

本專案使用 `Set` 收集 unique 資源，最後再統一 dispose。

## renderer.disposeRenderLists() 是什麼？

Three.js renderer 內部會 cache 一些「渲染列表」。
在某些情況下，就算你 dispose 了 geometry/material，cache 仍可能持有引用。

所以在換模型後呼叫一次 `disposeRenderLists()` 可以更保險地清掉引用。

## 建議你怎麼驗證？

手動測：
1. 開啟 dev server
2. 連續載入 10 次不同模型
3. 觀察是否逐漸變慢
4. 開 Chrome devtools → Performance/Memory（進階）

MVP 的目標是：載 10 次也不會明顯越來越慢。

