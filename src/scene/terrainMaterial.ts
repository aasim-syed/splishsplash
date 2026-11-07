import * as THREE from 'three'

const NOISE = /* glsl */ `
float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i + vec3(0,0,0)), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm3(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * n3(p); p = p * 2.03 + 1.7; a *= 0.5; } return s; }
// band-limited fbm: octaves finer than ~2 px fade to their mean → no shimmer/speckle
float fbmAA(vec3 p, float fw) { float s = 0.0, a = 0.5, f = 1.0;
  for (int i = 0; i < 6; i++) { float w = clamp(1.6 - f * fw * 2.2, 0.0, 1.0); s += a * mix(0.5, n3(p), w); p = p * 2.03 + 1.7; f *= 2.03; a *= 0.5; }
  return s; }
vec3 perturbN(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy) {
  vec3 vSigmaX = dFdx(surf_pos); vec3 vSigmaY = dFdy(surf_pos); vec3 vN = surf_norm;
  vec3 R1 = cross(vSigmaY, vN); vec3 R2 = cross(vN, vSigmaX);
  float fDet = dot(vSigmaX, R1);
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
`

/** Standard PBR terrain + procedural micro-detail (colour breakup and bump) from world-space noise. */
export function makeTerrainMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 })
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);',
      )
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\n' + NOISE)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float steep = 1.0 - smoothstep(0.55, 0.85, vWNrm.y);
        vec3 p = vWPos;
        float fw = length(fwidth(vWPos));           // world-space size of one pixel
        float big = fbmAA(p * vec3(0.18, 0.5, 0.18), fw * 0.5);
        float fine = fbmAA(p * 2.3, fw * 2.3);
        float rock = 0.78 + 0.45 * big + 0.3 * (fine - 0.5);
        float grass = 0.85 + 0.3 * fbmAA(p * 0.9, fw * 0.9) + 0.15 * (fine - 0.5) + 0.2 * (fbm3(p * 0.07) - 0.5);
        diffuseColor.rgb *= mix(grass, rock, steep);
        float cavity = smoothstep(0.35, 0.2, fine) * steep;
        diffuseColor.rgb *= 1.0 - 0.45 * cavity;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.35, smoothstep(1.5, -0.2, vWPos.y));',
      )
  }
  return m
}
