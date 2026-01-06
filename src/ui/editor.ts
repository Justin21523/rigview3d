// src/ui/editor.ts
// This UI module wires up the editor-only panels and interactions:
// - Viewport click-to-select (raycast picking via the core Editor)
// - Hierarchy panel rendering + search filter
//
// It intentionally does NOT own Three.js rendering state. It calls small APIs on `Editor`
// and reads selection/root state through events so the DOM stays in sync.

import type * as THREE from "three"; // Import Three.js types for Object3D annotations (no runtime dependency here).
import type { Editor } from "../core/editor/editor"; // Import Editor type (selection + root state).
import { getSettings, updateHierarchySettings } from "../core/settings"; // Import persistence helpers for Hierarchy panel preferences.
import type { Viewer } from "../core/viewer"; // Import Viewer type (used for framing from the Hierarchy context menu).

type VisibleNode = {
  // Flattened hierarchy node data used for simple DOM rendering.
  object: THREE.Object3D; // The underlying Three.js object.
  key: string; // Stable path key (used for expand/collapse persistence across reloads).
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
  const showBonesInput = mustGetEl("hierarchy-show-bones") as HTMLInputElement; // Checkbox that toggles Bone visibility in the hierarchy.
  const showHelpersInput = mustGetEl("hierarchy-show-helpers") as HTMLInputElement; // Checkbox that toggles helper-like leaf nodes in the hierarchy.
  const tree = mustGetEl("hierarchy-tree"); // Container where hierarchy items will be rendered.

  let currentRoot: THREE.Object3D | null = null; // Track the current model root so we can render it.
  let currentFilter = ""; // Track the current search string from the input box.

  let showBones = showBonesInput.checked; // Track whether Bone nodes are visible (initialized from persisted DOM value).
  let showHelpers = showHelpersInput.checked; // Track whether helper-like leaf nodes are visible (initialized from persisted DOM value).

  const expandedKeys = new Set<string>(); // Track which nodes are expanded by stable path keys (persisted across reloads).
  const uuidToObject = new Map<string, THREE.Object3D>(); // Map rendered DOM rows back to real Object3D instances.
  const uuidToStableKey = new Map<string, string>(); // Map uuid -> stable path key for selection reveal/scroll (includes hidden rows).
  const uuidToRow = new Map<string, HTMLElement>(); // Map uuid -> row element for fast selection style updates.
  const contextMenu = createContextMenu(); // Singleton context menu instance for hierarchy rows.

  const getAssetKey = () => editor.getSourceFileName() ?? "unknown"; // Compute a persistence key for the current asset.

  const loadExpandStateForAsset = () => {
    // Restore expand/collapse state for the currently loaded asset (if any).
    expandedKeys.clear(); // Reset current memory state.
    if (!currentRoot) return; // No model loaded => keep empty expand state.
    const key = getAssetKey(); // Resolve asset key.
    const saved = getSettings().hierarchy.expandedByAsset[key] ?? []; // Read saved expanded keys (or empty).
    saved.forEach((k) => expandedKeys.add(k)); // Restore into the Set for O(1) lookups.
  };

  const persistExpandStateForAsset = () => {
    // Persist the current expand/collapse state into settings (keyed by asset name).
    const assetKey = getAssetKey(); // Resolve persistence key.
    const current = getSettings(); // Read current settings snapshot.
    const next = { ...current.hierarchy.expandedByAsset }; // Shallow copy so we can mutate safely.
    if (expandedKeys.size === 0) delete next[assetKey]; // Keep storage small by removing empty entries.
    else next[assetKey] = Array.from(expandedKeys); // Store expanded keys for this asset.
    updateHierarchySettings({ expandedByAsset: next }); // Persist (coerceSettings caps size to avoid bloat).
  };

  const rebuildStableKeyMap = () => {
    // Rebuild the uuid -> stable key map for the entire model tree (used for selection reveal).
    uuidToStableKey.clear(); // Reset map for the current root.
    if (!currentRoot) return; // No root => nothing to build.

    const visit = (node: THREE.Object3D, key: string) => {
      // Visit a node and assign a stable path key based on child indices.
      uuidToStableKey.set(node.uuid, key); // Store mapping.
      node.children.forEach((child, index) => visit(child, `${key}/${index}`)); // Recurse.
    };

    visit(currentRoot, "0"); // Root key is always "0" (single-root hierarchy).
  };

  const isBone = (object: THREE.Object3D): boolean =>
    Boolean((object as unknown as { isBone?: unknown }).isBone); // Runtime flag for bones.

  const isMesh = (object: THREE.Object3D): boolean =>
    Boolean((object as unknown as { isMesh?: unknown }).isMesh); // Runtime flag for renderable meshes.

  const isHelperLikeLeaf = (object: THREE.Object3D): boolean => {
    // Treat leaf non-mesh/non-bone nodes as "helpers" (empties/markers) for filtering.
    if (object.children.length > 0) return false; // Only leaf nodes qualify as helper-like.
    if (isMesh(object)) return false; // Meshes are renderable and should not be treated as helpers.
    if (isBone(object)) return false; // Bones are handled by the Bone filter.
    return true; // Leaf non-mesh/non-bone => helper-like.
  };

  const shouldIncludeInHierarchy = (object: THREE.Object3D): boolean => {
    // Apply user filters to decide whether a node should appear in the Hierarchy list.
    if (!showBones && isBone(object)) return false; // Hide bones when the filter is off.
    if (!showHelpers && isHelperLikeLeaf(object)) return false; // Hide helper-like leaf nodes when the filter is off.
    return true; // Otherwise include.
  };

  const expandAll = (object: THREE.Object3D, key: string): void => {
    // Expand this node and all visible descendants (respecting current filters).
    const visit = (node: THREE.Object3D, nodeKey: string) => {
      if (!shouldIncludeInHierarchy(node)) return; // Skip filtered-out nodes entirely.
      const visibleChildren = node.children
        .map((child, index) => ({ child, childKey: `${nodeKey}/${index}` })) // Build stable child keys.
        .filter(({ child }) => shouldIncludeInHierarchy(child)); // Apply filters at the child level.
      if (visibleChildren.length === 0) return; // Nothing to expand.
      expandedKeys.add(nodeKey); // Mark this node as expanded.
      visibleChildren.forEach(({ child, childKey }) => visit(child, childKey)); // Recurse.
    };
    visit(object, key); // Start recursion at the clicked node.
  };

  const collapseAll = (object: THREE.Object3D, key: string): void => {
    // Collapse this node and all descendants (we remove keys regardless of filters).
    const visit = (node: THREE.Object3D, nodeKey: string) => {
      expandedKeys.delete(nodeKey); // Remove expand state for this node.
      node.children.forEach((child, index) => visit(child, `${nodeKey}/${index}`)); // Recurse into all children.
    };
    visit(object, key); // Start recursion at the clicked node.
  };

  let lastSelection = new Set<string>(); // Track selection uuids so we can update row classes without full re-render.
  let lastPrimaryUuid: string | null = null; // Track the last primary selection uuid (for `is-primary` class updates).

  const applySelectionStyles = () => {
    // Update selection highlighting in the existing DOM without rebuilding the whole tree.
    const selected = editor.getSelectionAll(); // Read current multi-selection list.
    const nextSelected = new Set<string>(selected.map((o) => o.uuid)); // Convert to a set for O(1) membership checks.

    // Remove selection styles from rows that are no longer selected.
    for (const uuid of lastSelection) {
      if (nextSelected.has(uuid)) continue; // Still selected.
      const row = uuidToRow.get(uuid); // Find row element.
      if (!row) continue; // Row may be filtered out.
      row.classList.remove("is-selected"); // Remove selection highlight.
      row.classList.remove("is-primary"); // Also remove primary highlight if it was set.
    }

    // Apply selection styles for newly selected rows.
    for (const uuid of nextSelected) {
      if (lastSelection.has(uuid)) continue; // Already styled.
      const row = uuidToRow.get(uuid); // Find row element.
      if (!row) continue; // Row may be filtered out.
      row.classList.add("is-selected"); // Highlight.
    }

    const primary = editor.getSelection(); // Primary selection (last selected).
    const primaryUuid = primary?.uuid ?? null; // Normalize.

    // Update primary highlight.
    if (lastPrimaryUuid && lastPrimaryUuid !== primaryUuid) {
      const row = uuidToRow.get(lastPrimaryUuid); // Find old primary row.
      row?.classList.remove("is-primary"); // Remove old primary highlight.
    }
    if (primaryUuid) {
      const row = uuidToRow.get(primaryUuid); // Find new primary row.
      if (row) {
        row.classList.add("is-selected"); // Primary is always selected.
        row.classList.add("is-primary"); // Stronger highlight for primary.
      }
    }

    lastSelection = nextSelected; // Store snapshot for next diff.
    lastPrimaryUuid = primaryUuid; // Store primary.
  };

  const revealAndScrollPrimarySelection = (): boolean => {
    // Ensure the primary selection is visible in the tree (auto-expand ancestors) and scroll it into view.
    if (!currentRoot) return false; // No root => nothing to reveal.
    if (currentFilter.trim().length > 0) return false; // While searching we already ignore collapse (no need to expand).
    const selection = editor.getSelection(); // Primary selection.
    if (!selection) return false; // Nothing selected.
    const key = uuidToStableKey.get(selection.uuid); // Look up stable key for selection (works even when the row is collapsed).
    if (!key) return false; // Selection may be filtered out (e.g., bones hidden).

    const parts = key.split("/"); // Split key into path parts (indices).
    let cursor = parts[0] ?? ""; // Start at root key.
    let changed = false; // Track whether we expanded anything.
    for (let i = 1; i < parts.length; i += 1) {
      // Expand every ancestor so the row becomes visible.
      if (!expandedKeys.has(cursor)) {
        expandedKeys.add(cursor); // Expand ancestor.
        changed = true; // Mark that we changed state.
      }
      cursor = `${cursor}/${parts[i]}`; // Advance to next ancestor key.
    }

    if (changed) {
      // If we changed expand state, persist + re-render so the row exists in the DOM.
      persistExpandStateForAsset(); // Persist expansion.
      render(); // Rebuild the tree.
      uuidToRow.get(selection.uuid)?.scrollIntoView({ block: "nearest" }); // Scroll after rows exist.
      return true; // Caller should not do extra work.
    }

    // If the row already exists, just scroll it into view.
    uuidToRow.get(selection.uuid)?.scrollIntoView({ block: "nearest" }); // Keep scrolling minimal (Unity-like).
    return false; // No re-render was needed.
  };

  const render = () => {
    // Rebuild the hierarchy DOM to reflect the current root/filter/selection.
    tree.innerHTML = ""; // Clear existing rows (simple + predictable for this small tool).
    uuidToObject.clear(); // Clear the mapping because we'll rebuild it from scratch.
    uuidToRow.clear(); // Clear uuid -> row map.

    if (!currentRoot) {
      // If no model is loaded, show an empty state message.
      const empty = document.createElement("div"); // Create a small placeholder element.
      empty.className = "muted"; // Use muted styling so it reads as secondary text.
      empty.textContent = "No model loaded."; // Explain why the hierarchy is empty.
      tree.appendChild(empty); // Add placeholder into the tree container.
      return; // Done.
    }

    const nodes = buildVisibleNodes(currentRoot, currentFilter, expandedKeys, {
      showBones,
      showHelpers,
    }); // Build a flat list of visible nodes with depth info.

    const fragment = document.createDocumentFragment(); // Build rows off-DOM to reduce layout thrash for large hierarchies.

    for (const { object, key, depth, hasChildren, expanded: isExpanded } of nodes) {
      // Create one row per visible node.
      const row = document.createElement("div"); // Use a div for a simple clickable row.
      row.className = "tree-item"; // Base styling for hierarchy items.
      row.setAttribute("role", "treeitem"); // Improve accessibility semantics for assistive tech.
      row.dataset.uuid = object.uuid; // Store uuid so click handlers can map back to the object.
      row.dataset.key = key; // Store stable key so expand/collapse can be persisted across reloads.
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
        if (expandedKeys.has(key)) expandedKeys.delete(key); // Collapse.
        else expandedKeys.add(key); // Expand.
        persistExpandStateForAsset(); // Persist expand/collapse state for this asset.
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
        if (editor.isSelected(object)) editor.notifySelectionUpdated(); // Refresh inspector if this object is currently selected.
        render(); // Re-render so the eye icon updates.
      });
      row.appendChild(eye); // Add eye toggle.

      if (!object.visible) row.classList.add("is-hidden"); // Dim hidden nodes for clarity.

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
            label: object.visible ? "Hide" : "Show",
            onClick: () => {
              const before = object.visible; // Snapshot for undo.
              const after = !before; // Toggle.
              object.visible = after; // Apply immediately.
              editor.pushCommand({
                label: "Toggle Visibility",
                undo: () => (object.visible = before),
                redo: () => (object.visible = after),
              });
              if (editor.isSelected(object)) editor.notifySelectionUpdated(); // Refresh inspector if needed.
              render(); // Refresh eye/icon state.
            },
          },
          {
            label: "Expand All",
            onClick: () => {
              expandAll(object, key); // Expand the subtree.
              persistExpandStateForAsset(); // Persist state.
              render(); // Re-render.
            },
          },
          {
            label: "Collapse All",
            onClick: () => {
              collapseAll(object, key); // Collapse the subtree.
              persistExpandStateForAsset(); // Persist state.
              render(); // Re-render.
            },
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
              if (editor.isSelected(object)) editor.notifySelectionUpdated(); // Refresh inspector name if this object is selected.
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
      uuidToRow.set(object.uuid, row); // Store uuid -> row for fast selection style updates.
      fragment.appendChild(row); // Add row to the fragment.
    }

    tree.appendChild(fragment); // Append all rows at once (faster for large trees).
    applySelectionStyles(); // Ensure selection highlight updates without rebuilding the tree.
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
      // Default to "whole model" selection; Ctrl/Cmd selects the exact hit object; Shift toggles multi-selection.
      exact: e.shiftKey || e.ctrlKey || e.metaKey, // Shift implies exact so multi-select works on real nodes instead of the root.
      toggle: e.shiftKey, // Shift toggles membership in the current selection set.
    });
  });

  canvas.addEventListener("pointercancel", () => {
    // Reset click tracking if the pointer interaction is cancelled.
    pointerDownButton = -1; // Clear stored button.
    pointerMoved = false; // Reset moved state.
  });

  tree.addEventListener("click", (e) => {
    // Clicking a hierarchy row selects that Object3D.
    const mouse = e as MouseEvent; // We need modifier keys (Shift) for multi-selection toggles.
    const target = e.target as HTMLElement | null; // The clicked element.
    const row = target?.closest(".tree-item") as HTMLElement | null; // Find the nearest row wrapper.
    if (!row) return; // Ignore clicks on the empty state or padding.
    const uuid = row.dataset.uuid; // Read uuid stored on the row.
    const object = uuid ? uuidToObject.get(uuid) ?? null : null; // Look up the Object3D for that uuid.
    editor.select(object, { toggle: mouse.shiftKey }); // Replace selection by default; Shift toggles multi-selection membership.
  });

  showBonesInput.addEventListener("change", () => {
    // Persist and apply Bone visibility filtering in the hierarchy.
    showBones = showBonesInput.checked; // Update local flag used by buildVisibleNodes().
    updateHierarchySettings({ showBones }); // Persist preference.
    render(); // Re-render so the tree reflects the new filter.
  });

  showHelpersInput.addEventListener("change", () => {
    // Persist and apply helper-like node filtering in the hierarchy.
    showHelpers = showHelpersInput.checked; // Update local flag.
    updateHierarchySettings({ showHelpers }); // Persist preference.
    render(); // Re-render.
  });

  searchInput.addEventListener("input", () => {
    // Re-filter the hierarchy list as the user types.
    currentFilter = searchInput.value; // Store the latest filter string.
    render(); // Re-render hierarchy with the new filter.
  });

  editor.onRootChange((root) => {
    // Re-render the hierarchy list when a new model is loaded.
    currentRoot = root; // Store root reference (null clears the hierarchy).
    rebuildStableKeyMap(); // Rebuild uuid -> stable key mapping for this model.
    loadExpandStateForAsset(); // Restore expand/collapse state for this asset.
    render(); // Refresh UI immediately.
  });

  editor.onSelectionChange(() => {
    // Selection changes are frequent, so avoid full tree rebuilds.
    if (revealAndScrollPrimarySelection()) return; // Auto-expand + render when needed.
    applySelectionStyles(); // Otherwise just update row classes.
    const selection = editor.getSelection(); // Primary selection (for scroll behavior).
    if (selection) uuidToRow.get(selection.uuid)?.scrollIntoView({ block: "nearest" }); // Keep the selected row in view.
  });

  editor.onSelectionUpdated(() => {
    // Re-render the hierarchy list when the selected object changes in-place (e.g., renaming).
    render(); // This keeps labels (like node names) up-to-date.
  });

  currentRoot = editor.getModelRoot(); // Initialize from current editor state (important if init order changes).
  rebuildStableKeyMap(); // Build stable key map for the initial root (if any).
  loadExpandStateForAsset(); // Restore expand state (if any).
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
  expandedKeys: ReadonlySet<string>, // Expanded node stable keys (used only when filter is empty).
  options: { showBones: boolean; showHelpers: boolean }, // Additional visibility filters for hierarchy usability.
): VisibleNode[] {
  // Convert the object tree into a flat list so it is easy to render with indentation.
  const q = filter.trim().toLowerCase(); // Normalize filter so matching is case-insensitive.
  const ignoreCollapse = q.length > 0; // While searching, ignore manual collapse so matches are always discoverable.

  const isBone = (object: THREE.Object3D): boolean =>
    Boolean((object as unknown as { isBone?: unknown }).isBone); // Bones.

  const isMesh = (object: THREE.Object3D): boolean =>
    Boolean((object as unknown as { isMesh?: unknown }).isMesh); // Meshes (SkinnedMesh is still a mesh).

  const isHelperLikeLeaf = (object: THREE.Object3D): boolean => {
    // Treat leaf non-mesh/non-bone nodes as "helpers" for filtering (empties/markers/cameras/lights).
    if (object.children.length > 0) return false; // Only leaf nodes qualify.
    if (isMesh(object)) return false; // Renderables are not helpers.
    if (isBone(object)) return false; // Bones are controlled by a separate toggle.
    return true; // Leaf non-mesh/non-bone => helper-like.
  };

  const build = (
    object: THREE.Object3D, // Current node being visited.
    key: string, // Stable path key for this node (based on child indices).
    depth: number, // Current depth used for indentation.
  ): { rows: VisibleNode[]; visible: boolean } => {
    // Recursively build a pre-order list for a subtree, including parents of matching nodes.
    const isRoot = key === "0"; // Root is always visible so the tree never becomes empty for bone-rooted rigs.
    const boneHidden = !isRoot && isBone(object) && !options.showBones; // Hide bone rows when the toggle is off.
    const helperHidden = !options.showHelpers && isHelperLikeLeaf(object); // Hide helper-like leaf rows when the toggle is off.
    if (helperHidden) return { rows: [], visible: false }; // Helper leaf nodes have no children, so we can drop the subtree.

    const label = formatObjectLabel(object).toLowerCase(); // Compute label used for filter matching.
    const selfMatches = boneHidden ? false : q.length === 0 || label.includes(q); // Hidden bone rows never count as matches.

    const childDepth = boneHidden ? depth : depth + 1; // Hidden bone rows are "transparent" so children keep the same depth.
    const childResults = object.children.map((child, index) =>
      build(child, `${key}/${index}`, childDepth),
    ); // Recursively build children with stable keys.
    const visibleChildren = childResults.filter((r) => r.visible); // Keep only visible children (others are filtered out).
    const anyChildVisible = visibleChildren.length > 0; // True if any descendant matches filter.
    const visible = selfMatches || anyChildVisible; // Include parent if it matches OR any descendant matches.

    if (!visible) return { rows: [], visible: false }; // If nothing matches in this subtree, return empty.

    const hasChildren = anyChildVisible; // Only count children that are actually visible under current filters.
    const isExpanded = ignoreCollapse || expandedKeys.has(key); // Treat as expanded while searching.
    const childRows = ignoreCollapse || isExpanded ? visibleChildren.flatMap((r) => r.rows) : []; // Hide children when collapsed.

    if (boneHidden) {
      // Bone filtering: don't render bone rows, but keep visible descendants reachable.
      return { rows: childRows, visible: anyChildVisible }; // Bone rows are only "visible" when they have visible descendants.
    }

    return {
      // Pre-order list: parent row first, then (maybe) children rows.
      rows: [{ object, key, depth, hasChildren, expanded: isExpanded }, ...childRows],
      visible: true,
    };
  };

  return build(root, "0", 0).rows; // Build the visible list starting at depth 0 with a stable root key.
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
