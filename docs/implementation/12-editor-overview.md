# 12 — Editor 模式總覽（Unity-like：Hierarchy / Inspector / Tools）

到 `phase-5` 為止，RigView3D 主要是一個「載入 + 播放動畫 + debug」的 viewer。從 `editor-phase-*` 開始，我們把它往「可操作的模型編輯器」方向推進，讓你可以像 Unity 一樣：

- 點選模型上的物件（selection）
- 在左側 Hierarchy 看到整棵場景樹（scene graph）
- 在右側 Inspector 編輯名稱、顯示、Transform、材質參數
- 用 Move/Rotate/Scale 的 gizmo 拖曳調整
- 用快捷鍵 Q/W/E/R 切工具、F 對焦、Del 刪除、Ctrl+Z/Y 復原/重做
- 匯出目前狀態為 `.glb`

## 「核心」跟「UI」怎麼分工？

你可以先把整個 app 想成兩層：

1) **Core（不碰 DOM）**：負責 Three.js 的狀態、運算、資源管理  
2) **UI（只做 DOM glue）**：負責讀/寫 HTML 元素，然後呼叫 core 的小 API

### Core 重要檔案

- `src/core/viewer.ts`  
  Three.js 的 Scene/Camera/Renderer/OrbitControls 與 render loop。Editor 用它來：
  - 取得 camera/canvas（TransformControls 需要）
  - 調整背景色與燈光強度（Scene 面板）

- `src/core/editor/editor.ts`  
  Editor 的「狀態中心」：管理目前模型 root、selection、TransformControls、undo/redo、delete。

- `src/core/editor/history.ts`  
  最小可用的 undo/redo（command pattern）。

- `src/core/editor/transformSnapshot.ts`  
  把 `Object3D` 的 transform（position/quaternion/scale）拍成快照，供 undo/redo 用。

### UI 重要檔案

- `src/ui/editor.ts`：viewport 點選選取 + Hierarchy 列表渲染/搜尋
- `src/ui/tools.ts`：Tools 面板（Select/Move/Rotate/Scale、snap、space）
- `src/ui/inspector.ts`：Inspector 面板（name/visible/transform/material + history）
- `src/ui/scene.ts`：Scene 面板（background + lights）
- `src/ui/export.ts`：Export 面板（GLTFExporter → 下載 `.glb`）
- `src/ui/shortcuts.ts`：快捷鍵（避免在輸入框打字時誤觸）

## 你在學習時的「建議看法」

如果你是 Three.js 新手，先不要急著理解所有檔案。你可以用這個順序：

1. 先懂 `Viewer`（scene/camera/render loop）→ 你就知道 3D 世界怎麼被畫出來
2. 再懂「selection」→ 你就知道「用滑鼠點 3D 物件」的本質（raycast）
3. 再懂 `TransformControls` → 你就能理解 Unity 那種 gizmo 怎麼做出來
4. 最後看 `history`/`export` → 你就能把編輯器變得更像完整工具

