// src/ui/tools.ts
// This module wires the "Tools" panel (Select/Move/Rotate/Scale + snap settings)
// to the core Editor. It keeps the DOM state (active button highlights, checkboxes,
// numeric inputs) synchronized with Editor state.

import type { Editor, ToolMode } from "../core/editor/editor"; // Import Editor/tool types (selection + gizmo configuration).

export function initToolUi(editor: Editor): void {
  // Public API: attach Tools panel behavior to the DOM.
  const btnSelect = mustGetEl("tool-select") as HTMLButtonElement; // "Select" tool button (Q).
  const btnMove = mustGetEl("tool-move") as HTMLButtonElement; // "Move" tool button (W).
  const btnRotate = mustGetEl("tool-rotate") as HTMLButtonElement; // "Rotate" tool button (E).
  const btnScale = mustGetEl("tool-scale") as HTMLButtonElement; // "Scale" tool button (R).

  const snapEnabled = mustGetEl("tool-snap-enabled") as HTMLInputElement; // Checkbox that enables/disables snapping.
  const snapMove = mustGetEl("tool-snap-move") as HTMLInputElement; // Number input for translation snap step.
  const snapRotate = mustGetEl("tool-snap-rotate") as HTMLInputElement; // Number input for rotation snap step in degrees.
  const snapScale = mustGetEl("tool-snap-scale") as HTMLInputElement; // Number input for scale snap step.
  const nudgeStep = mustGetEl("tool-nudge") as HTMLInputElement; // Number input for keyboard nudge step (used in shortcuts later).
  const gizmoSize = mustGetEl("tool-gizmo-size") as HTMLInputElement; // Range input for TransformControls size scaling.
  const gizmoSizeValue = mustGetEl("tool-gizmo-size-value"); // Text label that shows gizmo size numeric value.
  const localSpace = mustGetEl("tool-space-local") as HTMLInputElement; // Checkbox for local/world space toggle.

  const setActive = (mode: ToolMode) => {
    // Update active button styling based on the current tool mode.
    btnSelect.classList.toggle("is-active", mode === "select"); // Highlight Select when active.
    btnMove.classList.toggle("is-active", mode === "move"); // Highlight Move when active.
    btnRotate.classList.toggle("is-active", mode === "rotate"); // Highlight Rotate when active.
    btnScale.classList.toggle("is-active", mode === "scale"); // Highlight Scale when active.
  };

  btnSelect.addEventListener("click", () => editor.setToolMode("select")); // Activate Select tool.
  btnMove.addEventListener("click", () => editor.setToolMode("move")); // Activate Move tool.
  btnRotate.addEventListener("click", () => editor.setToolMode("rotate")); // Activate Rotate tool.
  btnScale.addEventListener("click", () => editor.setToolMode("scale")); // Activate Scale tool.

  snapEnabled.addEventListener("change", () => {
    // Toggle snapping on/off.
    editor.setSnapEnabled(snapEnabled.checked); // Apply checkbox to Editor snap settings.
  });

  snapMove.addEventListener("input", () => {
    // Update translation snap step as the user types.
    const value = Number(snapMove.value); // Convert the text input value into a number.
    if (!Number.isFinite(value)) return; // Ignore invalid numbers.
    editor.setTranslationSnap(value); // Apply to TransformControls translation snap.
  });

  snapRotate.addEventListener("input", () => {
    // Update rotation snap step in degrees.
    const value = Number(snapRotate.value); // Parse degrees from input.
    if (!Number.isFinite(value)) return; // Ignore invalid numbers.
    editor.setRotationSnapDegrees(value); // Convert to radians internally and apply to TransformControls.
  });

  snapScale.addEventListener("input", () => {
    // Update scale snap step.
    const value = Number(snapScale.value); // Parse number from input.
    if (!Number.isFinite(value)) return; // Ignore invalid numbers.
    editor.setScaleSnap(value); // Apply to TransformControls scale snap.
  });

  nudgeStep.addEventListener("input", () => {
    // Update the keyboard nudge step.
    const value = Number(nudgeStep.value); // Parse number from input.
    if (!Number.isFinite(value)) return; // Ignore invalid numbers.
    editor.setNudgeStep(value); // Store in Editor (used later by arrow-key shortcuts).
  });

  gizmoSize.addEventListener("input", () => {
    // Update gizmo visual size continuously while dragging the slider.
    const value = Number(gizmoSize.value); // Parse slider value.
    if (!Number.isFinite(value)) return; // Ignore invalid numbers.
    editor.setGizmoSize(value); // Apply size to TransformControls.
    gizmoSizeValue.textContent = value.toFixed(2); // Update label so user sees the exact value.
  });

  localSpace.addEventListener("change", () => {
    // Toggle between local and world gizmo orientation.
    editor.setSpace(localSpace.checked ? "local" : "world"); // Map checkbox to TransformControls space strings.
  });

  editor.onToolModeChange((mode) => setActive(mode)); // Keep UI in sync when tool mode changes programmatically (e.g., shortcuts).

  // Initialize Editor state from DOM defaults so the gizmo behavior matches the visible UI controls.
  editor.setSnapEnabled(snapEnabled.checked); // Apply initial snap toggle state.
  editor.setTranslationSnap(Number(snapMove.value)); // Apply initial move snap step.
  editor.setRotationSnapDegrees(Number(snapRotate.value)); // Apply initial rotate snap step.
  editor.setScaleSnap(Number(snapScale.value)); // Apply initial scale snap step.
  editor.setNudgeStep(Number(nudgeStep.value)); // Apply initial nudge step.
  editor.setGizmoSize(Number(gizmoSize.value)); // Apply initial gizmo size value.
  editor.setSpace(localSpace.checked ? "local" : "world"); // Apply initial local/world setting.

  gizmoSizeValue.textContent = Number(gizmoSize.value).toFixed(2); // Initialize gizmo size label from the input default.
  setActive(editor.getToolMode()); // Sync button highlight for the initial tool mode.
}

function mustGetEl(id: string): HTMLElement {
  // Convenience helper that guarantees an element exists (or throws early).
  const el = document.getElementById(id); // Find element by id.
  if (!el) throw new Error(`Missing element: #${id}`); // Throw if markup is out of sync.
  return el; // Return the element as non-null.
}
