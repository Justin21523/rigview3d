# 21 — Unity-like 操作升級：Alt 相機、Fly/WASD、Hierarchy 右鍵、設定保存

這一階段的重點是讓 RigView3D 的「操作手感」更接近 Unity Scene View / Hierarchy：

- Viewport：滑鼠移到物件上會有 hover outline（不必先選到才知道你指到哪）。
- Camera：改成 Unity 常見的 Alt 操作（Alt+LMB orbit / Alt+MMB pan / Alt+RMB dolly），並加入可切換的 Fly/WASD 模式。
- Hierarchy：可展開/收合、節點圖示（Mesh/Bone/Group）、眼睛顯示/隱藏、右鍵選單（Frame/Rename/Duplicate/Delete）。
- Settings：Tools/Scene/Debug 的狀態會存到 localStorage，重開不必重設（含 version + defaults）。

---

## 1) Hover outline：讓「指到哪裡」變明確

對應程式：
- `src/core/editor/editor.ts`：新增 `hoverAt()` / `clearHover()`，用 `Raycaster` 找 hover 物件。
- `src/ui/editor.ts`：在 canvas `pointermove` 事件呼叫 `editor.hoverAt()`，並用 `cursor: pointer` 提示可互動。

核心概念（先懂這個就夠）：
1. 滑鼠座標是「螢幕像素」，Three.js 的射線需要 `Normalized Device Coordinates (NDC)`（-1~1）。
2. `Raycaster.setFromCamera(ndc, camera)` 會建立「從相機穿過滑鼠位置」的射線。
3. `intersectObject(modelRoot, true)` 只打模型子樹，避免碰到 grid/gizmo 等 helper。
4. 用 `BoxHelper` 畫出 outline：它只是一個「包住物件的 bounding box 線框」，便宜又穩定。

---

## 2) Unity-like Camera：Alt 導航 + Fly/WASD

對應程式：
- `src/core/viewer.ts`

### Alt+mouse 的做法（OrbitControls 不改原始碼也能做到）
OrbitControls 的行為由 `controls.mouseButtons` 決定。這個欄位會在 `mousedown` 時決定「這次拖曳要做 ROTATE/PAN/DOLLY」。

所以我們做兩種 mapping：
- **Alt 沒按**：把 `LEFT/MIDDLE/RIGHT` 全部設成 `-1`，等於「拖曳不做任何事」（但滑鼠滾輪 zoom 仍可用）。
- **Alt 按住**：設成 `Alt+LMB orbit / Alt+MMB pan / Alt+RMB dolly`。

### Fly/WASD（像 Unity RMB+WASD）
Fly 模式下：
- RMB 按住拖曳：改相機 yaw/pitch（用 `Euler('YXZ')` 讓第一人稱旋轉比較直覺）。
- WASD/QE：每幀用 `deltaSeconds` 推進相機位置（前/右向量用相機 quaternion 轉出來）。
- Shift：速度加倍。

---

## 3) Settings：localStorage（有 version + defaults）

對應程式：
- `src/core/settings.ts`：定義 `AppSettingsV1`，提供 `getSettings()` + `updateToolsSettings/updateSceneSettings/updateDebugSettings()`。
- `src/main.ts`：啟動時先讀 settings，先把 DOM inputs 設好，再初始化各個 UI 模組。
- `src/ui/tools.ts` / `src/ui/scene.ts` / `src/ui/controls.ts`：在使用者改 UI 時，順便呼叫 `update*Settings()` 寫回 localStorage。

為什麼要「version」？
- 之後你如果新增欄位或改欄位名，可以靠 `version` 做 migration；沒對上版本就回到 defaults（安全）。

---

## 4) Hierarchy：展開/收合 + icons + 眼睛 + 右鍵選單

對應程式：
- `src/ui/editor.ts`

做法要點：
1. 用 `expanded: Set<uuid>` 記錄「哪些節點目前展開」。
2. `buildVisibleNodes()` 把樹狀資料 flatten 成 list（每列含 depth/expanded/hasChildren），render 超直覺。
3. 眼睛按鈕直接切 `object.visible`，並用 `editor.pushCommand()` 做成可 undo。
4. 右鍵選單是自己做一個 floating `<div>`（`position: fixed`），點外面或 Esc 會關閉。

---

## 建議你下一步可以練習什麼

- 把 Hierarchy 的展開狀態也存到 settings（localStorage）。
- Fly 模式加上「速度滑鼠滾輪調整」或「Shift+滾輪加減 speed」。
- 把 Hierarchy 的 visibility toggle 跟 Inspector 的 Visible checkbox 做雙向同步（現在主要靠 `notifySelectionUpdated()`）。

