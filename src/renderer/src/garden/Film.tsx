import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { LENS_DEFINES, LENS_GLSL, MAX_LENSES, readLenses } from '../ui/lens'
import { shared, tune } from './paint'

// The dream, over Ink's finished picture: the screen is copied with its mip
// chain and drawn back with a bloom over everything, lifted blacks, and a matte paper
// texture fixed to the page. Optionally dithered: chunky pixels, a few colour
// levels, and a 4×4 ordered (Bayer) pattern to mix between them.
//
// Under the callout's glass sheet (lens.ts) it draws its backdrop too, so the CSS
// panel needs no backdrop-filter: the painting before the dither, its rim
// pulled inward in a 44 px band (red a touch further than blue), softly
// blurred (tune.glassBlur), at the canvas's full resolution. An SVG
// filter in backdrop-filter did the same at 1 CSS px per device px, and the
// dither showed through a 2 px CSS blur as a mosaic.

/** How soft the backdrop is through the garden's glass, in CSS px. The
 * post's recipe says 2; 8 reads as glass over our painting rather than a
 * sharp copy of it (and it's the soft look Simon liked). `?glassblur=` tries
 * another. */

export function Film() {
  const gl = useThree((s) => s.gl)
  const size = useThree((s) => s.size)
  const dpr = useThree((s) => s.viewport.dpr)
  const copy = useMemo(() => new THREE.FramebufferTexture(1, 1), [])
  const pass = useMemo(() => {
    copy.magFilter = THREE.LinearFilter
    copy.minFilter = THREE.LinearMipmapLinearFilter
    copy.generateMipmaps = true
    const material = new THREE.ShaderMaterial({
      uniforms: {
        tPic: { value: copy },
        uPx: { value: new THREE.Vector2() },
        uPaperAt: shared.uPaperAt,
        uTime: { value: 0 },
        uSat: tune.sat,
        uFade: tune.fade,
        uGlow: tune.glow,
        uPaper: tune.paper,
        uDither: tune.dither,
        uPixel: tune.pixel,
        uHour: tune.hour,
        uCloud: tune.cloud,
        uRain: tune.rain,
        uLens: { value: Array.from({ length: MAX_LENSES }, () => new THREE.Vector4()) },
        uLensR: { value: new Array<number>(MAX_LENSES).fill(0) },
        uLensA: { value: new Array<number>(MAX_LENSES).fill(0) },
        uLensN: { value: 0 },
        uDpr: { value: 1 },
        uBlur: tune.glassBlur,
        uGSat: tune.glassSat,
        uGBright: tune.glassBright,
        uBand: tune.glassBand,
        uPull: tune.glassPull,
        uDisp: tune.glassDisp
      },
      defines: LENS_DEFINES,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform sampler2D tPic;
        uniform vec2 uPx;
        uniform float uTime;
        uniform float uSat;
        uniform float uFade;
        uniform float uGlow;
        uniform float uPaper;
        uniform float uDither;
        uniform float uPixel;
        uniform float uHour;
        uniform float uCloud;
        uniform float uRain;
        uniform vec3 uPaperAt;
        ${LENS_GLSL}
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        // A wide soft sample: the mip chain, smoothed with a ring of taps.
        vec3 pick(vec2 uv, float lod) {
          vec3 sum = textureLod(tPic, uv, lod).rgb * 2.0;
          vec2 r = uPx * 1.2 * pow(2.0, lod);
          for (int i = 0; i < 6; i++) {
            float a = float(i) * 1.0472;
            sum += textureLod(tPic, uv + vec2(cos(a), sin(a)) * r, lod).rgb;
          }
          return sum / 8.0;
        }
        // The ordered dither's threshold for this cell, 0..1.
        float bayer2(vec2 p) { return mod(p.x * 2.0 + p.y * 3.0, 4.0); }
        float bayer4(vec2 p) {
          p = mod(p, 4.0);
          return (4.0 * bayer2(mod(p, 2.0)) + bayer2(floor(p / 2.0)) + 0.5) / 16.0;
        }
        // Time of day and weather, laid over the finished painting like a glaze.
        vec3 sky(vec3 c, vec2 uv, vec2 px) {
          float h = uHour;
          // 1 in full daylight, 0 at night, easing through dawn and dusk.
          float day = smoothstep(5.0, 8.0, h) * (1.0 - smoothstep(18.0, 21.0, h));
          // Golden light round sunrise and sunset.
          float gold = exp(-pow((h - 7.0) / 1.2, 2.0)) + exp(-pow((h - 18.6) / 1.2, 2.0));
          c *= mix(vec3(1.0), vec3(1.08, 0.92, 0.78), gold * 0.75);
          // Night: deep blue, the paper dimmed, a few stars in the sky.
          vec3 night = c * vec3(0.3, 0.37, 0.6) + vec3(0.02, 0.03, 0.07);
          float star = step(0.9965, hash(floor(px / 2.0))) * smoothstep(0.62, 0.8, uv.y) * (0.6 + 0.4 * sin(uTime * 2.0 + hash(floor(px / 2.0) + 3.0) * 30.0));
          night += star * (1.0 - uCloud) * 0.7;
          c = mix(night, c, day);
          // Overcast: greyer, flatter, a little darker.
          float lum = dot(c, vec3(0.3, 0.59, 0.11));
          c = mix(c, vec3(lum) * vec3(0.96, 0.98, 1.02), uCloud * 0.5);
          c *= 1.0 - 0.14 * uCloud;
          // Rain: thin pale streaks falling on a slant, each lane at its own pace.
          vec2 rp = vec2(px.x + px.y * 0.16, px.y);
          float lane = floor(rp.x / 5.0);
          float r = hash(vec2(lane, 7.0));
          float y = rp.y / 90.0 + uTime * (2.4 + r * 1.6) + r * 13.0;
          float drop = (1.0 - smoothstep(0.0, 0.22, fract(y))) * step(0.5, hash(vec2(lane, floor(y))));
          drop *= 1.0 - smoothstep(0.25, 0.6, abs(fract(rp.x / 5.0) - 0.5) * 2.0);
          c = mix(c, vec3(0.86, 0.9, 0.97), drop * uRain * 0.45);
          return c;
        }
        vec3 shadeWith(vec2 uv, vec3 c) {
          // Bloom: a very soft copy of the whole picture screened over it,
          // so light spills out of everything bright.
          vec3 glow = pick(uv, 4.2);
          c = 1.0 - (1.0 - c) * (1.0 - glow * glow * vec3(1.0, 0.97, 0.93) * 0.2 * uGlow);
          // Blacks lifted only a touch.
          c = c * 0.965 + vec3(0.035);
          // Richer colour: film stock, not a grey lift.
          c = mix(vec3(dot(c, vec3(0.3, 0.59, 0.11))), c, uSat);
          // White closes in round the frame on a long soft fade, its edge just
          // touched by a brush.
          vec2 px = uv / uPx;
          vec2 arch = abs(uv - vec2(0.5, 0.5)) / vec2(0.5, 0.52);
          float reach = pow(pow(arch.x, 4.5) + pow(arch.y, 4.5), 1.0 / 4.5);
          // Faint horizontal strokes only, long and soft.
          float strokes = noise(vec2(px.x / 220.0, px.y / 22.0)) * 0.6 + noise(vec2(px.x / 70.0, px.y / 8.0)) * 0.4;
          float brush = reach + (strokes - 0.5) * 0.07;
          c = mix(c, vec3(1.0), smoothstep(0.7, 1.02, brush * uFade));
          // The sky goes further: it dissolves well before the top of the frame.
          c = mix(c, vec3(1.0), smoothstep(0.66, 0.97, (uv.y + (strokes - 0.5) * 0.05) * uFade));
          // Matte paint on rough paper, pinned to the garden (uPaperAt) so it
          // moves with it: a soft mottle from the brush that scales with the
          // zoom, and a fine tooth that only slides (so it stays fine), both
          // strongest in the mid tones, none on bare white.
          vec2 onGround = px - uPaperAt.xy;
          vec2 gp = onGround / uPaperAt.z;
          float mottle = noise(gp / 90.0) * 0.5 + noise(gp / 28.0) * 0.3 + noise(gp / 7.0) * 0.2;
          float paper = ((mottle - 0.5) * 0.12 + (hash(floor(onGround / 1.5)) - 0.5) * 0.035) * uPaper;
          c = sky(c, uv, px);
          c += paper * (1.0 - smoothstep(0.86, 1.0, min(c.r, min(c.g, c.b))));
          return c;
        }
        vec3 shade(vec2 uv) { return shadeWith(uv, texture2D(tPic, uv).rgb); }
        vec3 painted() {
          if (uDither <= 0.001) return shade(vUv);
          // One sample per chunky pixel, from its centre: a whole number of
          // device pixels (under 1 point when the canvas renders finer).
          float size = max(1.0, floor(uPixel * uDpr + 0.5)) / uDpr;
          vec2 cell = floor(vUv / uPx / size);
          vec3 c = shade((cell + 0.5) * size * uPx);
          // Fewer levels the stronger it is; the pattern decides which way each
          // pixel rounds, so flat washes turn into a fine checker of two tones.
          float levels = mix(24.0, 3.0, uDither);
          c = floor(c * levels + bayer4(cell)) / levels;
          return clamp(c, 0.0, 1.0);
        }
        void main() {
          // Under a glass panel?
          vec2 p = gl_FragCoord.xy / uDpr;
          vec2 pull;
          float rim;
          float glass = lensAt(p, pull, rim);
          if (glass <= 0.0) {
            gl_FragColor = vec4(painted(), 1.0);
            return;
          }
          // The backdrop through the glass: each channel pulled in from the rim
          // by its own amount, then softened.
          vec2 uvR = vUv + pull * uPx * (1.0 + uDisp);
          vec2 uvG = vUv + pull * uPx;
          vec2 uvB = vUv + pull * uPx * (1.0 - uDisp);
          vec3 g = vec3(shadeWith(uvR, soft(uvR)).r, shadeWith(uvG, soft(uvG)).g, shadeWith(uvB, soft(uvB)).b);
          g = lift(g);
          g = mix(g, vec3(1.0), rim);
          gl_FragColor = vec4(glass >= 0.999 ? clamp(g, 0.0, 1.0) : mix(painted(), clamp(g, 0.0, 1.0), glass), 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      toneMapped: false
    })
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
    quad.frustumCulled = false
    const scene = new THREE.Scene()
    scene.add(quad)
    return { material, scene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) }
  }, [copy])

  useEffect(() => {
    const px = gl.getDrawingBufferSize(new THREE.Vector2())
    copy.image.width = px.x
    copy.image.height = px.y
    copy.dispose()
    pass.material.uniforms.uPx.value.set(1 / px.x, 1 / px.y).multiplyScalar(dpr)
  }, [gl, copy, pass, size, dpr])

  // After Ink has drawn the frame.
  useFrame((_, dt) => {
    gl.setRenderTarget(null)
    gl.copyFramebufferToTexture(copy)
    // three copies level 0 only; the blur reads the whole mip chain.
    const ctx = gl.getContext()
    ctx.bindTexture(ctx.TEXTURE_2D, (gl.properties.get(copy) as { __webglTexture: WebGLTexture }).__webglTexture)
    ctx.generateMipmap(ctx.TEXTURE_2D)
    gl.state.unbindTexture()
    pass.material.uniforms.uTime.value += dt
    const u = pass.material.uniforms
    u.uLensN.value = readLenses(gl.domElement.getBoundingClientRect(), u.uLens.value, u.uLensR.value, u.uLensA.value)
    u.uDpr.value = dpr
    const space = gl.outputColorSpace
    gl.outputColorSpace = THREE.LinearSRGBColorSpace
    const tone = gl.toneMapping
    gl.toneMapping = THREE.NoToneMapping
    gl.render(pass.scene, pass.camera)
    gl.outputColorSpace = space
    gl.toneMapping = tone
  }, 2)

  return null
}
