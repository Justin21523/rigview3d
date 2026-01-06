// src/ui/export.ts
// This module wires the "Export" panel.
//
// Goal: let users export the currently loaded (and possibly edited) model as a binary GLB.
// We use Three.js' GLTFExporter (examples module) and trigger a browser download.

import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js"; // Import GLTF/GLB exporter from Three.js examples.
import type { Animator } from "../core/animator"; // Import Animator type (provides AnimationClips).
import type { Editor } from "../core/editor/editor"; // Import Editor type (provides current model root + source filename).
import { updateExportSettings } from "../core/settings"; // Import settings persistence helper for Export panel preferences.

export function initExportUi(editor: Editor, animator: Animator): void {
  // Public API: attach Export panel behavior to the DOM.
  const formatSelect = mustGetEl("export-format") as HTMLSelectElement; // Dropdown for export format (GLB/glTF).
  const includeAnims = mustGetEl("export-animations") as HTMLInputElement; // Checkbox for including animation clips.
  const onlyVisible = mustGetEl("export-only-visible") as HTMLInputElement; // Checkbox for exporting visible-only nodes.
  const overwriteName = mustGetEl("export-overwrite-name") as HTMLInputElement; // Checkbox controlling filename behavior.
  const outputName = mustGetEl("export-output-name"); // Code element that shows the computed output filename.
  const exportBtn = mustGetEl("btn-export") as HTMLButtonElement; // Button that triggers the export download.

  const syncEnabled = () => {
    // Enable/disable export controls based on whether a model is loaded.
    const hasModel = Boolean(editor.getModelRoot()); // A model exists if the editor has a root.
    exportBtn.disabled = !hasModel; // Disable export if no model is present.
    includeAnims.disabled = !hasModel; // Disable checkbox if no model is present.
    formatSelect.disabled = !hasModel; // Disable format select if no model is present.
    onlyVisible.disabled = !hasModel; // Disable visibility option if no model is present.
    overwriteName.disabled = !hasModel; // Disable filename option if no model is present.
  };

  const getBaseName = (): string => {
    // Compute a safe base filename (without extension) from the loaded asset.
    const raw = (editor.getSourceFileName() ?? "rigview3d").trim(); // Prefer the original file name.
    const base = raw.replace(/\.(glb|gltf|fbx)$/i, "").trim(); // Strip common extensions.
    return base || "rigview3d"; // Ensure we never return an empty string.
  };

  const getFormatExtension = (): "glb" | "gltf" => {
    // Normalize the select value into a supported extension.
    return formatSelect.value === "gltf" ? "gltf" : "glb"; // Treat unknown/disabled values as GLB.
  };

  const computeFileName = (): string => {
    // Build the filename we will suggest to the browser download.
    const base = getBaseName(); // Base name without extension.
    const ext = getFormatExtension(); // Output extension.
    if (overwriteName.checked) return `${base}.${ext}`; // "Overwrite" mode: no "-edited" suffix.
    return `${base}-edited.${ext}`; // Default: keep the original file intact by naming the download differently.
  };

  const syncOutputName = () => {
    // Keep the preview label in sync with the current options.
    outputName.textContent = computeFileName(); // Show computed name in the panel.
  };

  formatSelect.addEventListener("change", () => {
    // Persist and reflect format changes.
    const value = getFormatExtension(); // Normalize to supported values.
    formatSelect.value = value; // Coerce away unsupported/disabled options.
    updateExportSettings({ format: value }); // Persist.
    syncOutputName(); // Refresh preview.
  });

  includeAnims.addEventListener("change", () => {
    // Persist animation include setting.
    updateExportSettings({ includeAnimations: includeAnims.checked }); // Persist preference.
  });

  onlyVisible.addEventListener("change", () => {
    // Persist visibility export behavior.
    updateExportSettings({ onlyVisible: onlyVisible.checked }); // Persist preference.
  });

  overwriteName.addEventListener("change", () => {
    // Persist filename behavior and update preview.
    updateExportSettings({ overwriteName: overwriteName.checked }); // Persist preference.
    syncOutputName(); // Refresh preview.
  });

  exportBtn.addEventListener("click", async () => {
    // Export the current model root as a GLB or glTF file.
    const root = editor.getModelRoot(); // Read the active model root.
    if (!root) return; // Guard: nothing to export.

    exportBtn.disabled = true; // Temporarily disable to prevent double-click exports.
    exportBtn.textContent = "Exporting…"; // Provide quick feedback.

    const unfreeze = animator.freeze(); // Freeze animation time so exports are deterministic even if playback is running.
    try {
      const exporter = new GLTFExporter(); // Create a new exporter instance for this export.
      const animations = includeAnims.checked ? animator.getClips() : []; // Include clips only when checkbox is enabled.
      const ext = getFormatExtension(); // Output format extension.
      const fileName = computeFileName(); // Suggested download filename.

      if (ext === "glb") {
        // GLB output is a single binary file (ArrayBuffer).
        const arrayBuffer = (await exporter.parseAsync(root, {
          binary: true,
          animations,
          onlyVisible: onlyVisible.checked,
        })) as ArrayBuffer;
        downloadArrayBuffer(arrayBuffer, fileName); // Trigger a browser download using an object URL.
      } else {
        // glTF output is JSON with embedded buffer data URIs (single .gltf file).
        const json = (await exporter.parseAsync(root, {
          binary: false,
          animations,
          onlyVisible: onlyVisible.checked,
        })) as Record<string, unknown>;
        downloadJson(json, fileName); // Download as a .gltf JSON file.
      }
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
    } finally {
      // Always restore animation playback even if export fails.
      unfreeze(); // Restore previous mixer.timeScale state.
    }

    exportBtn.textContent = "Export"; // Restore default button label.
    syncEnabled(); // Restore enabled/disabled state based on current model.
  });

  editor.onRootChange(() => {
    // When a new model is loaded, update enabled state and file name preview.
    syncEnabled(); // Enable/disable controls.
    syncOutputName(); // Update filename preview (base name may change).
  });
  syncEnabled(); // Initialize enabled state on first load.
  syncOutputName(); // Initialize filename preview.
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

function downloadJson(json: unknown, fileName: string): void {
  // Trigger a download of a JSON object as a text file in the browser.
  const text = JSON.stringify(json, null, 2); // Pretty-print so it's human-readable (useful for debugging).
  const blob = new Blob([text], { type: "model/gltf+json" }); // Use the glTF JSON mime type.
  const url = URL.createObjectURL(blob); // Create a temporary object URL.

  const a = document.createElement("a"); // Create a temporary anchor element.
  a.href = url; // Point it at the blob URL.
  a.download = fileName; // Suggest a filename to the browser.
  document.body.appendChild(a); // Add to DOM so the click is trusted by the browser.
  a.click(); // Programmatically click to start download.
  a.remove(); // Remove the element after triggering.

  URL.revokeObjectURL(url); // Release memory for the object URL.
}
