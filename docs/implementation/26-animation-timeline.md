# 26 — Animation Timeline（Scrub / Range / Crossfade）

這一階段把「播放控制」從只有 Play/Pause/Stop，升級成更像剪輯器的 timeline 工作流：

- Scrub：用滑桿直接拖時間（0 ~ duration），就算在 Stop 狀態也能預覽 pose。
- Current time：顯示 `current / duration`，播放時會即時更新。
- Playback range：設定 Range Start / Range End，只在這段區間內循環或播放一次。
- Clip crossfade：在播放中切換 clip 時做平滑淡入淡出（避免瞬間跳 pose）。

對應的核心檔案：
- `src/core/animator.ts`：timeline 狀態、seek、range enforcement、crossfade
- `src/ui/controls.ts`：Animation panel 的 DOM wiring + timeline UI 同步
- `index.html`：新增 timeline 的 UI 控制元件

## 1) Scrub 的原理：把「時間」當成一個可直接設定的值

Three.js 的動畫系統核心是：

- `AnimationMixer`：負責更新（`mixer.update(deltaSeconds)`）並驅動所有 `AnimationAction`
- `AnimationAction`：代表「某個 clip 在某個模型上」的播放狀態，關鍵欄位是 `action.time`

Scrub 的做法不是「快轉」，而是：

1. 把 `action.time` 設成你要的秒數
2. 呼叫 `mixer.update(0)` 讓 Three.js 重新 sample pose（delta = 0 表示只重算不前進時間）

因此在 `src/core/animator.ts` 我們做了 `seek(seconds)`：
- `action.time = seconds`
- `mixer.update(0)`

重點：就算使用者按了 Stop，我們仍會 `ensureActiveAction()` 建立一個「preview action」，讓 scrub 時模型可以即時顯示 pose。

## 2) Timeline 狀態：UI 不要自己算時間

UI 最常見的 bug 是：UI 自己算時間、Animator 又自己算時間，兩邊打架。

所以 `Animator` 直接維護 timeline 狀態，並提供：
- `getTime()` / `getDuration()`
- `setTime(seconds)`（scrub 用）
- `setRangeStart(seconds)` / `setRangeEnd(seconds)`
- `onTimelineChange(listener)`：Animator 主動推送 state 給 UI

`Animator.update(deltaSeconds)` 每幀會：
- 呼叫 `mixer.update(deltaSeconds)`
- 同步 `this.time = action.time`
- 呼叫 `enforceRange()`（下一節）
- `emitTimeline()` 推播給 UI（更新 scrub slider / time label）

## 3) Playback Range：只在一段時間窗內 loop / once

Range 的需求是：不一定要播放整段 clip，而是只播放其中一段。

我們在 Animator 內維護：
- `rangeStart`
- `rangeEnd`

然後在 `enforceRange()` 做兩件事：

1) 如果 `repeat`：
- 超過 rangeEnd 時，把時間 wrap 回 rangeStart（類似取餘數）

2) 如果 `once`：
- 超過 rangeEnd 時，時間 clamp 在 rangeEnd
- 並把 `state` 設成 `stopped` + `mixer.timeScale = 0`（停止推進）

這樣 UI 的 Loop toggle 就不只是設定 `AnimationAction.setLoop(...)`，也會影響「range 的行為」。

## 4) Clip Crossfade：切 clip 不要瞬間跳 pose

Three.js 提供 `AnimationAction.crossFadeFrom(prevAction, duration, warp)`：
- `duration` 是淡入淡出秒數
- `warp=true` 通常可以讓不同節奏的動畫切換更自然

我們的策略是：
- 只有在「正在 playing / paused」時切 clip 才 crossfade
- 如果是 stopped 狀態，切 clip 直接 reset 到 rangeStart 並顯示第一幀 pose（比較直覺）

Crossfade 秒數由 UI slider 控制（`anim-crossfade`），存在 Animator 的 `crossfadeSeconds`。

## 5) UI 同步：避免播放更新和使用者拖曳互相打架

`src/ui/controls.ts` 做了兩個小保護：

- `isScrubbing`：當使用者正在拖 scrub slider 時，不要用播放更新去覆蓋 slider 的 thumb 位置。
- `document.activeElement` 檢查：Range Start/End 的 number input 正在輸入時，不要把 value 強制改回去（避免打字被洗掉）。

UI 事件 → Animator：
- scrub slider `input` → `animator.setTime(value)`
- range inputs `input` → `animator.setRangeStart/End(value)`
- crossfade slider `input` → `animator.setCrossfadeSeconds(value)`

Animator → UI：
- `animator.onTimelineChange(...)` 更新 `max/value`、time label、range inputs

## 6) 你可以怎麼驗證（建議操作順序）

1. 拖進一個有動畫的 `.glb/.gltf/.fbx`
2. Play：確認 time label 會動、scrub slider 會動
3. 停止（Stop）後拖 scrub：確認模型 pose 會跟著變（不是只有停在第一幀）
4. 設定 Range Start/End：確認播放只在這段區間內循環
5. Loop 關掉（once）：確認到 rangeEnd 會停住
6. 播放中切換 clip：確認動作會 crossfade（不是瞬間跳）

