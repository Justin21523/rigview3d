# 05 — 載入 GLB / GLTF：為什麼 glTF 常常需要多個檔？

對照檔案：`src/core/loader.ts`

## GLB vs GLTF（白話）

- `.glb`：一個檔案包全部（mesh、材質、貼圖、動畫），最方便
- `.gltf`：通常是 JSON（描述）+ 外部檔案（`.bin`、貼圖）

所以如果你拖進來的是 `.gltf`，常見狀況是：
- 同資料夾還有 `model.bin`
- 還有 `textures/*.png`

## 這個專案怎麼載入「本機檔案」？

瀏覽器不能直接讀你硬碟路徑（安全性）。  
我們需要把 `File` 變成瀏覽器可存取的 URL：

```ts
const url = URL.createObjectURL(file);
```

這會得到一個 `blob:` URL，例如：
`blob:http://localhost:5173/....`

GLTFLoader 看到 URL，就能用 fetch 類似的方式讀到內容。

## `.gltf` 的外部資源怎麼解？

關鍵是 `LoadingManager.setURLModifier(...)`：
- 每當 loader 想載入 `textures/diffuse.png`
- 我們把它改寫成對應的 blob URL

本專案做法是「用檔名匹配」：
- 將 URL 取 basename：`textures/diffuse.png` → `diffuse.png`
- 用 `Map<filename, blobUrl>` 找到 blob URL

注意：這代表如果你有兩張不同資料夾但同名檔案，可能會衝突。MVP 先用這種簡化策略。

## 為什麼要 revokeObjectURL？

`createObjectURL` 會讓瀏覽器保留一份 blob 的引用。  
你如果一直載入新模型，不 `revokeObjectURL`，記憶體會一直累積。

所以 loader 用 `try/finally` 確保一定會 cleanup：

```ts
try {
  await loader.loadAsync(...)
} finally {
  revokeAll()
}
```

