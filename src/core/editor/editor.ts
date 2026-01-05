// src/core/editor/editor.ts
// This module adds "Unity-like" editor features on top of the viewer runtime:
// - Track which model root is currently being edited (the loaded GLTF scene root)
// - Allow selecting objects (from viewport raycast picking or from the hierarchy panel)
// - Emit events so UI panels (Hierarchy/Inspector) can stay in sync with selection state
// - Draw a lightweight selection outline (BoxHelper) around the selected object
//
// Later phases extend this Editor with transform gizmos, undo/redo, export, etc.

import * as THREE from "three"; // Import Three.js types + utilities (Raycaster, Vector2, BoxHelper, math helpers).
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js"; // Import Unity-like transform gizmos (move/rotate/scale).
import type { Viewer } from "../viewer"; // Import Viewer type so Editor can access camera/scene/domElement.
import { HistoryStack, type EditorCommand } from "./history"; // Import a small undo/redo stack for editor commands.
import {
  applyTransform, // Apply a transform snapshot back onto an Object3D (used for undo/redo).
  captureTransform, // Capture an Object3D transform into an immutable snapshot.
  isTransformDifferent, // Compare two transform snapshots to avoid pushing no-op history entries.
  type TransformSnapshot, // Snapshot type for position/quaternion/scale.
} from "./transformSnapshot"; // Import transform snapshot helpers.

export type RootChangeListener = (root: THREE.Object3D | null) => void; // Listener type for model-root changes.
export type SelectionChangeListener = (selection: THREE.Object3D | null) => void; // Listener type for selection changes.
export type SelectionUpdatedListener = (selection: THREE.Object3D) => void; // Listener type for "selection changed in-place" updates (e.g., gizmo drag).

export type ToolMode = "select" | "move" | "rotate" | "scale"; // Tool modes exposed to the UI (Unity-style Q/W/E/R mapping).
export type ToolModeChangeListener = (mode: ToolMode) => void; // Listener type for tool mode changes.

export class Editor {
  // The Editor coordinates selection state and editor-only helpers.
  private readonly viewer: Viewer; // Reference to Viewer for camera/scene/domElement access.

  private modelRoot: THREE.Object3D | null = null; // The current editable model root (null when no model loaded).
  private selection: THREE.Object3D | null = null; // The currently selected object inside the model root.
  private sourceFileName: string | null = null; // The original filename of the loaded asset (used as a default export name).

  private readonly history = new HistoryStack(); // Undo/redo stack for editor operations.

  private readonly raycaster = new THREE.Raycaster(); // Raycaster converts screen points into 3D intersection tests.
  private readonly pointerNdc = new THREE.Vector2(); // Pointer position in Normalized Device Coordinates (-1..1).

  private selectionHelper: THREE.BoxHelper | null = null; // BoxHelper outline around the selected object.

  private readonly transformControls: TransformControls; // Transform gizmo that can attach to the current selection.
  private toolMode: ToolMode = "select"; // Current active tool mode (select by default).
  private isDraggingTransform = false; // True while the gizmo is actively dragging (used to avoid accidental picking).
  private gizmoStart: TransformSnapshot | null = null; // Transform snapshot captured at the start of a gizmo drag.
  private gizmoObject: THREE.Object3D | null = null; // Object that was being manipulated when the gizmo drag started.

  private snapEnabled = false; // Whether snapping is enabled for TransformControls.
  private translationSnap = 0.1; // World units per snap step for translation.
  private rotationSnapDeg = 15; // Degrees per snap step for rotation (converted to radians for TransformControls).
  private scaleSnap = 0.1; // Scale units per snap step for scaling.
  private space: "local" | "world" = "local"; // Local/world transform space for the gizmo.
  private nudgeStep = 0.05; // World units per arrow-key nudge (wired in shortcuts later).

