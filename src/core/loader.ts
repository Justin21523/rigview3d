// src/core/loader.ts
// This module turns user-provided local files (drag-and-drop or file picker)
// into a Three.js-ready model scene graph.
//
// Key idea:
// - For `.glb`, everything is in one binary file, so loading is straightforward.
// - For `.gltf`, the JSON often references external `.bin` and texture files.
//   Because those files are local (not hosted on a server), we create `blob:` URLs
//   for each dropped file and use Three.js' LoadingManager URL modifier to map
//   requested URLs (like `textures/diffuse.png`) to the correct `blob:` URL.
// - For `.fbx`, the FBX can reference external texture files. We use the same
//   `blob:` URL mapping technique via LoadingManager to resolve local textures.

import * as THREE from "three"; // Import LoadingManager and Object3D types from Three.js.
import { DDSLoader } from "three/examples/jsm/loaders/DDSLoader.js"; // DDSLoader enables loading .dds textures referenced by some FBX files.
import {
  GLTFLoader, // GLTFLoader parses .gltf/.glb into a Three.js scene graph.
  type GLTF, // GLTF is the TypeScript type describing the loader result.
} from "three/examples/jsm/loaders/GLTFLoader.js"; // GLTFLoader lives in Three.js examples.
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js"; // FBXLoader parses .fbx into a Three.js scene graph.
import { TGALoader } from "three/examples/jsm/loaders/TGALoader.js"; // TGALoader enables loading .tga textures referenced by some FBX files.

export type ModelFormat = "gltf" | "fbx"; // Supported high-level model formats for this app.

export type LoadedModel = {
  // Normalized return shape so UI code doesn't depend on GLTFLoader internals.
  fileName: string; // The name of the primary file the user loaded (used for UI display).
  format: ModelFormat; // Which loader/format produced this result (gltf vs fbx).
  gltf?: GLTF; // The full GLTFLoader result (only present when `format === "gltf"`).
  root: THREE.Object3D; // The scene root we want to add to our Three.js Scene (usually `gltf.scene`).
  animations: THREE.AnimationClip[]; // Animation clips embedded in the asset (if any).
}; // End LoadedModel type.

export class ModelLoader {
  // Wrapper around multiple Three.js loaders with local-file handling.
  public async loadFromFiles(files: File[]): Promise<LoadedModel> {
    // Load a model from a list of dropped/selected files.
    const mainFile = pickMainModelFile(files); // Find the primary model file in the selection.
    if (!mainFile) {
      // If the user only dropped textures or a .bin, we can't load a model.
      throw new Error("No .glb, .gltf, or .fbx file found in the drop selection."); // Provide a helpful error message.
    }

    const relatedFiles = files.filter((f) => f !== mainFile); // Everything else is treated as a potential dependency (bin/textures).
    return this.loadFromFile(mainFile, relatedFiles); // Delegate to the single-file loader with dependencies.
  }

  public async loadFromFile(
    file: File, // The main model file (.glb/.gltf/.fbx).
    relatedFiles: File[] = [], // Optional extra files referenced by the main file (.bin, textures, etc).
  ): Promise<LoadedModel> {
    const ext = file.name.split(".").pop()?.toLowerCase(); // Determine file extension from its name.

    const manager = new THREE.LoadingManager(); // LoadingManager lets us intercept URL requests made by loaders.
    const { urlMap, revokeAll } = createObjectUrlMap([file, ...relatedFiles]); // Create `blob:` URLs for every provided file.
    manager.setURLModifier((url) => {
      // This function runs whenever a loader requests a resource URL (textures, buffers, etc).
      const cleanUrl = decodeURIComponent(url).split(/[?#]/)[0] ?? url; // Remove query/hash and decode URL-escaped characters.
      const filename = basename(cleanUrl); // Reduce a path like `textures/a.png` to just `a.png` (handles "/" and "\\").
      return urlMap.get(filename) ?? url; // If we have a blob URL for that filename, use it; otherwise fall back.
    }); // End URL modifier.

    // Optional texture handlers for FBX (FBXLoader checks manager.getHandler('.tga') / '.dds').
    manager.addHandler(/\.tga$/i, new TGALoader(manager)); // Allow FBXLoader to load .tga textures when provided.
    manager.addHandler(/\.dds$/i, new DDSLoader(manager)); // Allow FBXLoader to load .dds textures when provided.

    const mainUrl = urlMap.get(file.name); // Look up the blob URL for the main file by exact name.
    if (!mainUrl) throw new Error("Failed to create an object URL for file."); // Defensive guard (should not happen).

    try {
      // Always revoke object URLs after load, even if parsing fails.
      if (ext === "glb" || ext === "gltf") {
        // GLB/GLTF path: parse with GLTFLoader.
        const loader = new GLTFLoader(manager); // Create the Three.js GLTFLoader bound to our LoadingManager.
        const gltf = await loader.loadAsync(mainUrl); // Load and parse the asset asynchronously.
        return {
          fileName: file.name, // Keep original filename for UI display.
          format: "gltf", // Mark format for downstream features (e.g., export naming).
          gltf, // Provide the full loader result for advanced usage if needed.
          root: gltf.scene, // Use the default scene graph root exported by the asset.
          animations: gltf.animations, // Copy the animation clips array for convenience.
        }; // End return object.
      }

      if (ext === "fbx") {
        // FBX path: parse with FBXLoader.
        const loader = new FBXLoader(manager); // Create FBXLoader bound to our LoadingManager.
        const root = await loader.loadAsync(mainUrl); // Load and parse FBX into a Three.js object tree.
        const animations = (root as unknown as { animations?: THREE.AnimationClip[] }).animations ?? []; // FBXLoader attaches clips to the returned object.
        return {
          fileName: file.name, // Keep original filename for UI display.
          format: "fbx", // Mark format.
          root, // Use the loaded Object3D as the scene root.
          animations, // Use FBX-provided animation clips if present.
        }; // End return object.
      }

      // If we reached here, the extension is not supported.
      throw new Error("Unsupported file type. Please provide a .glb, .gltf, or .fbx."); // Fail fast with a user-friendly error.
    } finally {
      revokeAll(); // Revoke all blob URLs to avoid leaking memory in long sessions.
    }
  }
}

function pickMainModelFile(files: File[]): File | null {
  // Choose a primary model file from a list: prefer .glb, otherwise .gltf, otherwise .fbx.
  const byExt = (ext: string) =>
    // Helper to find the first file that ends with the given extension.
    files.find((f) => f.name.toLowerCase().endsWith(ext)); // Compare case-insensitively.

  return byExt(".glb") ?? byExt(".gltf") ?? byExt(".fbx") ?? null; // Prefer binary GLB when multiple model types are present.
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

function basename(url: string): string {
  // Extract the last path segment from a URL or filename (supports "/" and Windows "\\").
  const normalized = url.replace(/\\/g, "/"); // Normalize Windows paths so we can split consistently.
  return normalized.split("/").pop() ?? url; // Return the last segment, or the full string as a fallback.
}
