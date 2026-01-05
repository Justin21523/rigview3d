# 06 — UI（DOM 事件）怎麼接到 Three.js？

對照檔案：`src/ui/controls.ts`

這個檔案很長，但你可以用「分區」方式看：
1. 找 DOM 元素
2. 綁事件（drag&drop、click、change）
3. 載入模型 → 更新 scene → 更新 UI
4. 計算 info stats

## 1) Drag & Drop 的核心概念

瀏覽器的 drop 事件預設會「打開檔案/導頁」。  
所以你必須在 `dragover` 和 `drop` 做：

```ts
e.preventDefault();
```

然後你從 `e.dataTransfer.files` 取得 `FileList`。

## 2) 為什麼同時要支援 file input？

不是每個人都習慣拖拉，也不是每個裝置都有方便的拖拉操作。  
所以 dropzone 點一下會觸發隱藏的 `<input type="file">`。

## 3) Load 完成後，UI 做了哪些事？

成功載入後，流程大概是：
1. `viewer.getScene().add(root)`：把模型放進 scene
2. `viewer.frameObject(root)`：相機自動對準
3. `animator.setSource(root, animations)`：初始化動畫系統
4. `helpers.setModelRoot(root)`：讓 debug helpers 知道目前的模型
5. 重新整理 dropdown / buttons enabled 狀態
6. 更新 Info panel

## 4) Info panel 的統計怎麼算？

我們用 `root.traverse(...)` 走過所有子物件：
- `obj.isMesh`：mesh 計數 + 收集 material
- `obj.isBone`：骨頭計數
- `obj.isSkinnedMesh`：判斷是否能顯示 skeleton helper

材料數量用 `Set` 的原因是：
同一個材質可能被很多 mesh 共用，如果直接加總會算錯。