  private readonly rootListeners = new Set<RootChangeListener>(); // Subscribers for root changes.
  private readonly selectionListeners = new Set<SelectionChangeListener>(); // Subscribers for selection changes.
  private readonly selectionUpdatedListeners = new Set<SelectionUpdatedListener>(); // Subscribers for in-place selection updates.
  private readonly toolModeListeners = new Set<ToolModeChangeListener>(); // Subscribers for tool mode changes.

  constructor(viewer: Viewer) {
    // Create an Editor bound to a Viewer instance.
    this.viewer = viewer; // Store viewer reference for later picking/highlight rendering.

    this.transformControls = new TransformControls(
      this.viewer.getCamera(), // TransformControls needs the active camera for gizmo raycasting and orientation.
      this.viewer.getDomElement(), // TransformControls needs the canvas DOM element to listen for pointer events.
    ); // End TransformControls constructor call.
    this.transformControls.visible = false; // Hide the gizmo until we have a selection + an active transform tool.
    this.transformControls.enabled = false; // Disable pointer handling until the user switches away from Select mode.
    this.viewer.getScene().add(this.transformControls); // Add gizmo to the scene so it renders in the viewport.

    this.transformControls.addEventListener("dragging-changed", (e) => {
      // TransformControls emits this event when the user starts/stops dragging the gizmo.
      const dragging = Boolean(
        (e as unknown as { value?: unknown }).value, // The event carries a `value` boolean (true while dragging).
      ); // Convert to a strict boolean.
      this.isDraggingTransform = dragging; // Store the state so the viewport picker can ignore clicks during drags.
      this.viewer.setOrbitEnabled(!dragging); // Disable OrbitControls while dragging so camera doesn't fight the gizmo.
    });

    this.transformControls.addEventListener("objectChange", () => {
      // This event fires when the attached object's transform changed (move/rotate/scale).
      const selection = this.selection; // Snapshot selection into a local variable for type-narrowing safety.
      if (!selection) return; // Guard: no selection means nothing to notify.
      this.selectionUpdatedListeners.forEach((fn) => fn(selection)); // Notify UI so Inspector fields can live-update.
    });

    this.transformControls.addEventListener("mouseDown", () => {
      // Capture a "before" transform snapshot when the user begins a gizmo drag.
      const selection = this.selection; // Snapshot current selection.
      if (!selection) return; // Guard: no selection means nothing to record.
      this.gizmoObject = selection; // Record which object is being manipulated.
      this.gizmoStart = captureTransform(selection); // Capture starting transform for undo/redo.
    });

    this.transformControls.addEventListener("mouseUp", (e) => {
      // When the gizmo drag ends, push an undoable transform command if anything changed.
      const object = this.gizmoObject; // Read the object that was manipulated.
      const before = this.gizmoStart; // Read the captured start snapshot.
      this.gizmoObject = null; // Clear state so the next drag starts fresh.
      this.gizmoStart = null; // Clear state so the next drag starts fresh.
      if (!object || !before) return; // Guard: nothing to commit.

      const after = captureTransform(object); // Capture ending transform for redo.
      if (!isTransformDifferent(before, after)) return; // Skip no-op commands (e.g., click without moving).

      const mode = String(
        (e as unknown as { mode?: unknown }).mode ?? "transform", // TransformControls mouseUp includes a `mode` string.
      ); // Normalize to a string.

      this.history.push({
        // Push a command that can undo/redo this transform change.
        label: `Transform (${mode})`, // Label for potential future UI (history list).
        undo: () => applyTransform(object, before), // Undo restores the start snapshot.
        redo: () => applyTransform(object, after), // Redo restores the end snapshot.
      });
    });
  }

  public setModelRoot(root: THREE.Object3D | null): void {
    // Set the current editable model root (call when a model is loaded/unloaded).
    if (this.modelRoot === root) return; // Avoid redundant work if nothing changed.
    this.clearSelection(); // Clear selection so we never keep references to objects from the previous model.
    this.history.clear(); // Clear undo/redo history because it may reference objects from the previous model.
    this.modelRoot = root; // Store the new root.
    if (!root) this.sourceFileName = null; // Clear source filename when the model is unloaded.
    this.rootListeners.forEach((fn) => fn(root)); // Notify UI panels so they can rebuild hierarchy lists, etc.
  }

