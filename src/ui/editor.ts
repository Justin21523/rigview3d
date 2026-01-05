// src/ui/editor.ts
// This UI module wires up the editor-only panels and interactions:
// - Viewport click-to-select (raycast picking via the core Editor)
// - Hierarchy panel rendering + search filter
//
// It intentionally does NOT own Three.js rendering state. It calls small APIs on `Editor`
// and reads selection/root state through events so the DOM stays in sync.

import type * as THREE from "three"; // Import Three.js types for Object3D annotations (no runtime dependency here).
import type { Editor } from "../core/editor/editor"; // Import Editor type (selection + root state).

export function initEditorUi(editor: Editor): void {
  // Public API: attach editor UI behavior to the existing DOM.
  const canvas = document.getElementById("c") as HTMLCanvasElement | null; // Find the viewport canvas used for rendering.
  if (!canvas) throw new Error("Canvas element not found."); // Fail fast if markup is out of sync with code.

  const searchInput = mustGetEl("hierarchy-search") as HTMLInputElement; // Search box for filtering the hierarchy list.
  const tree = mustGetEl("hierarchy-tree"); // Container where hierarchy items will be rendered.

  let currentRoot: THREE.Object3D | null = null; // Track the current model root so we can render it.
  let currentFilter = ""; // Track the current search string from the input box.

  const uuidToObject = new Map<string, THREE.Object3D>(); // Map rendered DOM rows back to real Object3D instances.

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
    const nodes = buildVisibleNodes(currentRoot, currentFilter); // Build a flat list of visible nodes with depth info.

    for (const { object, depth } of nodes) {
      // Create one row per visible node.
      const row = document.createElement("div"); // Use a div for a simple clickable row.
      row.className = "tree-item"; // Base styling for hierarchy items.
      row.setAttribute("role", "treeitem"); // Improve accessibility semantics for assistive tech.
      row.dataset.uuid = object.uuid; // Store uuid so click handlers can map back to the object.
      row.style.paddingLeft = `${8 + depth * 14}px`; // Indent based on depth to visualize parent/child structure.
      row.textContent = formatObjectLabel(object); // Show a user-friendly label (name or type).

      if (selection && selection.uuid === object.uuid) {
        // If this row corresponds to the selected object...
        row.classList.add("is-selected"); // ...apply selected styling.
      }

      uuidToObject.set(object.uuid, object); // Store uuid -> object mapping for click selection.
      tree.appendChild(row); // Add row to the DOM.
    }
  }; // End render function.

  canvas.addEventListener("click", (e) => {
    // Clicking in the viewport performs raycast picking to select objects.
    if (e.button !== 0) return; // Only respond to left-click selection.
    if (editor.isTransformDragging()) return; // Ignore clicks while the gizmo is mid-drag (prevents accidental selection clears).
    editor.pick(e.clientX, e.clientY); // Convert the click position into a raycast and update selection.
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
): Array<{ object: THREE.Object3D; depth: number }> {
  // Convert the object tree into a flat list so it is easy to render with indentation.
  const q = filter.trim().toLowerCase(); // Normalize filter so matching is case-insensitive.

  const build = (
    object: THREE.Object3D, // Current node being visited.
    depth: number, // Current depth used for indentation.
  ): Array<{ object: THREE.Object3D; depth: number }> => {
    // Recursively build a pre-order list for a subtree, including parents of matching nodes.
    const label = formatObjectLabel(object).toLowerCase(); // Compute label used for filter matching.
    const selfMatches = q.length === 0 || label.includes(q); // The node matches when filter is empty or substring matches.

    const children = object.children.flatMap((child) => build(child, depth + 1)); // Recursively build visible children first.
    const visible = selfMatches || children.length > 0; // Include parent if it matches OR any descendant matches.

    if (!visible) return []; // If nothing matches in this subtree, return an empty list.
    return [{ object, depth }, ...children]; // Pre-order list: parent row first, then children rows.
  };

  return build(root, 0); // Build the visible list starting at depth 0.
}
