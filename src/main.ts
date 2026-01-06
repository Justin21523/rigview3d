// src/main.ts
// This is the application entrypoint that Vite loads from `index.html`.
// Its job is to construct the core building blocks (viewer/loader/animator/helpers)
// and then connect them to the DOM UI wiring layer (`src/ui/controls.ts`).

	// Note: Global CSS is loaded from `index.html` via a `<link>` tag (so the UI is styled even if JS fails early).
import { Animator } from "./core/animator"; // Import the animation controller (AnimationMixer wrapper).
import { Editor } from "./core/editor/editor"; // Import the editor system (selection now; gizmos/undo/export later).
import { Helpers } from "./core/helpers"; // Import debug helpers (grid/axes/skeleton/wireframe).
import { ModelLoader } from "./core/loader"; // Import the model loader for drag-and-drop files (GLB/GLTF/FBX).
import { getSettings } from "./core/settings"; // Import localStorage-backed settings (Tools/Scene/Debug persistence).
import { Viewer } from "./core/viewer"; // Import the Three.js viewer (scene/camera/renderer/loop).
import { initControls } from "./ui/controls"; // Import DOM wiring that binds buttons/inputs to core logic.
import { initEditorUi } from "./ui/editor"; // Import editor UI wiring (hierarchy + click-to-select).
import { initExportUi } from "./ui/export"; // Import Export panel wiring (GLB download).
import { initInspectorUi } from "./ui/inspector"; // Import Inspector panel wiring (transform + material editing).
import { initSceneUi } from "./ui/scene"; // Import Scene panel wiring (background + lights).
import { initShortcuts } from "./ui/shortcuts"; // Import keyboard shortcuts (Q/W/E/R, F, Esc, Del, undo/redo).
import { initToolUi } from "./ui/tools"; // Import Tools panel wiring (Select/Move/Rotate/Scale + snapping).

const canvas = document.getElementById("c") as HTMLCanvasElement | null; // Find the `<canvas id="c">` used for WebGL rendering.
if (!canvas) throw new Error("Canvas element not found."); // Fail fast if the expected element is missing (prevents null errors later).

const settings = getSettings(); // Load persisted user preferences (or defaults) before wiring UI.
applyInitialSettingsToDom(settings); // Apply settings to DOM inputs so UI modules read the persisted values on init.

const viewer = new Viewer(canvas); // Create the viewer, which owns WebGLRenderer + Scene + Camera + OrbitControls.
viewer.setBackground(settings.scene.background); // Apply persisted background color.
viewer.setKeyLightIntensity(settings.scene.keyLightIntensity); // Apply persisted key light intensity.
viewer.setFillLightIntensity(settings.scene.fillLightIntensity); // Apply persisted fill light intensity.
viewer.setUnityAltOrbitEnabled(settings.tools.unityAltOrbit); // Apply persisted camera navigation preference.

const helpers = new Helpers(viewer.getScene()); // Add debug helpers (grid/axes) to the viewer scene immediately.
const animator = new Animator(); // Create the animator (initially idle until a model with clips is loaded).
const editor = new Editor(viewer); // Create the editor (selection + hierarchy; later adds gizmos/undo/export).
editor.setToolMode(settings.tools.toolMode); // Apply persisted tool mode (Select/Move/Rotate/Scale) before UI init.
viewer.setOnTick((deltaSeconds) => {
  // Register a per-frame callback so non-render logic can advance with time.
  animator.update(deltaSeconds); // Advance AnimationMixer by the frame delta so clips can play smoothly.
  helpers.update(); // Update helpers that need per-frame syncing (e.g., SkeletonHelper follows animated bones).
  editor.update(); // Update editor helpers (selection outline needs per-frame updates for animated meshes).
}); // End of render-loop callback registration.
viewer.start(); // Start the requestAnimationFrame loop (renders continuously).

const loader = new ModelLoader(); // Create a loader instance for local drag-and-drop files.
initControls({ viewer, loader, animator, helpers, editor }); // Wire the main UI controls to core systems.
initEditorUi(viewer, editor); // Wire editor panels (Hierarchy) and viewport picking to the Editor instance.
initToolUi(viewer, editor); // Wire the transform tool panel and camera navigation toggles.
initInspectorUi(editor); // Wire the Inspector panel to the current selection.
initSceneUi(viewer); // Wire the Scene panel to background and lighting settings.
initExportUi(editor, animator); // Wire Export panel to GLTFExporter using the current model and animation clips.
initShortcuts(viewer, editor); // Register Unity-like keyboard shortcuts for common editor actions.

