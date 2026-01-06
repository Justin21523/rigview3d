// src/core/settings.ts
// A tiny versioned localStorage settings layer.
//
// Goals:
// - Persist user preferences (Tools / Scene / Debug) between reloads.
// - Be resilient to missing/invalid values (fallback to defaults).
// - Keep the schema versioned so we can migrate later if needed.
//
// This module intentionally stays framework-free and synchronous because:
// - localStorage is synchronous anyway
// - the app is small and runs entirely in the browser
// - avoiding extra state libraries keeps learning value high

export type ToolModeSetting = "select" | "move" | "rotate" | "scale"; // Tool modes we persist for the editor toolbar.

export type ToolsSettings = {
  toolMode: ToolModeSetting; // Which tool is active (Select/Move/Rotate/Scale).
  snapEnabled: boolean; // Whether snapping is enabled for TransformControls.
  snapMove: number; // Translation snap step.
  snapRotateDeg: number; // Rotation snap step in degrees.
  snapScale: number; // Scale snap step.
  nudgeStep: number; // Arrow-key nudge step.
  gizmoSize: number; // TransformControls visual size multiplier.
  localSpace: boolean; // True = local space, false = world space.
  flyEnabled: boolean; // Fly mode toggle.
  flySpeed: number; // Fly movement speed in world units/second.
};

export type SceneSettings = {
  background: string; // Background color as CSS hex string "#rrggbb".
  keyLightIntensity: number; // Directional light intensity.
  fillLightIntensity: number; // Hemisphere light intensity.
};

export type DebugSettings = {
  grid: boolean; // GridHelper visibility.
  axes: boolean; // AxesHelper visibility.
  skeleton: boolean; // SkeletonHelper toggle (applies only when supported by the loaded model).
  wireframe: boolean; // Wireframe toggle (applies only when the loaded model has meshes).
};

export type AppSettingsV1 = {
  version: 1; // Schema version. Increment when the shape changes.
  tools: ToolsSettings; // Tools panel preferences.
  scene: SceneSettings; // Scene panel preferences.
  debug: DebugSettings; // Debug panel preferences.
};

const STORAGE_KEY = "rigview3d.settings"; // Single localStorage key for the whole app (easy to version/migrate).

const DEFAULT_SETTINGS: AppSettingsV1 = {
  // Defaults match `index.html` initial UI values so first run feels consistent.
  version: 1,
  tools: {
    toolMode: "move",
    snapEnabled: false,
    snapMove: 0.1,
    snapRotateDeg: 15,
    snapScale: 0.1,
    nudgeStep: 0.05,
    gizmoSize: 1,
    localSpace: true,
    flyEnabled: false,
    flySpeed: 3,
  },
  scene: {
    background: "#0b0e14",
    keyLightIntensity: 1.2,
    fillLightIntensity: 0.9,
  },
  debug: {
    grid: true,
    axes: true,
    skeleton: false,
    wireframe: false,
  },
};

let cached: AppSettingsV1 | null = null; // In-memory cache so repeated updates don't re-parse localStorage constantly.

export function getSettings(): AppSettingsV1 {
  // Read the current settings (loads from localStorage once, then caches).
  if (!cached) cached = loadSettingsFromStorage(); // Lazy-load so modules can import without side effects.
  return cached; // Return cached settings reference.
}

export function updateToolsSettings(patch: Partial<ToolsSettings>): AppSettingsV1 {
  // Update the Tools section and persist it.
  const current = getSettings(); // Read current cached settings.
  const next = coerceSettings({
    ...current,
    tools: { ...current.tools, ...patch },
  }); // Merge patch then coerce to ensure all values remain valid.
  return setSettings(next); // Persist and return the updated settings.
}

export function updateSceneSettings(patch: Partial<SceneSettings>): AppSettingsV1 {
  // Update the Scene section and persist it.
  const current = getSettings(); // Read current cached settings.
  const next = coerceSettings({
    ...current,
    scene: { ...current.scene, ...patch },
  }); // Merge patch then coerce.
  return setSettings(next); // Persist and return.
}

export function updateDebugSettings(patch: Partial<DebugSettings>): AppSettingsV1 {
  // Update the Debug section and persist it.
  const current = getSettings(); // Read current cached settings.
  const next = coerceSettings({
    ...current,
    debug: { ...current.debug, ...patch },
  }); // Merge patch then coerce.
  return setSettings(next); // Persist and return.
}

function setSettings(next: AppSettingsV1): AppSettingsV1 {
  // Replace cached settings and write to localStorage.
  cached = next; // Update cache first so readers get the new values immediately.
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); // Persist as JSON.
  } catch {
    // Ignore write failures (private mode / quota / disabled storage).
  }
  return next; // Return the stored object for convenience.
}

