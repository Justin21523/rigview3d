// src/core/editor/history.ts
// A tiny undo/redo history stack for editor actions.
//
// We implement a classic command pattern:
// - Each command already has its effect applied when it is pushed.
// - `undo()` reverses the effect.
// - `redo()` reapplies the effect.
//
// This module is intentionally generic so it can be used for transforms, materials,
// deletion, and any future editor operations.

export type EditorCommand = {
  // One undoable operation.
  label: string; // Human-friendly label (useful for future UI like an undo menu).
  undo: () => void; // Function that reverts the operation.
  redo: () => void; // Function that reapplies the operation.
}; // End EditorCommand type.

export class HistoryStack {
  // Manages two stacks: undo and redo.
  private undoStack: EditorCommand[] = []; // Commands that can be undone (most recent at end).
  private redoStack: EditorCommand[] = []; // Commands that can be redone after an undo.

  private readonly maxEntries: number; // Max history length to avoid unbounded memory growth.

  constructor(maxEntries = 100) {
    // Create a history stack with an optional maximum length.
    this.maxEntries = maxEntries; // Store max entry count.
  }

  public push(command: EditorCommand): void {
    // Add a command to the undo stack and clear redo history.
    this.undoStack.push(command); // Push the new command to the end (most recent).
    this.redoStack.length = 0; // Clear redo stack because redo is only valid after undo.

    if (this.undoStack.length > this.maxEntries) {
      // Enforce max history length by dropping the oldest command.
      this.undoStack.shift(); // Remove the first (oldest) command.
    }
  }

  public canUndo(): boolean {
    // True when there is at least one command to undo.
    return this.undoStack.length > 0; // Undo is available if stack is non-empty.
  }

  public canRedo(): boolean {
    // True when there is at least one command to redo.
    return this.redoStack.length > 0; // Redo is available if stack is non-empty.
  }

  public undo(): void {
    // Undo the most recent command (if any).
    const command = this.undoStack.pop(); // Pop the newest command from the undo stack.
    if (!command) return; // If there is nothing to undo, do nothing.
    command.undo(); // Run undo logic.
    this.redoStack.push(command); // Push command onto redo stack so it can be redone.
  }

  public redo(): void {
    // Redo the most recently undone command (if any).
    const command = this.redoStack.pop(); // Pop the newest command from redo stack.
    if (!command) return; // If there is nothing to redo, do nothing.
    command.redo(); // Reapply the command.
    this.undoStack.push(command); // Put it back onto undo stack.
  }

  public clear(): void {
    // Drop all history (useful when loading a new model).
    this.undoStack.length = 0; // Clear undo history.
    this.redoStack.length = 0; // Clear redo history.
  }
}

