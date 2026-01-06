// src/ui/editor.ts
// This UI module wires up the editor-only panels and interactions:
// - Viewport click-to-select (raycast picking via the core Editor)
// - Hierarchy panel rendering + search filter
//
// It intentionally does NOT own Three.js rendering state. It calls small APIs on `Editor`
// and reads selection/root state through events so the DOM stays in sync.

import type * as THREE from "three"; // Import Three.js types for Object3D annotations (no runtime dependency here).
import type { Editor } from "../core/editor/editor"; // Import Editor type (selection + root state).
import type { Viewer } from "../core/viewer"; // Import Viewer type (used for framing from the Hierarchy context menu).

type VisibleNode = {
  // Flattened hierarchy node data used for simple DOM rendering.
  object: THREE.Object3D; // The underlying Three.js object.
  depth: number; // Depth in the tree (used for indentation).
  hasChildren: boolean; // Whether the node has children (controls toggle visibility).
  expanded: boolean; // Whether children are currently expanded (only relevant when `hasChildren` is true).
};

export function initEditorUi(viewer: Viewer, editor: Editor): void {
  // Public API: attach editor UI behavior to the existing DOM.
  const canvas = document.getElementById("c") as HTMLCanvasElement | null; // Find the viewport canvas used for rendering.
  if (!canvas) throw new Error("Canvas element not found."); // Fail fast if markup is out of sync with code.

  let pointerDownX = 0; // Track pointer-down X for click-vs-drag detection.
  let pointerDownY = 0; // Track pointer-down Y for click-vs-drag detection.
  let pointerDownButton = -1; // Track which button started the interaction.
  let pointerMoved = false; // True once movement exceeds the click tolerance.
  const clickTolerancePx = 6; // Pixel tolerance used to treat a press as a "click" (prevents selection while orbiting).

  canvas.addEventListener("pointerdown", (e) => {
    // Clicking the viewport should "take focus" (Unity-like) so keyboard shortcuts work immediately.
    //
    // In browsers, clicking a non-focusable element does not blur inputs, so the active text field can keep
    // consuming shortcuts (our shortcut handler ignores keys while typing).
    canvas.focus(); // Focus the canvas so `keydown` targets are no longer text inputs.

    pointerDownX = e.clientX; // Record initial pointer X.
    pointerDownY = e.clientY; // Record initial pointer Y.
    pointerDownButton = e.button; // Record which mouse button was pressed.
    pointerMoved = false; // Reset moved flag for this interaction.
  });

  const searchInput = mustGetEl("hierarchy-search") as HTMLInputElement; // Search box for filtering the hierarchy list.
  const tree = mustGetEl("hierarchy-tree"); // Container where hierarchy items will be rendered.

  let currentRoot: THREE.Object3D | null = null; // Track the current model root so we can render it.
  let currentFilter = ""; // Track the current search string from the input box.

  const expanded = new Set<string>(); // Track which nodes are expanded by uuid (collapse/expand UX).
  const uuidToObject = new Map<string, THREE.Object3D>(); // Map rendered DOM rows back to real Object3D instances.
  const contextMenu = createContextMenu(); // Singleton context menu instance for hierarchy rows.

  const resetExpandState = () => {
    // Start collapsed so large rigs don't explode into thousands of rows by default (beginner-friendly).
    expanded.clear(); // Keep empty = everything collapsed until the user expands nodes.
  };

  const render = () => {
    // Rebuild the hierarchy DOM to reflect the current root/filter/selection.
    tree.innerHTML = ""; // Clear existing rows (simple + predictable for this small tool).
    uuidToObject.clear(); // Clear the mapping because we'll rebuild it from scratch.

    if (!currentRoot) {
      // If no model is loaded, show an empty state message.
      const empty = document.createElement("div"); // Create a small placeholder element.
      empty.className = "muted"; // Use muted styling so it reads as secondary text.
      empty.textContent = "No model loaded."; // Explain why the hierarchy is empty.
      tree.appendChild(empty); // Add placeholder into the tree container.
      return; // Done.
    }

    const selection = editor.getSelection(); // Read current selection so we can highlight the selected row.
    const nodes = buildVisibleNodes(currentRoot, currentFilter, expanded); // Build a flat list of visible nodes with depth info.

    for (const { object, depth, hasChildren, expanded: isExpanded } of nodes) {
      // Create one row per visible node.
      const row = document.createElement("div"); // Use a div for a simple clickable row.
      row.className = "tree-item"; // Base styling for hierarchy items.
      row.setAttribute("role", "treeitem"); // Improve accessibility semantics for assistive tech.
      row.dataset.uuid = object.uuid; // Store uuid so click handlers can map back to the object.
      row.style.paddingLeft = `${8 + depth * 14}px`; // Indent based on depth to visualize parent/child structure.

      // Collapse toggle (triangle).
      const toggle = document.createElement("button"); // A button is keyboard-focusable by default.
      toggle.type = "button"; // Explicit type avoids form-submit behavior if used inside a form.
      toggle.className = "tree-toggle"; // Style hook.
      toggle.textContent = hasChildren ? (isExpanded ? "▾" : "▸") : " "; // Triangle for parents, spacer for leaves.
      toggle.disabled = !hasChildren; // Disable for leaves so it doesn't look interactive.
      toggle.addEventListener("click", (e) => {
        // Expand/collapse without selecting the node.
        e.stopPropagation(); // Prevent row click selection.
        if (!hasChildren) return; // Guard.
        if (expanded.has(object.uuid)) expanded.delete(object.uuid); // Collapse.
        else expanded.add(object.uuid); // Expand.
        render(); // Re-render to reflect the new expand state.
      });
      row.appendChild(toggle); // Add toggle to row.

      // Type icon (Mesh/Bone/Group).
      const icon = document.createElement("span"); // Small badge-like icon.
      const kind = getNodeKind(object); // Determine icon kind based on runtime flags.
      icon.className = `tree-icon tree-icon-${kind}`; // Add kind-specific class for styling.
      icon.textContent = kindToLabel(kind); // Use a short letter label (M/B/G/N).
      row.appendChild(icon); // Add icon.

      // Name label (flexes to fill).
      const label = document.createElement("span"); // Separate label element so flex/ellipsis works with buttons.
      label.className = "tree-label"; // Style hook.
      label.textContent = formatObjectLabel(object); // Show a user-friendly label (name or type).
      row.appendChild(label); // Add label.

      // Visibility toggle (eye).
      const eye = document.createElement("button"); // Button so it can be clicked independently from selection.
      eye.type = "button"; // Explicit type.
      eye.className = "tree-eye"; // Style hook.
      eye.setAttribute("aria-label", "Toggle visibility"); // Accessibility label.
      eye.innerHTML = object.visible ? EYE_OPEN_SVG : EYE_CLOSED_SVG; // Render an eye icon (open/closed).
      eye.addEventListener("click", (e) => {
        // Toggle visibility without changing selection.
        e.stopPropagation(); // Prevent row click selection.
        const before = object.visible; // Snapshot previous state for undo.
        const after = !before; // Compute toggled state.
        object.visible = after; // Apply immediately.
        editor.pushCommand({
          // Make visibility toggles undoable like other editor actions.
          label: "Toggle Visibility",
          undo: () => (object.visible = before),
          redo: () => (object.visible = after),
        });
        if (selection && selection.uuid === object.uuid) editor.notifySelectionUpdated(); // Refresh inspector if this object is selected.
        render(); // Re-render so the eye icon updates.
      });
      row.appendChild(eye); // Add eye toggle.

      if (!object.visible) row.classList.add("is-hidden"); // Dim hidden nodes for clarity.

      if (selection && selection.uuid === object.uuid) {
        // If this row corresponds to the selected object...
        row.classList.add("is-selected"); // ...apply selected styling.
      }

      row.addEventListener("contextmenu", (e) => {
        // Right-click opens a Unity-like context menu.
        e.preventDefault(); // Prevent browser menu.
        e.stopPropagation(); // Don't trigger other handlers.
        contextMenu.show(e.clientX, e.clientY, [
          {
            label: "Frame",
            onClick: () => viewer.frameObject(object),
          },
          {
            label: "Rename…",
            onClick: () => {
              const next = window.prompt("Rename object", object.name || formatObjectLabel(object)); // Simple prompt UX.
              if (next === null) return; // Cancel.
              const before = object.name; // Snapshot for undo.
              object.name = next; // Apply rename.
              editor.pushCommand({
                label: "Rename",
                undo: () => (object.name = before),
                redo: () => (object.name = next),
              });
              if (selection && selection.uuid === object.uuid) editor.notifySelectionUpdated(); // Refresh inspector name.
              render(); // Re-render to refresh label.
            },
          },
          {
            label: "Duplicate",
            onClick: () => {
              editor.select(object); // Context menu acts on the clicked node.
              editor.duplicateSelection(); // Duplicate is implemented on selection (undoable).
            },
          },
          {
            label: "Delete",
            danger: true,
            onClick: () => {
              editor.select(object); // Delete acts on the clicked node.
              editor.deleteSelection(); // Delete is implemented on selection (undoable).
            },
          },
        ]);
      });

      uuidToObject.set(object.uuid, object); // Store uuid -> object mapping for click selection.
      tree.appendChild(row); // Add row to the DOM.
    }
  }; // End render function.

  canvas.addEventListener("pointermove", (e) => {
    // Moving the pointer in the viewport updates hover feedback (outline + cursor).
    if (pointerDownButton === 0 && (e.buttons & 1) !== 0) {
      // While LMB is held, treat movement as potential camera orbit; suppress hover and track drag distance.
      const dx = e.clientX - pointerDownX; // Horizontal delta from pointerdown.
      const dy = e.clientY - pointerDownY; // Vertical delta from pointerdown.
      if (Math.hypot(dx, dy) > clickTolerancePx) pointerMoved = true; // Mark as drag once we exceed the tolerance.
      editor.clearHover(); // Hide hover outline during drags (less flicker).
      canvas.style.cursor = ""; // Restore default cursor.
      return; // Done.
    }

    if (e.buttons !== 0) {
      // Any drag (MMB/RMB) is typically camera navigation; suppress hover for stability.
      editor.clearHover(); // Hide hover outline while orbiting/panning/dollying.
      canvas.style.cursor = ""; // Restore default cursor.
      return; // Done.
    }

    editor.hoverAt(e.clientX, e.clientY); // Update hover outline based on pointer position.
    canvas.style.cursor = editor.getHover() ? "pointer" : ""; // Show a pointer cursor when an object is hoverable.
  });

  canvas.addEventListener("pointerleave", () => {
    // When the pointer leaves the viewport, clear hover feedback.
    editor.clearHover(); // Remove hover outline helper.
    canvas.style.cursor = ""; // Restore default cursor.
  });

  canvas.addEventListener("pointerup", (e) => {
    // On pointer up, treat a short press as a selection click (but ignore drags used for camera navigation).
    if (e.button !== 0) return; // Only respond to left button selection.
    if (editor.isTransformDragging()) return; // Ignore while gizmo is mid-drag.
    if (pointerMoved) return; // Ignore if the pointer moved (likely camera orbit).

    editor.pick(e.clientX, e.clientY, {
      // Default to "whole model" selection; hold Shift/Ctrl/Cmd for exact object selection.
      exact: e.shiftKey || e.ctrlKey || e.metaKey,
    });
  });

  canvas.addEventListener("pointercancel", () => {
    // Reset click tracking if the pointer interaction is cancelled.
    pointerDownButton = -1; // Clear stored button.
    pointerMoved = false; // Reset moved state.
  });

  tree.addEventListener("click", (e) => {
    // Clicking a hierarchy row selects that Object3D.
    const target = e.target as HTMLElement | null; // The clicked element.
    const row = target?.closest(".tree-item") as HTMLElement | null; // Find the nearest row wrapper.
    if (!row) return; // Ignore clicks on the empty state or padding.
    const uuid = row.dataset.uuid; // Read uuid stored on the row.
    const object = uuid ? uuidToObject.get(uuid) ?? null : null; // Look up the Object3D for that uuid.
    editor.select(object); // Update core selection state (also updates selection outline + inspector later).
  });

  searchInput.addEventListener("input", () => {
    // Re-filter the hierarchy list as the user types.
    currentFilter = searchInput.value; // Store the latest filter string.
    render(); // Re-render hierarchy with the new filter.
  });

  editor.onRootChange((root) => {
    // Re-render the hierarchy list when a new model is loaded.
    currentRoot = root; // Store root reference (null clears the hierarchy).
    resetExpandState(); // Collapse by default for large rigs.
    render(); // Refresh UI immediately.
  });

  editor.onSelectionChange(() => {
    // Re-render the hierarchy list when selection changes (updates selected highlight row).
    render(); // Simple full re-render keeps behavior predictable for a learning project.
  });

  editor.onSelectionUpdated(() => {
    // Re-render the hierarchy list when the selected object changes in-place (e.g., renaming).
    render(); // This keeps labels (like node names) up-to-date.
  });

  currentRoot = editor.getModelRoot(); // Initialize from current editor state (important if init order changes).
  resetExpandState(); // Keep collapsed by default.
  render(); // Initial render so the panel is not empty on first paint.
}

