import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { shouldDraw } from './pace'

// The prints' hairline ink outline, as a screen-space pass. The Meshy mesh is
// shattered into thousands of open edges, so the outline can't come from its
// topology; it comes from depth instead. The scene renders into an offscreen
// target with its depth, then onto the screen, where a pixel gets a hairline
// if a neighbour is markedly farther away: a petal's edge over the petal
// behind it, a petal over a pad, the plant over the desktop. Depth's second
// difference is the test, so smooth surfaces seen at a grazing angle (big but
// even slopes) stay clean. The line is a darker, richer shade of the surface's
// own colour: deep pink on petals, deep green on pads.

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`

const fragmentShader = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 texel;
/** One scene-target pixel, in uv. */
uniform vec2 sub;
uniform float near;
uniform float far;
uniform float strength;

float viewZ(vec2 uv) {
  float z = texture2D(tDepth, uv).r * 2.0 - 1.0;
  return 2.0 * near * far / (far + near - z * (far - near));
}

const vec2 OFFSETS[8] = vec2[8](
  vec2(-1.0, 0.0), vec2(1.0, 0.0), vec2(0.0, -1.0), vec2(0.0, 1.0),
  vec2(1.0, 1.0), vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 1.0)
);

vec4 inked(vec2 at) {
  vec4 c = texture2D(tColor, at);
  float z0 = viewZ(at);
  float z[8];
  float farther = 0.0;
  float nearer = 0.0;
  vec4 fill = vec4(0.0);
  for (int i = 0; i < 8; i++) {
    vec2 uv = at + OFFSETS[i] * texel;
    z[i] = viewZ(uv);
    float d = z[i] - z0;
    farther += step(0.008, d);
    if (d < -0.008) {
      nearer += 1.0;
      fill += texture2D(tColor, uv);
    }
  }
  // A pinhole in the mesh (the desktop or a far surface showing through one
  // or two pixels, almost all neighbours nearer): paint it over, no ink.
  if (nearer >= 6.0) c = fill / nearer;
  // A jump in depth, not a slope: the second difference along each axis.
  float jump = max(max(abs(z[0] + z[1] - 2.0 * z0), abs(z[2] + z[3] - 2.0 * z0)),
                   max(abs(z[4] + z[5] - 2.0 * z0), abs(z[6] + z[7] - 2.0 * z0)));
  // Only on the near side of the jump, and only along a real edge (several
  // farther neighbours), so the line hugs front edges and skips pinholes.
  vec3 rgb = c.rgb / max(c.a, 1e-4);
  // Pads ruffle over themselves; the prints outline a pad only at its outer
  // edge, so on green only a big jump (pad against the desktop, the pot, the
  // flower) gets ink. Petals keep their fine lines.
  float leafPx = smoothstep(0.0, 0.05, rgb.g - max(rgb.r, rgb.b));
  float t = mix(0.012, 0.09, leafPx);
  // Soft on/off, so the hairline antialiases instead of stepping.
  float line = smoothstep(t, t * 3.5, jump) * smoothstep(1.0, 3.0, farther) * step(nearer, 5.0)
    * smoothstep(0.0, 0.05, c.a) * strength;

  vec3 ink = pow(max(rgb, 0.0), vec3(1.5)) * 0.55;
  vec4 o = vec4(mix(rgb, ink, line), 1.0);
  #ifdef TONE_MAPPING
  o.rgb = toneMapping(o.rgb);
  #endif
  o = linearToOutputTexel(o);
  return vec4(o.rgb * c.a, c.a);
}

// Supersampled on a low-density screen: the scene target is SS times the
// canvas, inked at its own resolution, and each screen pixel averages its
// SS × SS block, the way the compositor used to shrink a 2x canvas.
void main() {
  #if SS == 1
  gl_FragColor = inked(vUv);
  #else
  vec4 sum = vec4(0.0);
  for (int y = 0; y < SS; y++)
    for (int x = 0; x < SS; x++)
      sum += inked(vUv + (vec2(x, y) - 0.5 * float(SS - 1)) * sub);
  gl_FragColor = sum / float(SS * SS);
  #endif
}`

/** Scene pixels per canvas pixel, each way: a 1x screen keeps the 2x look. */
export const supersample = (dpr: number) => (dpr < 2 ? 2 : 1)

export function Ink({ strength = 0.6 }: { strength?: number }) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)

  const target = useMemo(() => {
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 })
    rt.depthTexture = new THREE.DepthTexture(1, 1)
    return rt
  }, [])
  const ss = supersample(dpr)
  const pass = useMemo(() => {
    const material = new THREE.ShaderMaterial({
      defines: { SS: ss },
      vertexShader,
      fragmentShader,
      uniforms: {
        tColor: { value: target.texture },
        tDepth: { value: target.depthTexture },
        texel: { value: new THREE.Vector2() },
        sub: { value: new THREE.Vector2() },
        near: { value: 0.1 },
        far: { value: 50 },
        strength: { value: strength }
      },
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending
    })
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
    quad.frustumCulled = false
    const quadScene = new THREE.Scene()
    quadScene.add(quad)
    return { material, quadScene, quadCamera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) }
  }, [target, strength, ss])

  useEffect(() => {
    const px = gl.getDrawingBufferSize(new THREE.Vector2()).multiplyScalar(ss)
    target.setSize(px.x, px.y)
    pass.material.uniforms.sub.value.set(1 / px.x, 1 / px.y)
    // About one point wide whatever the display: a hairline, not a stroke.
    const step = Math.max(1, dpr * ss * 0.75)
    pass.material.uniforms.texel.value.set(step / px.x, step / px.y)
  }, [gl, target, pass, size, dpr, ss])

  useEffect(
    () => () => {
      target.dispose()
      pass.material.dispose()
    },
    [target, pass]
  )

  // Priority 1 takes over rendering from r3f (and runs after the pose is
  // set): scene to the target, then the inked composite to the screen.
  // At rest, a tick the eye couldn't tell from the last frame isn't drawn (pace.ts).
  useFrame(() => {
    if (!shouldDraw()) return
    pass.material.uniforms.near.value = camera.near
    pass.material.uniforms.far.value = camera.far
    gl.setRenderTarget(target)
    gl.clear()
    gl.render(scene, camera)
    gl.setRenderTarget(null)
    gl.render(pass.quadScene, pass.quadCamera)
  }, 1)

  return null
}
