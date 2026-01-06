// src/core/animator.ts
// Animator wraps Three.js' animation system (AnimationMixer + AnimationAction)
// into a small, UI-friendly API:
// - Provide a model root + clips via `setSource(...)`
// - Choose a clip
// - Play / Pause / Stop
// - Adjust speed (timeScale)
// - Switch loop behavior (repeat vs once)
//
// This keeps animation state out of the UI layer and makes cleanup predictable.

import * as THREE from "three"; // Import AnimationMixer, AnimationClip, and constants like LoopOnce/LoopRepeat.

export type LoopMode = "repeat" | "once"; // UI-friendly loop modes supported by this app.
export type PlayState = "stopped" | "playing" | "paused"; // High-level playback states for UI updates.

export type TimelineState = {
  // Snapshot of timeline-related values exposed to the UI.
  time: number; // Current playback time in seconds (relative to the active clip).
  duration: number; // Active clip duration in seconds.
  rangeStart: number; // Playback range start in seconds.
  rangeEnd: number; // Playback range end in seconds.
  state: PlayState; // Current play state.
}; // End TimelineState type.

export class Animator {
  // Encapsulates the lifecycle of AnimationMixer and the currently active AnimationAction.
  private mixer: THREE.AnimationMixer | null = null; // AnimationMixer drives animation updates for a specific root object.
  private root: THREE.Object3D | null = null; // The root object passed to the mixer (used for uncache/dispose).
  private clips: THREE.AnimationClip[] = []; // All available clips for the current model.
  private selectedIndex = -1; // Index of the currently selected clip (-1 means none).
  private activeAction: THREE.AnimationAction | null = null; // The currently playing action, if any.

  private speed = 1; // Playback speed multiplier (mapped to mixer.timeScale).
  private loopMode: LoopMode = "repeat"; // Current loop mode for new/active actions.
  private state: PlayState = "stopped"; // Current high-level play state.

  private time = 0; // Current timeline time in seconds for the selected clip.
  private duration = 0; // Duration of the currently selected clip.
  private rangeStart = 0; // Playback range start in seconds.
  private rangeEnd = 0; // Playback range end in seconds.
  private crossfadeSeconds = 0.2; // Default crossfade duration when switching clips while playing.

  private readonly timelineListeners = new Set<(state: TimelineState) => void>(); // Subscribers for timeline updates.

  public setSource(root: THREE.Object3D | null, clips: THREE.AnimationClip[]): void {
    // Replace the current model/clip source and reset all playback state.
    this.dispose(); // Always tear down the previous mixer/actions first (prevents leaks and cross-model references).

    this.root = root; // Store the new root reference.
    this.clips = clips; // Store the new clips list.
    this.selectedIndex = clips.length > 0 ? 0 : -1; // Default to the first clip if any exist.
    this.speed = 1; // Reset speed to 1x for new models.
    this.loopMode = "repeat"; // Default loop mode for new models.
    this.state = "stopped"; // Start in a stopped state until the user presses Play.
    this.crossfadeSeconds = 0.2; // Reset crossfade to a sensible default.

    this.duration = this.selectedIndex >= 0 ? clips[this.selectedIndex]?.duration ?? 0 : 0; // Cache selected clip duration.
    this.rangeStart = 0; // Reset range to clip start.
    this.rangeEnd = this.duration; // Reset range to full duration.
    this.time = this.rangeStart; // Reset current time to range start.

    if (root && clips.length > 0) {
      // Only create a mixer if there is something to animate.
      this.mixer = new THREE.AnimationMixer(root); // Create a mixer that targets the entire model hierarchy.
      this.mixer.timeScale = 0; // Stopped state: keep timeScale=0 so `update()` does not advance time.
      this.ensureActiveAction(); // Create a preview action so timeline scrubbing works immediately.
      this.seek(this.time); // Apply the initial pose at time=0.
    }

    this.emitTimeline(); // Notify UI that a new source (and timeline) is available.
  }

  public getClips(): THREE.AnimationClip[] {
    // Expose the clip list to the UI for populating the dropdown.
    return this.clips; // Return the internal array reference (treat as read-only by convention).
  }

  public getSelectedIndex(): number {
    // UI uses this to keep the `<select>` in sync with internal state.
    return this.selectedIndex; // Return the current selection index.
  }

  public getSpeed(): number {
    // UI uses this to keep the speed slider/value label in sync.
    return this.speed; // Return current speed multiplier.
  }

  public getLoopMode(): LoopMode {
    // UI uses this to keep the loop checkbox in sync.
    return this.loopMode; // Return current loop mode.
  }

