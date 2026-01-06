// src/ui/controls.ts
// This module owns DOM wiring: it finds elements in `index.html`, attaches event listeners,
// and coordinates between user actions (clicks, drag-and-drop, inputs) and the core logic.
//
// Principles:
// - Keep `src/main.ts` small: it just composes objects and calls `initControls`.
// - Keep Three.js logic out of the DOM layer: the UI calls small methods on core modules.
// - Treat the UI layer as "glue code": it should not own rendering, animation math, or GPU cleanup logic.

import * as THREE from "three"; // Import Three.js types for runtime checks and traversal helpers.
import type { Animator } from "../core/animator"; // Import Animator type (runtime code lives in core/animator.ts).
import type { Editor } from "../core/editor/editor"; // Import Editor type (selection + hierarchy root state).
import { disposeObject3D } from "../core/dispose"; // Import disposal utility to prevent GPU memory leaks on reload.
import type { Helpers } from "../core/helpers"; // Import Helpers type for debug toggles (grid/axes/skeleton/wireframe).
import type { ModelLoader } from "../core/loader"; // Import ModelLoader type (handles .glb/.gltf/.fbx local loading).
import { updateDebugSettings } from "../core/settings"; // Import settings persistence helper for Debug toggles.
import type { Viewer } from "../core/viewer"; // Import Viewer type (scene/camera/renderer/loop wrapper).

