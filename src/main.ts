// src/main.ts
// This is the application entrypoint that Vite loads from `index.html`.
// Its job is to construct the core building blocks (viewer/loader/animator/helpers)
// and then connect them to the DOM UI wiring layer (`src/ui/controls.ts`).

import "./style.css"; // Import global CSS so Vite bundles it into the page.
import { Animator } from "./core/animator"; // Import the animation controller (AnimationMixer wrapper).
import { Helpers } from "./core/helpers"; // Import debug helpers (grid/axes/skeleton/wireframe).
import { ModelLoader } from "./core/loader"; // Import the GLB/GLTF loader for drag-and-drop files.
import { Viewer } from "./core/viewer"; // Import the Three.js viewer (scene/camera/renderer/loop).
import { initControls } from "./ui/controls"; // Import DOM wiring that binds buttons/inputs to core logic.

const canvas = document.getElementById("c") as HTMLCanvasElement | null; // Find the `<canvas id="c">` used for WebGL rendering.
if (!canvas) throw new Error("Canvas element not found."); // Fail fast if the expected element is missing (prevents null errors later).

const viewer = new Viewer(canvas); // Create the viewer, which owns WebGLRenderer + Scene + Camera + OrbitControls.
const helpers = new Helpers(viewer.getScene()); // Add debug helpers (grid/axes) to the viewer scene immediately.
const animator = new Animator(); // Create the animator (initially idle until a model with clips is loaded).
viewer.setOnTick((deltaSeconds) => {
  // Register a per-frame callback so non-render logic can advance with time.
  animator.update(deltaSeconds); // Advance AnimationMixer by the frame delta so clips can play smoothly.
  helpers.update(); // Update helpers that need per-frame syncing (e.g., SkeletonHelper follows animated bones).
}); // End of render-loop callback registration.
viewer.start(); // Start the requestAnimationFrame loop (renders continuously).

const loader = new ModelLoader(); // Create a loader instance for local drag-and-drop files.
initControls({ viewer, loader, animator, helpers }); // Wire DOM controls to the viewer/loader/animator/helpers instances.
