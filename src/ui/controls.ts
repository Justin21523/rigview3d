import * as THREE from "three";
import type { ModelLoader } from "../core/loader";
import type { Viewer } from "../core/viewer";

export function initControls({
  viewer,
  loader,
}: {
  viewer: Viewer;
  loader: ModelLoader;
}): void {
  const resetButton = document.getElementById("btn-reset-camera");
  resetButton?.addEventListener("click", () => viewer.resetCamera());

  const dropzone = mustGetEl("dropzone");
  const fileInput = mustGetEl("file-input") as HTMLInputElement;

  const infoFile = mustGetEl("info-file");
  const infoMeshes = mustGetEl("info-meshes");
  const infoMaterials = mustGetEl("info-materials");
  const infoBones = mustGetEl("info-bones");
  const infoClips = mustGetEl("info-clips");

  let currentModelRoot: THREE.Object3D | null = null;

  const setDragOver = (active: boolean) => {
    dropzone.classList.toggle("is-dragover", active);
  };

  const loadFiles = async (files: File[]) => {
    if (files.length === 0) return;

    try {
      infoFile.textContent = "Loading…";
      const result = await loader.loadFromFiles(files);

      if (currentModelRoot) {
        viewer.getScene().remove(currentModelRoot);
      }

      currentModelRoot = result.root;
      viewer.getScene().add(currentModelRoot);
      viewer.frameObject(currentModelRoot);

      const stats = getModelStats(result.root, result.animations);
      infoFile.textContent = result.fileName;
      infoMeshes.textContent = String(stats.meshes);
      infoMaterials.textContent = String(stats.materials);
      infoBones.textContent = String(stats.bones);
      infoClips.textContent = String(stats.clips);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(err);
      infoFile.textContent = `Error: ${message}`;
      infoMeshes.textContent = "—";
      infoMaterials.textContent = "—";
      infoBones.textContent = "—";
      infoClips.textContent = "—";
    }
  };

  const openFilePicker = () => fileInput.click();

  dropzone.addEventListener("click", openFilePicker);
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") openFilePicker();
  });

  fileInput.addEventListener("change", () => {
    void loadFiles(Array.from(fileInput.files ?? []));
    fileInput.value = "";
  });

  window.addEventListener("dragover", (e) => e.preventDefault());

  dropzone.addEventListener("dragenter", (e) => {
    e.preventDefault();
    setDragOver(true);
  });
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    setDragOver(true);
  });
  dropzone.addEventListener("dragleave", () => setDragOver(false));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    void loadFiles(files);
  });
}

function mustGetEl(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element: #${id}`);
  return el;
}

function getModelStats(
  root: THREE.Object3D,
  clips: THREE.AnimationClip[],
): { meshes: number; materials: number; bones: number; clips: number } {
  let meshes = 0;
  let bones = 0;
  const materialSet = new Set<THREE.Material>();

  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      meshes += 1;
      const mesh = obj as THREE.Mesh;
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => materialSet.add(m));
      else if (mat) materialSet.add(mat);
    }
    if ((obj as THREE.Bone).isBone) bones += 1;
  });

  return {
    meshes,
    materials: materialSet.size,
    bones,
    clips: clips.length,
  };
}
