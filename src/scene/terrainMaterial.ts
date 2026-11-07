import * as THREE from 'three'
import { makeRockTextures } from './rockTextures'
import { ATMOS_U } from './atmosphere'

/**
 * PBR terrain: vertex colours for large-scale geology + triplanar, mipmapped detail
 * (albedo, baked cavity, normal map) at two scales so it stays sharp at any distance
 * without tiling or shimmer.
 */
export function makeTerrainMaterial() {
  const tex = makeRockTextures()
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 })
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uDetA = { value: tex.albedo }
    sh.uniforms.uDetN = { value: tex.normal }
    sh.uniforms.uSnow = ATMOS_U.uSnow
    sh.uniforms.uGrassTint = ATMOS_U.uGrassTint
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);',
      )
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D uDetA;
        uniform sampler2D uDetN;
        uniform float uSnow;
        uniform vec3 uGrassTint;
        varying vec3 vWPos;
        varying vec3 vWNrm;
        vec3 triW(vec3 n) { vec3 w = pow(abs(n), vec3(5.0)); return w / (w.x + w.y + w.z); }
        vec4 triA(vec3 p, vec3 w, float s) {
          return texture2D(uDetA, p.zy * s) * w.x + texture2D(uDetA, p.xz * s) * w.y + texture2D(uDetA, p.xy * s) * w.z;
        }
        // whiteout-blended triplanar normal mapping in world space
        vec3 triN(vec3 p, vec3 n, vec3 w, float s, float k) {
          vec3 tx = texture2D(uDetN, p.zy * s).xyz * 2.0 - 1.0;
          vec3 ty = texture2D(uDetN, p.xz * s).xyz * 2.0 - 1.0;
          vec3 tz = texture2D(uDetN, p.xy * s).xyz * 2.0 - 1.0;
          tx.xy *= k; ty.xy *= k; tz.xy *= k;
          tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
          ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
          tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
          return normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 Nw = normalize(vWNrm);
        vec3 tw = triW(Nw);
        float steep = 1.0 - smoothstep(0.55, 0.85, Nw.y);
        vec4 dA1 = triA(vWPos, tw, 0.42);
        vec4 dA2 = triA(vWPos + 17.0, tw, 0.09);
        float detail = mix(1.0, dA1.r * 2.0, mix(0.4, 1.0, steep)) * mix(1.0, dA2.r * 2.0, mix(0.2, 0.4, steep));
        float cavity = mix(1.0, dA1.a * 1.3, 0.7 * steep + 0.15);
        diffuseColor.rgb *= detail * clamp(cavity, 0.35, 1.15);
        float above = smoothstep(-0.5, 1.5, vWPos.y);
        diffuseColor.rgb *= mix(vec3(1.0), uGrassTint, (1.0 - steep) * above);
        // snow settles on up-facing ledges and the plateau, patchy at the edges
        float snowAmt = uSnow * smoothstep(0.55, 0.85, Nw.y + (dA2.r - 0.5) * 0.6) * smoothstep(0.8, 2.5, vWPos.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.94, 0.97), clamp(snowAmt * 1.4, 0.0, 1.0));`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec3 Nw0 = normalize(vWNrm);
          vec3 w0 = triW(Nw0);
          float st = 1.0 - smoothstep(0.55, 0.85, Nw0.y);
          vec3 n1 = triN(vWPos, Nw0, w0, 0.42, mix(0.3, 1.1, st));
          vec3 n2 = triN(vWPos + 17.0, n1, w0, 0.09, mix(0.1, 0.3, st));
          normal = normalize((viewMatrix * vec4(n2, 0.0)).xyz);
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.32, smoothstep(1.6, -0.2, vWPos.y));',
      )
  }
  return m
}
