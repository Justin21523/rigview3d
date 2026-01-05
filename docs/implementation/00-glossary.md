# 00 — 名詞表（Glossary）

下面是你在 RigView3D 裡會一直遇到的名詞，用中文先建立直覺。

## Three.js / 3D 基礎

### WebGL
瀏覽器提供的低階 3D API。Three.js 是把 WebGL 包起來，讓你用更高階的方式畫 3D。

### Renderer（`THREE.WebGLRenderer`）
負責把「場景（Scene）」用「相機（Camera）」的視角畫到 `<canvas>` 上。你可以把它想成「把 3D 世界拍照成 2D 圖片」的機器。

### Scene（`THREE.Scene`）
3D 世界的根容器。所有會被渲染的物件（mesh、light、helper）都必須掛在 Scene 裡。

### Object3D（`THREE.Object3D`）
Three.js 的「場景樹」節點基底類別。Scene、Mesh、Group、Bone 都是 Object3D。你可以把它想成「可被擺放在 3D 空間的東西」。

### Camera（`THREE.PerspectiveCamera`）
相機決定你從哪裡看 3D 世界。PerspectiveCamera 類似真人相機，有視角（FOV）與近/遠裁切面（near/far）。

### Mesh
可被渲染的幾何物件（通常是你的角色身體/衣服/道具）。Mesh 通常由：
- Geometry（形狀：頂點/三角形）
- Material（材質：怎麼上色/貼圖/發光）
組成。

### Geometry / BufferGeometry
模型的「形狀資料」。通常是一堆頂點（position/normal/uv）與索引（index）。會佔用 GPU buffer。

### Material
模型的「畫法」。例如金屬、塑膠、皮膚。材質常常引用 Texture，並且會牽涉 shader。

### Texture
貼圖（圖片），例如 baseColor、normalMap。會佔用 GPU 記憶體。

## 動畫相關

### AnimationClip
GLTF 裡的一段動畫（例如 Idle/Walk/Run）。包含關節（bones）在不同時間的 keyframes。

### AnimationMixer
Three.js 的動畫播放引擎。它負責在每一幀把 clip 的時間往前推，並把結果套用到模型的骨架/物件上。

### AnimationAction
Mixer 針對每個 clip 產生的播放控制物件。你可以對 action 做 play/stop、設定 loop、設定 clampWhenFinished。

### SkinnedMesh / Bone / Skeleton
「骨架動畫」的核心：
- Bone：骨頭節點（也是 Object3D）
- SkinnedMesh：會跟著骨頭變形的網格（角色皮膚）
- Skeleton：骨頭集合 + 皮膚權重（skinning）

### SkeletonHelper
Three.js 的 debug helper，用線段把骨架畫出來，方便你看骨頭在怎麼動。

## RigView3D 的模組名詞

### Viewer（`src/core/viewer.ts`）
管理 Scene/Camera/Renderer/OrbitControls + render loop。其他模組都透過 Viewer 提供的小 API 來互動。

### ModelLoader（`src/core/loader.ts`）
負責把你拖拉進來的 `.glb/.gltf` 讀成 Three.js 的 Object3D。

### Animator（`src/core/animator.ts`）
負責 AnimationMixer/actions，提供 UI 需要的 play/pause/stop/speed/loop。

### Helpers（`src/core/helpers.ts`）
管理 grid/axes/skeleton/wireframe 的顯示與更新。

### Dispose（`src/core/dispose.ts`）
負責釋放 GPU 資源（geometry/material/texture），避免你重複載入模型造成越來越慢。