export function initControls({
  // Public API: one call that wires all DOM behavior for the app.
  viewer, // The Viewer instance (used for reset camera, framing, scene add/remove, render list disposal).
  loader, // The ModelLoader instance (used to load GLB/GLTF/FBX from dropped files).
  animator, // The Animator instance (used to manage clips and playback).
  helpers, // The Helpers instance (used to toggle debug helpers).
  editor, // The Editor instance (selection + hierarchy root state).
}: {
  viewer: Viewer; // Type annotation for viewer.
  loader: ModelLoader; // Type annotation for loader.
  animator: Animator; // Type annotation for animator.
  helpers: Helpers; // Type annotation for helpers.
  editor: Editor; // Type annotation for editor.
}): void {
  const resetButton = document.getElementById("btn-reset-camera"); // Find the reset camera button in the top bar.
  resetButton?.addEventListener("click", () => viewer.resetCamera()); // Reset camera when clicked (safe with optional chaining).

  const dropzone = mustGetEl("dropzone"); // Drop target element for drag-and-drop model loading.
  const fileInput = mustGetEl("file-input") as HTMLInputElement; // Hidden `<input type="file">` used for click-to-browse.

  const infoFile = mustGetEl("info-file"); // UI cell for the current file name / error state.
  const infoMeshes = mustGetEl("info-meshes"); // UI cell for mesh count.
  const infoMaterials = mustGetEl("info-materials"); // UI cell for material count.
  const infoBones = mustGetEl("info-bones"); // UI cell for bone count.
  const infoClips = mustGetEl("info-clips"); // UI cell for animation clip count.

  const clipSelect = mustGetEl("anim-clip") as HTMLSelectElement; // `<select>` listing animation clips.
  const playBtn = mustGetEl("anim-play") as HTMLButtonElement; // Play button.
  const pauseBtn = mustGetEl("anim-pause") as HTMLButtonElement; // Pause/Resume button.
  const stopBtn = mustGetEl("anim-stop") as HTMLButtonElement; // Stop button.
  const speedInput = mustGetEl("anim-speed") as HTMLInputElement; // `<input type="range">` for speed.
  const speedValue = mustGetEl("anim-speed-value"); // Text element that displays the current speed as "1.00x".
  const loopCheckbox = mustGetEl("anim-loop") as HTMLInputElement; // Checkbox controlling loop mode (repeat vs once).

  const gridCheckbox = mustGetEl("dbg-grid") as HTMLInputElement; // Toggle for GridHelper visibility.
  const axesCheckbox = mustGetEl("dbg-axes") as HTMLInputElement; // Toggle for AxesHelper visibility.
  const skeletonCheckbox = mustGetEl("dbg-skeleton") as HTMLInputElement; // Toggle for SkeletonHelper visibility.
  const wireframeCheckbox = mustGetEl("dbg-wireframe") as HTMLInputElement; // Toggle for wireframe rendering.

  let currentModelRoot: THREE.Object3D | null = null; // Keep track of the currently loaded model so we can remove/dispose it.

  const setDragOver = (active: boolean) => {
    // Add/remove a CSS class so the dropzone can visually respond to dragging.
    dropzone.classList.toggle("is-dragover", active); // Toggle the class based on the boolean.
  }; // End helper function.

  const loadFiles = async (files: File[]) => {
    // Main workflow: load dropped/selected files and update scene + UI.
    if (files.length === 0) return; // Ignore empty drops/selections.

    const previousRoot = currentModelRoot; // Snapshot currently loaded model (if any) so we can keep it on load failure.
    const previousInfo = {
      // Snapshot Info panel values so we can restore them if loading fails.
      file: infoFile.textContent ?? "—", // Previous file label.
      meshes: infoMeshes.textContent ?? "—", // Previous mesh count.
      materials: infoMaterials.textContent ?? "—", // Previous material count.
      bones: infoBones.textContent ?? "—", // Previous bone count.
      clips: infoClips.textContent ?? "—", // Previous clip count.
    }; // End snapshot object.

    try {
      infoFile.textContent = "Loading…"; // Give the user feedback immediately.
      const result = await loader.loadFromFiles(files); // Load the model using ModelLoader (handles .gltf dependencies).

      if (previousRoot) viewer.getScene().remove(previousRoot); // Remove previous model from the scene graph first (stops rendering it).

      currentModelRoot = result.root; // Store the new model root.
      viewer.getScene().add(currentModelRoot); // Add the new model to the scene so it renders.
      viewer.frameObject(currentModelRoot); // Auto-frame the model so it fits in the viewport.

      editor.setModelRoot(currentModelRoot); // Tell the editor about the new active model so hierarchy/selection stay in sync.
      editor.setSourceFileName(result.fileName); // Store original filename so Export can propose a friendly output name.
      helpers.setModelRoot(currentModelRoot); // Tell helpers about the new model (skeleton/wireframe operate on the active root).

      animator.setSource(result.root, result.animations); // Bind animation mixer to the new model and its clips.
      rebuildClipOptions(animator.getClips(), clipSelect); // Populate the clip dropdown based on available clips.
      syncAnimUi(animator, {
        // Synchronize UI enabled/disabled states and labels with Animator state.
        clipSelect, // Pass the dropdown element.
        playBtn, // Pass Play button.
        pauseBtn, // Pass Pause/Resume button.
        stopBtn, // Pass Stop button.
        speedInput, // Pass speed slider.
        speedValue, // Pass speed text.
        loopCheckbox, // Pass loop checkbox.
      }); // End sync call.

      const stats = getModelStats(result.root, result.animations); // Compute basic counts for the Info panel and debug toggle enablement.
      infoFile.textContent = result.fileName; // Display loaded filename.
      infoMeshes.textContent = String(stats.meshes); // Display mesh count.
      infoMaterials.textContent = String(stats.materials); // Display material count.
      infoBones.textContent = String(stats.bones); // Display bone count.
      infoClips.textContent = String(stats.clips); // Display clip count.

      skeletonCheckbox.disabled = !stats.hasSkinnedMesh; // Only enable skeleton toggle if the model contains a SkinnedMesh.
      wireframeCheckbox.disabled = stats.meshes === 0; // Wireframe toggle only makes sense if there are meshes.

      helpers.setGridVisible(gridCheckbox.checked); // Apply current grid toggle to the helper object.
      helpers.setAxesVisible(axesCheckbox.checked); // Apply current axes toggle to the helper object.
      helpers.setSkeletonVisible(skeletonCheckbox.checked); // Apply current skeleton toggle (may create/dispose helper).
      helpers.setWireframeEnabled(wireframeCheckbox.checked); // Apply current wireframe toggle to all model materials.

      if (previousRoot) {
        // Cleanup for repeated reloads: free GPU resources used by the previous model.
        disposeObject3D(previousRoot); // Dispose geometries/materials/textures in the old model tree.
        viewer.disposeRenderLists(); // Clear renderer internal caches that can keep references to disposed resources.
      }
    } catch (err) {
      // Handle errors gracefully and reset UI state.
      const message = err instanceof Error ? err.message : String(err); // Normalize error to a string message.
      console.error(err); // Log the full error for debugging.

      if (previousRoot) {
        // If we already had a model loaded, keep it and just restore UI (Unity-like behavior).
        infoFile.textContent = `${previousInfo.file} (Load error: ${message})`; // Show error while keeping the previous filename visible.
        infoMeshes.textContent = previousInfo.meshes; // Restore mesh count.
        infoMaterials.textContent = previousInfo.materials; // Restore material count.
        infoBones.textContent = previousInfo.bones; // Restore bone count.
        infoClips.textContent = previousInfo.clips; // Restore clip count.
        return; // Do not reset core state since the previous model is still active.
      }

      infoFile.textContent = `Error: ${message}`; // Display a readable error in the Info panel.
      infoMeshes.textContent = "—"; // Reset meshes display.
      infoMaterials.textContent = "—"; // Reset materials display.
      infoBones.textContent = "—"; // Reset bones display.
      infoClips.textContent = "—"; // Reset clips display.

      animator.setSource(null, []); // Reset animator so controls become disabled and no mixer remains.
      rebuildClipOptions([], clipSelect); // Reset clip dropdown to a "no clips" option.
      syncAnimUi(animator, {
        // Re-sync UI elements to the reset animator state.
        clipSelect, // Dropdown element.
        playBtn, // Play button.
        pauseBtn, // Pause button.
        stopBtn, // Stop button.
        speedInput, // Speed slider.
        speedValue, // Speed text.
        loopCheckbox, // Loop checkbox.
      }); // End sync call.

      helpers.setModelRoot(null); // Clear model binding for helpers (removes skeleton helper, etc.).
      editor.setModelRoot(null); // Clear editor root so hierarchy/selection reset to empty state.
      skeletonCheckbox.disabled = true; // Disable skeleton toggle until a valid skinned model is loaded.
      wireframeCheckbox.disabled = true; // Disable wireframe toggle until a valid mesh model is loaded.
    }
  }; // End loadFiles function.

  const openFilePicker = () => fileInput.click(); // Helper: programmatically open the native file chooser.

  dropzone.addEventListener("click", openFilePicker); // Clicking the dropzone opens the file picker (nice UX fallback).
  dropzone.addEventListener("keydown", (e) => {
    // Keyboard accessibility: allow Enter/Space to activate the dropzone like a button.
    if (e.key === "Enter" || e.key === " ") openFilePicker(); // Trigger file picker for common "activate" keys.
  });

  fileInput.addEventListener("change", () => {
    // When the user picks files via the file chooser...
    void loadFiles(Array.from(fileInput.files ?? [])); // Convert FileList to array and load (void ignores the returned Promise).
    fileInput.value = ""; // Clear value so selecting the same files again still triggers a change event.
  });

  window.addEventListener("dragover", (e) => e.preventDefault()); // Prevent default so the browser doesn't open files directly.

  dropzone.addEventListener("dragenter", (e) => {
    // Highlight dropzone when dragged files enter it.
    e.preventDefault(); // Prevent browser default handling.
    setDragOver(true); // Turn on visual highlight.
  });
  dropzone.addEventListener("dragover", (e) => {
    // Keep highlight active while dragging over.
    e.preventDefault(); // Prevent browser default handling.
    setDragOver(true); // Ensure highlight stays on.
  });
  dropzone.addEventListener("dragleave", () => setDragOver(false)); // Turn off highlight when dragged files leave the element.
  dropzone.addEventListener("drop", (e) => {
    // Handle the actual drop event.
    e.preventDefault(); // Prevent browser from navigating to the dropped file.
    setDragOver(false); // Remove visual highlight.
    const files = Array.from(e.dataTransfer?.files ?? []); // Extract dropped files from the DataTransfer API.
    void loadFiles(files); // Load the dropped files.
  });

  clipSelect.addEventListener("change", () => {
    // When the user selects a different animation clip...
    animator.selectClip(Number(clipSelect.value)); // Update animator selection (may restart action if currently playing).
    syncAnimUi(animator, {
      // Update UI state (e.g., button labels) after selection.
      clipSelect, // Dropdown element.
      playBtn, // Play button.
      pauseBtn, // Pause button.
      stopBtn, // Stop button.
      speedInput, // Speed slider.
      speedValue, // Speed label.
      loopCheckbox, // Loop checkbox.
    });
  });

  playBtn.addEventListener("click", () => {
    // Start playback when the user clicks Play.
    animator.play(); // Ask animator to play the currently selected clip.
    syncAnimUi(animator, {
      // Sync UI so Pause/Stop enablement is correct.
      clipSelect, // Dropdown element.
      playBtn, // Play button.
      pauseBtn, // Pause button.
      stopBtn, // Stop button.
      speedInput, // Speed slider.
      speedValue, // Speed label.
      loopCheckbox, // Loop checkbox.
    });
  });

  pauseBtn.addEventListener("click", () => {
    // Toggle pause/resume.
    animator.togglePause(); // Pause by setting timeScale=0, or resume by restoring speed.
    syncAnimUi(animator, {
      // Update Pause button label (Pause vs Resume).
      clipSelect, // Dropdown element.
      playBtn, // Play button.
      pauseBtn, // Pause button.
      stopBtn, // Stop button.
      speedInput, // Speed slider.
      speedValue, // Speed label.
      loopCheckbox, // Loop checkbox.
    });
  });

  stopBtn.addEventListener("click", () => {
    // Stop playback completely.
    animator.stop(); // Stop all actions and reset state.
    syncAnimUi(animator, {
      // Disable Stop and reset Pause label after stopping.
      clipSelect, // Dropdown element.
      playBtn, // Play button.
      pauseBtn, // Pause button.
      stopBtn, // Stop button.
      speedInput, // Speed slider.
      speedValue, // Speed label.
      loopCheckbox, // Loop checkbox.
    });
  });

  speedInput.addEventListener("input", () => {
    // Update speed continuously while dragging the slider.
    const speed = Number(speedInput.value); // Parse the slider value (string) into a number.
    animator.setSpeed(speed); // Store/apply speed to mixer.timeScale (unless paused).
    syncAnimUi(animator, {
      // Update the displayed "1.00x" label.
      clipSelect, // Dropdown element.
      playBtn, // Play button.
      pauseBtn, // Pause button.
      stopBtn, // Stop button.
      speedInput, // Speed slider.
      speedValue, // Speed label.
      loopCheckbox, // Loop checkbox.
    });
  });

  loopCheckbox.addEventListener("change", () => {
    // Switch between repeat and once loop modes.
    animator.setLoopMode(loopCheckbox.checked ? "repeat" : "once"); // Map checkbox to loop mode value.
    syncAnimUi(animator, {
      // UI may not change much, but we keep state consistent.
      clipSelect, // Dropdown element.
      playBtn, // Play button.
      pauseBtn, // Pause button.
      stopBtn, // Stop button.
      speedInput, // Speed slider.
      speedValue, // Speed label.
      loopCheckbox, // Loop checkbox.
    });
  });

  gridCheckbox.addEventListener("change", () => {
    // Persist and apply grid visibility.
    helpers.setGridVisible(gridCheckbox.checked); // Toggle grid visibility in the scene.
    updateDebugSettings({ grid: gridCheckbox.checked }); // Persist preference.
  });
  axesCheckbox.addEventListener("change", () => {
    // Persist and apply axes visibility.
    helpers.setAxesVisible(axesCheckbox.checked); // Toggle axes visibility in the scene.
    updateDebugSettings({ axes: axesCheckbox.checked }); // Persist preference.
  });
  skeletonCheckbox.addEventListener("change", () => {
    // Persist and apply skeleton helper visibility.
    helpers.setSkeletonVisible(skeletonCheckbox.checked); // Toggle skeleton visualization for the active model.
    updateDebugSettings({ skeleton: skeletonCheckbox.checked }); // Persist preference.
  });
  wireframeCheckbox.addEventListener("change", () => {
    // Persist and apply wireframe rendering.
    helpers.setWireframeEnabled(wireframeCheckbox.checked); // Toggle wireframe rendering for the active model.
    updateDebugSettings({ wireframe: wireframeCheckbox.checked }); // Persist preference.
  });

  rebuildClipOptions([], clipSelect); // Initialize clip dropdown with a "no clips" option.
  syncAnimUi(animator, {
    // Initialize animation UI state (disabled until a model with clips is loaded).
    clipSelect, // Dropdown element.
    playBtn, // Play button.
    pauseBtn, // Pause button.
    stopBtn, // Stop button.
    speedInput, // Speed slider.
    speedValue, // Speed label.
    loopCheckbox, // Loop checkbox.
  });

  helpers.setGridVisible(gridCheckbox.checked); // Apply initial grid state from DOM (which may be restored from settings).
  helpers.setAxesVisible(axesCheckbox.checked); // Apply initial axes state from DOM (which may be restored from settings).
  helpers.setSkeletonVisible(skeletonCheckbox.checked); // Apply initial skeleton desired state (no-op until a skinned model is loaded).
  helpers.setWireframeEnabled(wireframeCheckbox.checked); // Apply initial wireframe state (stored even if no model is loaded yet).
  skeletonCheckbox.disabled = true; // Disable skeleton toggle until we know the model has a SkinnedMesh.
  wireframeCheckbox.disabled = true; // Disable wireframe toggle until we know the model has meshes.
}