  public setSourceFileName(fileName: string | null): void {
    // Store the original filename of the loaded asset (used for export naming).
    this.sourceFileName = fileName; // Keep the name as-is (UI can strip extensions as needed).
  }

  public getSourceFileName(): string | null {
    // Read the stored original filename of the current asset.
    return this.sourceFileName; // Return filename (or null if none).
  }

  public getModelRoot(): THREE.Object3D | null {
    // Expose the current model root to UI layers (read-only).
    return this.modelRoot; // Return the root reference (treat as read-only by convention).
  }

  public onRootChange(listener: RootChangeListener): () => void {
    // Subscribe to model root changes; returns an unsubscribe function.
    this.rootListeners.add(listener); // Register listener.
    return () => this.rootListeners.delete(listener); // Return cleanup callback.
  }

  public getSelection(): THREE.Object3D | null {
    // Expose the current selection to UI layers (read-only).
    return this.selection; // Return the selected object (or null if none).
  }

  public onSelectionChange(listener: SelectionChangeListener): () => void {
    // Subscribe to selection changes; returns an unsubscribe function.
    this.selectionListeners.add(listener); // Register listener.
    return () => this.selectionListeners.delete(listener); // Return cleanup callback.
  }

  public onSelectionUpdated(listener: SelectionUpdatedListener): () => void {
    // Subscribe to in-place updates of the selected object (e.g., gizmo dragged).
    this.selectionUpdatedListeners.add(listener); // Register listener.
    return () => this.selectionUpdatedListeners.delete(listener); // Return cleanup callback.
  }

  public notifySelectionUpdated(): void {
    // Manually notify that the selected object changed without changing selection (used by the Inspector).
    const selection = this.selection; // Snapshot selection into a local variable for type-narrowing safety.
    if (!selection) return; // No selection means nothing to notify.
    this.selectionUpdatedListeners.forEach((fn) => fn(selection)); // Notify all listeners with the current selection.
  }

  public getToolMode(): ToolMode {
    // Expose current tool mode so the UI can highlight the active tool button.
    return this.toolMode; // Return current mode string.
  }

  public onToolModeChange(listener: ToolModeChangeListener): () => void {
    // Subscribe to tool mode changes (important once keyboard shortcuts can switch tools).
    this.toolModeListeners.add(listener); // Register listener.
    return () => this.toolModeListeners.delete(listener); // Return cleanup callback.
  }

  public setToolMode(mode: ToolMode): void {
    // Set the active editor tool mode (Select/Move/Rotate/Scale).
    if (this.toolMode === mode) return; // No-op if nothing changed.
    this.toolMode = mode; // Store the new mode.

    if (mode === "move") this.transformControls.setMode("translate"); // Map UI "move" to TransformControls "translate".
    if (mode === "rotate") this.transformControls.setMode("rotate"); // Map UI "rotate" to TransformControls "rotate".
    if (mode === "scale") this.transformControls.setMode("scale"); // Map UI "scale" to TransformControls "scale".

    this.syncTransformControls(); // Attach/detach + enable/disable based on current selection and tool mode.
    this.toolModeListeners.forEach((fn) => fn(mode)); // Notify listeners so UI can update active button state.
  }

  public isTransformDragging(): boolean {
    // Expose whether the gizmo is currently dragging (useful to avoid accidental selection clears).
    return this.isDraggingTransform; // Return the internal flag.
  }

  public pushCommand(command: EditorCommand): void {
    // Push a custom undoable command (used by UI like the Inspector for non-gizmo changes).
    this.history.push(command); // Delegate to the HistoryStack implementation.
  }

  public undo(): void {
    // Undo the most recent editor command.
    this.history.undo(); // Undo the command via the history stack.
    this.notifySelectionUpdated(); // Refresh inspector values if the selected object was affected.
  }

