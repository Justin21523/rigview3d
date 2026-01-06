# RigView3D 實作筆記（中文）

這個資料夾的目標是把 RigView3D 的核心概念拆到「完全不懂 Three.js / WebGL」也能慢慢看懂的程度。

- 程式碼內的註解全部用英文：方便你對照 Three.js 官方文件與原始 API 名稱。
- 這裡的文件用中文：把概念、流程、以及每個模組的責任用白話拆開來說。

## 建議閱讀順序
1. `00-glossary.md`：名詞表（Scene / Camera / Mesh / AnimationClip…）
2. `01-overview.md`：整體架構與資料流（UI → core modules）
3. `02-setup-vite-typescript.md`：Vite/TS 專案如何跑起來
4. `03-threejs-mental-model.md`：Three.js 的基本世界觀（場景樹、座標、渲染）
5. `04-viewer-render-loop.md`：`src/core/viewer.ts`（render loop、OrbitControls、frameObject）
6. `05-loading-gltf-glb.md`：`src/core/loader.ts`（GLB/GLTF、blob URL、URLModifier）
7. `06-ui-dom-events.md`：`src/ui/controls.ts`（drag & drop、file input、info panel）
8. `07-animation-mixer.md`：`src/core/animator.ts`（AnimationMixer、Play/Pause/Stop、Loop/Speed）
9. `08-debug-helpers.md`：`src/core/helpers.ts`（grid/axes/skeleton/wireframe）
10. `09-cleanup-dispose.md`：`src/core/dispose.ts`（為什麼要 dispose、怎麼避免 GPU leak）
11. `10-git-phases.md`：如何切換到每個 phase 的 git tag 來看「中間狀態」
12. `11-next-steps.md`：你可以自己改什麼來練習（循序漸進）
13. `12-editor-overview.md`：Editor 模式總覽（Hierarchy/Inspector/Tools）
14. `13-selection-hierarchy.md`：selection 的 raycast 原理 + Hierarchy 如何渲染
15. `14-transform-controls.md`：TransformControls（Move/Rotate/Scale gizmo）
16. `15-inspector-transform-material.md`：Inspector（Transform + Material）
17. `16-undo-redo-history.md`：Undo/Redo（history + snapshot）
18. `17-shortcuts.md`：快捷鍵（Q/W/E/R、F、Del、Ctrl+Z/Y）
19. `18-export-glb.md`：匯出 GLB（GLTFExporter）
20. `19-delete-and-safety.md`：Delete 的取捨與資源管理注意事項
21. `20-editor-polish.md`：Editor phase-5（duplicate / gizmo size / keyboard transforms）
22. `21-editor-unity-camera-hierarchy-settings.md`：Editor phase-6（Alt 相機 / Fly / Hierarchy 右鍵 / Settings）

## 如何對照程式碼
建議你開兩個視窗：
1. 編輯器打開對應的檔案，例如 `src/core/viewer.ts`
2. 同時打開這裡的文件，邊看概念邊對照程式碼註解（英文）

## 如何切換到每個 Phase 的中間狀態
這個 repo 有標記 git tag：

- Viewer phases：`phase-1` 到 `phase-5`
- Editor phases：`editor-phase-1` 開始（逐步把 viewer 變成 Unity-like editor）

你可以用：

```bash
git tag --list "phase-*"
git tag --list "editor-phase-*"
git switch --detach phase-1
npm install
npm run dev
```

看完再回到最新版本：

```bash
git switch main
```
