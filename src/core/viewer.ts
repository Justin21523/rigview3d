import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export class Viewer {
  private readonly canvas: HTMLCanvasElement;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;

  private rafId: number | null = null;
  private readonly clock = new THREE.Clock();
  private onTick: ((deltaSeconds: number) => void) | null = null;

  // Defaults
  private readonly defaultTarget = new THREE.Vector3(0, 1, 0);
  private readonly defaultCamPos = new THREE.Vector3(2.5, 1.8, 3.2);

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.init();
    this.attachResizeHandler();
  }

  public getScene(): THREE.Scene {
    return this.scene;
  }

  private init(): void {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0e14);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const { width, height } = this.getCanvasSize();
    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.01, 200);
    this.camera.position.copy(this.defaultCamPos);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.copy(this.defaultTarget);

    // Lights (simple, stable)
    const hemi = new THREE.HemisphereLight(0xffffff, 0x223344, 0.9);
    this.scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(4, 6, 3);
    dir.castShadow = false;
    this.scene.add(dir);

    this.resize();
  }

  private getCanvasSize(): { width: number; height: number } {
    const parent = this.canvas.parentElement;
    const width = parent?.clientWidth ?? window.innerWidth;
    const height = parent?.clientHeight ?? window.innerHeight;
    return { width, height };
  }

  private attachResizeHandler(): void {
    window.addEventListener("resize", () => this.resize(), { passive: true });
  }

  private resize(): void {
    const { width, height } = this.getCanvasSize();
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  public start(): void {
    if (this.rafId !== null) return;
    this.clock.start();

    const tick = () => {
      const deltaSeconds = this.clock.getDelta();
      this.onTick?.(deltaSeconds);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.rafId = window.requestAnimationFrame(tick);
    };

    this.rafId = window.requestAnimationFrame(tick);
  }

  public stop(): void {
    if (this.rafId === null) return;
    window.cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  public resetCamera(): void {
    this.controls.target.copy(this.defaultTarget);
    this.camera.position.copy(this.defaultCamPos);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  public frameObject(object: THREE.Object3D, padding = 1.2): void {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    if (!Number.isFinite(size.x + size.y + size.z)) return;
    if (size.lengthSq() === 0) return;

    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const distance = (maxDim / 2 / Math.tan(fov / 2)) * padding;

    const dir = new THREE.Vector3()
      .subVectors(this.defaultCamPos, this.defaultTarget)
      .normalize();

    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, distance);

    this.camera.near = Math.max(distance / 100, 0.001);
    this.camera.far = Math.max(distance * 100, 50);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  public setOnTick(callback: ((deltaSeconds: number) => void) | null): void {
    this.onTick = callback;
  }

  public disposeRenderLists(): void {
    const renderLists = (
      this.renderer as unknown as { renderLists?: { dispose?: () => void } }
    ).renderLists;
    renderLists?.dispose?.();
  }

  public dispose(): void {
    this.stop();
    this.controls.dispose();
    this.renderer.dispose();
  }
}
