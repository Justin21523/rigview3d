// src/core/viewer.ts
// The Viewer is the runtime "engine" of the app: it owns the Three.js Scene, Camera,
// WebGLRenderer, and OrbitControls, and it runs the render loop (requestAnimationFrame).
// Other modules (loader/animator/helpers/UI) call small APIs on Viewer rather than
// directly managing low-level Three.js renderer state.

import * as THREE from "three"; // Import the main Three.js namespace (Scene, Camera, Renderer, math utilities).
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"; // Import OrbitControls for orbit/pan/zoom camera interaction.

export class Viewer {
  // Exported class so other modules can create and use a Viewer instance.
  private readonly canvas: HTMLCanvasElement; // The canvas element where WebGL draws pixels.

  private renderer!: THREE.WebGLRenderer; // WebGLRenderer is responsible for GPU draw calls.
  private scene!: THREE.Scene; // Scene is the root container for all objects/lights/helpers.
  private camera!: THREE.PerspectiveCamera; // PerspectiveCamera gives a realistic 3D projection.
  private controls!: OrbitControls; // OrbitControls updates the camera based on user input.

  private hemiLight!: THREE.HemisphereLight; // Fill/ambient light used by the Scene panel (intensity slider).
  private dirLight!: THREE.DirectionalLight; // Key light used by the Scene panel (intensity slider).

  private rafId: number | null = null; // Track the current requestAnimationFrame id (so we can cancel it).
  private readonly clock = new THREE.Clock(); // Clock provides delta time between frames (useful for animation).
  private onTick: ((deltaSeconds: number) => void) | null = null; // Optional callback invoked once per frame.

  // Defaults
  private readonly defaultTarget = new THREE.Vector3(0, 1, 0); // Default point the camera orbits around (roughly character height).
  private readonly defaultCamPos = new THREE.Vector3(2.5, 1.8, 3.2); // Default camera position (an angled view of the origin).

  constructor(canvas: HTMLCanvasElement) {
    // Construct the viewer around an existing canvas element.
    this.canvas = canvas; // Store the canvas so we can pass it into WebGLRenderer.
    this.init(); // Create the Three.js renderer/scene/camera/controls and base lighting.
    this.attachResizeHandler(); // Keep the renderer/camera in sync with the layout size.
  }

  public getScene(): THREE.Scene {
    // Provide read-only access to the Scene for modules that need to add/remove objects.
    return this.scene; // Return the internal scene reference owned by the Viewer.
  }

  public getCamera(): THREE.PerspectiveCamera {
    // Provide access to the active camera (needed for picking and gizmos).
    return this.camera; // Return the camera owned by Viewer (callers should not replace it).
  }

  public getDomElement(): HTMLCanvasElement {
    // Provide the renderer DOM element for controls that need mouse/touch events.
    return this.renderer.domElement; // WebGLRenderer always renders into a canvas element.
  }

  public setOrbitEnabled(enabled: boolean): void {
    // Enable/disable OrbitControls (useful while dragging transform gizmos).
    this.controls.enabled = enabled; // OrbitControls checks this flag before responding to input.
  }

  public setBackground(color: THREE.ColorRepresentation): void {
    // Set the scene background color (called from the Scene panel color picker).
    const bg = this.scene.background; // Scene background can be a Color, Texture, or null.
    if (bg && (bg as THREE.Color).isColor) {
      // If background is already a Color, mutate it in-place to avoid allocations.
      (bg as THREE.Color).set(color); // Update the existing color value.
    } else {
      // Otherwise create a new Color object for the background.
      this.scene.background = new THREE.Color(color); // Assign a new background color.
    }
  }

  public getBackgroundColorHex(): string {
    // Return the current background color as a CSS hex string (e.g. "#0b0e14").
    const bg = this.scene.background; // Read current background value.
    if (bg && (bg as THREE.Color).isColor) return `#${(bg as THREE.Color).getHexString()}`; // Convert Three.js Color to hex string.
    return "#000000"; // Fallback if background is not a Color (should not happen in this app).
  }