function mustGetEl(id: string): HTMLElement {
  // Convenience helper that guarantees an element exists (or throws early).
  const el = document.getElementById(id); // Find element by id in the current document.
  if (!el) throw new Error(`Missing element: #${id}`); // Throw an error if the UI markup is out of sync with code.
  return el; // Return the found element (non-null).
}

function getModelStats(
  root: THREE.Object3D, // The loaded model root.
  clips: THREE.AnimationClip[], // The list of animation clips from GLTFLoader.
): {
  meshes: number; // Total mesh count.
  materials: number; // Count of unique material instances.
  bones: number; // Total bone count.
  clips: number; // Clip count.
  hasSkinnedMesh: boolean; // Whether the model contains a SkinnedMesh (needed for skeleton visualization).
} {
  let meshes = 0; // Accumulator for mesh count.
  let bones = 0; // Accumulator for bone count.
  let hasSkinnedMesh = false; // Flag set when we encounter a SkinnedMesh.
  const materialSet = new Set<THREE.Material>(); // Set to deduplicate materials (same material may be shared by many meshes).

  root.traverse((obj) => {
    // Traverse every node in the model hierarchy.
    if ((obj as THREE.Mesh).isMesh) {
      // Mesh objects have the runtime flag `.isMesh`.
      meshes += 1; // Increment mesh count.
      const mesh = obj as THREE.Mesh; // Narrow type so we can access `.material`.
      const mat = mesh.material; // Material can be a single material or an array.
      if (Array.isArray(mat)) mat.forEach((m) => materialSet.add(m)); // Add each material to the set if multi-material.
      else if (mat) materialSet.add(mat); // Add the single material if present.
    }
    if ((obj as THREE.Bone).isBone) bones += 1; // Bones have `.isBone`; count them for the Info panel.
    if ((obj as THREE.SkinnedMesh).isSkinnedMesh) hasSkinnedMesh = true; // SkinnedMesh indicates a skeleton/skinning system exists.
  });

  return {
    // Return computed stats in a structured shape.
    meshes, // Total meshes.
    materials: materialSet.size, // Unique material instances.
    bones, // Total bones.
    clips: clips.length, // Total clips (from loader result).
    hasSkinnedMesh, // Whether skeleton visualization is possible.
  };
}

