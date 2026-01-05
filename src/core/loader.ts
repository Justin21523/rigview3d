import * as THREE from "three";
import {
  GLTFLoader,
  type GLTF,
} from "three/examples/jsm/loaders/GLTFLoader.js";

export type LoadedModel = {
  fileName: string;
  gltf: GLTF;
  root: THREE.Object3D;
  animations: THREE.AnimationClip[];
};

export class ModelLoader {
  public async loadFromFiles(files: File[]): Promise<LoadedModel> {
    const mainFile = pickMainModelFile(files);
    if (!mainFile) {
      throw new Error("No .glb or .gltf file found in the drop selection.");
    }

    const relatedFiles = files.filter((f) => f !== mainFile);
    return this.loadFromFile(mainFile, relatedFiles);
  }

  public async loadFromFile(
    file: File,
    relatedFiles: File[] = [],
  ): Promise<LoadedModel> {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "glb" && ext !== "gltf") {
      throw new Error("Unsupported file type. Please provide a .glb or .gltf.");
    }

    const manager = new THREE.LoadingManager();
    const { urlMap, revokeAll } = createObjectUrlMap([file, ...relatedFiles]);
    manager.setURLModifier((url) => {
      const cleanUrl = decodeURIComponent(url).split(/[?#]/)[0] ?? url;
      const filename = cleanUrl.split("/").pop() ?? cleanUrl;
      return urlMap.get(filename) ?? url;
    });

    const mainUrl = urlMap.get(file.name);
    if (!mainUrl) throw new Error("Failed to create an object URL for file.");

    const loader = new GLTFLoader(manager);

    try {
      const gltf = await loader.loadAsync(mainUrl);
      return {
        fileName: file.name,
        gltf,
        root: gltf.scene,
        animations: gltf.animations,
      };
    } finally {
      revokeAll();
    }
  }
}

function pickMainModelFile(files: File[]): File | null {
  const byExt = (ext: string) =>
    files.find((f) => f.name.toLowerCase().endsWith(ext));

  return byExt(".glb") ?? byExt(".gltf") ?? null;
}

function createObjectUrlMap(files: File[]): {
  urlMap: Map<string, string>;
  revokeAll: () => void;
} {
  const urlMap = new Map<string, string>();
  const urls: string[] = [];

  for (const file of files) {
    const url = URL.createObjectURL(file);
    urlMap.set(file.name, url);
    urls.push(url);
  }

  return {
    urlMap,
    revokeAll: () => urls.forEach((u) => URL.revokeObjectURL(u)),
  };
}

