import * as THREE from "three";

export class Helpers {
  private readonly scene: THREE.Scene;
  private readonly grid: THREE.GridHelper;
  private readonly axes: THREE.AxesHelper;

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

  public dispose(): void {
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
}

