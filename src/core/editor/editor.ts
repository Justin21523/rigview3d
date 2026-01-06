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
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js"; // Import a clone helper that preserves SkinnedMesh skeleton bindings.
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
  private hover: THREE.Object3D | null = null; // The currently hovered object (used for non-committal hover feedback).
  private sourceFileName: string | null = null; // The original filename of the loaded asset (used as a default export name).

  private readonly history = new HistoryStack(); // Undo/redo stack for editor operations.

  private readonly raycaster = new THREE.Raycaster(); // Raycaster converts screen points into 3D intersection tests.
  private readonly pointerNdc = new THREE.Vector2(); // Pointer position in Normalized Device Coordinates (-1..1).

  private selectionHelper: THREE.BoxHelper | null = null; // BoxHelper outline around the selected object.
  private hoverHelper: THREE.BoxHelper | null = null; // BoxHelper outline around the hovered object (lighter than selection).

  private readonly transformControls: TransformControls; // Transform gizmo that can attach to the current selection.
  private toolMode: ToolMode = "move"; // Current active tool mode (default to Move so gizmo is visible like Unity).
  private isDraggingTransform = false; // True while the gizmo is actively dragging (used to avoid accidental picking).
  private gizmoStart: TransformSnapshot | null = null; // Transform snapshot captured at the start of a gizmo drag.
  private gizmoObject: THREE.Object3D | null = null; // Object that was being manipulated when the gizmo drag started.

  private snapEnabled = false; // Whether snapping is enabled for TransformControls.
  private translationSnap = 0.1; // World units per snap step for translation.
  private rotationSnapDeg = 15; // Degrees per snap step for rotation (converted to radians for TransformControls).
  private scaleSnap = 0.1; // Scale units per snap step for scaling.
  private space: "local" | "world" = "local"; // Local/world transform space for the gizmo.
  private nudgeStep = 0.05; // World units per arrow-key nudge (wired in shortcuts later).
  private gizmoSize = 1; // Visual size multiplier for TransformControls (does not affect actual transforms).

  private readonly rootListeners = new Set<RootChangeListener>(); // Subscribers for root changes.
  private readonly selectionListeners = new Set<SelectionChangeListener>(); // Subscribers for selection changes.
  private readonly selectionUpdatedListeners = new Set<SelectionUpdatedListener>(); // Subscribers for in-place selection updates.
  private readonly toolModeListeners = new Set<ToolModeChangeListener>(); // Subscribers for tool mode changes.

  private readonly handleGlobalPointerEnd = () => this.onGlobalPointerEnd(); // Bound handler for pointerup/pointercancel recovery.
  private readonly handleGlobalBlur = () => this.onGlobalBlur(); // Bound handler for blur recovery (prevents stuck camera locks).

  constructor(viewer: Viewer) {
    // Create an Editor bound to a Viewer instance.
    this.viewer = viewer; // Store viewer reference for later picking/highlight rendering.

    this.transformControls = new TransformControls(
      this.viewer.getCamera(), // TransformControls needs the active camera for gizmo raycasting and orientation.
      this.viewer.getDomElement(), // TransformControls needs the canvas DOM element to listen for pointer events.
    ); // End TransformControls constructor call.
    this.transformControls.visible = false; // Hide the gizmo until we have a selection + an active transform tool.
    this.transformControls.enabled = true; // Allow pointer handling for the default Move tool (gizmo still hidden until attach()).
    this.transformControls.setMode("translate"); // Default to translation gizmo so first selection is immediately draggable.
    this.transformControls.setSize(this.gizmoSize); // Apply default gizmo size immediately so UI slider matches behavior.
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

    // Failsafe: if a pointer interaction ends outside the canvas (or gets cancelled),
    // TransformControls can miss the "dragging end" signal and OrbitControls can stay disabled.
    window.addEventListener("pointerup", this.handleGlobalPointerEnd, { passive: true }); // Recover on pointer release anywhere.
    window.addEventListener("pointercancel", this.handleGlobalPointerEnd, { passive: true }); // Recover on pointer cancellation.
    window.addEventListener("blur", this.handleGlobalBlur); // Recover when the tab loses focus mid-drag.
  }

  public setModelRoot(root: THREE.Object3D | null): void {
    // Set the current editable model root (call when a model is loaded/unloaded).
    if (this.modelRoot === root) return; // Avoid redundant work if nothing changed.
    this.clearSelection(); // Clear selection so we never keep references to objects from the previous model.
    this.clearHover(); // Clear hover state because it can reference objects from the previous model.
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

  public getHover(): THREE.Object3D | null {
    // Expose the current hovered object (used by UI for cursor feedback).
    return this.hover; // Return the hovered object (or null if none).
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

  public duplicateSelection(): void {
    // Duplicate the selected object as a sibling under the same parent (undoable).
    const selection = this.selection; // Snapshot selection (we want a stable reference for history closures).
    if (!selection) return; // Guard: nothing selected means nothing to duplicate.
    if (this.modelRoot && selection === this.modelRoot) return; // Avoid duplicating the model root (too large / confusing).

    const parent = selection.parent; // Read current parent so we can insert the duplicate as a sibling.
    if (!parent) return; // Guard: cannot duplicate objects that are not attached to a parent.

    const index = parent.children.indexOf(selection); // Record original index so we can insert the duplicate next to the source.
    if (index === -1) return; // Guard: should not happen, but avoids out-of-bounds behavior.

    const duplicate = cloneSkeleton(selection); // Clone the subtree (handles SkinnedMesh skeleton rebinding correctly).
    duplicate.name = makeUniqueDuplicateName(selection, parent); // Give the duplicate a readable, unique name.
    duplicate.updateMatrixWorld(true); // Ensure matrices are computed so helpers/gizmos behave correctly immediately.

    const addDuplicate = () => {
      // Add the duplicate back under the same parent in a stable sibling order.
      parent.add(duplicate); // Attach duplicate to the parent (appends at end by default).
      moveChildToIndex(parent, duplicate, index + 1); // Reorder children so the duplicate sits next to the source.
    };

    addDuplicate(); // Perform the duplication action immediately (history assumes effects are already applied).
    this.select(duplicate); // Unity-like behavior: select the newly duplicated object.

    this.history.push({
      // Push an undoable duplicate command.
      label: "Duplicate", // Label for history UI.
      undo: () => {
        // Undo removes the duplicate and re-selects the original.
        parent.remove(duplicate); // Detach the duplicate from the scene graph.
        this.select(selection); // Restore selection to the original object.
      },
      redo: () => {
        // Redo re-adds the duplicate and selects it again.
        addDuplicate(); // Re-attach at the original position.
        this.select(duplicate); // Select the duplicate.
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

  public setGizmoSize(size: number): void {
    // Set the visual size of TransformControls.
    if (!Number.isFinite(size)) return; // Ignore invalid values.
    this.gizmoSize = Math.max(0.01, size); // Clamp to a small positive number to avoid disappearing gizmos.
    this.transformControls.setSize(this.gizmoSize); // Apply to TransformControls so the viewport reflects the new size.
  }

  public getGizmoSize(): number {
    // Read the current gizmo size multiplier (useful for initializing UI).
    return this.gizmoSize; // Return current size.
  }

  public select(object: THREE.Object3D | null): void {
    // Select an object inside the current model, or pass null to clear selection.
    if (object && this.modelRoot && !isDescendantOrSelf(object, this.modelRoot)) {
      // Defensive guard: ignore selections that do not belong to the current model root.
      return; // This prevents accidental selection of helpers or stale objects from previous loads.
    }

    if (this.selection === object) return; // No-op if selection is unchanged.
    this.selection = object; // Store new selection.
    this.clearHover(); // Clear hover highlight so we never show double outlines on the selected object.

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

  public hoverAt(clientX: number, clientY: number): void {
    // Raycast from a screen point and update hover state (no selection changes).
    if (!this.modelRoot) {
      // Without a model root, there is nothing to hover.
      this.clearHover(); // Ensure hover helper is removed.
      return; // Done.
    }

    if (this.isDraggingTransform) {
      // While dragging the gizmo, we do not want hover highlights to flicker.
      this.clearHover(); // Hide hover helper.
      return; // Done.
    }

    const dom = this.viewer.getDomElement(); // The canvas element that receives pointer events.
    const rect = dom.getBoundingClientRect(); // Read the canvas position/size in CSS pixels.
    if (rect.width === 0 || rect.height === 0) return; // Guard against division by zero if canvas is collapsed.

    this.pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1; // Convert to NDC X (-1 left, +1 right).
    this.pointerNdc.y = -(((clientY - rect.top) / rect.height) * 2 - 1); // Convert to NDC Y (+1 top, -1 bottom).

    this.raycaster.setFromCamera(this.pointerNdc, this.viewer.getCamera()); // Build a ray from camera through pointer.
    const hits = this.raycaster.intersectObject(this.modelRoot, true); // Intersect only the model subtree (ignore helpers/gizmos).

    const hit = hits[0]; // Take the closest hit.
    const next = hit?.object ?? null; // Normalize to null when no hit.

    if (!next) {
      // If pointer is over empty space, clear hover.
      this.clearHover(); // Hide hover helper.
      return; // Done.
    }

    if (this.selection && next.uuid === this.selection.uuid) {
      // Avoid drawing both hover and selection outlines on the same object (looks noisy).
      this.clearHover(); // Selection outline already communicates focus.
      return; // Done.
    }

    if (this.hover && this.hover.uuid === next.uuid) {
      // If hover did not change, keep current helper (no extra work).
      return; // Done.
    }

    this.hover = next; // Store new hover object.
    this.ensureHoverHelper(next); // Create/retarget hover outline helper.
  }

  public clearHover(): void {
    // Clear hover state and remove hover helper from the scene.
    this.hover = null; // Clear reference so GC can collect old hovered object if needed.
    this.disposeHoverHelper(); // Remove and dispose hover helper resources.
  }

  public pick(
    clientX: number, // Pointer X in client (viewport) coordinates.
    clientY: number, // Pointer Y in client (viewport) coordinates.
    options: { exact?: boolean } = {}, // Options to control what gets selected.
  ): void {
    // Raycast from a screen point (mouse coordinates) and select a hit object.
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

    if (options.exact) {
      // Exact mode selects the specific mesh/object under the cursor.
      this.select(hit.object); // Select the actual hit object.
      return; // Done.
    }

    // Default mode selects the model root so transforms move the whole character/model (beginner-friendly).
    this.select(this.modelRoot); // Select the model root for whole-model transforms.
  }

  public update(): void {
    // Per-frame update hook (called from Viewer tick).
    this.selectionHelper?.update(); // Keep the selection outline in sync with animated/skinned meshes.
    this.hoverHelper?.update(); // Keep hover outline in sync with animated/skinned meshes.
  }

  public dispose(): void {
    // Dispose editor-owned helpers (useful if the app ever unmounts).
    this.disposeSelectionHelper(); // Free outline helper GPU resources.
    this.disposeHoverHelper(); // Free hover helper GPU resources.
    window.removeEventListener("pointerup", this.handleGlobalPointerEnd); // Remove global pointer recovery.
    window.removeEventListener("pointercancel", this.handleGlobalPointerEnd); // Remove global pointer recovery.
    window.removeEventListener("blur", this.handleGlobalBlur); // Remove global blur recovery.
    this.viewer.getScene().remove(this.transformControls); // Remove gizmo from the scene graph.
    this.transformControls.dispose(); // Remove event listeners and dispose gizmo geometry/materials.
    this.selection = null; // Clear selection reference.
    this.hover = null; // Clear hover reference.
    this.modelRoot = null; // Clear root reference.
    this.sourceFileName = null; // Clear stored filename.
    this.history.clear(); // Clear history to release closures referencing objects.
    this.rootListeners.clear(); // Drop all subscriptions (callers should also unsubscribe).
    this.selectionListeners.clear(); // Drop all subscriptions.
    this.selectionUpdatedListeners.clear(); // Drop subscriptions.
    this.toolModeListeners.clear(); // Drop subscriptions.
  }

  private onGlobalPointerEnd(): void {
    // Recover from lost pointer up/cancel events that can leave TransformControls in a "dragging" state.
    //
    // We schedule a microtask so TransformControls' own handlers (on the canvas) can run first.
    // If TransformControls updates `dragging` correctly, `isDraggingTransform` will already be false and we do nothing.
    queueMicrotask(() => {
      // Delay so our recovery doesn't interfere with normal TransformControls mouseUp history handling.
      if (!this.isDraggingTransform) return; // If not dragging, no recovery is needed.
      this.isDraggingTransform = false; // Clear our local dragging flag.
      this.viewer.setOrbitEnabled(true); // Re-enable orbit camera so the viewport doesn't feel "dead".
      this.gizmoObject = null; // Drop any in-progress snapshot state.
      this.gizmoStart = null; // Drop any in-progress snapshot state.

      // Reset TransformControls internal axis/highlight state by re-attaching if possible.
      if (this.toolMode !== "select" && this.selection) {
        // Re-attach to the current selection so the gizmo remains usable after recovery.
        this.transformControls.detach(); // Clear internal state.
        this.transformControls.attach(this.selection); // Restore attachment.
      } else {
        // If we're in Select mode or no selection, ensure the gizmo is detached and hidden.
        this.transformControls.detach(); // Hide gizmo.
      }
    });
  }

  private onGlobalBlur(): void {
    // Treat window blur as an "end of interaction" so camera controls can't get stuck.
    this.onGlobalPointerEnd(); // Reuse the same recovery logic as pointerup/cancel.
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

  private ensureHoverHelper(target: THREE.Object3D): void {
    // Create the hover BoxHelper if needed, or retarget it to a different object.
    if (!this.hoverHelper) {
      // If there is no hover helper yet, create it.
      this.hoverHelper = new THREE.BoxHelper(target, 0x9aa5ce); // Use a muted color so selection remains dominant.
      this.hoverHelper.renderOrder = 998; // Draw late, but still below the selection outline.
      (this.hoverHelper.material as THREE.LineBasicMaterial).depthTest = false; // Disable depth test so outline is visible through geometry.
      this.viewer.getScene().add(this.hoverHelper); // Add helper to the scene so it renders.
      return; // Done.
    }

    this.hoverHelper.setFromObject(target); // Retarget helper to the new object and recompute bbox.
  }

  private disposeSelectionHelper(): void {
    // Remove and dispose the selection outline helper.
    if (!this.selectionHelper) return; // Guard against double-dispose.
    this.viewer.getScene().remove(this.selectionHelper); // Remove from scene so it stops rendering.
    this.selectionHelper.dispose(); // Dispose helper geometry/material (BoxHelper provides a dispose() convenience).
    this.selectionHelper = null; // Clear reference so GC can collect the JS object.
  }

  private disposeHoverHelper(): void {
    // Remove and dispose the hover outline helper.
    if (!this.hoverHelper) return; // Guard against double-dispose.
    this.viewer.getScene().remove(this.hoverHelper); // Remove from scene so it stops rendering.
    this.hoverHelper.dispose(); // Dispose helper geometry/material.
    this.hoverHelper = null; // Clear reference so GC can collect the JS object.
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

function makeUniqueDuplicateName(source: THREE.Object3D, parent: THREE.Object3D): string {
  // Create a Unity-like duplicate name that is unique among the parent's current children.
  const base = source.name && source.name.trim() ? source.name.trim() : source.type; // Prefer the existing name; fall back to type.
  const existing = new Set(parent.children.map((c) => c.name)); // Collect sibling names to avoid collisions.

  const candidateBase = `${base} Copy`; // Use a readable "Copy" suffix (Unity-like).
  if (!existing.has(candidateBase)) return candidateBase; // If unused, return it immediately.

  for (let i = 1; i < 10_000; i++) {
    // Keep incrementing until we find a name that isn't used by a sibling.
    const candidate = `${candidateBase} (${i})`; // Add a numeric suffix like "Copy (1)".
    if (!existing.has(candidate)) return candidate; // Return the first unused candidate.
  }

  return `${candidateBase} (${Date.now()})`; // Fallback: use a timestamp if we somehow hit an extreme collision case.
}
