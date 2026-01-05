# 02 — 專案怎麼跑起來？（Vite + TypeScript）

RigView3D 是「純前端」專案：沒有後端伺服器。你跑起來看到的東西，都在瀏覽器內完成。

## 你需要知道的兩件事

### 1) Vite 是什麼？
Vite 是一個前端工具，主要做兩件事：
1. `npm run dev`：開發伺服器（HMR、快速更新）
2. `npm run build`：把你的 TS/CSS/資源打包成可以部署的 `dist/`

### 2) TypeScript 是什麼？
TypeScript 是 JavaScript 的「加強版」，多了型別系統。  
你寫 `.ts`，Vite 會在開發/打包時把它編譯成瀏覽器能跑的 JS。

## 指令（照做就可以）

```bash
npm install
npm run dev
```

打開 terminal 印出的網址（通常是 `http://localhost:5173/`）。

## `index.html` 為什麼可以直接引用 `/src/main.ts`？
因為 Vite 把 `index.html` 當成入口，看到：

```html
<script type="module" src="/src/main.ts"></script>
```

它會：
- 在 dev 時動態編譯 TS
- 在 build 時把它打包成一個或多個 JS chunk

你不需要手動寫 webpack/rollup 設定，就能跑起來。

