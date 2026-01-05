import * as THREE from "three";
import type { Animator } from "../core/animator";
import type { ModelLoader } from "../core/loader";
import type { Viewer } from "../core/viewer";

export function initControls({
  viewer,
  loader,
  animator,
}: {
  viewer: Viewer;
  loader: ModelLoader;
  animator: Animator;
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

  const clipSelect = mustGetEl("anim-clip") as HTMLSelectElement;
  const playBtn = mustGetEl("anim-play") as HTMLButtonElement;
  const pauseBtn = mustGetEl("anim-pause") as HTMLButtonElement;
  const stopBtn = mustGetEl("anim-stop") as HTMLButtonElement;
  const speedInput = mustGetEl("anim-speed") as HTMLInputElement;
  const speedValue = mustGetEl("anim-speed-value");
  const loopCheckbox = mustGetEl("anim-loop") as HTMLInputElement;

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

      animator.setSource(result.root, result.animations);
      rebuildClipOptions(animator.getClips(), clipSelect);
      syncAnimUi(animator, {
        clipSelect,
        playBtn,
        pauseBtn,
        stopBtn,
        speedInput,
        speedValue,
        loopCheckbox,
      });

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

      animator.setSource(null, []);
      rebuildClipOptions([], clipSelect);
      syncAnimUi(animator, {
        clipSelect,
        playBtn,
        pauseBtn,
        stopBtn,
        speedInput,
        speedValue,
        loopCheckbox,
      });
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

  clipSelect.addEventListener("change", () => {
    animator.selectClip(Number(clipSelect.value));
    syncAnimUi(animator, {
      clipSelect,
      playBtn,
      pauseBtn,
      stopBtn,
      speedInput,
      speedValue,
      loopCheckbox,
    });
  });

  playBtn.addEventListener("click", () => {
    animator.play();
    syncAnimUi(animator, {
      clipSelect,
      playBtn,
      pauseBtn,
      stopBtn,
      speedInput,
      speedValue,
      loopCheckbox,
    });
  });

  pauseBtn.addEventListener("click", () => {
    animator.togglePause();
    syncAnimUi(animator, {
      clipSelect,
      playBtn,
      pauseBtn,
      stopBtn,
      speedInput,
      speedValue,
      loopCheckbox,
    });
  });

  stopBtn.addEventListener("click", () => {
    animator.stop();
    syncAnimUi(animator, {
      clipSelect,
      playBtn,
      pauseBtn,
      stopBtn,
      speedInput,
      speedValue,
      loopCheckbox,
    });
  });

  speedInput.addEventListener("input", () => {
    const speed = Number(speedInput.value);
    animator.setSpeed(speed);
    syncAnimUi(animator, {
      clipSelect,
      playBtn,
      pauseBtn,
      stopBtn,
      speedInput,
      speedValue,
      loopCheckbox,
    });
  });

  loopCheckbox.addEventListener("change", () => {
    animator.setLoopMode(loopCheckbox.checked ? "repeat" : "once");
    syncAnimUi(animator, {
      clipSelect,
      playBtn,
      pauseBtn,
      stopBtn,
      speedInput,
      speedValue,
      loopCheckbox,
    });
  });

  rebuildClipOptions([], clipSelect);
  syncAnimUi(animator, {
    clipSelect,
    playBtn,
    pauseBtn,
    stopBtn,
    speedInput,
    speedValue,
    loopCheckbox,
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

function rebuildClipOptions(
  clips: THREE.AnimationClip[],
  select: HTMLSelectElement,
): void {
  select.innerHTML = "";
  if (clips.length === 0) {
    const opt = document.createElement("option");
    opt.value = "-1";
    opt.textContent = "No animation clips";
    select.append(opt);
    return;
  }

  clips.forEach((clip, index) => {
    const opt = document.createElement("option");
    opt.value = String(index);
    opt.textContent = clip.name || `Clip ${index + 1}`;
    select.append(opt);
  });
}

function syncAnimUi(
  animator: Animator,
  els: {
    clipSelect: HTMLSelectElement;
    playBtn: HTMLButtonElement;
    pauseBtn: HTMLButtonElement;
    stopBtn: HTMLButtonElement;
    speedInput: HTMLInputElement;
    speedValue: HTMLElement;
    loopCheckbox: HTMLInputElement;
  },
): void {
  const clips = animator.getClips();
  const hasClips = clips.length > 0;

  els.clipSelect.disabled = !hasClips;
  els.playBtn.disabled = !hasClips;
  els.pauseBtn.disabled = !hasClips;
  els.stopBtn.disabled = !hasClips;
  els.speedInput.disabled = !hasClips;
  els.loopCheckbox.disabled = !hasClips;

  const selectedIndex = animator.getSelectedIndex();
  if (hasClips && selectedIndex >= 0) els.clipSelect.value = String(selectedIndex);

  const speed = animator.getSpeed();
  els.speedInput.value = String(speed);
  els.speedValue.textContent = `${speed.toFixed(2)}x`;

  els.loopCheckbox.checked = animator.getLoopMode() === "repeat";

  const state = animator.getPlayState();
  els.pauseBtn.textContent = state === "paused" ? "Resume" : "Pause";
  els.stopBtn.disabled = !hasClips || state === "stopped";
}
