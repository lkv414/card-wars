import * as THREE from 'three';

/**
 * Custom Three.js Card Material with Specular Sheen Band and Rainbow Foil
 * (docs/AUDIT-KIBERBUS-UIUX.md §5.1, §8 Этап 4).
 */
export function createCardMaterial(texture: THREE.Texture, isRainbow = false): THREE.ShaderMaterial {
  // Ensure optimal texture filtering per audit §2
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;

  const uniforms = {
    uTexture: { value: texture },
    uTilt: { value: new THREE.Vector2(0, 0) },
    uSheen: { value: 0.85 },
    uFoil: { value: isRainbow ? 1.0 : 0.0 },
    uTime: { value: 0.0 },
  };

  const vertexShader = `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vViewPosition;

    void main() {
      vUv = uv;
      vNormal = normalize(normalMatrix * normal);
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vViewPosition = -mvPosition.xyz;
      gl_Position = projectionMatrix * mvPosition;
    }
  `;

  const fragmentShader = `
    uniform sampler2D uTexture;
    uniform vec2 uTilt;
    uniform float uSheen;
    uniform float uFoil;
    uniform float uTime;

    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vViewPosition;

    vec3 hueToRgb(float h) {
      return 0.5 + 0.5 * cos(6.28318 * (h + vec3(0.0, 0.33, 0.67)));
    }

    void main() {
      vec4 texColor = texture2D(uTexture, vUv);

      // 1. Tilt-based Specular Sheen Band
      float band_pos = uTilt.y * 0.85 - uTilt.x * 1.05 + sin(uTime * 1.4) * 0.07;
      float d = (vUv.x * 0.8 + vUv.y * 0.6) - 0.7 - band_pos;
      float band = exp(-d * d * 60.0) * 0.22 + exp(-d * d * 900.0) * 0.18;
      texColor.rgb += vec3(band) * uSheen;

      // 2. Rainbow Foil (Holographic foil for rainbow cards)
      if (uFoil > 0.0) {
        float lum = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
        float rainbowCoord = fract(vUv.x * 0.9 + vUv.y * 0.6 + uTilt.y * 0.35 + uTilt.x * 0.45 + uTime * 0.06);
        vec3 rainbow = hueToRgb(rainbowCoord);
        float mask = smoothstep(0.35, 0.95, lum) * 0.45 + 0.1;
        texColor.rgb = mix(texColor.rgb, texColor.rgb * 0.55 + rainbow * 0.75, uFoil * mask);
      }

      gl_FragColor = texColor;
    }
  `;

  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    lights: false,
    toneMapped: true,
  });
}
