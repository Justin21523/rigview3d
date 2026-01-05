import * as THREE from "three";

export type LoopMode = "repeat" | "once";
export type PlayState = "stopped" | "playing" | "paused";

export class Animator {
  private mixer: THREE.AnimationMixer | null = null;
  private root: THREE.Object3D | null = null;
  private clips: THREE.AnimationClip[] = [];
  private selectedIndex = -1;
  private activeAction: THREE.AnimationAction | null = null;

  private speed = 1;
  private loopMode: LoopMode = "repeat";
  private state: PlayState = "stopped";

  public setSource(root: THREE.Object3D | null, clips: THREE.AnimationClip[]): void {
    this.dispose();

    this.root = root;
    this.clips = clips;
    this.selectedIndex = clips.length > 0 ? 0 : -1;
    this.speed = 1;
    this.loopMode = "repeat";
    this.state = "stopped";

    if (root && clips.length > 0) {
      this.mixer = new THREE.AnimationMixer(root);
      this.mixer.timeScale = this.speed;
    }
  }

  public getClips(): THREE.AnimationClip[] {
    return this.clips;
  }

  public getSelectedIndex(): number {
    return this.selectedIndex;
  }

  public getSpeed(): number {
    return this.speed;
  }

  public getLoopMode(): LoopMode {
    return this.loopMode;
  }

  public getPlayState(): PlayState {
    return this.state;
  }

  public selectClip(index: number): void {
    if (!this.mixer) return;
    if (index < 0 || index >= this.clips.length) return;

    this.selectedIndex = index;

    if (this.state === "stopped") return;
    this.playSelected(/* preserveState */ true);
  }

  public play(): void {
    if (!this.mixer) return;
    if (this.clips.length === 0) return;
    if (this.selectedIndex < 0) this.selectedIndex = 0;

    this.playSelected(/* preserveState */ false);
    this.state = "playing";
    this.mixer.timeScale = this.speed;
  }

  public togglePause(): void {
    if (!this.mixer) return;
    if (this.state === "stopped") return;

    if (this.state === "playing") {
      this.mixer.timeScale = 0;
      this.state = "paused";
      return;
    }

    this.mixer.timeScale = this.speed;
    this.state = "playing";
  }

  public stop(): void {
    if (!this.mixer) return;
    this.mixer.stopAllAction();
    this.activeAction = null;
    this.state = "stopped";
  }

  public setSpeed(speed: number): void {
    this.speed = clamp(speed, 0.01, 10);
    if (!this.mixer) return;
    if (this.state !== "paused") this.mixer.timeScale = this.speed;
  }

  public setLoopMode(mode: LoopMode): void {
    this.loopMode = mode;
    if (this.activeAction) applyLoopMode(this.activeAction, mode);
  }

  public update(deltaSeconds: number): void {
    if (!this.mixer) return;
    this.mixer.update(deltaSeconds);
  }

  public dispose(): void {
    if (this.mixer && this.root) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.root);
    }
    this.mixer = null;
    this.root = null;
    this.clips = [];
    this.selectedIndex = -1;
    this.activeAction = null;
    this.state = "stopped";
  }

  private playSelected(preserveState: boolean): void {
    if (!this.mixer) return;
    const clip = this.clips[this.selectedIndex];
    if (!clip) return;

    const nextAction = this.mixer.clipAction(clip);
    applyLoopMode(nextAction, this.loopMode);

    nextAction.reset();
    nextAction.play();

    if (this.activeAction && this.activeAction !== nextAction) {
      this.activeAction.stop();
    }

    this.activeAction = nextAction;

    if (!preserveState) return;
    if (this.state === "paused") this.mixer.timeScale = 0;
  }
}

function applyLoopMode(action: THREE.AnimationAction, mode: LoopMode): void {
  if (mode === "once") {
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
  } else {
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

