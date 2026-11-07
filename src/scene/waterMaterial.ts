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
varying vec3 vWorld;
varying vec3 vNormal;
varying float vFoam;
varying float vColumn;
varying float vHeight;
#include <fog_pars_fragment>

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

// wind chop: short deep-water waves, visual only, filtered with distance to avoid shimmer
vec2 chop(vec2 p, float t, float lod) {
  vec2 s = vec2(0.0);
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    float ang = fi * 2.399 + 0.6;
    vec2 d = vec2(cos(ang), sin(ang));
    float k = 0.8 * pow(1.5, fi);
    float w = sqrt(9.81 * k);
    float a = 0.03 / k;
    float atten = clamp(1.0 - k * lod, 0.0, 1.0);
    s += d * (a * k) * cos(dot(d, p) * k - w * t + fi * 1.7) * atten;
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
  // glossy reflection: unresolved micro-waves blur the sky more with distance
  vec3 sky = textureLod(uEnv, R, 2.0 + 3.0 * clamp(dist / 400.0, 0.0, 1.0)).rgb;
  float sd = max(dot(R, uSun), 0.0);
  vec3 spec = uSunColor * (pow(sd, 2200.0) * 60.0 + pow(sd, 220.0) * 2.2 + pow(sd, 18.0) * 0.08);

  vec3 deep = vec3(0.003, 0.022, 0.04);
  vec3 shallow = vec3(0.025, 0.17, 0.17);
  float colT = exp(-vColumn * 0.3);
  vec3 water = mix(deep, shallow, colT);
  // light transmitted through backlit wave faces
  float sss = pow(max(dot(V, -uSun + N * 0.5), 0.0), 4.0) * clamp(vHeight * 1.5 + 0.4, 0.0, 1.0);
  water += vec3(0.04, 0.26, 0.2) * sss * uSunColor * 0.45;
  water *= 0.6 + 0.4 * max(dot(N, uSun), 0.0);

  vec3 col = mix(water, sky * 0.9, fresnel);

  float n1 = noise(vWorld.xz * 1.8 + uTime * 0.12);
  float n2 = noise(vWorld.xz * 6.5 - uTime * 0.25);
  float lace = smoothstep(0.3, 0.8, n1 * 0.55 + n2 * 0.55);
  float shore = (1.0 - uFar) * (1.0 - smoothstep(0.0, 1.8, vColumn)) * (0.4 + 0.6 * lace);
  float foam = clamp(vFoam * (0.45 + 0.9 * lace) + shore, 0.0, 1.0);
  vec3 foamCol = vec3(0.95, 0.96, 0.97) * (0.55 + 0.45 * max(dot(N, uSun), 0.0)) + uSunColor * 0.08;
  col = mix(col, foamCol, foam);
  col += spec * (1.0 - foam);

  float alpha = clamp(0.7 + 0.3 * fresnel + (1.0 - colT) * 0.3 + foam, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`

export function makeWaterMaterial(far: boolean, rect: [number, number, number, number], env: THREE.Texture | null) {
  const m = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
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
