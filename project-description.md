# RigView3D — Real-time Rigged Character & Animation Previewer (Three.js)

## Overview
RigView3D is a browser-based real-time viewer for rigged 3D characters and animation clips. It loads `.glb/.gltf` files, plays animation clips using Three.js `AnimationMixer`, and provides debugging helpers such as skeleton visualization, wireframe view, and grid/axes toggles.

This tool is designed for quickly validating rigging and animation quality for assets exported from:
- Tripo AI (rigged characters, often without animation clips)
- Mixamo (animations, sometimes retargeted)
- Blender (custom keyframed animations and exports)

The goal is to make it easy to answer:
- Does the model contain a skeleton and skinning data?
- What animation clips are embedded and do they play correctly?
- Do joints deform correctly (knees/elbows), or does the mesh explode?
- Are materials/textures missing or incorrectly referenced?
- Can we quickly compare clips and record results?

## Target Users
- Developers who need a lightweight web viewer for GLB/GLTF characters
- Artists / riggers validating exported assets before sending them to game engines
- AI pipeline builders validating LoRA/training assets or video-generation reference rigs

## Core MVP Features (Must Have)
1. Load Model
   - Drag & drop `.glb/.gltf` file into the browser
   - Optional: load via URL (future)
2. Animation Playback
   - List available animation clips from the loaded model
   - Select clip from dropdown
   - Play / Pause / Stop
   - Speed slider (e.g. 0.25x to 2.0x)
   - Loop toggle (LoopRepeat vs LoopOnce)
3. Camera & Scene
   - OrbitControls (rotate / pan / zoom)
   - Auto-frame model after load
   - Reset camera button
4. Debug Helpers
   - Toggle GridHelper
   - Toggle AxesHelper
   - Toggle SkeletonHelper (shows bone hierarchy visually)
   - Toggle Wireframe rendering for meshes
5. Status / Info Panel
   - Display file name
   - Display number of meshes/materials/bones (basic stats)
   - Display animation clip names and durations
6. Robustness
   - Handle loading errors gracefully
   - Do not leak GPU resources on repeated loads (dispose old scene assets)

## Non-Goals (For MVP)
- Full retargeting / humanoid retarget pipeline
- Editing bones/weights in-browser
- Complex UI framework (React) — use simple DOM first

## Architecture
### Tech Stack
- Vite (frontend dev server + build)
- TypeScript
- Three.js
- No backend (static app)

### Module Responsibilities
- `src/core/viewer.ts`
  - Scene, camera, renderer, lights, resize handler, render loop
  - Public methods: `getScene()`, `frameObject(obj)`, `resetCamera()`, `setOnTick(cb)`, `dispose()`
- `src/core/loader.ts`
  - GLTFLoader setup
  - Exposes `loadFromFile(file: File)` returning `{ gltf, root, animations }`
  - Progress callbacks and error handling
- `src/core/animator.ts`
  - AnimationMixer lifecycle
  - Create actions per clip
  - Controls: play/pause/stop, setSpeed, setLoop, switchClip
- `src/core/helpers.ts`
  - Build and toggle helpers: grid/axes/skeleton/wireframe
- `src/ui/controls.ts`
  - Wire DOM elements to core logic
  - Dropdown population, buttons, sliders, toggles

## Implementation Milestones
### Phase 1 — Bootstrapping (MVP runnable)
- Setup Vite + TS + Three.js
- Create viewer scene with OrbitControls + basic lighting
- Render a placeholder grid/axes

### Phase 2 — Load & Display GLB/GLTF
- Drag & drop file loading
- Add model to scene and auto-frame camera
- Show basic stats in UI panel

### Phase 3 — Animation Playback
- Populate clip dropdown from `gltf.animations`
- Implement AnimationMixer play/pause/stop
- Add speed + loop controls

### Phase 4 — Debug Helpers
- SkeletonHelper toggle (based on first SkinnedMesh found)
- Wireframe toggle for all meshes
- Grid/Axes toggles

### Phase 5 — Resource Cleanup & Stability
- Dispose previous model geometries/materials/textures
- Ensure mixers, actions, and helpers are cleaned properly

## Export & Deployment
- Local development: `npm run dev`
- Build: `npm run build`
- Preview: `npm run preview`
- Optional deployment: GitHub Pages / static hosting

## Acceptance Criteria (MVP)
- User can drag a `.glb` file into the page and see the character rendered
- If the file has animation clips, user can select and play them
- Skeleton/grid/axes/wireframe toggles work without breaking playback
- Reloading another file does not cause performance degradation or visual artifacts
