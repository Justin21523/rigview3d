// src/core/editor/transformSnapshot.ts
// Utility helpers for capturing and restoring Object3D transforms.
//
// We snapshot the 3 fundamental transform components:
// - position (Vector3)
// - quaternion (Quaternion) for rotation
// - scale (Vector3)
//
// These snapshots are used by undo/redo commands (gizmo drags, inspector edits, etc.).

import * as THREE from "three"; // Import Vector3/Quaternion types and utilities for comparisons.

export type TransformSnapshot = {
  // Immutable-ish snapshot of a transform at a point in time.
  position: THREE.Vector3; // World/local position stored as a cloned Vector3.
  quaternion: THREE.Quaternion; // Rotation stored as a cloned Quaternion.
  scale: THREE.Vector3; // Scale stored as a cloned Vector3.
}; // End TransformSnapshot type.

export function captureTransform(object: THREE.Object3D): TransformSnapshot {
  // Capture the current transform of an Object3D into a snapshot object.
  return {
    position: object.position.clone(), // Clone position so it won't change if the object moves later.
    quaternion: object.quaternion.clone(), // Clone quaternion so it won't change if the object rotates later.
    scale: object.scale.clone(), // Clone scale so it won't change if the object scales later.
  }; // End snapshot object.
}

export function applyTransform(object: THREE.Object3D, snapshot: TransformSnapshot): void {
  // Apply a previously captured transform snapshot onto an Object3D.
  object.position.copy(snapshot.position); // Restore position.
  object.quaternion.copy(snapshot.quaternion); // Restore rotation via quaternion (avoids Euler order issues).
  object.scale.copy(snapshot.scale); // Restore scale.
  object.updateMatrixWorld(true); // Force matrix update so gizmos/helpers reflect the change immediately.
}

export function isTransformDifferent(
  a: TransformSnapshot, // First snapshot.
  b: TransformSnapshot, // Second snapshot.
  epsilon = 1e-8, // Threshold used to ignore tiny floating-point noise.
): boolean {
  // Return true if two snapshots are meaningfully different.
  const posDiff = a.position.distanceToSquared(b.position); // Compare positions using squared distance.
  const scaleDiff = a.scale.distanceToSquared(b.scale); // Compare scales using squared distance.
  const quatDiff = quaternionDistanceSquared(a.quaternion, b.quaternion); // Compare quaternions using component distance.
  return posDiff > epsilon || scaleDiff > epsilon || quatDiff > epsilon; // Consider any component difference a change.
}

function quaternionDistanceSquared(a: THREE.Quaternion, b: THREE.Quaternion): number {
  // Compute squared distance between quaternion components (simple and cheap).
  const dx = a.x - b.x; // Delta X.
  const dy = a.y - b.y; // Delta Y.
  const dz = a.z - b.z; // Delta Z.
  const dw = a.w - b.w; // Delta W.
  return dx * dx + dy * dy + dz * dz + dw * dw; // Return squared component distance.
}

