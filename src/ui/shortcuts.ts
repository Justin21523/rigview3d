// src/ui/shortcuts.ts
// Keyboard shortcuts (Unity-like) for faster editor workflow.
//
// This module intentionally stays small and focused:
// - It listens for global keydown events
// - It ignores key presses while the user is typing into form controls
// - It calls small APIs on Editor/Viewer (tool mode, selection, framing, undo/redo)

import type { Editor, ToolMode } from "../core/editor/editor"; // Import Editor and ToolMode types.
import type { Viewer } from "../core/viewer"; // Import Viewer type (for framing the camera).

export function initShortcuts(viewer: Viewer, editor: Editor): void {
  // Public API: register global keyboard shortcuts.
  window.addEventListener("keydown", (e) => {
    // Handle keyboard shortcuts at the window level so the canvas does not need focus.
    if (isTypingTarget(e.target)) return; // Ignore shortcuts while typing in inputs/textarea/select/contenteditable.

    const key = e.key.toLowerCase(); // Normalize key to lowercase for simpler comparisons.
    const cmdOrCtrl = e.ctrlKey || e.metaKey; // Support Ctrl on Windows/Linux and Cmd on macOS.

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

    if (key.startsWith("arrow")) {
      // Arrow keys: nudge the selected object in X/Z.
      const selection = editor.getSelection(); // Read current selection.
      if (!selection) return; // Nothing selected means nothing to nudge.
      e.preventDefault(); // Prevent the page from scrolling.

      let step = editor.getNudgeStep(); // Read configured nudge step from the Tools panel.
      if (e.shiftKey) step *= 10; // Shift speeds up nudging (simple and useful).

      if (key === "arrowleft") selection.position.x -= step; // Move left on X axis.
      if (key === "arrowright") selection.position.x += step; // Move right on X axis.
      if (key === "arrowup") selection.position.z -= step; // Move forward (Three.js forward is typically -Z).
      if (key === "arrowdown") selection.position.z += step; // Move backward (+Z).

      selection.updateMatrixWorld(true); // Ensure matrices update immediately.
      editor.notifySelectionUpdated(); // Notify inspector/hierarchy so UI reflects the new position.
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