function mustGetEl(id: string): HTMLElement {
  // Convenience helper that guarantees an element exists (or throws early).
  const el = document.getElementById(id); // Query the current document by id.
  if (!el) throw new Error(`Missing element: #${id}`); // Throw a readable error to catch markup/JS mismatches early.
  return el; // Return the element as non-null.
}

function formatObjectLabel(object: THREE.Object3D): string {
  // Build a readable label for the hierarchy list.
  const name = object.name?.trim() ?? ""; // Normalize the object name to a trimmed string.
  if (name) return name; // Prefer the authored name (most GLTF nodes have meaningful names).
  return object.type; // Fall back to the runtime class/type name if the node is unnamed.
}

function buildVisibleNodes(
  root: THREE.Object3D, // Root object we want to list.
  filter: string, // Search filter (case-insensitive substring match).
  expanded: ReadonlySet<string>, // Expanded node uuids (used only when filter is empty).
): VisibleNode[] {
  // Convert the object tree into a flat list so it is easy to render with indentation.
  const q = filter.trim().toLowerCase(); // Normalize filter so matching is case-insensitive.
  const ignoreCollapse = q.length > 0; // While searching, ignore manual collapse so matches are always discoverable.

  const build = (
    object: THREE.Object3D, // Current node being visited.
    depth: number, // Current depth used for indentation.
  ): { rows: VisibleNode[]; visible: boolean } => {
    // Recursively build a pre-order list for a subtree, including parents of matching nodes.
    const label = formatObjectLabel(object).toLowerCase(); // Compute label used for filter matching.
    const selfMatches = q.length === 0 || label.includes(q); // The node matches when filter is empty or substring matches.

    const childResults = object.children.map((child) => build(child, depth + 1)); // Recursively build children.
    const anyChildVisible = childResults.some((r) => r.visible); // True if any descendant matches filter.
    const visible = selfMatches || anyChildVisible; // Include parent if it matches OR any descendant matches.

    if (!visible) return { rows: [], visible: false }; // If nothing matches in this subtree, return empty.

    const hasChildren = object.children.length > 0; // Used for the collapse toggle.
    const isExpanded = ignoreCollapse || expanded.has(object.uuid); // Treat as expanded while searching.
    const childRows = ignoreCollapse || isExpanded ? childResults.flatMap((r) => r.rows) : []; // Hide children when collapsed.

    return {
      // Pre-order list: parent row first, then (maybe) children rows.
      rows: [{ object, depth, hasChildren, expanded: isExpanded }, ...childRows],
      visible: true,
    };
  };

  return build(root, 0).rows; // Build the visible list starting at depth 0.
}

