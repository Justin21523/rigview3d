# 15 — Inspector：用表單控制 3D 物件（Transform + Material）

Inspector 的重點是「把目前 selection 的屬性，用表單顯示出來並能改回去」。

在本 repo 對應：

- `src/ui/inspector.ts`

## 1) 先確立資料流：Editor 是 source of truth

我們的狀態中心是 `Editor`：

- `Editor.getSelection()`：目前選到誰
- `Editor.onSelectionChange(cb)`：選取改變（選到新物件 / 清空）
- `Editor.onSelectionUpdated(cb)`：同一個物件被改了（例如 gizmo 拖曳、undo/redo）

Inspector 只需要：

1. 監聽 selection 事件
2. 把 selection 的值寫到 input
3. 當 input 改變，再把值寫回 selection

## 2) Transform：position / rotation / scale

### position

Three.js 的座標單位沒有固定「公尺」或「公分」，就是你自己定義的世界單位。  
`Object3D.position` 是 `Vector3`：

- `position.x / y / z`

Inspector 的數字欄位（`<input type="number">`）會在 `input` 事件時把值寫回：

- `selected.position.x = value`

### rotation（重要：degrees vs radians）

Three.js 內部的 rotation 是 **radians**（弧度），但人類習慣用 **degrees**（角度）。

所以 Inspector 需要做轉換：

- 顯示：`radToDeg(selected.rotation.x)`
- 寫回：`selected.rotation.x = degToRad(inputValue)`

這就是你在 `src/ui/inspector.ts` 看到 `THREE.MathUtils.degToRad / radToDeg` 的原因。

### scale

`Object3D.scale` 也是 `Vector3`：

- `scale.x / y / z`

輸入 1 代表原大小，2 代表放大 2 倍。

## 3) Material：為什麼選 MeshStandardMaterial？

glTF 的預設 PBR 材質在 Three.js 通常會變成 `MeshStandardMaterial`。  
它的常用參數：

- `color`：底色（baseColor）
- `metalness`：金屬感（0~1）
- `roughness`：粗糙度（0~1）

Inspector 的 material editor 做的事是：

1. 判斷 selection 是不是 mesh（`(selection as Mesh).isMesh`）
2. 取出 `mesh.material`
   - 可能是單一 material
   - 也可能是 material array（multi-material）
3. 如果是 `MeshStandardMaterial` 才顯示控制器

對應：

- `getMeshMaterials()`：把單一/陣列材質統一成 array
- `material-slot`：多材質時選要改第幾個 slot

## 4) 為什麼要 isSyncing？

Inspector 有兩種更新方向：

- **scene → DOM**：selection 改變時，我們會把值寫到 input
- **DOM → scene**：使用者改 input 時，我們會把值寫回 selection

如果不做 guard，很容易出現「你寫到 input → 觸發 input event → 又改到 scene → 又回寫」的循環。

所以 `src/ui/inspector.ts` 用 `isSyncing`：

- `isSyncing = true` 時，所有 input handler 都直接 return
- 寫完 UI 再 `isSyncing = false`

這是一個簡單但非常常見的 UI 技巧。

## 5) Undo/Redo 為什麼 Inspector 要管？

因為 Inspector 的改動是「不是 gizmo 拖曳」的變更，所以需要自己把它包成命令推進 history（下一章會說 history 的原理）。

你會在 `src/ui/inspector.ts` 看到：

- 針對 name / transform / material 的 focus/change 事件做「before/after snapshot」
- 最後呼叫 `editor.pushCommand(...)`

