# 28 — 匯出格式與檔名策略（GLB / glTF / Overwrite）

這一階段把 Export 從「只能匯出 GLB」升級成更像工具軟體的工作流：

- 可選 **GLB** 或 **glTF**（單一檔案）
- 可選「只匯出可見物件」（避免你在編輯時把隱藏的節點也帶出去）
- 可選「使用原始檔名（overwrite）」或「加上 `-edited` 後綴」
- Export 設定會被存到 `localStorage`（下次開啟不用重設）

對應檔案：
- `index.html`：Export panel UI
- `src/ui/export.ts`：Export DOM wiring + 下載檔案
- `src/core/settings.ts`：新增 `settings.export.*` persistence
- `src/main.ts`：開機時把 export settings 套到 DOM
- `src/core/animator.ts`：新增 `freeze()`（匯出時暫停時間，避免播放中匯出不穩定）

---

## 1) GLB vs glTF 到底差在哪？

你可以把它理解成「同一個標準的兩種包裝方式」：

- **GLB (.glb)**：二進位，通常是 **單一檔案**，最方便拿去丟到其它工具/引擎。
- **glTF (.gltf)**：JSON，本來可以拆成多檔（.gltf + .bin + textures），但在瀏覽器工具裡不方便一次下載多檔。

所以這個專案的 glTF 匯出採用：
- **單一 `.gltf` 檔**（buffer/貼圖會被 embed 成 data URI）

優點：只下載一個檔案  
缺點：檔案可能比 GLB 大、也比較不適合長期版本管理

---

## 2) 「Overwrite 原始檔名」到底能不能真的覆寫？

在瀏覽器（純前端 Web App）環境下：

- **不能直接覆寫你硬碟上的原始檔案**（安全限制）
- 我們能做的只有「下載一個檔案」並且**建議瀏覽器用某個檔名**

所以 `Use original filename (overwrite)` 的意思是：
- 下載檔會使用跟原檔一樣的檔名，例如 `character.glb`
- 你可以在檔案總管裡用下載的新檔**手動替換**舊檔

如果你不勾選它，檔名會變成：
- `character-edited.glb`（比較安全，避免你不小心覆寫）

---

## 3) 「Export visible only」為什麼重要？

Three.js 的 `GLTFExporter` 有一個選項：`onlyVisible`

- `true`：只匯出 `object.visible === true` 的節點
- `false`：不管 visible 都會匯出

在我們的 Editor 裡，你可能會把某些部件（武器/衣服/某些 helper）暫時隱藏來方便操作。

這個選項可以讓你決定：

- 隱藏只是「編輯視覺」用途 → 匯出時仍然保留（關掉 onlyVisible）
- 隱藏代表你真的不想要它出現在輸出檔 → 匯出時剔除（打開 onlyVisible）

---

## 4) FBX 為什麼不能匯出？

這個專案目前：
- **可以載入 FBX**（FBXLoader）
- 但 **不能匯出 FBX**

原因很單純：Three.js 官方 examples 沒有提供穩定的 FBXExporter（而 FBX 格式本身也比較複雜/封閉）。

推薦流程：
1. 在 RigView3D 匯出 **GLB** 或 **glTF**
2. 用 Blender 之類的工具匯入 glTF/GLB
3. 再從 Blender 匯出 FBX

這也是很多製作流程常見的「中繼格式」做法（glTF 當 interchange format）。

---

## 5) 匯出時為什麼要 `freeze()`？

如果你在播放動畫時按 Export：
- 每一幀 pose 都在變
- 匯出過程可能在中途抓到不同幀的資料（雖然很短，但仍可能造成不一致）

所以我們在 `src/core/animator.ts` 加了：
- `animator.freeze()`：暫時把 `mixer.timeScale = 0`
- 匯出結束後再恢復原本的 `timeScale`

這樣就算你正在播放，也能得到更穩定的匯出結果。

