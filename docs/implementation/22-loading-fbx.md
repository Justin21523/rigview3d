# 22 — Loading FBX：讓 RigView3D 支援 `.fbx`

這一章會用「完全不懂 FBX/Three.js」也能理解的方式，解釋我們怎麼在瀏覽器裡載入 `.fbx`，並且讓貼圖（textures）也能跟著被解析。

對應程式碼：
- `src/core/loader.ts`
- `index.html`（dropzone 提示與 `<input accept>`）

---

## 1) FBX 跟 glTF 的差別（你只要先記住一件事）

- `.glb`：通常是「單一檔案」就包含幾乎所有內容（模型/材質/貼圖/動畫），很適合 Web。
- `.gltf`：主檔是 JSON，但常會「另外引用」`.bin` 和貼圖檔。
- `.fbx`：是 DCC（Maya/Max）常見格式，可能會引用外部貼圖檔，動畫也可能內含。

所以「載入 FBX」在 Web 上最大的麻煩通常是：
> 你的 FBX 會說「我要讀 `diffuse.png`」，但你現在是在本機拖拉檔案，沒有任何 HTTP 路徑能讓它去抓。

---

## 2) 我們怎麼在瀏覽器解決「外部貼圖路徑」？

核心技巧跟 `.gltf` 一樣：**用 `blob:` URL + `LoadingManager.setURLModifier()`**。

流程（高層理解就好）：
1. 你拖拉一堆檔案進來：`model.fbx` + `diffuse.png` + `normal.tga`…
2. 對每個檔案做 `URL.createObjectURL(file)`，得到像 `blob:https://...` 這種臨時 URL。
3. 設定 `manager.setURLModifier((url) => ...)`：
   - 當 FBXLoader/TextureLoader 想載入 `textures/diffuse.png` 時
   - 我們把它「改寫」成剛剛建立的 `blob:` URL
4. Loader 就能在瀏覽器裡讀到貼圖資料。

你可以把 URLModifier 想成：
> 「所有 loader 要抓資源之前，都先問我一聲，我可以把路徑換掉。」

---

## 3) `.tga` / `.dds` 貼圖為什麼需要額外處理？

FBX 很常用 `.tga`、`.dds`，但瀏覽器原生 `<img>` 不一定支援它們。

好消息是：Three.js 的 `FBXLoader` 本身就支援 `.tga/.dds`，前提是你要在 `LoadingManager` 裡註冊對應 handler：

- `manager.addHandler(/\\.tga$/i, new TGALoader(manager))`
- `manager.addHandler(/\\.dds$/i, new DDSLoader(manager))`

我們已經在 `src/core/loader.ts` 做了這件事，所以你只要把 `.tga/.dds` 檔案一起拖進來就有機會成功顯示貼圖。

---

## 4) 使用方式（實際操作）

1. 把 `model.fbx` 拖進 dropzone
2. 如果 FBX 有外部貼圖，**把貼圖一起拖進去**（建議一次多選拖拉）
3. 如果 FBX 內含動畫，你會在 Animation 面板看到 clips，按 Play 就能播放

---

## 5) 常見踩雷（先知道就能少走很多彎路）

- 不是所有 FBX 變體都能被 Three.js 完美支援（特別是很舊或很特殊的 exporter）。
- 貼圖「檔名重複」可能會對不上（因為我們用 filename 做 mapping）。最安全是讓貼圖檔名唯一。
- 如果載入後材質看起來怪：FBXLoader 常產生 Phong/Lambert 材質，跟 glTF 的 PBR 材質觀念不同。