function rebuildClipOptions(
  clips: THREE.AnimationClip[], // Clips to show in the dropdown.
  select: HTMLSelectElement, // The `<select>` element to update.
): void {
  select.innerHTML = ""; // Clear any existing options (rebuild from scratch).
  if (clips.length === 0) {
    // If there are no clips, show a placeholder option and keep UI disabled.
    const opt = document.createElement("option"); // Create a new `<option>`.
    opt.value = "-1"; // Use -1 to represent "no selection".
    opt.textContent = "No animation clips"; // User-visible placeholder text.
    select.append(opt); // Add the option to the select.
    return; // Done.
  }

  clips.forEach((clip, index) => {
    // Create one option per clip.
    const opt = document.createElement("option"); // Create option element.
    opt.value = String(index); // Store index as string so we can parse it on change.
    opt.textContent = clip.name || `Clip ${index + 1}`; // Use the clip name if present, otherwise a fallback label.
    select.append(opt); // Add to the dropdown.
  });
}

function syncAnimUi(
  animator: Animator, // The animator that owns playback state.
  els: {
    // Group UI elements we need to enable/disable and update labels for.
    clipSelect: HTMLSelectElement; // Clip dropdown.
    playBtn: HTMLButtonElement; // Play button.
    pauseBtn: HTMLButtonElement; // Pause/Resume button.
    stopBtn: HTMLButtonElement; // Stop button.
    speedInput: HTMLInputElement; // Speed slider.
    speedValue: HTMLElement; // Speed label.
    loopCheckbox: HTMLInputElement; // Loop checkbox.
  }, // End element group type.
): void {
  const clips = animator.getClips(); // Read the current clip list.
  const hasClips = clips.length > 0; // Determine whether animation controls should be enabled.

  els.clipSelect.disabled = !hasClips; // Disable dropdown when no clips exist.
  els.playBtn.disabled = !hasClips; // Disable Play when no clips exist.
  els.pauseBtn.disabled = !hasClips; // Disable Pause when no clips exist.
  els.stopBtn.disabled = !hasClips; // Disable Stop when no clips exist.
  els.speedInput.disabled = !hasClips; // Disable speed slider when no clips exist.
  els.loopCheckbox.disabled = !hasClips; // Disable loop toggle when no clips exist.

  const selectedIndex = animator.getSelectedIndex(); // Read current selection index from animator.
  if (hasClips && selectedIndex >= 0) els.clipSelect.value = String(selectedIndex); // Keep dropdown value consistent with state.

  const speed = animator.getSpeed(); // Read speed multiplier.
  els.speedInput.value = String(speed); // Keep slider position consistent.
  els.speedValue.textContent = `${speed.toFixed(2)}x`; // Show speed as a fixed 2-decimal multiplier.

  els.loopCheckbox.checked = animator.getLoopMode() === "repeat"; // Map loop mode to checkbox state.

  const state = animator.getPlayState(); // Read play state for UI label logic.
  els.pauseBtn.textContent = state === "paused" ? "Resume" : "Pause"; // Change button label depending on pause state.
  els.stopBtn.disabled = !hasClips || state === "stopped"; // Disable Stop when stopped (even if clips exist).
}
