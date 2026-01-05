// src/ui/scene.ts
// This module wires the "Scene" panel (background + light intensities) to the Viewer.
// It keeps UI sliders/color pickers synchronized with the current Three.js scene state.

import type { Viewer } from "../core/viewer"; // Import Viewer type (owns scene background and lights).

export function initSceneUi(viewer: Viewer): void {
  // Public API: attach Scene panel behavior to the DOM.
  const bg = mustGetEl("scene-bg") as HTMLInputElement; // Background color picker.

  const dir = mustGetEl("scene-dir-intensity") as HTMLInputElement; // Slider for key (directional) light intensity.
  const dirValue = mustGetEl("scene-dir-intensity-value"); // Text label that shows directional intensity value.

  const hemi = mustGetEl("scene-hemi-intensity") as HTMLInputElement; // Slider for fill (hemisphere) light intensity.
  const hemiValue = mustGetEl("scene-hemi-intensity-value"); // Text label that shows hemisphere intensity value.

  bg.addEventListener("input", () => {
    // Update the Three.js scene background color as the user picks a color.
    viewer.setBackground(bg.value); // HTML color input returns a CSS hex string like "#rrggbb".
  });

  dir.addEventListener("input", () => {
    // Update key light intensity as the user drags the slider.
    const value = Number(dir.value); // Parse slider value.
    if (!Number.isFinite(value)) return; // Ignore invalid values.
    viewer.setKeyLightIntensity(value); // Apply intensity to directional light.
    dirValue.textContent = value.toFixed(2); // Update label to match slider value.
  });

  hemi.addEventListener("input", () => {
    // Update fill light intensity as the user drags the slider.
    const value = Number(hemi.value); // Parse slider value.
    if (!Number.isFinite(value)) return; // Ignore invalid values.
    viewer.setFillLightIntensity(value); // Apply intensity to hemisphere light.
    hemiValue.textContent = value.toFixed(2); // Update label to match slider value.
  });

  // Initialize UI values from Viewer so the panel reflects the real scene state.
  bg.value = viewer.getBackgroundColorHex(); // Sync background color input to scene background.

  dir.value = String(viewer.getKeyLightIntensity()); // Sync directional intensity slider.
  dirValue.textContent = viewer.getKeyLightIntensity().toFixed(2); // Sync directional value label.

  hemi.value = String(viewer.getFillLightIntensity()); // Sync hemisphere intensity slider.
  hemiValue.textContent = viewer.getFillLightIntensity().toFixed(2); // Sync hemisphere value label.
}

function mustGetEl(id: string): HTMLElement {
  // Convenience helper that guarantees an element exists (or throws early).
  const el = document.getElementById(id); // Query DOM by id.
  if (!el) throw new Error(`Missing element: #${id}`); // Throw a readable error if markup is missing.
  return el; // Return as non-null.
}

