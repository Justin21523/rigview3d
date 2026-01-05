// src/main.ts
// This is the application entrypoint that Vite loads from `index.html`.
// Its job is to construct the core building blocks (viewer/loader/animator/helpers)
// and then connect them to the DOM UI wiring layer (`src/ui/controls.ts`).

import "./style.css"; // Import global CSS so Vite bundles it into the page.
import { Animator } from "./core/animator"; // Import the animation controller (AnimationMixer wrapper).
import { Editor } from "./core/editor/editor"; // Import the editor system (selection now; gizmos/undo/export later).
import { Helpers } from "./core/helpers"; // Import debug helpers (grid/axes/skeleton/wireframe).
import { ModelLoader } from "./core/loader"; // Import the GLB/GLTF loader for drag-and-drop files.
import { Viewer } from "./core/viewer"; // Import the Three.js viewer (scene/camera/renderer/loop).
import { initControls } from "./ui/controls"; // Import DOM wiring that binds buttons/inputs to core logic.
import { initEditorUi } from "./ui/editor"; // Import editor UI wiring (hierarchy + click-to-select).
import { initInspectorUi } from "./ui/inspector"; // Import Inspector panel wiring (transform + material editing).
import { initSceneUi } from "./ui/scene"; // Import Scene panel wiring (background + lights).
import { initToolUi } from "./ui/tools"; // Import Tools panel wiring (Select/Move/Rotate/Scale + snapping).

const canvas = document.getElementById("c") as HTMLCanvasElement | null; // Find the `<canvas id="c">` used for WebGL rendering.
if (!canvas) throw new Error("Canvas element not found."); // Fail fast if the expected element is missing (prevents null errors later).

const viewer = new Viewer(canvas); // Create the viewer, which owns WebGLRenderer + Scene + Camera + OrbitControls.
const helpers = new Helpers(viewer.getScene()); // Add debug helpers (grid/axes) to the viewer scene immediately.
const animator = new Animator(); // Create the animator (initially idle until a model with clips is loaded).
const editor = new Editor(viewer); // Create the editor (selection + hierarchy; later adds gizmos/undo/export).
viewer.setOnTick((deltaSeconds) => {
  // Register a per-frame callback so non-render logic can advance with time.
  animator.update(deltaSeconds); // Advance AnimationMixer by the frame delta so clips can play smoothly.
  helpers.update(); // Update helpers that need per-frame syncing (e.g., SkeletonHelper follows animated bones).
  editor.update(); // Update editor helpers (selection outline needs per-frame updates for animated meshes).
}); // End of render-loop callback registration.
viewer.start(); // Start the requestAnimationFrame loop (renders continuously).

const loader = new ModelLoader(); // Create a loader instance for local drag-and-drop files.
initControls({ viewer, loader, animator, helpers, editor }); // Wire the main UI controls to core systems.
initEditorUi(editor); // Wire editor panels (Hierarchy) and viewport picking to the Editor instance.
initToolUi(editor); // Wire the transform tool panel to TransformControls.
initInspectorUi(editor); // Wire the Inspector panel to the current selection.
initSceneUi(viewer); // Wire the Scene panel to background and lighting settings.
