import { useMemo } from 'react'
import * as THREE from 'three'
import { glsl3, linear, shared } from './paint'

// The far distance, painted: a sheet standing behind the meadow with a clear
// gouache blue sky, three ranges of mountains and a lake the grass runs down to.
// Past the shore everything fades into pale air. All flat washes, drawn first
// and writing no depth, so the ink pass leaves it alone.

const c = (hex: string) => glsl3(linear(hex))

/** World height of the meadow's far edge on this sheet, and the height of the picture above it. */
const BASE = -6.5
const SPAN = 14

export function Backdrop() {
  const mesh = useMemo(() => {
    const material = new THREE.ShaderMaterial({
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
      uniforms: { uTime: shared.uTime },
      vertexShader: /* glsl */ `
        varying vec3 vP;
        void main() {
          vP = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vP;
        uniform float uTime;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        // A rounded peak every so often.
        float tri(float x) { return 1.0 - pow(abs(sin(x)), 0.8); }
        // A small sailboat, in world units from the waterline at its middle,
        // s its size: a dark hull and a pale sail. 0 none, 1 hull, 2 sail.
        float boat(vec2 p, float s) {
          p /= s;
          if (p.y < 0.0 && p.y > -0.045 && abs(p.x) < 0.16 + p.y * 1.2) return 1.0;
          if (p.y >= 0.0 && p.y < 0.3 && p.x > -0.015 && p.x < 0.13 * (1.0 - p.y / 0.3)) return 2.0;
          if (p.y >= 0.0 && p.y < 0.22 && p.x < -0.03 && p.x > -0.1 * (1.0 - p.y / 0.22) - 0.03) return 2.0;
          return 0.0;
        }
        // One bird, a flapping V, 1 on its wings.
        float bird(vec2 p, float flap) {
          float wing = abs(p.x);
          float y = p.y - wing * flap + wing * wing * 1.4;
          // A fine line (Simon: subtler birds).
          return step(wing, 0.1) * (1.0 - smoothstep(0.011, 0.02, abs(y)));
        }
        void main() {
          float x = vP.x;
          float f = (vP.y - (${BASE.toFixed(1)})) / ${SPAN.toFixed(1)};
          float grain = noise(vec2(x * 1.4, f * 26.0)) * 0.5 + noise(vec2(x * 4.0, f * 70.0)) * 0.5;

          // Sky: clear, deep at the top, pale towards the far hills.
          vec3 col = mix(${c('#cbdfea')}, ${c('#7aabd4')}, smoothstep(0.2, 1.0, f));
          col *= 0.985 + 0.03 * grain;

          // Three ranges, flat washes, stepping paler with distance. They sit
          // straight behind the lake.
          float far = 0.25 + 0.2 * tri(x * 0.042 + 0.5) + 0.08 * tri(x * 0.11 + 2.0) + 0.01 * noise(vec2(x * 0.8, 1.0));
          float mid = 0.2 + 0.18 * tri(x * 0.06 + 1.5) + 0.04 * tri(x * 0.16) + 0.008 * noise(vec2(x * 1.1, 2.0));
          float near = 0.16 + 0.2 * smoothstep(9.0, 34.0, abs(x + 2.0)) + 0.04 * tri(x * 0.13 + 1.0) + 0.006 * noise(vec2(x, 3.0));
          col = mix(col, ${c('#a9c4e2')} * (0.98 + 0.04 * grain), smoothstep(far + 0.003, far - 0.003, f));
          col = mix(col, ${c('#86aebf')} * (0.97 + 0.06 * grain), smoothstep(mid + 0.003, mid - 0.003, f));
          col = mix(col, ${c('#6f9f92')} * (0.97 + 0.06 * grain), smoothstep(near + 0.003, near - 0.003, f));

          // Far shore, a faint dark line of trees.
          float crown = noise(vec2(x * 2.6, 0.0)) * 0.008;
          col = mix(col, ${c('#5f9488')}, step(f, 0.145 + crown));

          // Air: everything past the lake fades towards a pale haze, most of
          // all at its foot, where the distance is thickest.
          float air = 0.12 + 0.22 * (1.0 - smoothstep(0.14, 0.42, f));
          col = mix(col, ${c('#e4f0f5')}, air * (1.0 - smoothstep(0.5, 1.0, f)));

          // Now and then a few birds cross high over the far hills, a loose V
          // flapping out of step.
          for (int k = 0; k < 2; k++) {
            float fk = float(k);
            float cx = mod(uTime * (0.55 + 0.2 * fk) + 35.0 + fk * 47.0, 110.0) - 55.0;
            if (k == 1) cx = -cx;
            vec2 at = vec2(x - cx, vP.y - (${BASE.toFixed(2)} + ${SPAN.toFixed(2)} * (0.3 + 0.05 * fk) + 0.15 * sin(uTime * 0.2 + fk)));
            for (int i = 0; i < 5; i++) {
              float fi = float(i);
              float side = mod(fi, 2.0) * 2.0 - 1.0;
              vec2 o = vec2((k == 1 ? -1.0 : 1.0) * -0.32 * ceil(fi / 2.0), 0.13 * ceil(fi / 2.0) * side);
              float flap = 0.55 * sin(uTime * 7.0 + fi * 1.7 + fk * 3.0);
              col = mix(col, ${c('#7d8a95')}, bird(at - o, flap) * 0.45);
            }
          }

          // The lake, right up to the grass. t runs 0 at the meadow to 1 at
          // the far shore. Distance shows the way it does on real water:
          // deeper near, paler and bluer far off, ripple lines packing tighter
          // the further they go, the hills mirrored upside down below the far
          // shore, and a bright rim of light along it.
          float t = clamp(f / 0.135, 0.0, 1.0);
          vec3 lake = mix(${c('#3f6f8f')}, ${c('#a6c4d6')}, pow(t, 1.4));
          // Perspective: a row's height shrinks with distance.
          float u = 1.0 / (1.15 - t);
          float ripple = noise(vec2(x * 0.5 / u, u * 7.0));
          lake = mix(lake, ${c('#d4e6ee')}, smoothstep(0.62, 0.8, ripple) * (0.25 + 0.35 * t));
          lake *= 1.0 - 0.06 * smoothstep(0.25, 0.05, ripple);
          // The far range, reflected: mirrored about the shore, softened.
          float mf = 0.145 + (0.135 - f) * 1.4;
          float mirrored = smoothstep(near + 0.02, near - 0.02, mf) * smoothstep(0.35, 1.0, t);
          lake = mix(lake, ${c('#5f8f8a')}, mirrored * 0.45 * (0.8 + 0.2 * ripple));
          // Light along the far shore.
          lake = mix(lake, ${c('#eef6f8')}, smoothstep(0.86, 0.97, t) * (1.0 - smoothstep(0.97, 1.0, t)) * 0.7);
          // Boats out on the lake, slow, at different distances, smaller the
          // further out each sails, trailing a pale line on the water; several
          // are usually in view (Simon: more boats).
          for (int k = 0; k < 7; k++) {
            float fk = float(k);
            float row = 0.42 + 0.083 * fk;
            float dir = mod(fk, 2.0) < 0.5 ? 1.0 : -1.0;
            float bx = dir * (mod(uTime * (0.3 - 0.025 * fk) + 13.0 + fk * 37.0, 90.0) - 45.0);
            float size = (1.25 - 0.4 * row) * (0.85 + 0.3 * fract(fk * 0.618));
            vec2 bp = vec2((x - bx) * dir, vP.y - (${BASE.toFixed(2)} + ${SPAN.toFixed(2)} * 0.135 * row));
            float b = boat(bp, size * 1.4);
            float wake = step(abs(bp.y + 0.01), 0.012) * smoothstep(-2.0, -0.15, bp.x) * step(bp.x, -0.15) * step(f, 0.135);
            lake = mix(lake, ${c('#e6f1f4')}, wake * 0.6);
            lake = mix(lake, ${c('#3b4a58')}, step(0.5, b) * step(b, 1.5));
            lake = mix(lake, ${c('#fbf8f1')}, step(1.5, b));
          }
          col = mix(col, lake, step(f, 0.135));
          gl_FragColor = vec4(col, 1.0);
        }`
    })
    const out = new THREE.Mesh(new THREE.PlaneGeometry(320, 80), material)
    out.position.set(0, -20, -30)
    out.frustumCulled = false
    out.renderOrder = -11
    return out
  }, [])
  return <primitive object={mesh} />
}
