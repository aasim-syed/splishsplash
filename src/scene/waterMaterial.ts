import * as THREE from 'three'
import { SWELL } from '@/engine/water'

// Late-afternoon sun from over the sea: rakes across the cliff face, glitter off to the side.
export const SUN_DIR = new THREE.Vector3(0.48, 0.3, -0.82).normalize()

const swellGLSL = (() => {
  const lines = SWELL.map(([dx, dz, l, a, p]) => {
    const n = Math.hypot(dx, dz)
    const k = (2 * Math.PI) / l
    const w = Math.sqrt(9.81 * k)
    const f = (v: number) => v.toFixed(6)
    return `  { vec2 d = vec2(${f(dx / n)}, ${f(dz / n)}); float ph = ${f(k)} * dot(d, p) - ${f(w)} * t + ${f(p)};
    h += ${f(a)} * sin(ph); g += d * (${f(a * k)} * cos(ph)); }`
  })
  return `
// identical to swellHeight() in engine/water.ts
vec3 swell(vec2 p, float t) {
  float h = 0.0; vec2 g = vec2(0.0);
${lines.join('\n')}
  return vec3(h, g);
}`
})()

const vert = /* glsl */ `
attribute float aFoam;
attribute float aFloor;
uniform float uSimTime;
uniform mat4 uReflMat;
varying vec4 vReflCoord;
varying float vViewZ;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vFoam;
varying float vColumn;
varying float vHeight;
${swellGLSL}
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 sw = swell(wp.xz, uSimTime);
  wp.y += sw.x;
  // combine simulated slope (from the CPU normal) with the analytic swell slope
  vec3 n0 = normalize(normal);
  vec2 slope = -n0.xz / max(n0.y, 1e-3) + sw.yz;
  vNormal = normalize(vec3(-slope.x, 1.0, -slope.y));
  vWorld = wp.xyz;
  vFoam = aFoam;
  vColumn = max(wp.y - aFloor, 0.0);
  vHeight = wp.y;
  vec4 mvPosition = viewMatrix * wp;
  vViewZ = mvPosition.z;
  vReflCoord = uReflMat * vec4(wp.xyz, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`