type NodeKind = "mesh" | "bone" | "group" | "node"; // Supported node kinds for hierarchy icons.

function getNodeKind(object: THREE.Object3D): NodeKind {
  // Determine a hierarchy icon kind based on common Three.js runtime flags.
  if ((object as unknown as { isBone?: unknown }).isBone) return "bone"; // Bones.
  if ((object as unknown as { isSkinnedMesh?: unknown }).isSkinnedMesh) return "mesh"; // SkinnedMesh is still a mesh.
  if ((object as unknown as { isMesh?: unknown }).isMesh) return "mesh"; // Mesh.
  if (object.type === "Group") return "group"; // Group nodes.
  return "node"; // Fallback for other Object3D types.
}

function kindToLabel(kind: NodeKind): string {
  // Return a compact label used inside the icon badge.
  if (kind === "mesh") return "M"; // Mesh.
  if (kind === "bone") return "B"; // Bone.
  if (kind === "group") return "G"; // Group.
  return "N"; // Generic node.
}

type ContextMenuItem = {
  // One clickable entry in the context menu.
  label: string; // Visible label.
  danger?: boolean; // When true, render as a "danger" action (e.g., Delete).
  onClick: () => void; // Action callback.
};

type ContextMenu = {
  // Minimal imperative API to show/hide a menu.
  show: (x: number, y: number, items: ContextMenuItem[]) => void; // Show menu at screen coords.
  hide: () => void; // Hide menu.
};

