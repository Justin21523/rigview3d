# 18 — Export GLB：把「目前編輯後的模型」下載成檔案

很多人做 viewer 到最後會想要：**把我現在調好的狀態存成一個檔案**。這裡我們用 Three.js examples 的 `GLTFExporter` 做最小可用的 `.glb` 匯出。

在本 repo 對應：

- `src/ui/export.ts`

## 1) GLTF vs GLB

- `.gltf`：JSON + 外部 `.bin` + 外部 textures（通常是多檔）
- `.glb`：把 JSON / binary / textures 打包成單一 binary 檔（單檔）

在 Web app 裡，下載單檔 `.glb` 最方便，所以我們用：

- `binary: true`

## 2) GLTFExporter 的輸出是什麼？

`GLTFExporter.parseAsync(...)` 在 `binary: true` 時會回傳：

- `ArrayBuffer`（一段 binary bytes）

所以要下載就是：

1. `new Blob([arrayBuffer], { type: "model/gltf-binary" })`
2. `URL.createObjectURL(blob)`
3. 建立 `<a download>` 並 click
4. `URL.revokeObjectURL(url)`

這一套流程在 `src/ui/export.ts` 的 `downloadArrayBuffer()` 裡。

## 3) 動畫要不要一起匯出？

GLTFExporter 支援把 `AnimationClip[]` 一起寫進 glTF：

- `animations: [...]`

所以 Export 面板提供：

- `Include animations`（checkbox）

我們把動畫 clips 來源設計成：

- 從 `Animator.getClips()` 取得（因為 Animator 本來就持有目前模型的 clips）

對應：

- `src/ui/export.ts`：`const animations = includeAnims.checked ? animator.getClips() : []`

## 4) 檔名從哪裡來？

為了讓輸出檔名友善，我們會拿原始載入的檔名當 base：

- `editor.getSourceFileName()`（由 loader 成功後寫入）

然後輸出：

- `${base}-edited.glb`

你如果想更像 Unity，可以再加：

- 自訂輸出檔名輸入框
- 匯出選項（只匯出 selection、是否 embed textures、是否 merge meshes…）

