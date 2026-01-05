// src/ui/inspector.ts
// This module wires the "Inspector" panel (Unity-like) to the current Editor selection:
// - Displays selection name/type/visibility
// - Edits transform (position/rotation/scale) using numeric inputs
// - Provides a small material editor for common PBR materials (MeshStandardMaterial)
//
// The Inspector listens to Editor selection events so it stays in sync when the user:
// - Clicks objects in the viewport
// - Clicks objects in the Hierarchy panel
// - Drags the transform gizmo

import * as THREE from "three"; // Import math helpers (deg/rad) and material runtime type guards.
import type { Editor } from "../core/editor/editor"; // Import Editor type (selection events).
import {
  applyTransform, // Apply a transform snapshot to an Object3D (used by undo/redo commands).
  captureTransform, // Capture Object3D transform for history snapshots.
  isTransformDifferent, // Compare two transforms to avoid pushing no-op history commands.
  type TransformSnapshot, // Type for position/quaternion/scale snapshots.
} from "../core/editor/transformSnapshot"; // Import transform snapshot helpers shared with the core Editor.

export function initInspectorUi(editor: Editor): void {
  // Public API: attach Inspector panel behavior to the DOM.
  const empty = mustGetEl("inspector-empty"); // Empty-state element displayed when nothing is selected.
  const content = mustGetEl("inspector-content"); // Container with actual inspector controls (hidden when no selection).

  const nameInput = mustGetEl("inspector-name") as HTMLInputElement; // Input for editing Object3D.name.
  const typeValue = mustGetEl("inspector-type"); // Read-only label showing Object3D.type.
  const visibleInput = mustGetEl("inspector-visible") as HTMLInputElement; // Checkbox controlling Object3D.visible.

  const posX = mustGetEl("inspector-pos-x") as HTMLInputElement; // Position X input.
  const posY = mustGetEl("inspector-pos-y") as HTMLInputElement; // Position Y input.
  const posZ = mustGetEl("inspector-pos-z") as HTMLInputElement; // Position Z input.

  const rotX = mustGetEl("inspector-rot-x") as HTMLInputElement; // Rotation X input (degrees).
  const rotY = mustGetEl("inspector-rot-y") as HTMLInputElement; // Rotation Y input (degrees).
  const rotZ = mustGetEl("inspector-rot-z") as HTMLInputElement; // Rotation Z input (degrees).

  const scaleX = mustGetEl("inspector-scale-x") as HTMLInputElement; // Scale X input.
  const scaleY = mustGetEl("inspector-scale-y") as HTMLInputElement; // Scale Y input.
  const scaleZ = mustGetEl("inspector-scale-z") as HTMLInputElement; // Scale Z input.

  const materialHint = mustGetEl("inspector-material"); // Placeholder text element for material editor state.
  const materialControls = mustGetEl("inspector-material-controls"); // Wrapper that contains material controls (hidden by default).
  const materialSlot = mustGetEl("material-slot") as HTMLSelectElement; // Slot selector for multi-material meshes.
  const materialColor = mustGetEl("material-color") as HTMLInputElement; // Color picker for baseColor.
  const metalness = mustGetEl("material-metalness") as HTMLInputElement; // Slider for metalness.
  const metalnessValue = mustGetEl("material-metalness-value"); // Text label showing metalness value.
  const roughness = mustGetEl("material-roughness") as HTMLInputElement; // Slider for roughness.
  const roughnessValue = mustGetEl("material-roughness-value"); // Text label showing roughness value.

  let selected: THREE.Object3D | null = null; // Current selection reference (null when nothing selected).
  let selectedMesh: THREE.Mesh | null = null; // Cached selection cast as Mesh when applicable.
  let meshMaterials: THREE.Material[] = []; // Cached materials array for the selected mesh (handles multi-material).
  let materialIndex = 0; // Currently selected material slot index for the mesh material editor.

  let isSyncing = false; // Guard flag to prevent event handler feedback loops while writing values to inputs.

  let nameEditStart: string | null = null; // Original name captured when the name input receives focus (used for undo).
  let nameEditObject: THREE.Object3D | null = null; // Object that is being renamed (captured on focus).

  let transformEditStart: TransformSnapshot | null = null; // Original transform captured on focus (used for undo).
  let transformEditObject: THREE.Object3D | null = null; // Object whose transform is being edited via inspector inputs.

  type MaterialSnapshot = {
    // Snapshot of editable PBR parameters we expose in the inspector.
    color: string; // CSS hex color string like "#rrggbb".
    metalness: number; // PBR metalness value in [0,1].
    roughness: number; // PBR roughness value in [0,1].
  }; // End MaterialSnapshot type.

  let materialEditStart: MaterialSnapshot | null = null; // Material snapshot captured at the start of an edit interaction.
  let materialEditMaterial: THREE.MeshStandardMaterial | null = null; // Which material instance we are currently editing.

  const setInspectorVisible = (hasSelection: boolean) => {
    // Toggle the empty/content inspector views.
    empty.hidden = hasSelection; // Hide empty state when something is selected.
    content.hidden = !hasSelection; // Show controls only when selection exists.
  };

  const syncTransformInputs = () => {
    // Write the selected object's transform into the numeric inputs.
    if (!selected) return; // Guard: no selection.

    posX.value = formatNumber(selected.position.x, 3); // Sync position X.
    posY.value = formatNumber(selected.position.y, 3); // Sync position Y.
    posZ.value = formatNumber(selected.position.z, 3); // Sync position Z.

    rotX.value = formatNumber(THREE.MathUtils.radToDeg(selected.rotation.x), 1); // Sync rotation X as degrees.
    rotY.value = formatNumber(THREE.MathUtils.radToDeg(selected.rotation.y), 1); // Sync rotation Y as degrees.
    rotZ.value = formatNumber(THREE.MathUtils.radToDeg(selected.rotation.z), 1); // Sync rotation Z as degrees.

    scaleX.value = formatNumber(selected.scale.x, 3); // Sync scale X.
    scaleY.value = formatNumber(selected.scale.y, 3); // Sync scale Y.
    scaleZ.value = formatNumber(selected.scale.z, 3); // Sync scale Z.
  };

  const syncMaterialUi = () => {
    // Rebuild and sync the material editor for the current selection.
    materialControls.hidden = true; // Hide controls until we confirm we have an editable material.
    materialHint.hidden = false; // Show placeholder/hint by default.

    if (!selectedMesh) {
      // Non-mesh selections do not have materials.
      materialHint.textContent = "Select a mesh to edit material."; // Explain what the user needs to do.
      return; // Done.
    }

    meshMaterials = getMeshMaterials(selectedMesh); // Normalize mesh.material into a flat array.
    if (meshMaterials.length === 0) {
      // Some meshes might not have materials (rare but possible).
      materialHint.textContent = "This mesh has no material."; // Show a helpful message.
      return; // Done.
    }

    materialIndex = clampInt(materialIndex, 0, meshMaterials.length - 1); // Keep index in bounds.

    materialSlot.innerHTML = ""; // Clear previous options before rebuilding.
    meshMaterials.forEach((m, i) => {
      // Create one option per material slot.
      const opt = document.createElement("option"); // Create option element.
      opt.value = String(i); // Store the slot index in the option value.
      opt.textContent = `#${i} ${m.type}`; // Show index + material type so it is understandable.
      materialSlot.appendChild(opt); // Add option to the select.
    });

    materialSlot.disabled = meshMaterials.length <= 1; // Disable slot dropdown if there's only one material.
    materialSlot.value = String(materialIndex); // Select the current slot in the UI.

    const material = meshMaterials[materialIndex] as THREE.Material | undefined; // Resolve the currently selected slot material.
    if (!material) {
      // Defensive: should not happen if bounds are correct.
      materialHint.textContent = "Material not found."; // Show error state.
      return; // Done.
    }

    if (!(material as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
      // For now we only implement MeshStandardMaterial-like editing (glTF PBR default).
      materialHint.textContent = `Unsupported material: ${material.type}`; // Tell the user why controls are hidden.
      return; // Done.
    }

    const standard = material as THREE.MeshStandardMaterial; // Narrow the type so TS knows metalness/roughness/color exist.

    materialHint.hidden = true; // Hide the placeholder text when controls are available.
    materialControls.hidden = false; // Show the actual controls.

    materialColor.value = `#${standard.color.getHexString()}`; // Sync base color to the color input.

    metalness.value = String(standard.metalness); // Sync metalness slider.
    metalnessValue.textContent = standard.metalness.toFixed(2); // Sync metalness numeric label.

    roughness.value = String(standard.roughness); // Sync roughness slider.
    roughnessValue.textContent = standard.roughness.toFixed(2); // Sync roughness numeric label.
  };

  const syncInspector = () => {
    // Sync the entire inspector UI from the current `selected` reference.
    const hasSelection = Boolean(selected); // Convert selection object to a boolean for view toggles.
    setInspectorVisible(hasSelection); // Toggle empty/content views.
    if (!hasSelection) return; // If nothing selected, no further syncing is needed.

    isSyncing = true; // Start guarded sync section.
    nameInput.value = selected?.name ?? ""; // Sync object name (empty string is allowed).
    typeValue.textContent = selected?.type ?? "—"; // Sync type display.
    visibleInput.checked = selected?.visible ?? true; // Sync visibility checkbox.
    syncTransformInputs(); // Sync position/rotation/scale inputs.
    syncMaterialUi(); // Sync material editor section.
    isSyncing = false; // End guarded sync section.
  };

  const getEditableStandardMaterial = (): THREE.MeshStandardMaterial | null => {
    // Resolve the currently selected MeshStandardMaterial from the mesh + slot index.
    if (!selectedMesh) return null; // Guard: selection is not a mesh.
    const material = meshMaterials[materialIndex]; // Read the material at the current slot index.
    if (!material) return null; // Guard: missing material.
    if (!(material as THREE.MeshStandardMaterial).isMeshStandardMaterial) return null; // Guard: unsupported type.
    return material as THREE.MeshStandardMaterial; // Return as MeshStandardMaterial for editing.
  };

  const captureMaterial = (mat: THREE.MeshStandardMaterial): MaterialSnapshot => {
    // Capture the subset of material properties we expose in this inspector.
    return {
      color: `#${mat.color.getHexString()}`, // Store color as a CSS hex string (matches `<input type="color">`).
      metalness: mat.metalness, // Store current metalness.
      roughness: mat.roughness, // Store current roughness.
    }; // End snapshot object.
  };

  const applyMaterial = (mat: THREE.MeshStandardMaterial, snapshot: MaterialSnapshot): void => {
    // Apply a previously captured material snapshot.
    mat.color.set(snapshot.color); // Restore base color.
    mat.metalness = snapshot.metalness; // Restore metalness.
    mat.roughness = snapshot.roughness; // Restore roughness.
    mat.needsUpdate = true; // Mark material for update so renderer reuses the updated values safely.
  };

  const beginMaterialEdit = () => {
    // Capture a "before" snapshot when the user starts changing material controls.
    if (isSyncing) return; // Avoid capturing snapshots during programmatic UI sync.
    const mat = getEditableStandardMaterial(); // Resolve the current editable material.
    if (!mat) return; // Guard: no editable material.
    materialEditMaterial = mat; // Track which material is being edited.
    materialEditStart = captureMaterial(mat); // Capture starting values for undo.
  };

  const commitMaterialEdit = () => {
    // Commit an undoable material edit command if anything changed.
    const mat = materialEditMaterial; // Snapshot the material reference.
    const before = materialEditStart; // Snapshot the starting values.
    materialEditMaterial = null; // Clear edit state.
    materialEditStart = null; // Clear edit state.
    if (!mat || !before) return; // Guard: no recorded edit session.

    const after = captureMaterial(mat); // Capture ending values for redo.
    const changed =
      before.color !== after.color || // Any color change counts.
      Math.abs(before.metalness - after.metalness) > 1e-6 || // Ignore tiny float noise.
      Math.abs(before.roughness - after.roughness) > 1e-6; // Ignore tiny float noise.
    if (!changed) return; // Skip no-op edits.

    editor.pushCommand({
      // Push an undoable material command.
      label: "Material", // Label used in history.
      undo: () => applyMaterial(mat, before), // Undo restores "before".
      redo: () => applyMaterial(mat, after), // Redo restores "after".
    });
  };

  // --- DOM -> scene wiring (write back into Three.js objects) ---

  nameInput.addEventListener("input", () => {
    // Update Object3D.name as the user types.
    if (isSyncing) return; // Ignore events fired during sync.
    if (!selected) return; // Guard: nothing selected.
    selected.name = nameInput.value; // Write name back to the Object3D.
    editor.notifySelectionUpdated(); // Notify listeners (Hierarchy re-renders to reflect the new name).
  });

  nameInput.addEventListener("focus", () => {
    // Capture the starting name so we can create an undoable "Rename" command on change.
    if (!selected) return; // Guard: nothing selected.
    nameEditObject = selected; // Remember which object is being renamed.
    nameEditStart = selected.name; // Capture the original name (could be empty string).
  });

  nameInput.addEventListener("change", () => {
    // Commit an undoable rename command when the user finishes editing the name field.
    const object = nameEditObject; // Snapshot object reference captured on focus.
    const before = nameEditStart; // Snapshot original name captured on focus.
    nameEditObject = null; // Clear edit state.
    nameEditStart = null; // Clear edit state.
    if (!object || before === null) return; // Guard: no recorded edit session.
    const after = object.name; // Read the final name after the user's edits.
    if (before === after) return; // Skip if nothing changed.
    editor.pushCommand({
      // Push an undoable command for rename.
      label: "Rename", // Label used in history.
      undo: () => (object.name = before), // Undo restores original name.
      redo: () => (object.name = after), // Redo reapplies new name.
    });
  });

  visibleInput.addEventListener("change", () => {
    // Update Object3D.visible when the checkbox is toggled.
    if (isSyncing) return; // Ignore events fired during sync.
    if (!selected) return; // Guard: nothing selected.
    selected.visible = visibleInput.checked; // Update Three.js visibility flag.
  });

  const bindNumber = (
    input: HTMLInputElement, // The input element to read from.
    apply: (value: number) => void, // Callback that applies the parsed number to the scene.
  ) => {
    // Helper that binds a numeric input to a scene update callback.
    input.addEventListener("input", () => {
      // React while the user edits the number.
      if (isSyncing) return; // Ignore programmatic changes.
      if (!selected) return; // Guard: no selection.
      const value = Number(input.value); // Parse input string to number.
      if (!Number.isFinite(value)) return; // Ignore NaN/Infinity.
      apply(value); // Apply to the scene object.
    });
  };

  const beginTransformEdit = () => {
    // Capture a "before" snapshot when the user focuses any transform input.
    if (!selected) return; // Guard: no selection means nothing to record.
    transformEditObject = selected; // Record which object is being edited.
    transformEditStart = captureTransform(selected); // Snapshot starting transform for undo.
  };

  const commitTransformEdit = () => {
    // Commit an undoable transform command when the user finishes editing a transform input.
    const object = transformEditObject; // Snapshot the object captured at the start of the edit.
    const before = transformEditStart; // Snapshot the starting transform.
    transformEditObject = null; // Clear edit state.
    transformEditStart = null; // Clear edit state.
    if (!object || !before) return; // Guard: no recorded edit session.
    const after = captureTransform(object); // Snapshot ending transform for redo.
    if (!isTransformDifferent(before, after)) return; // Skip no-op edits.
    editor.pushCommand({
      // Push an undoable transform command.
      label: "Transform (Inspector)", // Label used in history.
      undo: () => applyTransform(object, before), // Undo restores "before".
      redo: () => applyTransform(object, after), // Redo restores "after".
    });
  };

  const transformInputs = [posX, posY, posZ, rotX, rotY, rotZ, scaleX, scaleY, scaleZ]; // All transform inputs.
  transformInputs.forEach((input) => {
    // Attach focus/change handlers to record undo history for inspector-driven transform edits.
    input.addEventListener("focus", () => beginTransformEdit()); // Focus marks the start of an edit session.
    input.addEventListener("change", () => commitTransformEdit()); // Change commits a history entry when editing finishes.
  });

  bindNumber(posX, (v) => selected && (selected.position.x = v)); // Bind position X.
  bindNumber(posY, (v) => selected && (selected.position.y = v)); // Bind position Y.
  bindNumber(posZ, (v) => selected && (selected.position.z = v)); // Bind position Z.

  bindNumber(rotX, (deg) => selected && (selected.rotation.x = THREE.MathUtils.degToRad(deg))); // Bind rotation X (deg->rad).
  bindNumber(rotY, (deg) => selected && (selected.rotation.y = THREE.MathUtils.degToRad(deg))); // Bind rotation Y (deg->rad).
  bindNumber(rotZ, (deg) => selected && (selected.rotation.z = THREE.MathUtils.degToRad(deg))); // Bind rotation Z (deg->rad).

  bindNumber(scaleX, (v) => selected && (selected.scale.x = v)); // Bind scale X.
  bindNumber(scaleY, (v) => selected && (selected.scale.y = v)); // Bind scale Y.
  bindNumber(scaleZ, (v) => selected && (selected.scale.z = v)); // Bind scale Z.

  materialSlot.addEventListener("change", () => {
    // Switch which material slot the editor controls are targeting.
    if (isSyncing) return; // Ignore programmatic changes.
    materialEditMaterial = null; // Clear any pending material edit session (slot change changes the target material).
    materialEditStart = null; // Clear any pending material edit session.
    materialIndex = clampInt(Number(materialSlot.value), 0, meshMaterials.length - 1); // Clamp to a valid index.
    syncMaterialUi(); // Re-sync controls for the newly selected material.
  });

  materialColor.addEventListener("focus", () => beginMaterialEdit()); // Record "before" values when starting a color edit.
  materialColor.addEventListener("change", () => commitMaterialEdit()); // Commit undo history when the color edit is finished.

  materialColor.addEventListener("input", () => {
    // Update PBR base color.
    if (isSyncing) return; // Ignore programmatic sync.
    const mat = getEditableStandardMaterial(); // Resolve current editable material.
    if (!mat) return; // Guard: no editable material.
    mat.color.set(materialColor.value); // Apply CSS hex color to Three.js Color.
  });

  metalness.addEventListener("pointerdown", () => beginMaterialEdit()); // Record "before" values when starting a slider drag.
  metalness.addEventListener("focus", () => beginMaterialEdit()); // Record "before" values for keyboard-driven changes too.
  metalness.addEventListener("change", () => commitMaterialEdit()); // Commit undo history when the slider interaction ends.

  metalness.addEventListener("input", () => {
    // Update PBR metalness.
    if (isSyncing) return; // Ignore programmatic sync.
    const mat = getEditableStandardMaterial(); // Resolve current editable material.
    if (!mat) return; // Guard.
    const value = Number(metalness.value); // Parse slider value.
    if (!Number.isFinite(value)) return; // Guard.
    mat.metalness = clamp01(value); // Apply clamped metalness.
    metalnessValue.textContent = mat.metalness.toFixed(2); // Update label.
  });

  roughness.addEventListener("pointerdown", () => beginMaterialEdit()); // Record "before" values when starting a slider drag.
  roughness.addEventListener("focus", () => beginMaterialEdit()); // Record "before" values for keyboard-driven changes too.
  roughness.addEventListener("change", () => commitMaterialEdit()); // Commit undo history when the slider interaction ends.

  roughness.addEventListener("input", () => {
    // Update PBR roughness.
    if (isSyncing) return; // Ignore programmatic sync.
    const mat = getEditableStandardMaterial(); // Resolve current editable material.
    if (!mat) return; // Guard.
    const value = Number(roughness.value); // Parse slider value.
    if (!Number.isFinite(value)) return; // Guard.
    mat.roughness = clamp01(value); // Apply clamped roughness.
    roughnessValue.textContent = mat.roughness.toFixed(2); // Update label.
  });

  // --- Editor -> DOM wiring (react to selection changes) ---

  editor.onSelectionChange((selection) => {
    // Update inspector when selection changes (new object selected or cleared).
    selected = selection; // Store current selection reference.
    selectedMesh = selection && (selection as THREE.Mesh).isMesh ? (selection as THREE.Mesh) : null; // Cache mesh selection.
    meshMaterials = selectedMesh ? getMeshMaterials(selectedMesh) : []; // Cache materials array for selected mesh.
    materialIndex = 0; // Reset slot to 0 on new selection (simple and predictable).
    nameEditStart = null; // Clear pending rename history state when selection changes.
    nameEditObject = null; // Clear pending rename history state.
    transformEditStart = null; // Clear pending transform history state when selection changes.
    transformEditObject = null; // Clear pending transform history state.
    materialEditStart = null; // Clear pending material history state when selection changes.
    materialEditMaterial = null; // Clear pending material history state.
    syncInspector(); // Update the entire inspector UI.
  });

  editor.onSelectionUpdated(() => {
    // Update inspector values when the selected object changes in-place (e.g., gizmo drag).
    if (!selected) return; // Guard: no selection.
    if (isTextEditingActive(content)) return; // Avoid fighting the user's typing focus.
    isSyncing = true; // Guard input events while we update fields.
    nameInput.value = selected.name; // Keep name input in sync (important for undo/redo rename).
    visibleInput.checked = selected.visible; // Keep visibility checkbox in sync (future-proof for undo/redo).
    syncTransformInputs(); // Update position/rotation/scale inputs to match the live selection.
    syncMaterialUi(); // Refresh material UI (material properties could change via other tooling later).
    isSyncing = false; // End guarded sync.
  });

  // Initialize inspector from the current editor selection (important if init order changes).
  selected = editor.getSelection(); // Read current selection.
  selectedMesh = selected && (selected as THREE.Mesh).isMesh ? (selected as THREE.Mesh) : null; // Cache mesh selection if applicable.
  meshMaterials = selectedMesh ? getMeshMaterials(selectedMesh) : []; // Cache initial materials.
  syncInspector(); // Initial UI sync.
}

function mustGetEl(id: string): HTMLElement {
  // Convenience helper that guarantees an element exists (or throws early).
  const el = document.getElementById(id); // Find by id in the document.
  if (!el) throw new Error(`Missing element: #${id}`); // Fail fast if markup is out of sync.
  return el; // Return the element as non-null.
}

function formatNumber(value: number, decimals: number): string {
  // Format a number for display inside an `<input type="number">`.
  if (!Number.isFinite(value)) return "0"; // Avoid "NaN" showing up in the UI.
  return value.toFixed(decimals); // Use fixed decimals for stable UI while dragging gizmos.
}

function clamp01(value: number): number {
  // Clamp numeric values to [0,1].
  return Math.min(1, Math.max(0, value)); // Clamp by applying max then min.
}

function clampInt(value: number, min: number, max: number): number {
  // Clamp a number to an integer range.
  if (!Number.isFinite(value)) return min; // Use min if value is invalid.
  return Math.min(max, Math.max(min, Math.round(value))); // Clamp and round to an integer.
}

function getMeshMaterials(mesh: THREE.Mesh): THREE.Material[] {
  // Normalize `mesh.material` into a flat array.
  const m = mesh.material as THREE.Material | THREE.Material[] | null | undefined; // Read mesh material (can be single or array).
  if (!m) return []; // No material.
  return Array.isArray(m) ? m.filter(Boolean) : [m]; // Normalize to an array (filter removes any accidental nulls).
}

function isTextEditingActive(container: HTMLElement): boolean {
  // Return true if the user is currently typing in an input inside the given container.
  const active = document.activeElement; // The element currently focused by the browser.
  if (!active) return false; // No active element.
  if (!(active instanceof HTMLInputElement || active instanceof HTMLSelectElement || active instanceof HTMLTextAreaElement)) {
    // Only treat typical form controls as "text editing" contexts.
    return false; // Not editing text.
  }
  return container.contains(active); // True if focus is inside the inspector panel.
}
