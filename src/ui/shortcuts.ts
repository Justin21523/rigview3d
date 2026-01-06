// src/ui/shortcuts.ts
// Keyboard shortcuts (Unity-like) for faster editor workflow.
//
// This module intentionally stays small and focused:
// - It listens for global keydown events
// - It ignores key presses while the user is typing into form controls
// - It calls small APIs on Editor/Viewer (tool mode, selection, framing, undo/redo)

import * as THREE from "three"; // Import math utilities and vector helpers for keyboard-driven transforms.
import type { Editor, ToolMode } from "../core/editor/editor"; // Import Editor and ToolMode types.
import {
  applyTransform, // Apply a transform snapshot back onto an Object3D (used for undo/redo of keyboard transforms).
  captureTransform, // Capture a before/after transform snapshot for history.
  isTransformDifferent, // Compare snapshots to avoid pushing no-op history commands.
} from "../core/editor/transformSnapshot"; // Import shared transform snapshot helpers.
import type { Viewer } from "../core/viewer"; // Import Viewer type (for framing the camera).

export function initShortcuts(viewer: Viewer, editor: Editor): void {
  // Public API: register global keyboard shortcuts.
  const snapCheckbox = document.getElementById("tool-snap-enabled") as HTMLInputElement | null; // Optional snap checkbox (used for the 'G' toggle).
  const localSpaceCheckbox = document.getElementById("tool-space-local") as HTMLInputElement | null; // Optional local/world checkbox (used for the 'X' toggle).
  const rotateStepInput = document.getElementById("tool-snap-rotate") as HTMLInputElement | null; // Optional rotate step input (used for '[' and ']').
  const scaleStepInput = document.getElementById("tool-snap-scale") as HTMLInputElement | null; // Optional scale step input (used for '-' and '=').

  const upAxis = new THREE.Vector3(0, 1, 0); // World up axis used for Y-rotation in world space.
  const tmpWorldPos = new THREE.Vector3(); // Temporary vector reused for world-space position calculations.
  const tmpDelta = new THREE.Vector3(); // Temporary vector reused for world-space translation deltas.

  window.addEventListener("keydown", (e) => {
    // Handle keyboard shortcuts at the window level so the canvas does not need focus.
    if (isTypingTarget(e.target)) return; // Ignore shortcuts while typing in inputs/textarea/select/contenteditable.

    const key = e.key.toLowerCase(); // Normalize key to lowercase for simpler comparisons.
    const cmdOrCtrl = e.ctrlKey || e.metaKey; // Support Ctrl on Windows/Linux and Cmd on macOS.

    if (cmdOrCtrl && key === "d") {
      // Ctrl+D / Cmd+D: duplicate selection (Unity-like), overriding the browser "bookmark" shortcut.
      e.preventDefault(); // Prevent browser bookmarking.
      editor.duplicateSelection(); // Duplicate selected node as a sibling and push an undoable history command.
      return; // Done.
    }

    if (cmdOrCtrl && key === "z") {
      // Ctrl+Z / Cmd+Z: Undo (Shift+Z becomes redo, matching common editor behavior).
      e.preventDefault(); // Prevent browser "undo typing" behavior from interfering.
      if (e.shiftKey) editor.redo(); // Shift+Z is redo in many tools.
      else editor.undo(); // Plain Z is undo.
      return; // Done handling this keypress.
    }

    if (cmdOrCtrl && key === "y") {
      // Ctrl+Y / Cmd+Y: Redo.
      e.preventDefault(); // Prevent browser behavior.
      editor.redo(); // Redo last undone command.
      return; // Done.
    }

    if (key === "escape") {
      // Esc: clear selection.
      e.preventDefault(); // Avoid leaving fullscreen/pointerlock in some contexts.
      editor.clearSelection(); // Clear current selection.
      return; // Done.
    }

    if (!cmdOrCtrl && !e.altKey && key === "g") {
      // G: toggle snapping (Blender-like and convenient in editors).
      e.preventDefault(); // Prevent any default browser behavior for "g".
      if (!snapCheckbox) return; // Guard if the Tools panel is not present in the DOM.
      snapCheckbox.checked = !snapCheckbox.checked; // Flip the checkbox value.
      snapCheckbox.dispatchEvent(new Event("change", { bubbles: true })); // Fire change so the Tools UI updates Editor state.
      return; // Done.
    }

    if (!cmdOrCtrl && !e.altKey && key === "x") {
      // X: toggle local/world space (matches a common "toggle space" shortcut pattern).
      e.preventDefault(); // Prevent default behavior.
      if (!localSpaceCheckbox) return; // Guard if the Tools panel is not present in the DOM.
      localSpaceCheckbox.checked = !localSpaceCheckbox.checked; // Flip local/world checkbox.
      localSpaceCheckbox.dispatchEvent(new Event("change", { bubbles: true })); // Fire change so Tools UI updates Editor state.
      return; // Done.
    }

    if (key === "delete" || key === "backspace") {
      // Delete/Backspace: delete selection (undoable).
      e.preventDefault(); // Prevent browser navigation (Backspace can navigate back on some setups).
      editor.deleteSelection(); // Remove selected node from hierarchy and push history command.
      return; // Done.
    }

    if (key === "f") {
      // F: frame selection (or frame model root if nothing selected).
      e.preventDefault(); // Prevent browser find-in-page in some contexts.
      const selection = editor.getSelection(); // Read current selection.
      const root = editor.getModelRoot(); // Read current model root.
      if (selection) viewer.frameObject(selection); // Frame the selected object.
      else if (root) viewer.frameObject(root); // Otherwise frame the whole model.
      return; // Done.
    }

    if (key === "q" || key === "w" || key === "e" || key === "r") {
      // Q/W/E/R: tool selection (Select/Move/Rotate/Scale).
      if (cmdOrCtrl || e.altKey) return; // Avoid interfering with browser/system shortcuts.
      e.preventDefault(); // Prevent accidental browser focus changes.
      editor.setToolMode(mapKeyToToolMode(key)); // Update editor tool mode.
      return; // Done.
    }

    if (key === "[" || key === "]") {
      // [ / ]: rotate selection around Y axis by the configured rotate step (Inspector-style keyboard rotation).
      if (cmdOrCtrl || e.altKey) return; // Avoid interfering with browser/system shortcuts.
      e.preventDefault(); // Prevent default browser focus behavior.
      const sign = key === "[" ? -1 : 1; // '[' rotates left, ']' rotates right.
      const stepDeg = readNumber(rotateStepInput?.value, 15); // Use rotate step input if available, else default to 15 degrees.
      const degrees = stepDeg * sign * (e.shiftKey ? 10 : 1); // Shift increases the rotation step for faster adjustments.
      commitTransformCommand(editor, "Rotate (Keys)", tmpWorldPos, () => {
        // Apply rotation to the selected object.
        const selection = editor.getSelection(); // Read selection inside apply to avoid stale references.
        if (!selection) return; // Guard.
        const radians = THREE.MathUtils.degToRad(degrees); // Convert degrees to radians (Three.js uses radians internally).
        if (editor.getSpace() === "world") selection.rotateOnWorldAxis(upAxis, radians); // World-space rotation around global up.
        else selection.rotateY(radians); // Local-space rotation around the object's local Y axis.
      });
      return; // Done.
    }

    if (key === "-" || key === "_" || key === "=" || key === "+") {
      // - / =: scale selection uniformly by the configured scale step.
      if (cmdOrCtrl || e.altKey) return; // Avoid interfering with browser/system shortcuts.
      e.preventDefault(); // Prevent browser zoom shortcuts from interfering.
      const sign = key === "-" || key === "_" ? -1 : 1; // '-' scales down, '=' scales up.
      const step = readNumber(scaleStepInput?.value, 0.1); // Use scale step input if available, else default to 0.1.
      const factor = 1 + step * sign * (e.shiftKey ? 10 : 1); // Convert step to a multiplicative factor (Shift speeds up).
      commitTransformCommand(editor, "Scale (Keys)", tmpWorldPos, () => {
        // Apply uniform scaling to the selected object.
        const selection = editor.getSelection(); // Read selection inside apply to avoid stale references.
        if (!selection) return; // Guard.
        const safeFactor = Math.max(0.001, factor); // Prevent negative/zero scaling which can break normals and gizmos.
        selection.scale.multiplyScalar(safeFactor); // Multiply all scale components uniformly.
      });
      return; // Done.
    }

    if (key.startsWith("arrow")) {
      // Arrow keys: nudge the selected object in world X/Z (predictable and editor-friendly).
      if (cmdOrCtrl || e.altKey) return; // Avoid browser navigation / OS shortcuts using arrows.
      e.preventDefault(); // Prevent the page from scrolling.

      let step = editor.getNudgeStep(); // Read configured nudge step from the Tools panel.
      if (e.shiftKey) step *= 10; // Shift speeds up nudging (simple and useful).
      if (step <= 0) return; // Nothing to do if step is zero.

      tmpDelta.set(0, 0, 0); // Reset delta vector for this keypress.
      if (key === "arrowleft") tmpDelta.x = -step; // Move left on world X axis.
      if (key === "arrowright") tmpDelta.x = step; // Move right on world X axis.
      if (key === "arrowup") tmpDelta.z = -step; // Move forward on world -Z (Three.js forward is typically -Z).
      if (key === "arrowdown") tmpDelta.z = step; // Move backward on world +Z.

      commitTransformCommand(editor, "Nudge (Keys)", tmpWorldPos, () => {
        // Apply the translation in world space while preserving parent transforms.
        const selection = editor.getSelection(); // Read selection inside apply to avoid stale references.
        if (!selection) return; // Guard.
        selection.updateMatrixWorld(true); // Ensure current world matrices are up-to-date.
        tmpWorldPos.copy(selection.getWorldPosition(tmpWorldPos)).add(tmpDelta); // Compute target world position = current world pos + delta.
        if (selection.parent) selection.position.copy(selection.parent.worldToLocal(tmpWorldPos)); // Convert world position into parent-local position.
        else selection.position.copy(tmpWorldPos); // If no parent, local and world are the same.
      });
    }
  });
}