  public redo(): void {
    // Redo the most recently undone editor command.
    this.history.redo(); // Redo the command via the history stack.
    this.notifySelectionUpdated(); // Refresh inspector values if the selected object was affected.
  }

  public deleteSelection(): void {
    // Delete the currently selected object from the model hierarchy (undoable).
    const selection = this.selection; // Snapshot selection.
    if (!selection) return; // Guard: nothing to delete.
    if (this.modelRoot && selection === this.modelRoot) return; // Do not allow deleting the model root (too destructive).

    const parent = selection.parent; // Read current parent (needed to remove and restore).
    if (!parent) return; // Guard: cannot delete objects that are not attached.

    const index = parent.children.indexOf(selection); // Record the original index for stable undo ordering.
    parent.remove(selection); // Remove from scene graph (stops rendering and updating).
    this.clearSelection(); // Clear selection so gizmos/outline detach cleanly.

    const restoreAtIndex = () => {
      // Helper: re-add the object and restore its original sibling order as best as possible.
      parent.add(selection); // Add back to parent (Three.js will append by default).
      moveChildToIndex(parent, selection, index); // Reorder children array to restore the original index.
    };

    this.history.push({
      // Push an undoable delete command.
      label: "Delete", // Label for history UI.
      undo: () => {
        // Undo re-adds the object and re-selects it.
        restoreAtIndex(); // Restore object into the hierarchy.
        this.select(selection); // Reselect so the user can continue editing.
      },
      redo: () => {
        // Redo removes the object again and clears selection.
        parent.remove(selection); // Remove again.
        this.clearSelection(); // Clear selection for consistency.
      },
    });
  }

  public setSnapEnabled(enabled: boolean): void {
    // Enable/disable snapping for gizmo operations.
    this.snapEnabled = enabled; // Store toggle state.
    this.applyTransformSettings(); // Apply to TransformControls immediately.
  }

  public setTranslationSnap(step: number): void {
    // Set translation snap step in world units.
    if (!Number.isFinite(step)) return; // Ignore invalid values.
    this.translationSnap = Math.max(0, step); // Clamp to 0+ to avoid negative snap steps.
    this.applyTransformSettings(); // Apply to TransformControls.
  }

  public setRotationSnapDegrees(stepDeg: number): void {
    // Set rotation snap step in degrees (UI uses degrees; TransformControls uses radians internally).
    if (!Number.isFinite(stepDeg)) return; // Ignore invalid values.
    this.rotationSnapDeg = Math.max(0, stepDeg); // Clamp to 0+ (0 effectively disables snapping).
    this.applyTransformSettings(); // Apply updated snap.
  }

  public setScaleSnap(step: number): void {
    // Set scale snap step in scale units.
    if (!Number.isFinite(step)) return; // Ignore invalid values.
    this.scaleSnap = Math.max(0, step); // Clamp to 0+ to avoid negative snap steps.
    this.applyTransformSettings(); // Apply updated snap.
  }

  public setSpace(space: "local" | "world"): void {
    // Set whether the gizmo operates in local space or world space.
    this.space = space; // Store space setting.
    this.applyTransformSettings(); // Apply to TransformControls immediately.
  }

  public getSpace(): "local" | "world" {
    // Expose current gizmo space so UI can stay in sync.
    return this.space; // Return the current space string.
  }

  public setNudgeStep(step: number): void {
    // Set the arrow-key nudge step in world units.
    if (!Number.isFinite(step)) return; // Ignore invalid values.
    this.nudgeStep = Math.max(0, step); // Clamp to 0+ (0 effectively disables nudging).
  }

  public getNudgeStep(): number {
    // Expose the configured nudge step for keyboard shortcuts.
    return this.nudgeStep; // Return stored nudge amount.
  }