function loadSettingsFromStorage(): AppSettingsV1 {
  // Load settings from localStorage, falling back to defaults if missing or invalid.
  try {
    const raw = localStorage.getItem(STORAGE_KEY); // Read raw JSON string.
    if (!raw) return cloneDefaults(); // No stored settings means use defaults.
    const parsed = JSON.parse(raw) as unknown; // Parse JSON to an unknown value (must validate).
    return coerceSettings(parsed); // Convert unknown -> fully valid settings object.
  } catch {
    // Any parse errors or storage errors fall back to defaults.
    return cloneDefaults(); // Use safe defaults.
  }
}

function cloneDefaults(): AppSettingsV1 {
  // Create a deep copy of defaults so callers can safely mutate settings without touching the constant.
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as AppSettingsV1; // Defaults contain only JSON-safe primitives.
}

function coerceSettings(value: unknown): AppSettingsV1 {
  // Convert an unknown value into a safe AppSettingsV1 object (with defaults for missing fields).
  const base = cloneDefaults(); // Start from defaults so all keys exist.

  if (!value || typeof value !== "object") return base; // Non-objects cannot contain valid settings.
  const obj = value as Record<string, unknown>; // Treat as a plain object for property reads.

  // Versioning: only accept version 1 shape for now (future versions can be migrated here).
  if (obj.version !== 1) return base; // Unknown schema version => reset to defaults (safe behavior).

  const tools = (obj.tools ?? {}) as Record<string, unknown>; // Read tools section.
  base.tools.toolMode = coerceToolMode(tools.toolMode, base.tools.toolMode); // Tool mode.
  base.tools.snapEnabled = coerceBool(tools.snapEnabled, base.tools.snapEnabled); // Snap toggle.
  base.tools.snapMove = coerceNumber(tools.snapMove, base.tools.snapMove, 0, 1_000); // Move snap.
  base.tools.snapRotateDeg = coerceNumber(tools.snapRotateDeg, base.tools.snapRotateDeg, 0, 360); // Rotate snap (deg).
  base.tools.snapScale = coerceNumber(tools.snapScale, base.tools.snapScale, 0, 1_000); // Scale snap.
  base.tools.nudgeStep = coerceNumber(tools.nudgeStep, base.tools.nudgeStep, 0, 1_000); // Nudge step.
  base.tools.gizmoSize = coerceNumber(tools.gizmoSize, base.tools.gizmoSize, 0.01, 10); // Gizmo size multiplier.
  base.tools.localSpace = coerceBool(tools.localSpace, base.tools.localSpace); // Local/world.
  base.tools.flyEnabled = coerceBool(tools.flyEnabled, base.tools.flyEnabled); // Fly mode toggle.
  base.tools.flySpeed = coerceNumber(tools.flySpeed, base.tools.flySpeed, 0.01, 1_000); // Fly speed.

  const scene = (obj.scene ?? {}) as Record<string, unknown>; // Read scene section.
  base.scene.background = coerceColorHex(scene.background, base.scene.background); // Background color.
  base.scene.keyLightIntensity = coerceNumber(scene.keyLightIntensity, base.scene.keyLightIntensity, 0, 100); // Key light.
  base.scene.fillLightIntensity = coerceNumber(scene.fillLightIntensity, base.scene.fillLightIntensity, 0, 100); // Fill light.

  const debug = (obj.debug ?? {}) as Record<string, unknown>; // Read debug section.
  base.debug.grid = coerceBool(debug.grid, base.debug.grid); // Grid toggle.
  base.debug.axes = coerceBool(debug.axes, base.debug.axes); // Axes toggle.
  base.debug.skeleton = coerceBool(debug.skeleton, base.debug.skeleton); // Skeleton toggle.
  base.debug.wireframe = coerceBool(debug.wireframe, base.debug.wireframe); // Wireframe toggle.

  return base; // Return a fully valid settings object.
}

function coerceBool(value: unknown, fallback: boolean): boolean {
  // Convert an unknown value into a boolean (or fallback).
  if (typeof value === "boolean") return value; // Accept real booleans.
  return fallback; // Fall back for anything else.
}

function coerceNumber(value: unknown, fallback: number, min: number, max: number): number {
  // Convert an unknown value into a finite number clamped to [min, max].
  const n = typeof value === "number" ? value : Number(value); // Accept numbers or numeric strings.
  if (!Number.isFinite(n)) return fallback; // Reject NaN/Infinity.
  return Math.max(min, Math.min(max, n)); // Clamp to safe range.
}

function coerceToolMode(value: unknown, fallback: ToolModeSetting): ToolModeSetting {
  // Convert an unknown value into a valid tool mode union.
  if (value === "select" || value === "move" || value === "rotate" || value === "scale") return value; // Accept known strings.
  return fallback; // Fall back to previous/default.
}

function coerceColorHex(value: unknown, fallback: string): string {
  // Convert an unknown value into a CSS hex color string "#rrggbb".
  if (typeof value !== "string") return fallback; // Only strings can be colors.
  const v = value.trim(); // Remove surrounding whitespace.
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v; // Accept exactly 6-digit hex.
  return fallback; // Fall back for invalid formats.
}

