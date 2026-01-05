// src/ui/export.ts
// This module wires the "Export" panel.
//
// Goal: let users export the currently loaded (and possibly edited) model as a binary GLB.
// We use Three.js' GLTFExporter (examples module) and trigger a browser download.

import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js"; // Import GLTF/GLB exporter from Three.js examples.
import type { Animator } from "../core/animator"; // Import Animator type (provides AnimationClips).
import type { Editor } from "../core/editor/editor"; // Import Editor type (provides current model root + source filename).

export function initExportUi(editor: Editor, animator: Animator): void {
  // Public API: attach Export panel behavior to the DOM.
  const includeAnims = mustGetEl("export-animations") as HTMLInputElement; // Checkbox for including animation clips.
  const exportBtn = mustGetEl("btn-export-glb") as HTMLButtonElement; // Button that triggers the export download.

  const syncEnabled = () => {
    // Enable/disable export controls based on whether a model is loaded.
    const hasModel = Boolean(editor.getModelRoot()); // A model exists if the editor has a root.
    exportBtn.disabled = !hasModel; // Disable export if no model is present.
    includeAnims.disabled = !hasModel; // Disable checkbox if no model is present.
  };

  exportBtn.addEventListener("click", async () => {
    // Export the current model root as a GLB file.
    const root = editor.getModelRoot(); // Read the active model root.
    if (!root) return; // Guard: nothing to export.

    exportBtn.disabled = true; // Temporarily disable to prevent double-click exports.
    exportBtn.textContent = "Exporting…"; // Provide quick feedback.

    try {
      const exporter = new GLTFExporter(); // Create a new exporter instance for this export.
      const animations = includeAnims.checked ? animator.getClips() : []; // Include clips only when checkbox is enabled.

      const arrayBuffer = (await exporter.parseAsync(root, {
        // Export options for GLB output.
        binary: true, // Binary output = .glb (ArrayBuffer).
        animations, // Optional animation clips to include in the file.
      })) as ArrayBuffer; // We expect ArrayBuffer because `binary: true`.

      const base = (editor.getSourceFileName() ?? "rigview3d") // Use original filename when available.
        .replace(/\.(glb|gltf)$/i, "") // Strip common extensions for cleaner output names.
        .trim(); // Remove whitespace.
      const fileName = `${base || "rigview3d"}-edited.glb`; // Default export name.

      downloadArrayBuffer(arrayBuffer, fileName); // Trigger a browser download using an object URL.
    } catch (err) {
      // Export errors can happen for unusual models; log for debugging.
      console.error(err); // Print full error stack/details.
      exportBtn.textContent = "Export failed"; // Show a minimal failure state.
      window.setTimeout(() => {
        // Reset button label after a short delay.
        exportBtn.textContent = "Export GLB"; // Restore default label.
        syncEnabled(); // Restore enabled/disabled state.
      }, 1200);
      return; // Stop the normal reset path.
    }

    exportBtn.textContent = "Export GLB"; // Restore default button label.
    syncEnabled(); // Restore enabled/disabled state based on current model.
  });

  editor.onRootChange(() => syncEnabled()); // Keep controls enabled state in sync with model load/unload.
  syncEnabled(); // Initialize enabled state on first load.
}

function mustGetEl(id: string): HTMLElement {
  // Convenience helper that guarantees an element exists (or throws early).
  const el = document.getElementById(id); // Query DOM by id.
  if (!el) throw new Error(`Missing element: #${id}`); // Fail fast if markup is missing.
  return el; // Return as non-null.
}

function downloadArrayBuffer(data: ArrayBuffer, fileName: string): void {
  // Trigger a download of an ArrayBuffer as a file in the browser.
  const blob = new Blob([data], { type: "model/gltf-binary" }); // Wrap the bytes in a GLB-typed Blob.
  const url = URL.createObjectURL(blob); // Create a temporary object URL for the Blob.

  const a = document.createElement("a"); // Create a temporary anchor element.
  a.href = url; // Point it at the blob URL.
  a.download = fileName; // Suggest a filename to the browser.
  document.body.appendChild(a); // Add to DOM so the click is trusted by the browser.
  a.click(); // Programmatically click to start download.
  a.remove(); // Remove the element after triggering.

  URL.revokeObjectURL(url); // Release memory for the object URL.
}