  public getPlayState(): PlayState {
    // UI uses this to label the pause button (Pause vs Resume) and enable/disable Stop.
    return this.state; // Return current playback state.
  }

  public getTime(): number {
    // Return current timeline time (seconds).
    return this.time; // Expose internal time for the scrub UI.
  }

  public getDuration(): number {
    // Return the currently selected clip duration (seconds).
    return this.duration; // Duration is 0 when no clip is selected.
  }

  public getRangeStart(): number {
    // Return current playback range start (seconds).
    return this.rangeStart; // Expose for UI.
  }

  public getRangeEnd(): number {
    // Return current playback range end (seconds).
    return this.rangeEnd; // Expose for UI.
  }

  public setTime(seconds: number): void {
    // Seek the timeline to a specific time (used by the scrub slider).
    this.time = this.clampToRange(seconds); // Clamp to current range.
    this.ensureActiveAction(); // Ensure we have an action to display poses even when "stopped".
    this.seek(this.time); // Apply pose at the requested time.
    this.emitTimeline(); // Notify UI so labels/slider stay in sync.
  }

  public setRangeStart(seconds: number): void {
    // Set the playback range start, clamped to [0, duration].
    const nextStart = clamp(seconds, 0, this.duration); // Clamp to clip duration.
    const nextEnd = Math.max(nextStart, this.rangeEnd); // Ensure end stays >= start.
    this.rangeStart = nextStart; // Store.
    this.rangeEnd = nextEnd; // Store.
    this.setTime(this.time); // Re-clamp current time and apply pose if needed.
    this.emitTimeline(); // Notify UI.
  }

  public setRangeEnd(seconds: number): void {
    // Set the playback range end, clamped to [0, duration].
    const nextEnd = clamp(seconds, 0, this.duration); // Clamp to clip duration.
    const nextStart = Math.min(this.rangeStart, nextEnd); // Ensure start stays <= end.
    this.rangeStart = nextStart; // Store.
    this.rangeEnd = nextEnd; // Store.
    this.setTime(this.time); // Re-clamp current time and apply pose if needed.
    this.emitTimeline(); // Notify UI.
  }

  public setCrossfadeSeconds(seconds: number): void {
    // Set the crossfade duration used when switching clips while playing.
    this.crossfadeSeconds = clamp(seconds, 0, 10); // Clamp to a sane range.
  }

  public getCrossfadeSeconds(): number {
    // Expose crossfade duration for UI initialization.
    return this.crossfadeSeconds; // Return stored seconds.
  }

  public onTimelineChange(listener: (state: TimelineState) => void): () => void {
    // Subscribe to timeline updates (time/duration/range changes during playback or scrubbing).
    this.timelineListeners.add(listener); // Register listener.
    return () => this.timelineListeners.delete(listener); // Return unsubscribe function.
  }

  public selectClip(index: number): void {
    // Change the selected clip; if currently playing/paused, switch playback to the new clip.
    if (index < 0 || index >= this.clips.length) return; // Guard against invalid indices from the UI.
    if (this.selectedIndex === index) return; // No-op if selection did not change.

    this.selectedIndex = index; // Update selection.
    this.duration = this.clips[this.selectedIndex]?.duration ?? 0; // Update duration cache.
    this.rangeStart = 0; // Reset range on clip change (simple and predictable).
    this.rangeEnd = this.duration; // Full duration by default.
    this.time = this.rangeStart; // Reset time to the start of the clip.

    if (!this.mixer) {
      // No mixer means no root/clips were bound (should not happen if clips exist, but keep safe).
      this.emitTimeline(); // Still notify UI of the metadata change.
      return; // Done.
    }

    const prev = this.activeAction; // Snapshot the previous action for crossfade.
    const next = this.ensureActiveAction(); // Create (or reuse) the action for the new selected clip.
    if (!next) {
      // If we could not create an action, just emit UI state.
      this.emitTimeline(); // Notify UI.
      return; // Done.
    }

    // Always restart at the range start when switching clips (scrub slider also resets).
    next.reset(); // Reset clip time to 0.
    next.play(); // Ensure the action is active so we can scrub/preview.
    this.seek(this.time); // Apply pose at start time.

    if (prev && prev !== next && (this.state === "playing" || this.state === "paused") && this.crossfadeSeconds > 0) {
      // Crossfade only makes sense when we were already playing/paused on another clip.
      next.crossFadeFrom(prev, this.crossfadeSeconds, true); // Smoothly blend from prev -> next over crossfadeSeconds.
    } else if (prev && prev !== next) {
      // No crossfade: stop the previous action so it stops influencing the pose.
      prev.stop(); // Remove previous clip influence.
    }

    // Preserve pause/play state by controlling mixer.timeScale.
    if (this.state === "playing") this.mixer.timeScale = this.speed; // Keep running if playing.
    else this.mixer.timeScale = 0; // Paused/stopped keep timeScale at 0.

    this.emitTimeline(); // Notify UI that duration/range/time changed.
  }

