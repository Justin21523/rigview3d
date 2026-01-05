# 08 — Debug helpers：為什麼要 grid/axes/skeleton/wireframe？

對照檔案：`src/core/helpers.ts`

這些功能是給「檢查模型」用的，不是給玩家玩的 UI。

## Grid（地板格線）
用途：
- 看比例（模型是不是太大/太小）
- 看有沒有踩在地上（y=0）

## Axes（座標軸）
用途：
- 你永遠不會搞不清楚哪邊是 X/Y/Z

## Skeleton（骨架線）
用途：
- 看骨頭階層是否正確
- 看骨頭在動的時候是否合理（例如膝蓋彎的方向）

注意：
- SkeletonHelper 需要 SkinnedMesh
- 有些模型只有骨頭但沒有 skin（或沒有 SkinnedMesh），那就不能顯示

## Wireframe（線框）
用途：
- 檢查 topology（面數、破面）
- 檢查權重問題時，線框能更清楚看到變形

本專案做法是直接切 `material.wireframe`：
- 優點：簡單、快速
- 缺點：不是所有材質都有 wireframe property（所以程式碼有做防守）

## 為什麼 Helpers 需要 update？
SkeletonHelper 需要每一幀 `update()`，才能跟著骨頭的動畫更新線段位置。

