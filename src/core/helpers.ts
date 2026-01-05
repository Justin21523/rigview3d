import * as THREE from "three";

export class Helpers {
  private readonly scene: THREE.Scene;
  private readonly grid: THREE.GridHelper;
  private readonly axes: THREE.AxesHelper;

  private modelRoot: THREE.Object3D | null = null;
  private skeletonHelper: THREE.SkeletonHelper | null = null;
  private wireframeEnabled = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.grid = new THREE.GridHelper(20, 20, 0x444444, 0x222222);
    this.grid.position.y = 0;
    this.scene.add(this.grid);

    this.axes = new THREE.AxesHelper(1.2);
    this.axes.position.set(0, 0.01, 0);
    this.scene.add(this.axes);
  }

  public setGridVisible(visible: boolean): void {
    this.grid.visible = visible;
  }

  public setAxesVisible(visible: boolean): void {
    this.axes.visible = visible;
  }

  public setModelRoot(root: THREE.Object3D | null): void {
    this.modelRoot = root;

    if (this.skeletonHelper) {
      this.disposeSkeletonHelper();
    }

    if (this.modelRoot) {
      this.applyWireframe(this.modelRoot, this.wireframeEnabled);
    }
  }

  public setSkeletonVisible(visible: boolean): void {
    if (!visible) {
      if (this.skeletonHelper) this.disposeSkeletonHelper();
      return;
    }

    if (!this.modelRoot) return;
    if (this.skeletonHelper) {
      this.skeletonHelper.visible = true;
      return;
    }

    const skinnedMesh = findFirstSkinnedMesh(this.modelRoot);
    if (!skinnedMesh) return;

    this.skeletonHelper = new THREE.SkeletonHelper(skinnedMesh);
    this.skeletonHelper.visible = true;
    this.scene.add(this.skeletonHelper);
  }

  public setWireframeEnabled(enabled: boolean): void {
    this.wireframeEnabled = enabled;
    if (!this.modelRoot) return;
    this.applyWireframe(this.modelRoot, enabled);
  }

  public update(): void {
    this.skeletonHelper?.update();
  }

  public dispose(): void {
    this.setModelRoot(null);
    this.scene.remove(this.grid, this.axes);

    this.grid.geometry.dispose();
    if (Array.isArray(this.grid.material)) {
      this.grid.material.forEach((m) => m.dispose());
    } else {
      this.grid.material.dispose();
    }

    this.axes.geometry.dispose();
    if (Array.isArray(this.axes.material)) {
      this.axes.material.forEach((m) => m.dispose());
    } else {
      this.axes.material.dispose();
    }
  }

  private applyWireframe(root: THREE.Object3D, enabled: boolean): void {
    root.traverse((obj) => {
      if (!(obj as THREE.Mesh).isMesh) return;
      const mesh = obj as THREE.Mesh;
      const material = mesh.material;
      if (Array.isArray(material)) {
        material.forEach((m) => setMaterialWireframe(m, enabled));
      } else if (material) {
        setMaterialWireframe(material, enabled);
      }
    });
  }

  private disposeSkeletonHelper(): void {
    if (!this.skeletonHelper) return;
    this.scene.remove(this.skeletonHelper);

    this.skeletonHelper.geometry.dispose();
    const material = this.skeletonHelper.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material.dispose();

    this.skeletonHelper = null;
  }
}

function findFirstSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh | null {
  let found: THREE.SkinnedMesh | null = null;
  root.traverse((obj) => {
    if (found) return;
    if ((obj as THREE.SkinnedMesh).isSkinnedMesh) found = obj as THREE.SkinnedMesh;
  });
  return found;
}

function setMaterialWireframe(material: THREE.Material, enabled: boolean): void {
  if ("wireframe" in material) {
    (material as THREE.Material & { wireframe: boolean }).wireframe = enabled;
    material.needsUpdate = true;
  }
}

