// src/core/helpers.ts
// Helpers is responsible for debug visuals that sit "around" a loaded model:
// - Always-on scene helpers: GridHelper and AxesHelper
// - Model-dependent helpers: SkeletonHelper and wireframe rendering toggles
//
// Keeping these in one place makes it easier to:
// - Toggle visibility without touching Viewer internals
// - Dispose temporary helper meshes/materials cleanly
// - Keep helpers updated while animations are playing

import * as THREE from "three"; // Import Three.js types and helper classes.

export class Helpers {
  // A small manager object for debug visualization helpers.
  private readonly scene: THREE.Scene; // Scene to which all helpers are attached.
  private readonly grid: THREE.GridHelper; // Grid on the ground plane for scale/orientation.
  private readonly axes: THREE.AxesHelper; // XYZ axes indicator for orientation.

  private modelRoot: THREE.Object3D | null = null; // The currently loaded model root (used for skeleton/wireframe operations).
  private skeletonHelper: THREE.SkeletonHelper | null = null; // The SkeletonHelper instance (created lazily when enabled).
  private wireframeEnabled = false; // Current wireframe toggle state (applied to the active model).

  constructor(scene: THREE.Scene) {
    // Construct helpers bound to a given scene.
    this.scene = scene; // Store the scene reference (Viewer owns the scene).

    this.grid = new THREE.GridHelper(20, 20, 0x444444, 0x222222); // Create a 20x20 grid with subtle colors.
    this.grid.position.y = 0; // Place the grid on the ground plane (y=0).
    this.scene.add(this.grid); // Add the grid to the scene so it renders.

    this.axes = new THREE.AxesHelper(1.2); // Create an axes helper with length 1.2 units.
    this.axes.position.set(0, 0.01, 0); // Slightly lift it to avoid z-fighting with the grid.
    this.scene.add(this.axes); // Add the axes to the scene.
  }

  public setGridVisible(visible: boolean): void {
    // Toggle grid visibility without destroying it.
    this.grid.visible = visible; // Three.js will skip rendering invisible objects.
  }

  public setAxesVisible(visible: boolean): void {
    // Toggle axes visibility without destroying it.
    this.axes.visible = visible; // This is a cheap toggle; no allocations required.
  }

  public setModelRoot(root: THREE.Object3D | null): void {
    // Update which model the helpers should operate on (call when you load/unload a model).
    this.modelRoot = root; // Store the new root reference.

    if (this.skeletonHelper) {
      // If a previous skeleton helper exists, it belongs to the old model and must be removed.
      this.disposeSkeletonHelper(); // Dispose its geometry/material and remove it from the scene.
    }

    if (this.modelRoot) {
      // If wireframe is enabled, apply it immediately to the newly loaded model.
      this.applyWireframe(this.modelRoot, this.wireframeEnabled); // Traverse meshes and set material.wireframe.
    }
  }

  public setSkeletonVisible(visible: boolean): void {
    // Enable/disable SkeletonHelper for the active model (shows animated bones as lines).
    if (!visible) {
      // If the user turned it off...
      if (this.skeletonHelper) this.disposeSkeletonHelper(); // ...dispose and remove the helper if it exists.
      return; // Nothing else to do.
    }

    if (!this.modelRoot) return; // If no model is loaded, skeleton cannot be shown.
    if (this.skeletonHelper) {
      // If a helper already exists, just make sure it's visible.
      this.skeletonHelper.visible = true; // Avoid recreating to keep toggling cheap.
      return; // Done.
    }

    const skinnedMesh = findFirstSkinnedMesh(this.modelRoot); // Find a SkinnedMesh (required for a skeleton).
    if (!skinnedMesh) return; // If there is no skinned mesh, there is no skeleton to visualize.

    this.skeletonHelper = new THREE.SkeletonHelper(skinnedMesh); // Create a helper that draws bone lines for that mesh.
    this.skeletonHelper.visible = true; // Ensure it renders immediately.
    this.scene.add(this.skeletonHelper); // Add helper to the scene so it is rendered each frame.
  }