  public play(): void {
    // Start (or restart) playback of the selected clip.
    if (!this.mixer) return; // No mixer means no model/clips loaded.
    if (this.clips.length === 0) return; // No clips means nothing to play.
    if (this.selectedIndex < 0) this.selectedIndex = 0; // Defensive: ensure a valid selection.

    this.ensureActiveAction(); // Ensure an action exists for the selected clip.
    this.state = "playing"; // Update state for UI.
    this.mixer.timeScale = this.speed; // Ensure mixer is running at the requested speed.
    this.emitTimeline(); // Notify UI.
  }

  public togglePause(): void {
    // Toggle between playing and paused states.
    if (!this.mixer) return; // No mixer means nothing to pause.
    if (this.state === "stopped") return; // You can't pause something that isn't playing.

    if (this.state === "playing") {
      // If currently playing...
      this.mixer.timeScale = 0; // ...pause by stopping time progression (actions keep their current pose).
      this.state = "paused"; // Update UI state.
      this.emitTimeline(); // Notify UI so state label can update.
      return; // Done.
    }

    this.mixer.timeScale = this.speed; // Resume by restoring timeScale (speed).
    this.state = "playing"; // Update UI state.
    this.emitTimeline(); // Notify UI so state label can update.
  }

  public stop(): void {
    // Stop playback and reset state to "stopped".
    if (!this.mixer) return; // No mixer means nothing to stop.
    this.mixer.stopAllAction(); // Stop all actions (removes their influence from the model).
    this.activeAction = null; // Clear action so ensureActiveAction() recreates a clean preview action.
    this.state = "stopped"; // Update state for UI.
    this.mixer.timeScale = 0; // Stop advancing time.
    this.time = this.rangeStart; // Reset time to range start (usually 0).
    this.ensureActiveAction(); // Recreate a preview action so the first frame is shown.
    this.seek(this.time); // Apply the start pose immediately.
    this.emitTimeline(); // Notify UI.
  }

  public setSpeed(speed: number): void {
    // Set playback speed; speed affects timeScale (how fast time moves for animations).
    this.speed = clamp(speed, 0.01, 10); // Clamp to a reasonable range to avoid weird values or division by zero.
    if (!this.mixer) return; // If no mixer, just store the value for later.
    if (this.state === "playing") this.mixer.timeScale = this.speed; // Only apply to mixer when actually playing (paused/stopped keep timeScale=0).
  }

  public setLoopMode(mode: LoopMode): void {
    // Set the loop behavior for the active action and future actions.
    this.loopMode = mode; // Store the selected loop mode.
    if (this.activeAction) applyLoopMode(this.activeAction, mode); // Apply immediately to the current action if it exists.
    this.emitTimeline(); // Notify UI (range looping logic depends on loop mode).
  }

  public update(deltaSeconds: number): void {
    // Advance animation by one frame (called from Viewer tick).
    if (!this.mixer) return; // No mixer means nothing to update.
    this.mixer.update(deltaSeconds); // Mixer updates all bound actions by delta time (timeScale controls play/pause).

    const action = this.activeAction; // Snapshot active action reference.
    if (!action) return; // No action means nothing to clamp/update.

    // Mirror the action time into our UI-facing timeline value.
    this.time = action.time; // Action time is in seconds relative to the clip.

    // Enforce user-defined playback range.
    this.enforceRange(); // Clamp or wrap time when outside [rangeStart, rangeEnd].

    this.emitTimeline(); // Emit timeline updates so the UI can keep the scrubber/time label in sync.
  }

  public dispose(): void {
    // Fully tear down animation state so we can load a new model without leaks.
    if (this.mixer && this.root) {
      // If we have an active mixer/root...
      this.mixer.stopAllAction(); // ...stop all actions to remove pose influence.
      this.mixer.uncacheRoot(this.root); // ...release cached bindings for this root (important for repeated loads).
    }
    this.mixer = null; // Drop mixer reference.
    this.root = null; // Drop root reference.
    this.clips = []; // Clear clips list.
    this.selectedIndex = -1; // Reset selection.
    this.activeAction = null; // Reset active action.
    this.state = "stopped"; // Reset play state.
    this.time = 0; // Reset time.
    this.duration = 0; // Reset duration.
    this.rangeStart = 0; // Reset range.
    this.rangeEnd = 0; // Reset range.
  }