  public select(object: THREE.Object3D | null): void {
    // Select an object inside the current model, or pass null to clear selection.
    if (object && this.modelRoot && !isDescendantOrSelf(object, this.modelRoot)) {
      // Defensive guard: ignore selections that do not belong to the current model root.
      return; // This prevents accidental selection of helpers or stale objects from previous loads.
    }

    if (this.selection === object) return; // No-op if selection is unchanged.
    this.selection = object; // Store new selection.

    if (!this.selection) {
      // If selection is cleared...
      this.disposeSelectionHelper(); // ...remove outline helper from the scene and free GPU resources.
      this.syncTransformControls(); // ...detach and hide transform controls since there's no target to manipulate.
      this.selectionListeners.forEach((fn) => fn(null)); // Notify listeners that selection is now empty.
      return; // Done.
    }

    this.ensureSelectionHelper(this.selection); // Create (or retarget) the BoxHelper to the new selection.
    this.syncTransformControls(); // Attach gizmo to selection if the current tool mode requires it.
    this.selectionListeners.forEach((fn) => fn(this.selection)); // Notify listeners of the new selection.
  }

  public clearSelection(): void {
    // Convenience wrapper to clear selection state.
    this.select(null); // Delegate to select(null) so listeners/helper cleanup happen consistently.
  }

  public pick(clientX: number, clientY: number): void {
    // Raycast from a screen point (mouse coordinates) and select the first hit object.
    if (!this.modelRoot) return; // Without a model root there is nothing to pick.
    if (this.isDraggingTransform) return; // Avoid changing selection while the gizmo is mid-drag.

    const dom = this.viewer.getDomElement(); // The canvas element that receives pointer events.
    const rect = dom.getBoundingClientRect(); // Read the canvas position/size in CSS pixels.
    if (rect.width === 0 || rect.height === 0) return; // Guard against division by zero if canvas is collapsed.

    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1; // Convert to NDC X (-1 left, +1 right).
    this.pointerNdc.y = -(((clientY - rect.top) / rect.height) * 2 - 1); // Convert to NDC Y (+1 top, -1 bottom).

    this.raycaster.setFromCamera(this.pointerNdc, this.viewer.getCamera()); // Build a ray starting at the camera through the pointer.
    const hits = this.raycaster.intersectObject(this.modelRoot, true); // Intersect the ray with the model root and all descendants.

    const hit = hits[0]; // Take the closest hit (Three.js sorts by distance).
    if (!hit) {
      // If we didn't hit anything...
      this.clearSelection(); // ...clear selection (Unity-like behavior).
      return; // Done.
    }

    this.select(hit.object); // Select the actual mesh/object that the ray hit.
  }

  public update(): void {
    // Per-frame update hook (called from Viewer tick).
    this.selectionHelper?.update(); // Keep the selection outline in sync with animated/skinned meshes.
  }

  public dispose(): void {
    // Dispose editor-owned helpers (useful if the app ever unmounts).
    this.disposeSelectionHelper(); // Free outline helper GPU resources.
    this.viewer.getScene().remove(this.transformControls); // Remove gizmo from the scene graph.
    this.transformControls.dispose(); // Remove event listeners and dispose gizmo geometry/materials.
    this.selection = null; // Clear selection reference.
    this.modelRoot = null; // Clear root reference.
    this.sourceFileName = null; // Clear stored filename.
    this.history.clear(); // Clear history to release closures referencing objects.
    this.rootListeners.clear(); // Drop all subscriptions (callers should also unsubscribe).
    this.selectionListeners.clear(); // Drop all subscriptions.
    this.selectionUpdatedListeners.clear(); // Drop subscriptions.
    this.toolModeListeners.clear(); // Drop subscriptions.
  }

