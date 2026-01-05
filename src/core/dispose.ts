import * as THREE from "three";

export function disposeObject3D(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  root.traverse((obj) => {
    const anyObj = obj as unknown as {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };

    if (anyObj.geometry) geometries.add(anyObj.geometry);
    if (!anyObj.material) return;

    if (Array.isArray(anyObj.material)) {
      anyObj.material.forEach((m) => materials.add(m));
    } else {
      materials.add(anyObj.material);
    }
  });

  for (const material of materials) {
    collectTextures(material, textures);
  }

  textures.forEach((t) => t.dispose());
  materials.forEach((m) => m.dispose());
  geometries.forEach((g) => g.dispose());
}

function collectTextures(material: THREE.Material, out: Set<THREE.Texture>): void {
  for (const key in material) {
    const value = (material as unknown as Record<string, unknown>)[key];
    collectTextureValue(value, out);
  }

  const uniforms = (material as unknown as { uniforms?: unknown }).uniforms;
  if (uniforms && typeof uniforms === "object") {
    for (const value of Object.values(uniforms as Record<string, unknown>)) {
      collectTextureValue(value, out);
      if (
        value &&
        typeof value === "object" &&
        "value" in (value as Record<string, unknown>)
      ) {
        collectTextureValue(
          (value as Record<string, unknown>).value as unknown,
          out,
        );
      }
    }
  }
}

function collectTextureValue(value: unknown, out: Set<THREE.Texture>): void {
  if (!value) return;
  if (Array.isArray(value)) {
    value.forEach((v) => collectTextureValue(v, out));
    return;
  }

  if (typeof value === "object" && (value as THREE.Texture).isTexture) {
    out.add(value as THREE.Texture);
  }
}

