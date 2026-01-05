import type { Viewer } from "../core/viewer";

export function initControls({ viewer }: { viewer: Viewer }): void {
  const resetButton = document.getElementById("btn-reset-camera");
  resetButton?.addEventListener("click", () => viewer.resetCamera());
}