function mapKeyToToolMode(key: string): ToolMode {
  // Map a single-letter shortcut to a ToolMode string.
  if (key === "q") return "select"; // Q = Select (no gizmo).
  if (key === "w") return "move"; // W = Move/Translate.
  if (key === "e") return "rotate"; // E = Rotate.
  return "scale"; // R = Scale (default fallback).
}

function isTypingTarget(target: EventTarget | null): boolean {
  // Return true if the event target indicates the user is typing into a form field.
  const el = target as HTMLElement | null; // Narrow to HTMLElement-ish.
  if (!el) return false; // No element means we can handle shortcuts.
  if (el.isContentEditable) return true; // Contenteditable regions should not receive editor shortcuts.
  return (
    el instanceof HTMLInputElement || // Inputs (text/number/range/color, etc.).
    el instanceof HTMLTextAreaElement || // Textareas.
    el instanceof HTMLSelectElement // Select dropdowns.
  ); // Return true if element is a typical text entry control.
}

function readNumber(value: string | undefined, fallback: number): number {
  // Parse a number from an optional string, falling back to a safe default.
  const n = value === undefined ? NaN : Number(value); // Convert string to number (undefined becomes NaN).
  return Number.isFinite(n) ? n : fallback; // Use fallback if parsing fails.
}

