# Repository Guidelines

## Project Structure & Module Organization
RigView3D is a small front-end app (TypeScript + Three.js) intended to be served/built with Vite.

- `index.html`: app shell (loads `src/main.ts` as an ES module)
- `src/main.ts`: bootstrap (wires core + UI)
- `src/ui/controls.ts`: DOM wiring for loading/animation/debug panels
- `src/ui/editor.ts`: Hierarchy panel + viewport click-to-select
- `src/ui/tools.ts`: Tools panel (Select/Move/Rotate/Scale, snapping, local/world)
- `src/ui/inspector.ts`: Inspector panel (name/visible/transform/material)
- `src/ui/scene.ts`: Scene panel (background + light intensities)
- `src/ui/export.ts`: Export panel (GLB download)
- `src/ui/shortcuts.ts`: keyboard shortcuts (Q/W/E/R, F, Del, undo/redo)
- `src/core/`: rendering and runtime logic (`viewer.ts`, `loader.ts`, `animator.ts`, `helpers.ts`, `dispose.ts`)
- `src/core/editor/`: editor runtime (selection, TransformControls, history, snapshots)
- `src/style.css`: global UI styles
- `docs/implementation/`: step-by-step implementation notes (Chinese) for beginners
- `project-description.md`: product/architecture notes and roadmap

## Build, Test, and Development Commands
This repo uses a Vite workflow:

- `npm install`: install dependencies
- `npm run dev`: start the local dev server with HMR
- `npm run build`: create a production build
- `npm run preview`: serve the production build locally
- `npm run typecheck`: TypeScript typecheck (no emit)

## Coding Style & Naming Conventions
- Indentation: 2 spaces; use semicolons and double quotes (match existing `src/**/*.ts`).
- Prefer small, focused modules: keep Three.js/WebGL logic in `src/core/`, and keep DOM/UI glue in `src/ui/`.
- Naming: `PascalCase` for classes (`Viewer`), `camelCase` for functions/vars, and lowercase filenames (`viewer.ts`).

## Testing Guidelines
There are no automated tests checked in yet. When adding logic that can be unit-tested, keep it free of DOM/WebGL side effects and add tests under `tests/` (or `src/**/__tests__/`). Document the test command in `package.json` when introduced.

## Commit & Pull Request Guidelines
- Commits: follow Conventional Commits (`feat:`, `fix:`, `chore:`) and keep changes scoped.
- PRs: include a short description, steps to reproduce (mention the asset type, e.g. `.glb`), and screenshots/GIFs for any UI or rendering changes.

## Assets, Performance, and Safety
- Avoid committing large binary `.glb/.gltf` assets; prefer small fixtures or provide download links.
- Be deliberate about cleanup: dispose Three.js resources on reloads (`geometry.dispose()`, `material.dispose()`, `renderer.dispose()`), and stop animation loops when tearing down.

## Documentation Expectations
- Source code includes extensive English inline comments for learning and maintenance.
- When adding features or changing behavior, update `docs/implementation/` with a short Chinese explanation of the new concepts and the affected modules.
