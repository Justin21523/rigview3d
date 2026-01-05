# 13 — Selection 與 Hierarchy：用滑鼠點到 3D 物件的原理

這一章的目標是讓你理解：**為什麼在畫面上點一下，就能選到 3D 模型裡的某個 Mesh？**

## 1) Selection 的本質：Raycasting（射線碰撞）

當你在螢幕上點一下（2D），Three.js 要做的是：

1. 把滑鼠座標（clientX/clientY）換成 **NDC**（Normalized Device Coordinates）  
   - X：左邊 -1 → 右邊 +1  
   - Y：上面 +1 → 下面 -1
2. 用 camera + NDC 建一條「從相機出發穿過畫面那個點」的射線（Ray）
3. 拿這條射線去和模型做相交測試，找出最近的命中（hit）

在本 repo 對應到：

- `src/core/editor/editor.ts` 的 `Editor.pick(clientX, clientY)`
  - `getBoundingClientRect()` 取得 canvas 在頁面上的位置/尺寸
  - 把滑鼠點的位置換成 NDC
  - `Raycaster.setFromCamera(ndc, camera)`
  - `raycaster.intersectObject(modelRoot, true)`

### 為什麼只 intersect `modelRoot`？

我們刻意只對「目前載入的模型 root」做 raycast，原因是：

- grid/axes/skeleton 等 helpers 不應該被選到
- TransformControls gizmo 也不應該被選到
- 這樣可以避免「點一下選到 debug 物件」的困擾

## 2) Selection outline：BoxHelper（選取外框）

Unity 被選取的物件會有外框/高亮。這裡我們用 Three.js 內建的：

- `THREE.BoxHelper`

它的概念很直白：

- 算出該物件的 bounding box（包住它的最小長方體）
- 用線段把長方體畫出來

在本 repo 對應到：

- `src/core/editor/editor.ts`
  - `ensureSelectionHelper()`：建立/切換 BoxHelper 目標
  - `update()`：每一幀呼叫 `BoxHelper.update()`，讓外框跟動畫/變形同步

## 3) Hierarchy：把場景樹渲染成左側列表

Three.js 的場景（Scene）其實是一棵樹：

- Scene
  - Group
    - Mesh
    - Bone
    - ...

glTF 載入後的 `gltf.scene` 就是這棵樹的 root。

我們做 Hierarchy 的方式是：

1. 從 root 開始 DFS 遞迴走訪 `object.children`
2. 產生一個「扁平陣列」（每個節點帶 `depth`）
3. 用 DOM 把每個節點渲染成一行 `div.tree-item`
4. 用 `padding-left` 根據 depth 做縮排

對應程式：

- `src/ui/editor.ts`
  - `buildVisibleNodes(root, filter)`：遞迴建立可顯示節點列表（含搜尋過濾）
  - `render()`：把列表渲染到 `#hierarchy-tree`

### 搜尋 filter 為什麼要「父節點也顯示」？

我們的 filter 做法是：

- 自己符合搜尋字串 → 顯示
- 或者「任何子孫」符合 → 父節點也顯示（讓你看得出它在哪個樹枝上）

這樣比只顯示命中的葉子節點更好理解。

## 4) UI 與 core 怎麼同步？

同步的核心是「事件」：

- `Editor.onRootChange()`：模型換了 → 重建 Hierarchy
- `Editor.onSelectionChange()`：選取換了 → 更新選取高亮行
- `Editor.onSelectionUpdated()`：同一個選取物件內容變了（例如改名）→ 更新文字

你可以把它當成很簡單的「狀態管理」：Editor 是 state source，UI 是 view。

