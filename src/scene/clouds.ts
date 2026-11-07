import * as THREE from 'three'

/** Procedural cumulus/strato layer on a dome: domain-warped fbm, self-shadowed toward the sun. */
export function makeClouds(sun: THREE.Vector3) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: { uSun: { value: sun.clone() }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
        gl_Position.z = gl_Position.w * 0.99999;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun;
      uniform float uTime;
      varying vec3 vW;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
      float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { s += a * n(p); p = p * 2.02 + 7.3; a *= 0.5; } return s; }
      float dens(vec2 p) {
        vec2 q = vec2(fbm(p + vec2(0.0, uTime * 0.01)), fbm(p + vec2(5.2, 1.3)));
        float d = fbm(p * 1.3 + 1.6 * q + vec2(uTime * 0.006, 0.0));
        return smoothstep(0.4, 0.72, d);
      }
      void main() {
        vec3 d = normalize(vW - cameraPosition);
        if (d.y < 0.005) discard;
        vec2 p = d.xz / (d.y + 0.08) * 1.6 + vec2(3.0, 1.0);
        float c = dens(p);
        if (c < 0.003) discard;
        // light march toward the sun: thick cloud shades its own far side
        vec2 sp = normalize(uSun.xz) * 0.09;
        float occl = dens(p + sp) * 0.6 + dens(p + sp * 2.0) * 0.4;
        float lit = clamp(1.0 - occl * 1.1 + 0.25, 0.0, 1.0);
        float sunAmt = max(dot(d, uSun), 0.0);
        vec3 base = vec3(0.46, 0.5, 0.58);
        vec3 bright = vec3(1.0, 0.94, 0.86) * 1.7;
        vec3 col = mix(base, bright, lit) + vec3(1.0, 0.85, 0.65) * pow(sunAmt, 12.0) * (1.0 - c) * 2.5;
        float fade = smoothstep(0.005, 0.18, d.y);
        // aerial perspective: distant clouds melt into the horizon haze
        col = mix(vec3(0.78, 0.82, 0.86), col, smoothstep(0.02, 0.3, d.y));
        gl_FragColor = vec4(col, c * fade * 0.92);
      }`,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(4200, 48, 24), mat)
  mesh.renderOrder = -1
  mesh.frustumCulled = false
  return { mesh, mat }
}