function applyInitialSettingsToDom(settings: ReturnType<typeof getSettings>): void {
  // Apply persisted settings to the existing DOM inputs before UI modules initialize.
  //
  // Why do this in `main.ts`?
  // - It keeps the persistence layer independent from individual UI modules
  // - It guarantees all init*Ui() functions read the same initial values
  const dbgGrid = document.getElementById("dbg-grid") as HTMLInputElement | null; // Debug: grid checkbox.
  const dbgAxes = document.getElementById("dbg-axes") as HTMLInputElement | null; // Debug: axes checkbox.
  const dbgSkeleton = document.getElementById("dbg-skeleton") as HTMLInputElement | null; // Debug: skeleton checkbox.
  const dbgWireframe = document.getElementById("dbg-wireframe") as HTMLInputElement | null; // Debug: wireframe checkbox.

  if (dbgGrid) dbgGrid.checked = settings.debug.grid; // Restore grid toggle.
  if (dbgAxes) dbgAxes.checked = settings.debug.axes; // Restore axes toggle.
  if (dbgSkeleton) dbgSkeleton.checked = settings.debug.skeleton; // Restore skeleton desired state.
  if (dbgWireframe) dbgWireframe.checked = settings.debug.wireframe; // Restore wireframe desired state.

  const hierarchyBones = document.getElementById("hierarchy-show-bones") as HTMLInputElement | null; // Hierarchy: show bones filter.
  const hierarchyHelpers = document.getElementById("hierarchy-show-helpers") as HTMLInputElement | null; // Hierarchy: show helpers filter.

  if (hierarchyBones) hierarchyBones.checked = settings.hierarchy.showBones; // Restore "show bones" preference.
  if (hierarchyHelpers) hierarchyHelpers.checked = settings.hierarchy.showHelpers; // Restore "show helpers" preference.

  const exportFormat = document.getElementById("export-format") as HTMLSelectElement | null; // Export: format select.
  const exportAnimations = document.getElementById("export-animations") as HTMLInputElement | null; // Export: include animations checkbox.
  const exportOnlyVisible = document.getElementById("export-only-visible") as HTMLInputElement | null; // Export: only-visible checkbox.
  const exportOverwriteName = document.getElementById("export-overwrite-name") as HTMLInputElement | null; // Export: filename mode checkbox.

  if (exportFormat) exportFormat.value = settings.export.format; // Restore export format.
  if (exportAnimations) exportAnimations.checked = settings.export.includeAnimations; // Restore include animations toggle.
  if (exportOnlyVisible) exportOnlyVisible.checked = settings.export.onlyVisible; // Restore only-visible toggle.
  if (exportOverwriteName) exportOverwriteName.checked = settings.export.overwriteName; // Restore overwrite-name toggle.

  const snapEnabled = document.getElementById("tool-snap-enabled") as HTMLInputElement | null; // Tools: snap checkbox.
  const snapMove = document.getElementById("tool-snap-move") as HTMLInputElement | null; // Tools: move step.
  const snapRotate = document.getElementById("tool-snap-rotate") as HTMLInputElement | null; // Tools: rotate step (deg).
  const snapScale = document.getElementById("tool-snap-scale") as HTMLInputElement | null; // Tools: scale step.
  const nudge = document.getElementById("tool-nudge") as HTMLInputElement | null; // Tools: keyboard nudge step.
  const gizmoSize = document.getElementById("tool-gizmo-size") as HTMLInputElement | null; // Tools: gizmo size slider.
  const localSpace = document.getElementById("tool-space-local") as HTMLInputElement | null; // Tools: local/world checkbox.
  const pivotMode = document.getElementById("tool-pivot-mode") as HTMLSelectElement | null; // Tools: pivot/center mode select.
  const axisX = document.getElementById("tool-axis-x") as HTMLInputElement | null; // Tools: X axis toggle.
  const axisY = document.getElementById("tool-axis-y") as HTMLInputElement | null; // Tools: Y axis toggle.
  const axisZ = document.getElementById("tool-axis-z") as HTMLInputElement | null; // Tools: Z axis toggle.
  const altOrbit = document.getElementById("tool-alt-orbit") as HTMLInputElement | null; // Tools: Unity-like Alt navigation toggle.
  const flyEnabled = document.getElementById("tool-fly-enabled") as HTMLInputElement | null; // Tools: fly toggle.
  const flySpeed = document.getElementById("tool-fly-speed") as HTMLInputElement | null; // Tools: fly speed slider.

  if (snapEnabled) snapEnabled.checked = settings.tools.snapEnabled; // Restore snap toggle.
  if (snapMove) snapMove.value = String(settings.tools.snapMove); // Restore move step.
  if (snapRotate) snapRotate.value = String(settings.tools.snapRotateDeg); // Restore rotate step.
  if (snapScale) snapScale.value = String(settings.tools.snapScale); // Restore scale step.
  if (nudge) nudge.value = String(settings.tools.nudgeStep); // Restore nudge step.
  if (gizmoSize) gizmoSize.value = String(settings.tools.gizmoSize); // Restore gizmo size.
  if (localSpace) localSpace.checked = settings.tools.localSpace; // Restore local/world.
  if (pivotMode) pivotMode.value = settings.tools.pivotMode; // Restore pivot/center mode.
  if (axisX) axisX.checked = settings.tools.axisX; // Restore X axis.
  if (axisY) axisY.checked = settings.tools.axisY; // Restore Y axis.
  if (axisZ) axisZ.checked = settings.tools.axisZ; // Restore Z axis.
  if (altOrbit) altOrbit.checked = settings.tools.unityAltOrbit; // Restore Alt navigation preference.
  if (flyEnabled) flyEnabled.checked = settings.tools.flyEnabled; // Restore fly mode.
  if (flySpeed) flySpeed.value = String(settings.tools.flySpeed); // Restore fly speed.
}
