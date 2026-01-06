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

  // Orbit control mapping: choose a mouse-button scheme for orbit/pan/dolly.
  private orbitEnabledByCameraMode = true; // Whether orbit controls are allowed by the current camera mode (disabled in Fly mode).
  private orbitEnabledByExternal = true; // Whether orbit controls are allowed by external systems (e.g., TransformControls dragging).
  private unityAltOrbitEnabled = true; // Toggle for an editor-friendly mouse mapping (MMB pan / RMB dolly).

  // Fly camera (Unity-like): RMB look + WASD/QE move.
  private flyEnabled = false; // When true, the camera can be driven in "fly" mode (instead of orbiting a target).
  private flyLooking = false; // True while the user is holding RMB down to look around.
  private flyPointerId: number | null = null; // Pointer id captured for RMB looking (so movement stays smooth).
  private flyLastX = 0; // Last pointer X for look delta calculations.
  private flyLastY = 0; // Last pointer Y for look delta calculations.
  private flyYaw = 0; // Yaw angle (radians) used to build camera orientation during fly look.
  private flyPitch = 0; // Pitch angle (radians) used to build camera orientation during fly look.
  private flySpeed = 3; // Base movement speed in world units/second.
  private flyFastMultiplier = 4; // Speed multiplier while holding Shift.
  private flyLookSensitivity = 0.0025; // Radians per pixel while looking (tune for a comfortable feel).
  private flyKey = {
    // Key state tracked while fly mode is enabled.
    forward: false, // W
    backward: false, // S
    left: false, // A
    right: false, // D
    up: false, // E
    down: false, // Q
    fast: false, // Shift
  };

  private readonly flyTmpForward = new THREE.Vector3(); // Reused temp vector for camera forward direction.
  private readonly flyTmpRight = new THREE.Vector3(); // Reused temp vector for camera right direction.
  private readonly flyTmpDelta = new THREE.Vector3(); // Reused temp vector for movement delta.
  private readonly flyWorldUp = new THREE.Vector3(0, 1, 0); // Constant world up vector used for vertical movement.

  private readonly handleKeyDown = (e: KeyboardEvent) => this.onKeyDown(e); // Bound handler so we can remove it on dispose.
  private readonly handleKeyUp = (e: KeyboardEvent) => this.onKeyUp(e); // Bound handler so we can remove it on dispose.
  private readonly handleBlur = () => this.onWindowBlur(); // Bound handler for window blur.
  private readonly handleContextMenu = (e: MouseEvent) => e.preventDefault(); // Bound handler to disable context menu.
  private readonly handlePointerDown = (e: PointerEvent) => this.onPointerDown(e); // Bound handler for pointerdown.
  private readonly handlePointerMove = (e: PointerEvent) => this.onPointerMove(e); // Bound handler for pointermove.
  private readonly handlePointerUp = (e: PointerEvent) => this.onPointerUp(e); // Bound handler for pointerup.

  // Defaults
  private readonly defaultTarget = new THREE.Vector3(0, 1, 0); // Default point the camera orbits around (roughly character height).
  private readonly defaultCamPos = new THREE.Vector3(2.5, 1.8, 3.2); // Default camera position (an angled view of the origin).

  constructor(canvas: HTMLCanvasElement) {
    // Construct the viewer around an existing canvas element.
    this.canvas = canvas; // Store the canvas so we can pass it into WebGLRenderer.
    this.init(); // Create the Three.js renderer/scene/camera/controls and base lighting.
    this.attachInputHandlers(); // Attach window/canvas listeners for Unity-like camera navigation.
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
    this.orbitEnabledByExternal = enabled; // Store the external gating state (gizmos set this).
    this.applyOrbitEnabledState(); // Apply combined gating to OrbitControls.enabled.
  }

  public setFlyEnabled(enabled: boolean): void {
    // Enable/disable Fly (WASD) camera mode.
    this.flyEnabled = enabled; // Store the mode flag.
    this.orbitEnabledByCameraMode = !enabled; // Fly mode disables orbit controls entirely.
    this.applyOrbitEnabledState(); // Apply orbit enable/disable.

    if (!enabled) {
      // When leaving fly mode, stop any active "look" drag so we don't keep rotating the camera.
      this.stopFlyLook(); // Clean up pointer capture and state.
      this.controls.update(); // Ensure OrbitControls receives a consistent camera state on return.
      return; // Done.
    }

    // When entering fly mode, initialize yaw/pitch from the current camera orientation.
    const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, "YXZ"); // Convert camera quaternion into yaw/pitch friendly order.
    this.flyPitch = euler.x; // Pitch corresponds to X in YXZ.
    this.flyYaw = euler.y; // Yaw corresponds to Y in YXZ.
    this.flyKey.forward = false; // Reset key state so we don't "stick" movement from previous sessions.
    this.flyKey.backward = false; // Reset key state.
    this.flyKey.left = false; // Reset key state.
    this.flyKey.right = false; // Reset key state.
    this.flyKey.up = false; // Reset key state.
    this.flyKey.down = false; // Reset key state.
    this.flyKey.fast = false; // Reset key state.
  }

  public isFlyEnabled(): boolean {
    // Return whether fly camera mode is currently enabled.
    return this.flyEnabled; // Expose the internal flag.
  }

  public setFlySpeed(speed: number): void {
    // Set the base movement speed used in fly mode.
    if (!Number.isFinite(speed)) return; // Ignore invalid numbers.
    this.flySpeed = Math.max(0.01, speed); // Clamp to a small positive number to avoid "stuck" movement.
  }

  public getFlySpeed(): number {
    // Read the current fly speed (used for initializing UI).
    return this.flySpeed; // Return speed in world units/second.
  }

  public setUnityAltOrbitEnabled(enabled: boolean): void {
    // Enable/disable an editor-friendly orbit mouse mapping (MMB pan / RMB dolly).
    this.unityAltOrbitEnabled = enabled; // Store preference.
    this.applyOrbitMouseButtons(); // Update OrbitControls mouse mappings immediately.
  }

  public isUnityAltOrbitEnabled(): boolean {
    // Return whether editor-friendly orbit mapping is enabled.
    return this.unityAltOrbitEnabled; // Expose internal flag.
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
    this.applyOrbitEnabledState(); // Apply initial enabled/disabled state based on camera mode flags.
    this.applyOrbitMouseButtons(); // Apply initial Unity-like mouse button gating.

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

  private attachInputHandlers(): void {
    // Attach window/canvas listeners for camera navigation (Fly mode) and viewport UX.
    window.addEventListener("keydown", this.handleKeyDown); // Track fly movement keys while fly mode is enabled.
    window.addEventListener("keyup", this.handleKeyUp); // Track fly movement keys while fly mode is enabled.
    window.addEventListener("blur", this.handleBlur); // Clear stuck modifier keys when the tab loses focus.

    const dom = this.getDomElement(); // Canvas element used for pointer events.
    dom.addEventListener("contextmenu", this.handleContextMenu); // Disable the browser context menu in the viewport (Unity-like).
    dom.addEventListener("pointerdown", this.handlePointerDown); // Start fly look on RMB when fly mode is enabled.
    dom.addEventListener("pointermove", this.handlePointerMove); // Update fly look rotation while dragging.
    dom.addEventListener("pointerup", this.handlePointerUp); // End fly look when RMB is released.
  }

  private onKeyDown(e: KeyboardEvent): void {
    // Track modifier keys and fly movement keys.
    if (!this.flyEnabled) return; // Ignore fly keys when fly mode is off.

    const key = e.key.toLowerCase(); // Normalize to lowercase so "W" and "w" behave the same.
    if (key === "w") this.flyKey.forward = true; // W = forward.
    if (key === "s") this.flyKey.backward = true; // S = backward.
    if (key === "a") this.flyKey.left = true; // A = left strafe.
    if (key === "d") this.flyKey.right = true; // D = right strafe.
    if (key === "e") this.flyKey.up = true; // E = up (matches many editors).
    if (key === "q") this.flyKey.down = true; // Q = down.
    if (e.key === "Shift") this.flyKey.fast = true; // Shift = faster movement.
  }

  private onKeyUp(e: KeyboardEvent): void {
    // Track key releases for modifier and fly movement keys.
    if (!this.flyEnabled) return; // Ignore fly keys when fly mode is off.

    const key = e.key.toLowerCase(); // Normalize.
    if (key === "w") this.flyKey.forward = false; // W released.
    if (key === "s") this.flyKey.backward = false; // S released.
    if (key === "a") this.flyKey.left = false; // A released.
    if (key === "d") this.flyKey.right = false; // D released.
    if (key === "e") this.flyKey.up = false; // E released.
    if (key === "q") this.flyKey.down = false; // Q released.
    if (e.key === "Shift") this.flyKey.fast = false; // Shift released.
  }

  private onWindowBlur(): void {
    // Clear modifier keys when focus is lost so the app doesn't get "stuck" in Fly.
    this.applyOrbitMouseButtons(); // Restore OrbitControls mouse mapping (Fly may have changed pointer capture state).
    this.flyKey.forward = false; // Clear fly keys.
    this.flyKey.backward = false; // Clear fly keys.
    this.flyKey.left = false; // Clear fly keys.
    this.flyKey.right = false; // Clear fly keys.
    this.flyKey.up = false; // Clear fly keys.
    this.flyKey.down = false; // Clear fly keys.
    this.flyKey.fast = false; // Clear fly keys.
    this.stopFlyLook(); // Ensure fly look is not stuck.
  }

  private onPointerDown(e: PointerEvent): void {
    // Start RMB-look when fly mode is enabled.
    if (!this.flyEnabled) return; // Not in fly mode, nothing to do.
    if (e.button !== 2) return; // Only RMB triggers look mode (Unity-like).

    this.flyLooking = true; // Enter look mode.
    this.flyPointerId = e.pointerId; // Store pointer id so we can release capture later.
    this.flyLastX = e.clientX; // Store pointer pos for delta.
    this.flyLastY = e.clientY; // Store pointer pos for delta.

    this.getDomElement().setPointerCapture(e.pointerId); // Capture pointer so we still receive moves outside the canvas.
  }

  private onPointerMove(e: PointerEvent): void {
    // Update fly look rotation while RMB is held.
    if (!this.flyEnabled) return; // Not in fly mode.
    if (!this.flyLooking) return; // Not currently looking.
    if (this.flyPointerId !== e.pointerId) return; // Ignore moves from other pointers.

    const dx = e.clientX - this.flyLastX; // Horizontal mouse delta in pixels.
    const dy = e.clientY - this.flyLastY; // Vertical mouse delta in pixels.
    this.flyLastX = e.clientX; // Update last X.
    this.flyLastY = e.clientY; // Update last Y.

    this.flyYaw -= dx * this.flyLookSensitivity; // Yaw around world up.
    this.flyPitch -= dy * this.flyLookSensitivity; // Pitch around camera right.

    const maxPitch = Math.PI / 2 - 0.01; // Clamp pitch to avoid flipping when looking straight up/down.
    this.flyPitch = Math.max(-maxPitch, Math.min(maxPitch, this.flyPitch)); // Clamp.

    const euler = new THREE.Euler(this.flyPitch, this.flyYaw, 0, "YXZ"); // Build Euler in yaw/pitch friendly order.
    this.camera.quaternion.setFromEuler(euler); // Apply orientation to camera.
  }

  private onPointerUp(e: PointerEvent): void {
    // End fly look when RMB is released.
    if (!this.flyEnabled) return; // Not in fly mode.
    if (e.button !== 2) return; // Only RMB ends look mode.
    this.stopFlyLook(); // Clean up.
  }

  private stopFlyLook(): void {
    // Stop RMB-look and release pointer capture if needed.
    if (!this.flyLooking) return; // Nothing to do.
    const id = this.flyPointerId; // Snapshot pointer id so we can release capture safely.
    this.flyLooking = false; // Exit look mode.
    this.flyPointerId = null; // Clear pointer id.
    if (id !== null) {
      // releasePointerCapture can throw if capture is already released, so guard and try/catch.
      try {
        this.getDomElement().releasePointerCapture(id); // Release capture so the browser can resume normal behavior.
      } catch {
        // Ignore; capture may already have been released by the browser.
      }
    }
  }

  private applyOrbitEnabledState(): void {
    // Apply combined orbit gating to OrbitControls.enabled.
    this.controls.enabled = this.orbitEnabledByCameraMode && this.orbitEnabledByExternal; // Only enable if both gates allow it.
  }

  private applyOrbitMouseButtons(): void {
    // Apply a mouse-button mapping to OrbitControls.
    if (this.flyEnabled) {
      // Fly mode does not use orbit controls mouse buttons at all.
      this.controls.mouseButtons = {
        LEFT: -1 as unknown as THREE.MOUSE, // Disable LMB orbit.
        MIDDLE: -1 as unknown as THREE.MOUSE, // Disable MMB pan/dolly.
        RIGHT: -1 as unknown as THREE.MOUSE, // Disable RMB pan/dolly.
      };
      return; // Done.
    }

    if (this.unityAltOrbitEnabled) {
      // Editor-friendly mapping: LMB orbit, MMB pan, RMB dolly (common in DCC tools and Unity Scene view style).
      this.controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE, // LMB orbit.
        MIDDLE: THREE.MOUSE.PAN, // MMB pan.
        RIGHT: THREE.MOUSE.DOLLY, // RMB dolly.
      };
      return; // Done.
    }

    // OrbitControls default mapping: LMB orbit, MMB dolly, RMB pan.
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE, // LMB orbit.
      MIDDLE: THREE.MOUSE.DOLLY, // MMB dolly.
      RIGHT: THREE.MOUSE.PAN, // RMB pan.
    };
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
      if (this.flyEnabled) this.updateFly(deltaSeconds); // Apply fly movement before rendering.
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
    this.setFlyEnabled(false); // Reset leaves fly mode so the camera returns to predictable orbit behavior.
    this.controls.target.copy(this.defaultTarget); // Restore the orbit pivot.
    this.camera.position.copy(this.defaultCamPos); // Restore the camera position.
    this.camera.updateProjectionMatrix(); // Ensure camera matrices are up-to-date.
    this.controls.update(); // Apply control changes immediately.
  }

  private updateFly(deltaSeconds: number): void {
    // Update fly-mode movement each frame based on key state.
    if (deltaSeconds <= 0) return; // Guard against non-positive deltas.
    if (!this.flyEnabled) return; // Fly mode off.

    const moveX = (this.flyKey.right ? 1 : 0) - (this.flyKey.left ? 1 : 0); // Right/left strafe.
    const moveY = (this.flyKey.up ? 1 : 0) - (this.flyKey.down ? 1 : 0); // Up/down.
    const moveZ = (this.flyKey.forward ? 1 : 0) - (this.flyKey.backward ? 1 : 0); // Forward/back.

    if (moveX === 0 && moveY === 0 && moveZ === 0) return; // No movement keys held.

    const speed = this.flySpeed * (this.flyKey.fast ? this.flyFastMultiplier : 1); // Apply Shift speed multiplier.

    this.flyTmpForward.set(0, 0, -1).applyQuaternion(this.camera.quaternion); // Camera forward direction.
    this.flyTmpRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion); // Camera right direction.

    this.flyTmpDelta.set(0, 0, 0); // Reset movement delta.
    this.flyTmpDelta.addScaledVector(this.flyTmpRight, moveX); // Add strafe component.
    this.flyTmpDelta.addScaledVector(this.flyWorldUp, moveY); // Add vertical component.
    this.flyTmpDelta.addScaledVector(this.flyTmpForward, moveZ); // Add forward/back component.

    if (this.flyTmpDelta.lengthSq() > 0) this.flyTmpDelta.normalize(); // Normalize so diagonal movement isn't faster.
    this.camera.position.addScaledVector(this.flyTmpDelta, speed * deltaSeconds); // Move the camera in world space.
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
    this.stopFlyLook(); // Release pointer capture if fly look is active.
    window.removeEventListener("keydown", this.handleKeyDown); // Remove keyboard listeners.
    window.removeEventListener("keyup", this.handleKeyUp); // Remove keyboard listeners.
    window.removeEventListener("blur", this.handleBlur); // Remove blur listener.
    const dom = this.getDomElement(); // Read dom element for listener cleanup.
    dom.removeEventListener("contextmenu", this.handleContextMenu); // Remove context menu suppression.
    dom.removeEventListener("pointerdown", this.handlePointerDown); // Remove pointer listeners.
    dom.removeEventListener("pointermove", this.handlePointerMove); // Remove pointer listeners.
    dom.removeEventListener("pointerup", this.handlePointerUp); // Remove pointer listeners.
    this.controls.dispose(); // Remove event listeners attached by OrbitControls.
    this.renderer.dispose(); // Dispose renderer GPU resources and internal state.
  }
}
