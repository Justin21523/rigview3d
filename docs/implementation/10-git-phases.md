# 10 — 用 git tags 看「中間過程」（phase-* / editor-phase-*）

你說你希望能看到「一步一步做出來」的過程，所以 repo 有提供 tags：

- `phase-1`：基礎 Three.js 場景 + OrbitControls + grid/axes + reset camera
- `phase-2`：drag & drop / file input 載入 GLB/GLTF + info panel
- `phase-3`：動畫播放控制（clip dropdown、play/pause/stop、speed、loop）
- `phase-4`：debug helpers（grid/axes/skeleton/wireframe toggles）
- `phase-5`：重複載入模型的資源釋放（dispose）

另外也有 Editor（Unity-like）進度 tags：

- `editor-phase-1`：三欄式 UI 版面（左右面板 + viewport）
- `editor-phase-2`：Selection + Hierarchy（raycast picking + 場景樹列表）
- `editor-phase-3`：TransformControls + Inspector + Scene 面板
- `editor-phase-4`：Shortcuts + Undo/Redo + Export GLB（含 delete 可復原）
- `editor-phase-5`：Editor polish（gizmo size、duplicate、更多鍵盤操作）
- `editor-phase-6`：Unity-like 操作升級（Alt 相機、Fly/WASD、Hierarchy 右鍵、設定保存）
- `editor-phase-7`：新增 FBX 載入支援（含貼圖路徑與常見貼圖格式）
- `editor-phase-8`：修復互動體驗（Viewport focus 讓快捷鍵可用 + 相機滑鼠 mapping 開關）
- `editor-phase-9`：互動穩定性提升（選取/相機不互相打架 + gizmo 拖曳後不再卡死）

## 查詢 tags

```bash
git tag --list "phase-*"
git tag --list "editor-phase-*"
```

## 切換到某個 phase

建議用 detach 模式（不會影響你的 main 分支）：

```bash
git switch --detach phase-3
npm install
npm run dev
```

看完回到最新版本：

```bash
git switch main
```

## 建議你怎麼學（最有效）

1. 先切到 `phase-1`，只看 Viewer 和渲染 loop
2. 再切到 `phase-2`，看 loader + dropzone
3. 再切到 `phase-3`，看 animator
4. `phase-4` 看 helpers
5. `phase-5` 看 dispose

每一階段都跑一次 `npm run dev`，你會很快建立「改哪裡會影響哪裡」的直覺。