  public setWireframeEnabled(enabled: boolean): void {
    // Enable/disable wireframe rendering on all mesh materials in the active model.
    this.wireframeEnabled = enabled; // Store the state so it persists across model reloads.
    if (!this.modelRoot) return; // If there's no model, nothing to apply to.
    this.applyWireframe(this.modelRoot, enabled); // Apply to every mesh material in the model.
  }

  public update(): void {
    // Per-frame update hook (called from Viewer tick).
    this.skeletonHelper?.update(); // SkeletonHelper needs updating to follow animated bones.
  }

  public dispose(): void {
    // Dispose all helper resources (useful if the app ever unmounts).
    this.setModelRoot(null); // Clear model bindings and ensure model-dependent helper is cleaned.
    this.scene.remove(this.grid, this.axes); // Remove persistent helpers from the scene graph.

    this.grid.geometry.dispose(); // Free GPU buffers used by the grid lines.
    if (Array.isArray(this.grid.material)) {
      // GridHelper can use an array of materials depending on Three.js internals.
      this.grid.material.forEach((m) => m.dispose()); // Dispose each material to free shader/program references.
    } else {
      this.grid.material.dispose(); // Dispose the single material instance.
    }

    this.axes.geometry.dispose(); // Free GPU buffers for the axes lines.
    if (Array.isArray(this.axes.material)) {
      // AxesHelper may also use multiple materials.
      this.axes.material.forEach((m) => m.dispose()); // Dispose each material.
    } else {
      this.axes.material.dispose(); // Dispose the single axes material.
    }
  }

  private applyWireframe(root: THREE.Object3D, enabled: boolean): void {
    // Traverse the object tree and set `material.wireframe` on every mesh material.
    root.traverse((obj) => {
      // traverse() visits every descendant object (meshes, bones, groups, etc.).
      if (!(obj as THREE.Mesh).isMesh) return; // Only meshes have materials we can render as wireframe.
      const mesh = obj as THREE.Mesh; // Narrow the type so TS knows we can access `.material`.
      const material = mesh.material; // Read the material (can be a single material or an array).
      if (Array.isArray(material)) {
        // Multi-material meshes store an array of materials (one per geometry group).
        material.forEach((m) => setMaterialWireframe(m, enabled)); // Apply wireframe to each material.
      } else if (material) {
        // Single-material mesh.
        setMaterialWireframe(material, enabled); // Apply wireframe toggle to that material.
      }
    }); // End traverse callback.
  }

  private disposeSkeletonHelper(): void {
    // Remove and dispose SkeletonHelper resources safely.
    if (!this.skeletonHelper) return; // Guard against double-dispose.
    this.scene.remove(this.skeletonHelper); // Remove helper from scene so it stops rendering.

    this.skeletonHelper.geometry.dispose(); // Free GPU buffers used by the helper lines.
    const material = this.skeletonHelper.material; // SkeletonHelper material can be a single or array depending on Three.js.
    if (Array.isArray(material)) material.forEach((m) => m.dispose()); // Dispose each material if it's an array.
    else material.dispose(); // Dispose the single material instance.

    this.skeletonHelper = null; // Clear reference so GC can collect JS objects.
  }
}

function findFirstSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh | null {
  // Find the first SkinnedMesh in a model tree (needed for SkeletonHelper).
  let found: THREE.SkinnedMesh | null = null; // Store the first match we see.
  root.traverse((obj) => {
    // Traverse all descendants to locate a SkinnedMesh.
    if (found) return; // Early exit (traverse still visits nodes, but we ignore them once found).
    if ((obj as THREE.SkinnedMesh).isSkinnedMesh) found = obj as THREE.SkinnedMesh; // Check the Three.js runtime flag.
  }); // End traversal.
  return found; // Return the found mesh (or null if none exist).
}

function setMaterialWireframe(material: THREE.Material, enabled: boolean): void {
  // Set wireframe mode on materials that support it (most Mesh*Material types do).
  if ("wireframe" in material) {
    // Not all material subclasses have the wireframe property, so check defensively.
    (material as THREE.Material & { wireframe: boolean }).wireframe = enabled; // Toggle the wireframe flag.
    material.needsUpdate = true; // Tell Three.js to recompile/update rendering state if needed.
  }
}