const EYE_OPEN_SVG = `
<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
  <path fill="currentColor" d="M12 5c5.5 0 9.6 3.6 11 7-1.4 3.4-5.5 7-11 7S2.4 15.4 1 12c1.4-3.4 5.5-7 11-7Zm0 2C7.7 7 4.3 9.7 3.1 12 4.3 14.3 7.7 17 12 17s7.7-2.7 8.9-5C19.7 9.7 16.3 7 12 7Zm0 2.2A2.8 2.8 0 1 1 9.2 12 2.8 2.8 0 0 1 12 9.2Z"/>
</svg>
`.trim(); // Inline SVG icon for visible state.

const EYE_CLOSED_SVG = `
<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
  <path fill="currentColor" d="M3.3 2 22 20.7l-1.3 1.3-3-3c-1.7.8-3.6 1.3-5.7 1.3-5.5 0-9.6-3.6-11-7 1-2.4 3.3-5 6.4-6.4L2 3.3 3.3 2Zm8.7 6c.8 0 1.5.2 2.1.5l-1.6 1.6a1.8 1.8 0 0 0-2.4 2.4L8.5 14A3.8 3.8 0 0 1 12 8Zm0-3c2.1 0 4 .5 5.7 1.3l-1.6 1.6A9 9 0 0 0 12 6.9c-4.3 0-7.7 2.7-8.9 5 1 2 3.5 4.2 6.7 4.8l-1.7 1.7C5.2 17.6 2.7 15.5 1 12c1.4-3.4 5.5-7 11-7Z"/>
</svg>
`.trim(); // Inline SVG icon for hidden state.

