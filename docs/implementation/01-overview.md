# 01 — 架構總覽：資料怎麼流？

先不要急著看 Three.js 的 API。先看「誰負責什麼」，你會比較不容易迷路。

## 專案檔案分工（重要）

- `index.html`：UI 的骨架（sidebar、buttons、canvas）
- `src/main.ts`：組裝器（建立 Viewer/Loader/Animator/Helpers，然後呼叫 `initControls`）
- `src/ui/controls.ts`：DOM 事件綁定（click、drag&drop、input change）
- `src/core/viewer.ts`：Three.js 渲染核心（scene/camera/renderer/loop）
- `src/core/loader.ts`：GLB/GLTF 載入（含 `.gltf` 多檔案 blob URL 對應）
- `src/core/animator.ts`：動畫播放控制（AnimationMixer、loop、speed）
- `src/core/helpers.ts`：debug helpers（grid/axes/skeleton/wireframe）
- `src/core/dispose.ts`：釋放 GPU 資源（避免重複載入越來越慢）

## 最重要的資料流（你可以背起來）

1. 使用者拖拉/選檔 → `src/ui/controls.ts`
2. UI 叫 `ModelLoader.loadFromFiles(...)` → 得到 `{ root, animations }`
3. UI 把 `root` 加到 `Viewer.getScene()` → 3D 物件出現
4. UI 呼叫 `Viewer.frameObject(root)` → 自動把相機移到看得到模型
5. UI 呼叫 `Animator.setSource(root, animations)` → 準備播放動畫
6. Viewer 每一幀呼叫 `Animator.update(delta)` → 動畫真的動起來
7. UI 切換 Debug toggles → `Helpers` 改可見性/線框/骨架顯示
8. 新模型載入前 → 清掉舊模型 + `disposeObject3D(oldRoot)` → 不會累積 GPU 資源

## 你該先看哪個檔？

如果你想理解「畫面怎麼畫出來」：從 `src/core/viewer.ts` 開始。  
如果你想理解「拖拉為什麼可以載入多個檔」：看 `src/core/loader.ts`。  
如果你想理解「動畫怎麼播放」：看 `src/core/animator.ts`。  
如果你想理解「UI 怎麼跟 core 溝通」：看 `src/ui/controls.ts`。

