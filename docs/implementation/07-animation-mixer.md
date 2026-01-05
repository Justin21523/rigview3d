# 07 — 動畫播放：AnimationMixer 到底在做什麼？

對照檔案：`src/core/animator.ts`

## 你可以先有一個直覺

AnimationMixer 就像一個「時間推進器」：
- 你每一幀呼叫 `mixer.update(deltaSeconds)`
- mixer 會把所有正在播放的 action 往前推 deltaSeconds
- 然後把結果套用到骨頭/物件上（所以模型看起來在動）

## setSource：為什麼換模型要先 dispose？

重複載入模型最容易出事的地方之一就是動畫：
- mixer 內部會 cache 很多對 bone/property 的 binding
- 如果不清掉，可能引用舊物件，造成記憶體累積或奇怪的動作

所以 `setSource` 先呼叫 `dispose()`：
- `stopAllAction()`
- `uncacheRoot(root)`

## Play / Pause / Stop 的差別

### Play
建立（或取得）action：
```ts
const action = mixer.clipAction(clip);
action.reset();
action.play();
```

### Pause（本專案做法）
用 `mixer.timeScale = 0` 暫停時間推進。
好處：簡單，且會停在當前姿勢。

### Stop
`stopAllAction()` 會把 action 的影響拿掉，通常模型會回到 bind pose 或沒有 action 影響的姿勢。

## Speed（速度）
我們用 `mixer.timeScale` 控制速度：
- 1 = 正常
- 0.5 = 半速
- 2 = 兩倍速

## Loop（循環）

Three.js loop 模式：
- `LoopRepeat`：一直重複
- `LoopOnce`：播一次就停

播一次後停住最後一幀，需要：
`action.clampWhenFinished = true`

