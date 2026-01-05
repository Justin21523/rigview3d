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

  public setSource(root: THREE.Object3D | null, clips: THREE.AnimationClip[]): void {
    // Replace the current model/clip source and reset all playback state.
    this.dispose(); // Always tear down the previous mixer/actions first (prevents leaks and cross-model references).

    this.root = root; // Store the new root reference.
    this.clips = clips; // Store the new clips list.
    this.selectedIndex = clips.length > 0 ? 0 : -1; // Default to the first clip if any exist.
    this.speed = 1; // Reset speed to 1x for new models.
    this.loopMode = "repeat"; // Default loop mode for new models.
    this.state = "stopped"; // Start in a stopped state until the user presses Play.

    if (root && clips.length > 0) {
      // Only create a mixer if there is something to animate.
      this.mixer = new THREE.AnimationMixer(root); // Create a mixer that targets the entire model hierarchy.
      this.mixer.timeScale = this.speed; // Initialize timeScale so speed controls work consistently.
    }
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

  public selectClip(index: number): void {
    // Change the selected clip; if currently playing/paused, switch playback to the new clip.
    if (!this.mixer) return; // Without a mixer, there is nothing to play or switch.
    if (index < 0 || index >= this.clips.length) return; // Guard against invalid indices from the UI.

    this.selectedIndex = index; // Update selection.

    if (this.state === "stopped") return; // If stopped, do not auto-play; just change selection.
    this.playSelected(/* preserveState */ true); // If playing/paused, swap to the new clip while preserving pause state.
  }

  public play(): void {
    // Start (or restart) playback of the selected clip.
    if (!this.mixer) return; // No mixer means no model/clips loaded.
    if (this.clips.length === 0) return; // No clips means nothing to play.
    if (this.selectedIndex < 0) this.selectedIndex = 0; // Defensive: ensure a valid selection.

    this.playSelected(/* preserveState */ false); // Start selected clip from the beginning.
    this.state = "playing"; // Update state for UI.
    this.mixer.timeScale = this.speed; // Ensure mixer is running at the requested speed.
  }

  public togglePause(): void {
    // Toggle between playing and paused states.
    if (!this.mixer) return; // No mixer means nothing to pause.
    if (this.state === "stopped") return; // You can't pause something that isn't playing.

    if (this.state === "playing") {
      // If currently playing...
      this.mixer.timeScale = 0; // ...pause by stopping time progression (actions keep their current pose).
      this.state = "paused"; // Update UI state.
      return; // Done.
    }

    this.mixer.timeScale = this.speed; // Resume by restoring timeScale (speed).
    this.state = "playing"; // Update UI state.
  }

  public stop(): void {
    // Stop playback and reset state to "stopped".
    if (!this.mixer) return; // No mixer means nothing to stop.
    this.mixer.stopAllAction(); // Stop all actions (removes their influence from the model).
    this.activeAction = null; // Clear the active action reference.
    this.state = "stopped"; // Update state for UI.
  }

  public setSpeed(speed: number): void {
    // Set playback speed; speed affects timeScale (how fast time moves for animations).
    this.speed = clamp(speed, 0.01, 10); // Clamp to a reasonable range to avoid weird values or division by zero.
    if (!this.mixer) return; // If no mixer, just store the value for later.
    if (this.state !== "paused") this.mixer.timeScale = this.speed; // Don't override pause (pause uses timeScale=0).
  }

  public setLoopMode(mode: LoopMode): void {
    // Set the loop behavior for the active action and future actions.
    this.loopMode = mode; // Store the selected loop mode.
    if (this.activeAction) applyLoopMode(this.activeAction, mode); // Apply immediately to the current action if it exists.
  }

  public update(deltaSeconds: number): void {
    // Advance animation by one frame (called from Viewer tick).
    if (!this.mixer) return; // No mixer means nothing to update.
    this.mixer.update(deltaSeconds); // Mixer updates all bound actions by delta time.
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
  }

  private playSelected(preserveState: boolean): void {
    // Internal helper: start playback of `selectedIndex` and optionally preserve paused state.
    if (!this.mixer) return; // Guard: cannot play without mixer.
    const clip = this.clips[this.selectedIndex]; // Resolve the selected clip from the list.
    if (!clip) return; // Guard: no clip resolved.

    const nextAction = this.mixer.clipAction(clip); // Create (or reuse) an AnimationAction for this clip.
    applyLoopMode(nextAction, this.loopMode); // Apply current loop settings to the action.

    nextAction.reset(); // Reset action time back to 0 so it starts from the beginning.
    nextAction.play(); // Enable action so it contributes to the animated pose.

    if (this.activeAction && this.activeAction !== nextAction) {
      // If another action was previously active, stop it so clips don't blend unintentionally.
      this.activeAction.stop(); // Stop the previous action.
    }

    this.activeAction = nextAction; // Store the new active action reference.

    if (!preserveState) return; // If we don't need to preserve, we are done.
    if (this.state === "paused") this.mixer.timeScale = 0; // If we were paused, keep the mixer paused after switching clips.
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