  public setKeyLightIntensity(intensity: number): void {
    // Set the key (directional) light intensity.
    this.dirLight.intensity = intensity; // Update intensity used in lighting calculations.
  }

  public getKeyLightIntensity(): number {
    // Read the key (directional) light intensity for UI initialization.
    return this.dirLight.intensity; // Return current directional intensity.
  }

  public setFillLightIntensity(intensity: number): void {
    // Set the fill (hemisphere) light intensity.
    this.hemiLight.intensity = intensity; // Update intensity used in lighting calculations.
  }

  public getFillLightIntensity(): number {
    // Read the fill (hemisphere) light intensity for UI initialization.
    return this.hemiLight.intensity; // Return current hemisphere intensity.
  }

  private init(): void {
    // Initialize all Three.js objects owned by Viewer.
    this.scene = new THREE.Scene(); // Create a new Scene (a container for objects).
    this.scene.background = new THREE.Color(0x0b0e14); // Set a dark background for better contrast.

    this.renderer = new THREE.WebGLRenderer({
      // Create a renderer that draws into our provided canvas.
      canvas: this.canvas, // Use the existing DOM canvas element.
      antialias: true, // Enable MSAA for smoother edges (tradeoff: more GPU work).
      alpha: false, // Use an opaque framebuffer (slightly faster than alpha).
    }); // End of renderer options.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Match display DPI but clamp for performance.

    const { width, height } = this.getCanvasSize(); // Read the current canvas display size.
    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.01, 200); // Set up a perspective camera with near/far planes.
    this.camera.position.copy(this.defaultCamPos); // Put the camera at the default position.

    this.controls = new OrbitControls(this.camera, this.renderer.domElement); // Hook orbit controls to the camera + DOM events.
    this.controls.enableDamping = true; // Enable inertia smoothing for nicer feel.
    this.controls.target.copy(this.defaultTarget); // Set the orbit pivot point.

    // Lights (simple, stable)
    this.hemiLight = new THREE.HemisphereLight(0xffffff, 0x223344, 0.9); // Soft ambient light from sky/ground colors.
    this.scene.add(this.hemiLight); // Add the hemisphere light to the scene so it affects shading.

    this.dirLight = new THREE.DirectionalLight(0xffffff, 1.2); // Directional light simulates sunlight.
    this.dirLight.position.set(4, 6, 3); // Position the light so it shines toward the origin.
    this.dirLight.castShadow = false; // Disable shadows to keep the MVP simple and fast.
    this.scene.add(this.dirLight); // Add the directional light to the scene.