  private ensureSelectionHelper(target: THREE.Object3D): void {
    // Create the BoxHelper if needed, or retarget it to a different object.
    if (!this.selectionHelper) {
      // If there is no helper yet, create it.
      this.selectionHelper = new THREE.BoxHelper(target, 0x7aa2f7); // Create an outline box with an accent color.
      this.selectionHelper.renderOrder = 999; // Draw late so the outline is less likely to be hidden by other objects.
      (this.selectionHelper.material as THREE.LineBasicMaterial).depthTest = false; // Disable depth test so outline is visible through geometry.
      this.viewer.getScene().add(this.selectionHelper); // Add the helper to the scene so it renders.
      return; // Done.
    }

    this.selectionHelper.setFromObject(target); // Retarget helper to the new object and recompute its bounding box.
  }

  private disposeSelectionHelper(): void {
    // Remove and dispose the selection outline helper.
    if (!this.selectionHelper) return; // Guard against double-dispose.
    this.viewer.getScene().remove(this.selectionHelper); // Remove from scene so it stops rendering.
    this.selectionHelper.dispose(); // Dispose helper geometry/material (BoxHelper provides a dispose() convenience).
    this.selectionHelper = null; // Clear reference so GC can collect the JS object.
  }

  private syncTransformControls(): void {
    // Ensure TransformControls attachment/visibility/enabled state matches selection + tool mode.
    this.transformControls.setSpace(this.space); // Apply current space setting (local/world).
    this.applyTransformSettings(); // Apply snap settings (translation/rotation/scale snap).

    if (this.toolMode === "select") {
      // Select tool means no gizmo in the viewport.
      this.transformControls.enabled = false; // Disable pointer interactions so the gizmo does not capture events.
      this.transformControls.detach(); // Detach hides the gizmo and clears axis state.
      return; // Done.
    }

    this.transformControls.enabled = true; // Enable pointer interactions for transform tools.

    if (!this.selection) {
      // If we have no selection, keep gizmo hidden even though a transform tool is active.
      this.transformControls.detach(); // Ensure it is detached and invisible.
      return; // Done.
    }

    this.transformControls.attach(this.selection); // Attach gizmo to the selected object so user can manipulate it.
  }

  private applyTransformSettings(): void {
    // Apply snapping + space settings to TransformControls.
    this.transformControls.setSpace(this.space); // Set local/world space for gizmo axes orientation.

    const translationSnap = this.snapEnabled ? this.translationSnap : null; // Use null when snapping is disabled.
    this.transformControls.setTranslationSnap(translationSnap); // Apply translation snap (0/ null disables in TransformControls internals).

    const rotationSnap = this.snapEnabled
      ? THREE.MathUtils.degToRad(this.rotationSnapDeg) // Convert UI degrees to radians required by TransformControls.
      : null; // Disable rotation snap when snapping toggle is off.
    this.transformControls.setRotationSnap(rotationSnap); // Apply rotation snap step.

    const scaleSnap = this.snapEnabled ? this.scaleSnap : null; // Disable scale snap when snapping toggle is off.
    this.transformControls.setScaleSnap(scaleSnap); // Apply scale snap step.
  }
}

function isDescendantOrSelf(object: THREE.Object3D, root: THREE.Object3D): boolean {
  // Return true if `object` is `root` or is inside `root`'s subtree.
  let current: THREE.Object3D | null = object; // Start at the object itself.
  while (current) {
    // Walk up the parent chain until we reach the top.
    if (current === root) return true; // If we reach the root, the object belongs to this model.
    current = current.parent; // Move upward one level.
  }
  return false; // If we never reached root, the object is outside the subtree.
}

function moveChildToIndex(parent: THREE.Object3D, child: THREE.Object3D, targetIndex: number): void {
  // Reorder `parent.children` so `child` ends up at `targetIndex`.
  const currentIndex = parent.children.indexOf(child); // Find where the child currently lives.
  if (currentIndex === -1) return; // If child isn't a child anymore, do nothing.
  parent.children.splice(currentIndex, 1); // Remove child from its current position.
  const clamped = Math.max(0, Math.min(targetIndex, parent.children.length)); // Clamp target index to valid bounds.
  parent.children.splice(clamped, 0, child); // Insert child back at the desired index.
}
