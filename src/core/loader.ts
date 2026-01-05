// src/core/loader.ts
// This module turns user-provided local files (drag-and-drop or file picker)
// into a Three.js-ready GLTF scene graph.
//
// Key idea:
// - For `.glb`, everything is in one binary file, so loading is straightforward.
// - For `.gltf`, the JSON often references external `.bin` and texture files.
//   Because those files are local (not hosted on a server), we create `blob:` URLs
//   for each dropped file and use Three.js' LoadingManager URL modifier to map
//   requested URLs (like `textures/diffuse.png`) to the correct `blob:` URL.

import * as THREE from "three"; // Import LoadingManager and Object3D types from Three.js.
import {
  GLTFLoader, // GLTFLoader parses .gltf/.glb into a Three.js scene graph.
  type GLTF, // GLTF is the TypeScript type describing the loader result.
} from "three/examples/jsm/loaders/GLTFLoader.js"; // GLTFLoader lives in Three.js examples.

export type LoadedModel = {
  // Normalized return shape so UI code doesn't depend on GLTFLoader internals.
  fileName: string; // The name of the primary file the user loaded (used for UI display).
  gltf: GLTF; // The full GLTFLoader result (includes parser, scenes, etc.).
  root: THREE.Object3D; // The scene root we want to add to our Three.js Scene (usually `gltf.scene`).
  animations: THREE.AnimationClip[]; // Animation clips embedded in the asset (if any).
}; // End LoadedModel type.

export class ModelLoader {
  // Wrapper around GLTFLoader with local-file handling.
  public async loadFromFiles(files: File[]): Promise<LoadedModel> {
    // Load a model from a list of dropped/selected files.
    const mainFile = pickMainModelFile(files); // Find the primary `.glb` or `.gltf` file in the selection.
    if (!mainFile) {
      // If the user only dropped textures or a .bin, we can't load a model.
      throw new Error("No .glb or .gltf file found in the drop selection."); // Provide a helpful error message.
    }

    const relatedFiles = files.filter((f) => f !== mainFile); // Everything else is treated as a potential dependency (bin/textures).
    return this.loadFromFile(mainFile, relatedFiles); // Delegate to the single-file loader with dependencies.
  }

  public async loadFromFile(
    file: File, // The main `.glb` or `.gltf` file.
    relatedFiles: File[] = [], // Optional extra files referenced by the main file (.bin, textures).
  ): Promise<LoadedModel> {
    const ext = file.name.split(".").pop()?.toLowerCase(); // Determine file extension from its name.
    if (ext !== "glb" && ext !== "gltf") {
      // Only GLB/GLTF are supported by this tool.
      throw new Error("Unsupported file type. Please provide a .glb or .gltf."); // Fail fast with a user-friendly error.
    }

    const manager = new THREE.LoadingManager(); // LoadingManager lets us intercept URL requests made by loaders.
    const { urlMap, revokeAll } = createObjectUrlMap([file, ...relatedFiles]); // Create `blob:` URLs for every provided file.
    manager.setURLModifier((url) => {
      // This function runs whenever GLTFLoader requests a resource URL.
      const cleanUrl = decodeURIComponent(url).split(/[?#]/)[0] ?? url; // Remove query/hash and decode URL-escaped characters.
      const filename = cleanUrl.split("/").pop() ?? cleanUrl; // Reduce a path like `textures/a.png` to just `a.png`.
      return urlMap.get(filename) ?? url; // If we have a blob URL for that filename, use it; otherwise fall back.
    }); // End URL modifier.

    const mainUrl = urlMap.get(file.name); // Look up the blob URL for the main file by exact name.
    if (!mainUrl) throw new Error("Failed to create an object URL for file."); // Defensive guard (should not happen).

    const loader = new GLTFLoader(manager); // Create the Three.js GLTFLoader bound to our LoadingManager.

    try {
      // Always revoke object URLs after load, even if parsing fails.
      const gltf = await loader.loadAsync(mainUrl); // Load and parse the asset asynchronously.
      return {
        fileName: file.name, // Keep original filename for UI display.
        gltf, // Provide the full loader result for advanced usage if needed.
        root: gltf.scene, // Use the default scene graph root exported by the asset.
        animations: gltf.animations, // Copy the animation clips array for convenience.
      }; // End return object.
    } finally {
      revokeAll(); // Revoke all blob URLs to avoid leaking memory in long sessions.
    }
  }
}

function pickMainModelFile(files: File[]): File | null {
  // Choose a primary model file from a list: prefer .glb, otherwise .gltf.
  const byExt = (ext: string) =>
    // Helper to find the first file that ends with the given extension.
    files.find((f) => f.name.toLowerCase().endsWith(ext)); // Compare case-insensitively.

  return byExt(".glb") ?? byExt(".gltf") ?? null; // Prefer binary GLB (self-contained) when both are present.
}

function createObjectUrlMap(files: File[]): {
  urlMap: Map<string, string>; // Map from filename to blob URL.
  revokeAll: () => void; // Cleanup function that revokes all blob URLs we created.
} {
  const urlMap = new Map<string, string>(); // Store filename -> blob URL mapping.
  const urls: string[] = []; // Keep a list of blob URLs so we can revoke them all later.

  for (const file of files) {
    // Create a blob URL for every provided file (main + dependencies).
    const url = URL.createObjectURL(file); // Convert the File into a temporary local URL the loader can fetch.
    urlMap.set(file.name, url); // Use the exact filename as the key (we also match by basename in URLModifier).
    urls.push(url); // Track the URL so we can revoke it later.
  }

  return {
    urlMap, // Expose the mapping used by the URL modifier.
    revokeAll: () => urls.forEach((u) => URL.revokeObjectURL(u)), // Free browser memory by revoking each blob URL.
  }; // End return object.
}