    this.resize(); // Perform an initial resize to sync camera aspect and renderer size.
  }

  private getCanvasSize(): { width: number; height: number } {
    // Compute the canvas size based on its parent layout, with a window fallback.
    const parent = this.canvas.parentElement; // The canvas is inside a layout container (viewport).
    const width = parent?.clientWidth ?? window.innerWidth; // Use parent width if available, else window width.
    const height = parent?.clientHeight ?? window.innerHeight; // Use parent height if available, else window height.
    return { width, height }; // Return a simple object used by resize/camera setup.
  }

  private attachResizeHandler(): void {
    // Update camera aspect + renderer size when the browser window resizes.
    window.addEventListener("resize", () => this.resize(), { passive: true }); // Passive listener avoids blocking scroll.
  }

  private resize(): void {
    // Resize renderer output and update camera projection to match the canvas display size.
    const { width, height } = this.getCanvasSize(); // Measure the current layout size.
    this.camera.aspect = width / height; // Update the camera aspect ratio to prevent stretching.
    this.camera.updateProjectionMatrix(); // Recompute the internal projection matrix after changing aspect.
    this.renderer.setSize(width, height, false); // Resize the drawing buffer; `false` keeps CSS size unchanged.
  }

  public start(): void {
    // Start the render loop (requestAnimationFrame).
    if (this.rafId !== null) return; // Prevent starting multiple loops.
    this.clock.start(); // Reset the clock so the first delta is small and consistent.

    const tick = () => {
      // This function runs once per animation frame.
      const deltaSeconds = this.clock.getDelta(); // Compute elapsed time since last frame in seconds.
      this.onTick?.(deltaSeconds); // Let external systems (animations/helpers) advance using the same delta.
      this.controls.update(); // Update OrbitControls (needed for damping to work).
      this.renderer.render(this.scene, this.camera); // Draw the current scene from the camera's point of view.
      this.rafId = window.requestAnimationFrame(tick); // Schedule the next frame.
    }; // End tick function definition.

    this.rafId = window.requestAnimationFrame(tick); // Kick off the first frame.
  }

  public stop(): void {
    // Stop the render loop so the app stops drawing frames.
    if (this.rafId === null) return; // If we were not running, do nothing.
    window.cancelAnimationFrame(this.rafId); // Cancel the scheduled animation frame.
    this.rafId = null; // Clear the id to represent the stopped state.
  }

  public resetCamera(): void {
    // Reset the camera and orbit controls back to their default position/target.
    this.controls.target.copy(this.defaultTarget); // Restore the orbit pivot.
    this.camera.position.copy(this.defaultCamPos); // Restore the camera position.
    this.camera.updateProjectionMatrix(); // Ensure camera matrices are up-to-date.
    this.controls.update(); // Apply control changes immediately.
  }

  public frameObject(object: THREE.Object3D, padding = 1.2): void {
    // Move the camera so the given object fits nicely in the viewport.
    const box = new THREE.Box3().setFromObject(object); // Compute a world-space bounding box around the object.
    const size = box.getSize(new THREE.Vector3()); // Get the box dimensions (width/height/depth).
    const center = box.getCenter(new THREE.Vector3()); // Get the center point of the box.

    if (!Number.isFinite(size.x + size.y + size.z)) return; // Abort if the box contains invalid numbers (e.g., NaNs).
    if (size.lengthSq() === 0) return; // Abort if the object has no measurable size (degenerate bbox).

    const maxDim = Math.max(size.x, size.y, size.z); // Use the largest dimension to decide camera distance.
    const fov = THREE.MathUtils.degToRad(this.camera.fov); // Convert camera vertical FOV from degrees to radians.
    const distance = (maxDim / 2 / Math.tan(fov / 2)) * padding; // Compute distance so object fits in view, with extra padding.

    const dir = new THREE.Vector3() // Create a direction vector for the camera to look from.
      .subVectors(this.defaultCamPos, this.defaultTarget) // Use the default camera direction (pos - target).
      .normalize(); // Normalize so we can scale it by the desired distance.

    this.controls.target.copy(center); // Orbit around the model center so interactions feel natural.
    this.camera.position.copy(center).addScaledVector(dir, distance); // Place camera at `center + dir * distance`.

    this.camera.near = Math.max(distance / 100, 0.001); // Set near plane relative to distance (prevents clipping close to model).
    this.camera.far = Math.max(distance * 100, 50); // Set far plane relative to distance (prevents clipping far parts).
    this.camera.updateProjectionMatrix(); // Recompute projection after updating near/far.
    this.controls.update(); // Apply the new camera/target values immediately.
  }

  public setOnTick(callback: ((deltaSeconds: number) => void) | null): void {
    // Register (or clear) the per-frame callback executed before rendering.
    this.onTick = callback; // Store the callback for use in the render loop.
  }

  public disposeRenderLists(): void {
    // Free internal renderer caches that can keep references to disposed geometries/materials.
    const renderLists = (
      this.renderer as unknown as { renderLists?: { dispose?: () => void } } // Access an internal-ish API via a safe cast.
    ).renderLists; // Read the renderLists object if it exists.
    renderLists?.dispose?.(); // Dispose render lists if the method is available (guards keep this safe).
  }

  public dispose(): void {
    // Tear down GPU and event resources held by Viewer (useful if the app ever unmounts).
    this.stop(); // Stop the render loop first so we don't render while disposing.
    this.controls.dispose(); // Remove event listeners attached by OrbitControls.
    this.renderer.dispose(); // Dispose renderer GPU resources and internal state.
  }
}
