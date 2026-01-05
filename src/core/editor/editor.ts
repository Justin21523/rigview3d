// src/core/editor/editor.ts
// This module adds "Unity-like" editor features on top of the viewer runtime:
// - Track which model root is currently being edited (the loaded GLTF scene root)
// - Allow selecting objects (from viewport raycast picking or from the hierarchy panel)
// - Emit events so UI panels (Hierarchy/Inspector) can stay in sync with selection state
// - Draw a lightweight selection outline (BoxHelper) around the selected object
//
// Later phases extend this Editor with transform gizmos, undo/redo, export, etc.

import * as THREE from "three"; // Import Three.js types + utilities (Raycaster, Vector2, BoxHelper).
import type { Viewer } from "../viewer"; // Import Viewer type so Editor can access camera/scene/domElement.

export type RootChangeListener = (root: THREE.Object3D | null) => void; // Listener type for model-root changes.
export type SelectionChangeListener = (selection: THREE.Object3D | null) => void; // Listener type for selection changes.

export class Editor {
  // The Editor coordinates selection state and editor-only helpers.
  private readonly viewer: Viewer; // Reference to Viewer for camera/scene/domElement access.

  private modelRoot: THREE.Object3D | null = null; // The current editable model root (null when no model loaded).
  private selection: THREE.Object3D | null = null; // The currently selected object inside the model root.

  private readonly raycaster = new THREE.Raycaster(); // Raycaster converts screen points into 3D intersection tests.
  private readonly pointerNdc = new THREE.Vector2(); // Pointer position in Normalized Device Coordinates (-1..1).

  private selectionHelper: THREE.BoxHelper | null = null; // BoxHelper outline around the selected object.

  private readonly rootListeners = new Set<RootChangeListener>(); // Subscribers for root changes.
  private readonly selectionListeners = new Set<SelectionChangeListener>(); // Subscribers for selection changes.

  constructor(viewer: Viewer) {
    // Create an Editor bound to a Viewer instance.
    this.viewer = viewer; // Store viewer reference for later picking/highlight rendering.
  }

  public setModelRoot(root: THREE.Object3D | null): void {
    // Set the current editable model root (call when a model is loaded/unloaded).
    if (this.modelRoot === root) return; // Avoid redundant work if nothing changed.
    this.clearSelection(); // Clear selection so we never keep references to objects from the previous model.
    this.modelRoot = root; // Store the new root.
    this.rootListeners.forEach((fn) => fn(root)); // Notify UI panels so they can rebuild hierarchy lists, etc.
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
      this.selectionListeners.forEach((fn) => fn(null)); // Notify listeners that selection is now empty.
      return; // Done.
    }

    this.ensureSelectionHelper(this.selection); // Create (or retarget) the BoxHelper to the new selection.
    this.selectionListeners.forEach((fn) => fn(this.selection)); // Notify listeners of the new selection.
  }

  public clearSelection(): void {
    // Convenience wrapper to clear selection state.
    this.select(null); // Delegate to select(null) so listeners/helper cleanup happen consistently.
  }

  public pick(clientX: number, clientY: number): void {
    // Raycast from a screen point (mouse coordinates) and select the first hit object.
    if (!this.modelRoot) return; // Without a model root there is nothing to pick.

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
    this.selection = null; // Clear selection reference.
    this.modelRoot = null; // Clear root reference.
    this.rootListeners.clear(); // Drop all subscriptions (callers should also unsubscribe).
    this.selectionListeners.clear(); // Drop all subscriptions.
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

