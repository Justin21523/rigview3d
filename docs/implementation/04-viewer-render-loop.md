# 04 — Viewer：怎麼把 3D 畫出來？

對照檔案：`src/core/viewer.ts`

Viewer 的責任只有一件事：**穩定地把 scene 用 camera 畫到 canvas 上**。  
它不關心你載入什麼模型，也不關心 UI。

## 1) 初始化三件套：Scene / Camera / Renderer

### Scene
```ts
this.scene = new THREE.Scene();
this.scene.background = new THREE.Color(0x0b0e14);
```
Scene 是容器，背景色只是讓畫面看起來舒服。

### Renderer
```ts
this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
```
Renderer 會用 WebGL 把畫面畫到 canvas。

pixelRatio 這段很重要：
- 手機/高 DPI 螢幕 `devicePixelRatio` 可能是 2~3
- 直接用 3 會讓 GPU 負擔大（render buffer 變 9 倍像素）
- 所以我們 clamp 到 2

### Camera
```ts
this.camera = new THREE.PerspectiveCamera(50, width / height, 0.01, 200);
```
你會看到四個值：
- 50：視角（FOV），越大越廣角
- width/height：畫面比例，不對會變形
- near/far：裁切面，不對會「被剪掉」或深度精度變差

## 2) OrbitControls（用滑鼠轉來轉去）

```ts
this.controls = new OrbitControls(this.camera, this.renderer.domElement);
this.controls.enableDamping = true;
```
OrbitControls 是 Three.js examples 的工具，提供：
- 旋轉（orbit）
- 平移（pan）
- 縮放（zoom）

enableDamping 是「慣性」，手感比較好，但要記得每一幀 `controls.update()`。

## 3) Render loop（requestAnimationFrame）

Viewer 的 `start()` 會做：
1. `clock.getDelta()` 算出這一幀距離上一幀的秒數
2. `onTick?.(delta)` 讓外部（Animator/Helpers）同步更新
3. `controls.update()`
4. `renderer.render(scene, camera)`

你可以把 `onTick` 想成「把時間傳出去」，讓動畫系統跟渲染同步。

## 4) frameObject：自動把模型放到鏡頭裡

對初學者最直覺的問題：模型載入了，但我看不到怎麼辦？

`frameObject(object)` 做的事：
1. 算 object 的 bounding box（包含所有 children）
2. 取得 box 的 center 與 size
3. 用「最大邊長 + 相機 FOV」推算相機要退多遠才看得到整個物體
4. 設定 controls.target = center
5. 設定 camera.position = center + dir * distance

這就是「自動置中與縮放」。

## 5) resize：視窗變動不變形

resize 時必做兩件事：
- `camera.aspect = width / height` + `camera.updateProjectionMatrix()`
- `renderer.setSize(width, height, false)`

否則你會看到畫面拉伸、比例不對。

