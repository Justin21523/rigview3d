// src/core/dispose.ts
// Three.js does NOT automatically free GPU resources when you remove objects from a scene.
// To avoid memory/GPU leaks when repeatedly loading new models, we must explicitly dispose:
// - Geometries (GPU vertex/index buffers)
// - Materials (shader programs + GPU state)
// - Textures (GPU texture memory)
//
// This module provides a conservative, reusable disposal helper that:
// - Traverses an Object3D tree
// - Collects unique geometries/materials/textures into Sets (prevents double-dispose)
// - Disposes textures first, then materials, then geometries

import * as THREE from "three"; // Import Three.js types so we can detect and dispose resources safely.

export function disposeObject3D(root: THREE.Object3D): void {
  // Dispose GPU resources owned by an Object3D subtree (meshes, materials, textures).
  const geometries = new Set<THREE.BufferGeometry>(); // Track unique geometries to avoid disposing shared buffers twice.
  const materials = new Set<THREE.Material>(); // Track unique materials to avoid disposing shared materials twice.
  const textures = new Set<THREE.Texture>(); // Track unique textures to avoid disposing shared textures twice.

  root.traverse((obj) => {
    // Traverse visits every descendant object under root.
    const anyObj = obj as unknown as {
      // We use a structural type because not all Object3D subclasses have geometry/material.
      geometry?: THREE.BufferGeometry; // Mesh-like objects have geometry.
      material?: THREE.Material | THREE.Material[]; // Mesh-like objects have material(s).
    }; // End structural typing.

    if (anyObj.geometry) geometries.add(anyObj.geometry); // Collect geometry if present.
    if (!anyObj.material) return; // If there is no material, there are no textures/materials to collect.

    if (Array.isArray(anyObj.material)) {
      // Multi-material meshes store an array of materials.
      anyObj.material.forEach((m) => materials.add(m)); // Add each material to the set.
    } else {
      materials.add(anyObj.material); // Add the single material to the set.
    }
  }); // End traversal.

  for (const material of materials) {
    // Collect textures referenced by each material.
    collectTextures(material, textures); // Push any textures found into the textures set.
  }

  textures.forEach((t) => t.dispose()); // Dispose textures first to free GPU image memory.
  materials.forEach((m) => m.dispose()); // Dispose materials next (may release shader programs).
  geometries.forEach((g) => g.dispose()); // Dispose geometries last (release vertex/index buffers).
}

function collectTextures(material: THREE.Material, out: Set<THREE.Texture>): void {
  // Heuristically collect textures referenced by common material properties and shader uniforms.
  for (const key in material) {
    // Iterate enumerable properties on the material instance.
    const value = (material as unknown as Record<string, unknown>)[key]; // Read property value using an index signature cast.
    collectTextureValue(value, out); // Add any textures found in this value.
  }

  const uniforms = (material as unknown as { uniforms?: unknown }).uniforms; // ShaderMaterial-like materials may have uniforms.
  if (uniforms && typeof uniforms === "object") {
    // Only process uniforms if it looks like an object.
    for (const value of Object.values(uniforms as Record<string, unknown>)) {
      // Uniform objects are typically shaped like `{ value: ... }`.
      collectTextureValue(value, out); // Some custom materials may store textures directly.
      if (
        value && // Ensure non-null.
        typeof value === "object" && // Ensure object shape.
        "value" in (value as Record<string, unknown>) // Check for a `value` field commonly used by Three.js uniforms.
      ) {
        collectTextureValue(
          (value as Record<string, unknown>).value as unknown, // Extract the nested uniform value.
          out, // Add any textures found there.
        ); // End nested collection.
      }
    }
  }
}

function collectTextureValue(value: unknown, out: Set<THREE.Texture>): void {
  // Recursively collect textures from arbitrary values (handles arrays and nested structures).
  if (!value) return; // Ignore null/undefined.
  if (Array.isArray(value)) {
    // If the value is an array, check each element.
    value.forEach((v) => collectTextureValue(v, out)); // Recurse on each element.
    return; // Done with array case.
  }

  if (typeof value === "object" && (value as THREE.Texture).isTexture) {
    // Three.js textures have the runtime flag `isTexture`.
    out.add(value as THREE.Texture); // Add the texture to the set.
  }
}
