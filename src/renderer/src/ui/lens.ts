import { useEffect, useMemo, useState } from 'react'

// The glass panels whose backdrop is drawn for them, at full resolution, by
// the lens shader (LENS_GLSL): in the garden by Film, from the painting
// before it is dithered; on the pad by Lens, from the desktop behind it. The
// CSS panel over it is only tint, edge light and text. Up to MAX_LENSES at once.

export const MAX_LENSES = 4

type Lens = { el: HTMLElement; radius: number }
const lenses = new Set<Lens>()

/** A callback ref that also keeps `.current`, so a panel mounted later works. */
export type LensRef<T> = ((el: T | null) => void) & { current: T | null }

/** Lets the garden draw this element's backdrop as glass. */
export function useLens<T extends HTMLElement>(radius = 22): LensRef<T> {
  const [el, setEl] = useState<T | null>(null)
  const ref = useMemo(() => {
    const f = ((node: T | null) => {
      f.current = node
      setEl(node)
    }) as LensRef<T>
    f.current = null
    return f
  }, [])
  useEffect(() => {
    if (!el) return
    const lens = { el, radius }
    lenses.add(lens)
    return () => {
      lenses.delete(lens)
    }
  }, [el, radius])
  return ref
}

/**
 * Where the lenses are this frame, in CSS px from the canvas's bottom-left
 * (x, y, w, h), with their corner radius and how much they show (their
 * opacity, so a panel fading in or out takes its glass with it). Returns how
 * many it wrote.
 */
export function readLenses(canvas: DOMRect, rects: { set(x: number, y: number, z: number, w: number): unknown }[], radii: number[], alpha: number[]) {
  let n = 0
  for (const { el, radius } of lenses) {
    if (n >= MAX_LENSES) break
    const style = getComputedStyle(el)
    const a = style.visibility === 'hidden' ? 0 : Number(style.opacity)
    if (!(a > 0.001)) continue
    // The transformed box: a panel scaling in takes its glass with it.
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    rects[n].set(r.left - canvas.left, canvas.bottom - r.bottom, r.width, r.height)
    radii[n] = Math.min(radius, r.width / 2, r.height / 2)
    alpha[n] = a
    n++
  }
  return n
}

/**
 * The lens, in GLSL, shared by the garden's Film pass and the pad's Lens so
 * the glass is one material everywhere, on the same dials (paint.ts
 * `tune.glass*`, Tune's Glass group). It reads `tPic` (with mipmaps) and
 * needs `uPx` (1 / the picture's size in CSS px) declared before it, the
 * uniforms below, and `MAX_LENSES` defined.
 *
 *   soft(uv)                     the backdrop blurred by uBlur
 *   lensAt(p, out pull, out rim) how much glass covers p (CSS px from the
 *                                bottom-left, 0..1), how far its rim pulls the
 *                                backdrop in there (CSS px), and how much of p
 *                                is under the 1 px border (painted plain white,
 *                                so the CSS line over it is the same white over
 *                                any backdrop)
 *   lift(c)                      the glass's saturate and brightness
 */
export const LENS_DEFINES = { MAX_LENSES }

export const LENS_GLSL = /* glsl */ `
  uniform vec4 uLens[MAX_LENSES];
  uniform float uLensR[MAX_LENSES];
  uniform float uLensA[MAX_LENSES];
  uniform int uLensN;
  uniform float uDpr;
  uniform float uBlur;
  uniform float uGSat;
  uniform float uGBright;
  uniform float uBand;
  uniform float uPull;
  uniform float uDisp;
  // The glass's blur, uBlur CSS px: the mip level about half that wide, and
  // two rings of taps out to it, so it's round and smooth.
  vec3 soft(vec2 uv) {
    float lod = max(0.0, log2(uBlur * uDpr * 0.5));
    vec3 sum = textureLod(tPic, uv, lod).rgb * 2.0;
    for (int i = 0; i < 6; i++) {
      float a = float(i) * 1.0472;
      vec2 d = vec2(cos(a), sin(a)) * uPx * uBlur;
      sum += textureLod(tPic, uv + d * 0.7, lod).rgb + textureLod(tPic, uv + d.yx * vec2(0.35, -0.35), lod).rgb;
    }
    return sum / 14.0;
  }
  // How far in from the rounded rectangle's edge p is (CSS px, < 0 outside)
  // and the way in.
  float inside(vec2 p, vec4 r, float rad, out vec2 way) {
    vec2 h = r.zw * 0.5;
    vec2 d = p - r.xy - h;
    vec2 q = abs(d) - (h - rad);
    float depth;
    vec2 n;
    if (q.x > 0.0 && q.y > 0.0) {
      float l = max(length(q), 1e-4);
      depth = rad - l;
      n = q / l;
    } else if (q.x > q.y) {
      depth = rad - q.x;
      n = vec2(1.0, 0.0);
    } else {
      depth = rad - q.y;
      n = vec2(0.0, 1.0);
    }
    way = -n * vec2(d.x < 0.0 ? -1.0 : 1.0, d.y < 0.0 ? -1.0 : 1.0);
    return depth;
  }
  float lensAt(vec2 p, out vec2 pull, out float rim) {
    pull = vec2(0.0);
    rim = 0.0;
    for (int i = 0; i < MAX_LENSES; i++) {
      if (i >= uLensN) break;
      vec2 way;
      float depth = inside(p, uLens[i], uLensR[i], way);
      if (depth <= -1.0) continue;
      float band = max(uBand, 1.0);
      float t = clamp(depth / band, 0.0, 1.0);
      // Full pull at the rim (uPull x the band), easing to none inside.
      pull = way * (1.0 - t) * (1.0 - t) * uPull * band;
      // Under the panel's 1 px border only: any wider reads as a white box.
      rim = 1.0 - smoothstep(0.6, 1.4, depth);
      // Antialiased at the rim.
      return uLensA[i] * clamp(depth * uDpr + 0.5, 0.0, 1.0);
    }
    return 0.0;
  }
  vec3 lift(vec3 g) {
    return mix(vec3(dot(g, vec3(0.2126, 0.7152, 0.0722))), g, uGSat) * uGBright;
  }
`