  private ensureActiveAction(): THREE.AnimationAction | null {
    // Ensure we have an AnimationAction for the currently selected clip.
    if (!this.mixer) return null; // Without a mixer, we can't create actions.
    const clip = this.clips[this.selectedIndex]; // Resolve selected clip.
    if (!clip) return null; // Guard.

    const action = this.mixer.clipAction(clip); // Create (or reuse) action for this clip.
    applyLoopMode(action, this.loopMode); // Apply loop settings.
    action.enabled = true; // Ensure it contributes to the pose when evaluated.
    action.play(); // Make sure the action is active (needed for scrubbing while stopped).
    this.activeAction = action; // Store as current action.
    return action; // Return action for callers.
  }

  private seek(seconds: number): void {
    // Apply the pose at a specific clip time without advancing time.
    if (!this.mixer) return; // Guard.
    const action = this.ensureActiveAction(); // Ensure we have an active action to seek.
    if (!action) return; // Guard.
    action.time = clamp(seconds, 0, this.duration); // Set action time (Three.js uses seconds).
    this.mixer.update(0); // Evaluate at the new time (delta=0 means "re-sample pose").
  }

  private clampToRange(seconds: number): number {
    // Clamp a time value into the current playback range.
    const start = clamp(this.rangeStart, 0, this.duration); // Clamp range start defensively.
    const end = clamp(this.rangeEnd, 0, this.duration); // Clamp range end defensively.
    const lo = Math.min(start, end); // Ensure ordering.
    const hi = Math.max(start, end); // Ensure ordering.
    return clamp(seconds, lo, hi); // Clamp into [lo, hi].
  }

  private enforceRange(): void {
    // Clamp/wrap `this.time` into [rangeStart, rangeEnd] and apply the corrected pose if needed.
    const action = this.activeAction; // Snapshot.
    if (!action || !this.mixer) return; // Guard.
    if (this.duration <= 0) return; // Guard: no duration.

    const start = clamp(this.rangeStart, 0, this.duration); // Defensive clamp.
    const end = clamp(this.rangeEnd, 0, this.duration); // Defensive clamp.
    const lo = Math.min(start, end); // Normalize ordering.
    const hi = Math.max(start, end); // Normalize ordering.
    const len = Math.max(hi - lo, 1e-6); // Range length (avoid divide by zero).

    if (action.time < lo - 1e-6) {
      // If we somehow went before range start, clamp forward.
      action.time = lo; // Clamp.
      this.mixer.update(0); // Re-evaluate pose.
      this.time = action.time; // Sync time.
      return; // Done.
    }

    if (action.time <= hi + 1e-6) return; // Still within range (common case).

    if (this.loopMode === "repeat") {
      // Wrap time back into the range (loop within the user-defined window).
      const wrapped = lo + ((action.time - lo) % len); // Wrap time into [lo, hi).
      action.time = wrapped; // Apply wrapped time.
      this.mixer.update(0); // Re-evaluate pose.
      this.time = action.time; // Sync.
      return; // Done.
    }

    // Loop once: clamp at the end of the range and stop advancing.
    action.time = hi; // Clamp to end.
    this.mixer.update(0); // Re-evaluate pose.
    this.time = action.time; // Sync.
    this.state = "stopped"; // Treat as stopped so UI can reflect that playback ended.
    this.mixer.timeScale = 0; // Stop advancing time.
  }

  private emitTimeline(): void {
    // Notify listeners of the current timeline state (used by the scrub UI).
    const snapshot: TimelineState = {
      time: this.time,
      duration: this.duration,
      rangeStart: this.rangeStart,
      rangeEnd: this.rangeEnd,
      state: this.state,
    };
    this.timelineListeners.forEach((fn) => fn(snapshot)); // Emit to all subscribers.
  }
}

function applyLoopMode(action: THREE.AnimationAction, mode: LoopMode): void {
  // Convert our UI-friendly mode into Three.js loop constants on an action.
  if (mode === "once") {
    // Play one time and then stop.
    action.setLoop(THREE.LoopOnce, 1); // LoopOnce with a repeat count of 1.
    action.clampWhenFinished = true; // Keep the last pose when the action finishes.
  } else {
    // Repeat forever.
    action.setLoop(THREE.LoopRepeat, Infinity); // LoopRepeat with infinite repetitions.
    action.clampWhenFinished = false; // Allow action to continue looping normally.
  }
}

function clamp(value: number, min: number, max: number): number {
  // Utility to constrain a numeric value to a range.
  return Math.min(max, Math.max(min, value)); // Clamp by applying max then min.
}