const frag = /* glsl */ `
uniform vec3 uSun;
uniform vec3 uSunColor;
uniform float uTime;
uniform vec4 uRect;
uniform float uFar;
uniform samplerCube uEnv;
uniform sampler2D uRefr;
uniform sampler2D uDepth;
uniform sampler2D uRefl;
uniform vec2 uRes;
uniform float uNear;
uniform float uFar2;
uniform float uPasses;
varying vec4 vReflCoord;
varying float vViewZ;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vFoam;
varying float vColumn;
varying float vHeight;
#include <fog_pars_fragment>
#include <packing>

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

// wind sea: 16 deep-water components (ω² = g·k), directions spread around the wind,
// amplitudes from a k^-1.6 spectrum, each band-limited by screen-space frequency.
vec2 chop(vec2 p, float t, float lod) {
  vec2 s = vec2(0.0);
  float wind = 3.3; // radians: blowing toward -x (onshore)
  for (int i = 0; i < 16; i++) {
    float fi = float(i);
    float spread = (fract(sin(fi * 91.7) * 4375.85) - 0.5) * 1.9;
    float ang = wind + spread;
    vec2 d = vec2(cos(ang), sin(ang));
    float k = 0.55 * pow(1.27, fi);
    float w = sqrt(9.81 * k);
    float a = 0.11 * pow(k, -1.6) * 0.55;
    float atten = clamp(1.4 - k * lod, 0.0, 1.0);
    float ph = dot(d, p) * k - w * t + fi * 2.13;
    // sharpened (trochoid-like) slope: crests narrower than troughs
    float c = cos(ph);
    s += d * (a * k) * c * (1.0 + 0.6 * sin(ph)) * atten;
  }
  return s;
}

void main() {
  if (uFar > 0.5 && vWorld.x > uRect.x + 0.5 && vWorld.z > uRect.y + 0.5 && vWorld.x < uRect.z - 0.5 && vWorld.z < uRect.w - 0.5) discard;
  vec3 V = normalize(cameraPosition - vWorld);
  float dist = length(cameraPosition - vWorld);
  vec2 ds = chop(vWorld.xz, uTime, dist * 0.006);
  vec3 N = normalize(vNormal + vec3(-ds.x, 0.0, -ds.y));

  float cosT = max(dot(N, V), 0.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);

  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 skyR = textureLod(uEnv, R, 1.0 + 3.0 * clamp(dist / 500.0, 0.0, 1.0)).rgb;
  float sd = max(dot(R, uSun), 0.0);
  vec3 spec = uSunColor * (pow(sd, 2400.0) * 70.0 + pow(sd, 260.0) * 2.4 + pow(sd, 20.0) * 0.06);

  vec2 suv = gl_FragCoord.xy / uRes;
  vec3 reflCol = skyR;
  vec3 body;
  float alpha = 1.0;
  if (uPasses > 0.5) {
    // planar reflection, rippled by the surface normal
    vec2 ruv = vReflCoord.xy / vReflCoord.w + N.xz * vec2(0.09, 0.14);
    vec4 rt = textureLod(uRefl, ruv, 0.6 + clamp(dist / 100.0, 0.0, 2.5));
    reflCol = mix(skyR, rt.rgb, rt.a);

    // refraction: what's under the surface, absorbed by the real water thickness along the ray
    float rayScale = dist / max(-vViewZ, 1e-3);
    float dScene = texture2D(uDepth, suv).x;
    float thick0 = (vViewZ - perspectiveDepthToViewZ(dScene, uNear, uFar2)) * rayScale;
    vec2 off = N.xz * 0.045 * clamp(thick0 / 2.5, 0.0, 1.0);
    vec2 ruv2 = suv + off;
    float d2 = texture2D(uDepth, ruv2).x;
    float sceneZ2 = perspectiveDepthToViewZ(d2, uNear, uFar2);
    if (sceneZ2 > vViewZ) ruv2 = suv; // refracted sample is in front of the water → don't use it
    float thick = max((vViewZ - perspectiveDepthToViewZ(texture2D(uDepth, ruv2).x, uNear, uFar2)) * rayScale, 0.0);
    vec3 under = texture2D(uRefr, ruv2).rgb;
    // Beer–Lambert, red dies first
    vec3 trans = exp(-vec3(0.5, 0.13, 0.1) * thick);
    vec3 scatter = vec3(0.008, 0.045, 0.06) * (0.55 + 0.45 * max(uSun.y, 0.0)) * uSunColor;
    float sss = pow(max(dot(V, -uSun + N * 0.5), 0.0), 4.0) * clamp(vHeight * 1.5 + 0.4, 0.0, 1.0);
    scatter += vec3(0.02, 0.16, 0.13) * sss * uSunColor * 0.35;
    body = under * trans + scatter * (1.0 - trans);
  } else {
    vec3 deep = vec3(0.003, 0.022, 0.04);
    vec3 shallow = vec3(0.025, 0.17, 0.17);
    body = mix(deep, shallow, exp(-vColumn * 0.3));
    alpha = 0.85;
  }

  vec3 col = mix(body, reflCol, fresnel);

  float n1 = noise(vWorld.xz * 1.8 + uTime * 0.12);
  float n2 = noise(vWorld.xz * 6.5 - uTime * 0.25);
  float lace = smoothstep(0.3, 0.8, n1 * 0.55 + n2 * 0.55);
  float shore = (1.0 - uFar) * (1.0 - smoothstep(0.0, 1.4, vColumn)) * smoothstep(0.35, 0.75, lace);
  float foam = clamp(vFoam * (0.45 + 0.9 * lace) + shore, 0.0, 1.0);
  vec3 foamCol = vec3(0.95, 0.96, 0.97) * (0.55 + 0.45 * max(dot(N, uSun), 0.0)) + uSunColor * 0.08;
  col = mix(col, foamCol, foam);
  col += spec * (1.0 - foam);

  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

export function makeWaterMaterial(far: boolean, rect: [number, number, number, number], env: THREE.Texture | null) {
  const m = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    transparent: false,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uSun: { value: SUN_DIR.clone() },
        uSunColor: { value: new THREE.Color(1.0, 0.88, 0.72) },
        uTime: { value: 0 },
        uSimTime: { value: 0 },
        uRect: { value: new THREE.Vector4(...rect) },
        uFar: { value: far ? 1 : 0 },
        uEnv: { value: null },
        uRefr: { value: null },
        uDepth: { value: null },
        uRefl: { value: null },
        uReflMat: { value: new THREE.Matrix4() },
        uRes: { value: new THREE.Vector2(1, 1) },
        uNear: { value: 0.1 },
        uFar2: { value: 1000 },
        uPasses: { value: 0 },
      },
    ]),
  })
  // set after merge: mergeUniforms() refuses to clone render-target textures and would null it
  m.uniforms.uEnv.value = env
  return m
}

/** Ocean plane with vertex density concentrated near the play area. */
export function makeFarOcean(cx: number, cz: number, half = 3000, seg = 260) {
  const n = seg + 1
  const pos = new Float32Array(n * n * 3)
  const map = (u: number) => Math.sign(u) * half * Math.pow(Math.abs(u), 2.6)
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i
    pos[k * 3] = cx + map((i / seg) * 2 - 1)
    pos[k * 3 + 2] = cz + map((j / seg) * 2 - 1)
  }
  const idx = new Uint32Array(seg * seg * 6)
  let p = 0
  for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1
    idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const nrm = new Float32Array(n * n * 3)
  for (let k = 0; k < n * n; k++) nrm[k * 3 + 1] = 1
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  g.setAttribute('aFoam', new THREE.BufferAttribute(new Float32Array(n * n), 1))
  g.setAttribute('aFloor', new THREE.BufferAttribute(new Float32Array(n * n).fill(-80), 1))
  g.setIndex(new THREE.BufferAttribute(idx, 1))
  return g
}
