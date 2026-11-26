import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createCardMaterial } from './CardCustomMaterial';

describe('CardCustomMaterial', () => {
  it('creates ShaderMaterial without specular sheen band', () => {
    const texture = new THREE.Texture();
    const mat = createCardMaterial(texture, false);

    expect(mat).toBeInstanceOf(THREE.ShaderMaterial);
    expect(mat.uniforms.uSheen).toBeUndefined();
    expect(mat.uniforms.uFoil?.value).toBe(0.0);
    expect(mat.uniforms.uTilt?.value).toBeInstanceOf(THREE.Vector2);
    expect(mat.fragmentShader).not.toContain('Specular Sheen');
    expect(mat.fragmentShader).not.toContain('band_pos');
  });

  it('enables rainbow holographic foil for rainbow cards', () => {
    const texture = new THREE.Texture();
    const mat = createCardMaterial(texture, true);

    expect(mat.uniforms.uFoil?.value).toBe(1.0);
    expect(mat.fragmentShader).not.toContain('Specular Sheen');
    expect(mat.fragmentShader).not.toContain('band_pos');
    expect(mat.fragmentShader).toContain('Rainbow Foil');
  });

  it('allows updating uTilt and uTime uniforms', () => {
    const texture = new THREE.Texture();
    const mat = createCardMaterial(texture, false);

    mat.uniforms.uTime!.value = 1.5;
    mat.uniforms.uTilt!.value.set(0.25, -0.35);

    expect(mat.uniforms.uTime?.value).toBe(1.5);
    expect(mat.uniforms.uTilt?.value.x).toBe(0.25);
    expect(mat.uniforms.uTilt?.value.y).toBe(-0.35);
  });
});