function createContextMenu(): ContextMenu {
  // Create a single DOM element-based context menu that can be reused for all rows.
  const menu = document.createElement("div"); // Root menu element.
  menu.className = "context-menu"; // CSS hook.
  menu.hidden = true; // Hidden by default.
  document.body.appendChild(menu); // Add to body so it can be positioned absolutely anywhere.

  const hide = () => {
    // Hide the menu.
    menu.hidden = true; // Use hidden so it's removed from tab order.
    menu.innerHTML = ""; // Clear buttons so stale handlers aren't retained.
  };

  window.addEventListener("pointerdown", (e) => {
    // Click outside closes the menu (Unity-like).
    const target = e.target as Node | null; // Read event target.
    if (!target) return; // Guard.
    if (menu.hidden) return; // Nothing to do if menu is already closed.
    if (menu.contains(target)) return; // Clicking inside the menu should not close it before button click.
    hide(); // Close on outside click.
  });

  window.addEventListener("keydown", (e) => {
    // Escape closes the menu.
    if (e.key === "Escape") hide(); // Close.
  });

  const show = (x: number, y: number, items: ContextMenuItem[]) => {
    // Show the menu at screen coordinates and populate it with items.
    menu.hidden = false; // Make visible.
    menu.style.left = `${x}px`; // Position horizontally.
    menu.style.top = `${y}px`; // Position vertically.
    menu.innerHTML = ""; // Clear previous items.

    for (const item of items) {
      // Create a button per item.
      const btn = document.createElement("button"); // Use buttons for keyboard accessibility.
      btn.type = "button"; // Avoid form submit.
      btn.className = item.danger ? "context-item is-danger" : "context-item"; // Style hook.
      btn.textContent = item.label; // Visible label.
      btn.addEventListener("click", () => {
        // Click executes the action and closes the menu.
        hide(); // Close first so action can open other UI (prompts, etc) without overlay.
        item.onClick(); // Run action.
      });
      menu.appendChild(btn); // Add to menu.
    }

    // Keep the menu within the viewport if near the edges (simple clamp).
    const rect = menu.getBoundingClientRect(); // Measure after content is inserted.
    const maxX = window.innerWidth - rect.width - 6; // Small margin.
    const maxY = window.innerHeight - rect.height - 6; // Small margin.
    menu.style.left = `${Math.max(6, Math.min(x, maxX))}px`; // Clamp X.
    menu.style.top = `${Math.max(6, Math.min(y, maxY))}px`; // Clamp Y.
  };

  return { show, hide }; // Return imperative API.
}
