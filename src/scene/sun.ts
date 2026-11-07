import * as THREE from 'three'
import { SUN_COLOR, SUN_DIR } from './atmosphere'

/**
 * A visible sun: limb-darkened disc (≈1.1° — a touch larger than the real 0.53° so it reads on
 * screen), a tight corona and a wide atmospheric glow. HDR values so bloom does the rest.
 * Drawn before the cloud layer, so clouds drift across it.
 */
export function makeSun() {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uSun: { value: SUN_DIR }, uColor: { value: SUN_COLOR }, uIntensity: { value: 1 } },
    vertexShader: /* glsl */ `
      uniform vec3 uSun;
      varying vec2 vUv;
      void main() {
        vUv = uv * 2.0 - 1.0;
        // billboard placed far along the sun direction, following the camera
        vec3 c = cameraPosition + uSun * 4000.0;
        vec3 right = normalize(cross(uSun, vec3(0.0, 1.0, 0.0) + vec3(1e-4, 0.0, 0.0)));
        vec3 up = normalize(cross(right, uSun));
        float size = 4000.0 * tan(radians(9.0));
        vec3 p = c + (right * position.x + up * position.y) * size;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        gl_Position.z = gl_Position.w * 0.99998;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      varying vec2 vUv;
      void main() {
        float r = length(vUv) * 9.0;           // degrees from sun centre
        float discR = 0.55;
        float mu = sqrt(max(0.0, 1.0 - (r / discR) * (r / discR)));
        float disc = smoothstep(discR, discR * 0.94, r) * (0.55 + 0.45 * mu); // limb darkening
        float corona = exp(-r * 3.2) * 0.9;
        float glow = exp(-r * 0.75) * 0.18 + exp(-r * 0.25) * 0.05;
        vec3 col = uColor * (disc * 28.0 + corona * 2.2 + glow * 1.2) * uIntensity;
        // the disc itself whitens at the core like a real overexposed sun
        col += vec3(1.0, 0.97, 0.9) * disc * 8.0 * uIntensity * mu;
        gl_FragColor = vec4(min(col, vec3(60.0)), 1.0);
      }`,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
  mesh.frustumCulled = false
  mesh.renderOrder = -2
  return { mesh, mat }
}
