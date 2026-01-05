# 03 — Three.js 的世界觀（先建立直覺）

你可以用「拍電影」的比喻來理解 Three.js：

- Scene：片場（所有東西都在片場裡）
- Mesh：演員/道具（真正被拍到的東西）
- Light：燈光（讓畫面有明暗）
- Camera：攝影機（決定你看到的畫面）
- Renderer：攝影組（把畫面拍到螢幕上）

## 座標系（Three.js 預設）

Three.js 預設是右手座標系：
- X：向右
- Y：向上
- Z：朝你（或說：相機預設看向 -Z，因此在相機前方的物體常常是「負 Z」）

你不用立刻背很精準，先知道：
- GridHelper 在 `y=0` 的平面上
- AxesHelper 會告訴你 X/Y/Z 的方向

## Scene Graph（場景樹）

Scene 裡的物件不是扁平的 list，而是一棵樹：
- 你把一個 `Object3D` 加到 scene，它的 children 也會一起被渲染。
- 這很適合模型：模型通常是一棵「Group/mesh/bone」的樹。

## 每一幀（Frame）在做什麼？

瀏覽器大約每秒 60 次呼叫你的回呼（requestAnimationFrame）：
1. 更新控制器（OrbitControls）
2. 更新動畫（AnimationMixer）
3. renderer.render(scene, camera)

這就是 `src/core/viewer.ts` 的核心。