function commitTransformCommand(
  editor: Editor, // Editor instance used for selection and history.
  label: string, // History label for the command.
  tmp: THREE.Vector3, // Temporary vector used by some apply callbacks (passed so we can reuse allocations).
  apply: () => void, // Callback that mutates the selected object's transform.
): void {
  // Capture before/after transforms and push an undoable command if the transform changed.
  const selection = editor.getSelection(); // Snapshot selection for this keypress.
  if (!selection) return; // Guard: nothing selected.
  void tmp; // Explicitly mark tmp as used even if some callers don't need it (keeps signature stable).

  const before = captureTransform(selection); // Capture "before" snapshot.
  apply(); // Apply the transform mutation.
  selection.updateMatrixWorld(true); // Ensure matrices update immediately for helpers and inspector sync.
  editor.notifySelectionUpdated(); // Update inspector/hierarchy fields after the change.

  const after = captureTransform(selection); // Capture "after" snapshot.
  if (!isTransformDifferent(before, after)) return; // Skip no-op commands (prevents noisy history entries).

  editor.pushCommand({
    // Push a history command that can undo/redo this transform change.
    label, // Store the label for potential future history UI.
    undo: () => applyTransform(selection, before), // Undo restores "before".
    redo: () => applyTransform(selection, after), // Redo restores "after".
  });
}
