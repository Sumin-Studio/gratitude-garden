"""Auto-rig a single-mesh flower (e.g. from Meshy) for Sip Flower.

    blender --background --python scripts/autorig.py -- \
        --in rose_meshy.glb --out resources/flowers/rose.glb [--blend rose.blend]
        [--stem 6] [--petals 0] [--head 0] [--drop pot,soil]

What it does, all geometrically, with no manual input:
  1. Imports the GLB, drops anything named pot/soil (configurable), joins the
     rest into one mesh, stands it on the origin (Blender Z-up).
  2. Finds the stem: a robust centre line traced up horizontal slices from
     the base, and the head: where the silhouette widens near the top.
  3. Finds petals (angular sectors around the head axis) and leaves (clumps
     of geometry off the stem, by voxel connectivity).
  4. Builds an armature that follows the app's rig contract (docs/FLOWERS.md):
     stem_0…stem_N (connected chain), head, petal_*, leaf_*.
  4b. Replaces each bud with a small copy of the bloom (generated buds are an
     outer skin with no petals inside, so they can't open): the bud is
     deleted, the bloom's head and petals are duplicated onto the stalk's end
     along the bud's axis, with their own bones bud_N, bud_N_petal_K(_tip).
  5. Paints weights itself instead of Blender's automatic weights, which
     often fail on generated, non-manifold meshes: stems blend between
     neighbouring stem bones, petals and leaves ramp in from their hinge.
  6. Exports a skinned GLB (Y-up) and, with --blend, a .blend to refine.

It prints a one-line JSON report at the end (prefixed AUTORIG).
"""

import argparse
import json
import math
import re
import sys

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--in", dest="inp", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--blend", default=None)
    p.add_argument("--stem", type=int, default=6, help="stem bones")
    p.add_argument("--petals", type=int, default=0, help="petals in one even ring, 0 = auto (rings found from tips)")
    p.add_argument("--ring-elev", type=float, default=12.0, help="degrees above the receptacle where the inner ring starts")
    p.add_argument("--rims", type=int, default=6, help="rim bones per leaf blade")
    p.add_argument("--leaf-core", type=float, default=0.12, help="radius around the stem (share of height) cut before finding organs")
    p.add_argument("--bud-bloom", type=float, default=0.58, help="replace buds with a bloom copy this size (share of the bloom), 0 = keep buds")
    p.add_argument("--bud-stem", type=float, default=0.15, help="the bloom copy's stem, from the stalk's end to the flower (share of the plant's height)")
    p.add_argument("--flat", type=float, default=0.08, help="flatness below which an organ is a leaf, above a bud")
    p.add_argument("--head", type=float, default=0.0, help="head height as a share of the plant, 0 = auto")
    p.add_argument("--drop", default="pot,soil", help="comma-separated name prefixes to remove")
    p.add_argument("--debug", action="store_true")
    p.add_argument("--decimate", type=int, default=0, help="target triangle count, 0 = keep")
    p.add_argument("--texture", type=int, default=0, help="max texture size in px, 0 = keep")
    # Autorig v3: plants that aren't one stem and one bloom (see rig_plant).
    p.add_argument("--mode", default="flower", choices=["flower", "spike", "clump"], help="flower = stem + head (lotus); spike = a stem with florets up it; clump = a bush from one crown")
    p.add_argument("--bloom", default="", help="v3: what a flower looks like in the texture: 'hue:H:W' (degrees, +-W), 'white'")
    p.add_argument("--bloom-sat", type=float, default=0.35, help="v3: minimum saturation of a hue bloom")
    p.add_argument("--bloom-val", type=float, default=0.25, help="v3: minimum brightness of a bloom")
    p.add_argument("--bloom-size", type=float, default=0.12, help="v3: largest bloom, share of the plant's height (bigger clusters are split)")
    p.add_argument("--bloom-min", type=int, default=12, help="v3: smallest bloom, in vertices")
    p.add_argument("--bloom-flat", type=float, default=0.0, help="v3: a cluster flatter than this (PCA ratio) is a leaf of the flowers' colour")
    p.add_argument("--bloom-above", type=float, default=0.08, help="v3: no flowers below this height (share)")
    p.add_argument("--bloom-grow", default="3:1.15", help="v3: 'RINGS:REACH', each flower grows over what it touches (petal rims, or a star's flat petals from its centre) this many mesh rings, within REACH of its radius")
    p.add_argument("--flat-petals", action="store_true", help="v3, untextured: flat petals (a star) may join a flower when it grows (only what is joined to it in the mesh)")
    p.add_argument("--blooms-max", type=int, default=40, help="v3: at most this many bloom bones (the smallest merge)")
    p.add_argument("--sectors", type=int, default=6, help="v3: branch chains fanning out from the crown")
    p.add_argument("--branch-bones", type=int, default=2, help="v3: bones per crown branch")
    p.add_argument("--drop-normal", action="store_true", help="v3: don't ship the normal map (an all-leaf bush: the watercolour flattens leaf bump anyway)")
    p.add_argument("--keep-blooms", action="store_true", help="v3: don't decimate the flowers (tiny ones would vanish)")
    p.add_argument("--draco", action="store_true", help="v3: Draco-compress the mesh (the app decodes it); for a bush of many small leaves that won't decimate further")
    p.add_argument("--cut-below", type=float, default=0.0, help="v3: delete everything below this height (share), e.g. a vase the flowers stand in")
    p.add_argument("--cut-ring", default="", help="v3: 'Z:R', also delete what is below height Z and further out than R (shares of the height), e.g. a vase's handles")
    p.add_argument("--cut-pot", default="", help="v3: 'Z:R', delete a pot the model stands in: what is below height Z and within R of the middle (shares of the height); leaves hanging over the rim stay, and the rim becomes the soil")
    p.add_argument("--upright", type=float, default=0.0, help="v3: stand a leaning model up, this share of the way (its middle over its base)")
    p.add_argument("--decimate-flowers", type=float, default=0.3, help="v3, untextured: how hard decimation cuts the flowers (1 = as hard as leaves, stalks are 0.04)")
    p.add_argument("--paint", default="", help="v3, untextured models: bake vertex colours, 'leaf=#hex,petal=#hex,edge=#hex,inner=#hex:0.45,heart=#hex:0.25,base=#hex:0.35' (inner, heart: share of a flower's radius round its centre; base: round its pivot)")
    p.add_argument("--stalks", action="store_true", help="v3, untextured: tell the stalks from the flowers by how round the surface is (a stalk running through a cluster of bells), and let each flower grow over all of itself up to them")
    p.add_argument("--shrink-leaves", default="", help="v3, untextured: 'LEN:WIDE', shrink broad leaves that tower over the flowers toward their base, LEN in height and WIDE across (they're cut free first, and stay whole)")
    p.add_argument("--grass", type=float, default=0.22, help="v3 spike: height (share) of the basal fan of leaves")
    return p.parse_args(argv)


DEBUG = "--debug" in sys.argv


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ---- 1. Import and prepare ---------------------------------------------------


def load_mesh(path, drop):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    objs = list(bpy.context.scene.objects)

    def dropped(o):
        while o:
            if any(o.name.lower().startswith(d) for d in drop):
                return True
            o = o.parent
        return False

    meshes = [o for o in objs if o.type == "MESH" and not dropped(o)]
    if not meshes:
        raise SystemExit("no mesh found")

    # Bake every mesh's world transform, strip old rigs, then join.
    for o in meshes:
        for m in list(o.modifiers):
            if m.type == "ARMATURE":
                o.modifiers.remove(m)
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
        o.vertex_groups.clear()
    for o in objs:
        if o not in meshes:
            bpy.data.objects.remove(o, do_unlink=True)

    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = "flower"
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # Stand it on the origin: base centre at (0, 0, 0).
    co = verts(obj)
    z0 = co[:, 2].min()
    low = co[co[:, 2] < z0 + 0.03 * np.ptp(co[:, 2])]
    cx, cy = np.median(low[:, 0]), np.median(low[:, 1])
    obj.data.transform(Matrix.Translation((-float(cx), -float(cy), -float(z0))))
    obj.data.update()
    return obj


def surface_samples(obj, count=60000, seed=7):
    """Points spread evenly over the surface (area-weighted), so the shape
    analysis doesn't depend on how the mesh happens to be triangulated: a
    low-poly block has vertices only at its corners, a scan has millions."""
    me = obj.data
    me.calc_loop_triangles()
    tri = np.empty(len(me.loop_triangles) * 3, dtype=np.int64)
    me.loop_triangles.foreach_get("vertices", tri)
    tri = tri.reshape(-1, 3)
    co = verts(obj)
    a, b, c = co[tri[:, 0]], co[tri[:, 1]], co[tri[:, 2]]
    area = np.linalg.norm(np.cross(b - a, c - a), axis=1) / 2
    rng = np.random.default_rng(seed)
    pick = rng.choice(len(tri), size=count, p=area / area.sum())
    r1, r2 = rng.random(count), rng.random(count)
    flip = r1 + r2 > 1
    r1[flip], r2[flip] = 1 - r1[flip], 1 - r2[flip]
    return a[pick] + r1[:, None] * (b - a)[pick] + r2[:, None] * (c - a)[pick]


def triangles(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def decimate(obj, ratio, group=None):
    """Collapse decimation (keeps UVs), applied. A flower drawn ~250 px tall
    needs tens of thousands of triangles, not hundreds of thousands. With
    `group`, only that vertex group's vertices collapse."""
    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new("decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = max(0.001, min(1.0, ratio))
    if group:
        mod.vertex_group = group
    bpy.ops.object.modifier_apply(modifier=mod.name)


def shrink_textures(max_px):
    for img in bpy.data.images:
        w, h = img.size
        if max(w, h) > max_px:
            k = max_px / max(w, h)
            img.scale(max(1, int(w * k)), max(1, int(h * k)))
            # Repack so the exporter writes the smaller pixels.
            img.pack()


def verts(obj):
    n = len(obj.data.vertices)
    a = np.empty(n * 3, dtype=np.float64)
    obj.data.vertices.foreach_get("co", a)
    return a.reshape(n, 3)


# ---- 4a. One piece, one part --------------------------------------------------


def one_piece(obj, co, W):
    """A decimated generated mesh is hundreds of loose pieces, and a piece can
    straddle parts: a pad's edge fused to the stem, two pads overlapping. When
    those parts move differently, the triangles across them stretch into
    webs. So within each piece, vertices of a minority part take the weights
    of their nearest vertex in the piece's majority part, and the piece moves
    as one. Only leaves, pads and their stalks are evened out: the stem and
    the bloom blend into each other on purpose, and pieces touching a bud
    are left to step 4b, which replaces the bud."""
    import bmesh
    from mathutils.kdtree import KDTree

    names = list(W)
    M = np.stack([W[nm] for nm in names], axis=1)
    buds = {m.group(1) for nm in names if (m := re.fullmatch(r"bud_(\d+)", nm))}

    def part(nm):
        m = re.match(r"(stalk|leaf|bud)_(\d+)", nm)
        if m:
            return f"bud{m.group(2)}" if m.group(2) in buds else f"organ{m.group(2)}"
        return "stem" if nm.startswith("stem") else "bloom"

    parts = np.array([part(nm) for nm in names])
    dom = np.where(M.sum(1) > 0, parts[M.argmax(1)], "none")

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    seen = np.zeros(len(bm.verts), bool)
    fixed = 0
    for s0 in range(len(bm.verts)):
        if seen[s0]:
            continue
        stack, members = [s0], []
        seen[s0] = True
        while stack:
            x = stack.pop()
            members.append(x)
            for e in bm.verts[x].link_edges:
                y = e.other_vert(bm.verts[x]).index
                if not seen[y]:
                    seen[y] = True
                    stack.append(y)
        idx = np.array(members)
        kinds, counts = np.unique(dom[idx], return_counts=True)
        if len(kinds) < 2 or any(k.startswith("bud") for k in kinds):
            continue
        major = kinds[counts.argmax()]
        minor = idx[dom[idx] != major]
        # Only where a leaf/pad/bud part is involved on either side.
        organish = major.startswith("organ") | np.char.startswith(dom[minor].astype(str), "organ")
        minor = minor[organish if isinstance(organish, np.ndarray) else np.full(len(minor), organish)]
        if not len(minor):
            continue
        keep = idx[dom[idx] == major]
        kd = KDTree(len(keep))
        for j, i in enumerate(keep):
            kd.insert(Vector(co[i]), j)
        kd.balance()
        for i in minor:
            _, j, _ = kd.find(Vector(co[i]))
            M[i] = M[keep[j]]
        fixed += len(minor)
    bm.free()
    for k, nm in enumerate(names):
        W[nm] = M[:, k]
    print("AUTORIG-PIECES evened", fixed, "vertices")


# ---- 4b. Buds into blooms ------------------------------------------------------


def bloom_bud(obj, arm, bud_name, size, stem_share):
    """Replace a bud with a copy of the bloom, `size` times as big.

    The bud goes: its bone's vertices, its lower body (skinned to the stalk
    but well off the stalk's line), anything inside its volume and the stalk
    past where it flares into the bud's sepal cup. The bloom's faces (skinned
    to head and petals, with the bit of stem under them) are duplicated,
    turned from the head bone's axis to continue the stalk (leaning a little
    more upright), the stem's foot on the stalk's new end and the stem
    stretched so the flower stands clear of the pads. They
    get their own bones: bud_N in place of the old bud bone, and
    bud_N_petal_K(_tip) copied from the bloom's petal bones."""
    import bmesh

    n = bud_name.split("_")[1]
    stalk_name = f"stalk_{n}_1"
    bones = arm.data.bones
    if stalk_name not in bones or "head" not in bones:
        return
    vg = obj.vertex_groups
    gi = {g.name: g.index for g in vg}
    petal_groups = [g for g in gi if re.fullmatch(r"petal_\d+(_tip)?", g)]

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    dl = bm.verts.layers.deform.active
    co = np.array([v.co[:] for v in bm.verts])

    def weights(idx):
        return np.array([v[dl].get(idx, 0.0) for v in bm.verts]) if idx is not None else np.zeros(len(bm.verts))

    wb = weights(gi.get(bud_name))
    ws = weights(gi.get(stalk_name))
    # The whole stalk (both bones): the bud's sepals can be skinned to either.
    ws_all = ws + weights(gi.get(f"stalk_{n}_0"))
    bloom_ids = [gi["head"]] + [gi[g] for g in petal_groups]
    wbloom = np.array([sum(v[dl].get(i, 0.0) for i in bloom_ids) for v in bm.verts])

    sb = bones[stalk_name]
    s0, s1 = np.array(sb.head_local), np.array(sb.tail_local)
    sd = (s1 - s0) / max(np.linalg.norm(s1 - s0), 1e-9)
    rel = co - s0
    t = rel @ sd
    on = ws >= 0.5
    # Distance from the whole stalk's line (both bones).
    line = [np.array(bones[f"stalk_{n}_0"].head_local)] if f"stalk_{n}_0" in bones else []
    off, _ = closest_on_polyline(co, np.array(line + [s0, s1]))
    on_all = ws_all >= 0.5
    radius = float(np.percentile(off[on_all], 25)) if on_all.any() else 0.0
    off_line = (wb > 0.2) | (on_all & (off > 2.5 * radius))
    body = co[off_line]
    if len(body) < 10:
        bm.free()
        return
    c = body.mean(0)
    # The bloom continues its stalk, leaning out with it but opening more
    # upwards (a generated bud can lie on its side, which reads as a snapped
    # stalk once it opens).
    axis = 0.7 * sd + 0.3 * np.array([0.0, 0.0, 1.0])
    axis = axis / np.linalg.norm(axis)
    # (90th percentile: a stray far vertex mustn't blow the volume up.)
    r_body = float(np.percentile(np.linalg.norm(body - c, axis=1), 90))
    inside = off_line | (np.linalg.norm(co - c, axis=1) < r_body)
    # Where the stalk flares into the bud's sepal cup, it ends: walking up
    # the stalk bone in slices, the first slice much wider than the stalk.
    kept = on & ~inside
    t_end = float(t[kept].max()) if kept.any() else float(np.linalg.norm(s1 - s0))
    if kept.sum() > 20:
        tk, ok = t[kept], off[kept]
        edges = np.linspace(tk.min(), tk.max(), 13)
        widths = [(a, float(np.median(ok[(tk >= a) & (tk < b)]))) for a, b in zip(edges[:-1], edges[1:]) if ((tk >= a) & (tk < b)).sum() >= 3]
        if widths:
            stalk_w = float(np.median([w for _, w in widths[: max(1, len(widths) // 2)]]))
            flare = [k for k, (a, w) in enumerate(widths) if w > 1.4 * stalk_w]
            if flare:
                # Cut well before the flare (the stalk starts to widen
                # before it shows), so no collar or fringe is left; the
                # bloom's own stem makes up the length.
                t_end = widths[max(0, flare[0] - 3)][0]
                inside = inside | (((ws_all >= 0.2) | (wb > 0)) & (t > t_end))
    seat = s0 + sd * t_end

    # The bloom's frame -> the bud's: rotate the head axis onto the bud's,
    # scale, seat on the stalk.
    # The whole bloom is copied, with the short piece of stem the head carries
    # under it: that piece's foot (the head bone's root) sits on the stalk's
    # end, so the stem runs on into the flower.
    hb = bones["head"]
    top = Vector(hb.head_local)
    hd = (Vector(hb.tail_local) - top).normalized()
    rot = hd.rotation_difference(Vector(axis.tolist()))
    # That stem piece is short; it's stretched (in the bloom's frame, before
    # the copy is placed) to `stem_share` of the plant's height, so the
    # flower stands clear of the pads without stretching the stalk's bones
    # (which drags whatever is skinned across them). The stem is the head's
    # thin core below the petals: below `a_s` along the axis, near it.
    along = (co - np.array(top[:])) @ np.array(hd[:])
    radial = np.linalg.norm((co - np.array(top[:])) - along[:, None] * np.array(hd[:]), axis=1)
    wpetal = np.array([sum(v[dl].get(gi[g], 0.0) for g in petal_groups) for v in bm.verts])
    head_only = (wbloom > 0.5) & (wpetal < 0.5)
    core = head_only & (along > 0)
    stem_r = float(np.percentile(radial[core], 20)) if core.any() else 0.0
    pa = along[wpetal > 0.5]
    a_s = max(float(np.percentile(pa, 2)), 1e-4) if len(pa) else 1e-4
    h = float(co[:, 2].max())
    k = max(1.0, stem_share * h / (size * a_s))
    M = Matrix.Translation(Vector(seat.tolist())) @ rot.to_matrix().to_4x4() @ Matrix.Scale(size, 4) @ Matrix.Translation(-top)

    # New groups first (the old bud's group is renamed out of the way).
    old = vg[bud_name]
    old.name = f"_old_{bud_name}"
    new_g = {"head": vg.new(name=bud_name).index}
    for g in petal_groups:
        new_g[g] = vg.new(name=f"{bud_name}_{g}").index

    # The bloom copy, before anything is deleted (indices still match).
    faces = [f for f in bm.faces if all(wbloom[v.index] > 0.5 for v in f.verts)]
    dup = bmesh.ops.duplicate(bm, geom=faces)
    new_verts = [e for e in dup["geom"] if isinstance(e, bmesh.types.BMVert)]
    hd_np, top_np = np.array(hd[:]), np.array(top[:])
    for v in new_verts:
        p = np.array(v.co[:]) - top_np
        a = float(p @ hd_np)
        r = float(np.linalg.norm(p - a * hd_np))
        # The stem below a_s stretches; everything above it moves up.
        shift = a * (k - 1) if (a < a_s and r < 2.5 * stem_r) else a_s * (k - 1)
        v.co = M @ (v.co + hd * shift)
        d = v[dl]
        moved = {}
        for idx, w in list(d.items()):
            name = vg[idx].name
            key = name if name in new_g else "head"
            moved[new_g[key]] = moved.get(new_g[key], 0.0) + w
        d.clear()
        for idx, w in moved.items():
            d[idx] = w

    # The bud goes; what's left of its weight goes to the stalk.
    bm.verts.ensure_lookup_table()
    gone = [bm.verts[i] for i in np.nonzero(inside)[0]]
    oi, si = old.index, gi[stalk_name]
    for v in bm.verts:
        d = v[dl]
        if oi in d:
            d[si] = d.get(si, 0.0) + d[oi]
            del d[oi]
    bmesh.ops.delete(bm, geom=gone, context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()
    vg.remove(old)

    # Bones: the new bud bone on the seat along the bud's axis, the bloom's
    # petal bones mapped through M.
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    eb.remove(eb[bud_name])
    head = eb["head"]
    nb = eb.new(bud_name)
    lift = hd * (a_s * (k - 1))
    nb.head = M @ head.head
    nb.tail = M @ (head.tail + lift)
    nb.align_roll(rot @ head.z_axis)
    nb.parent = eb[stalk_name]
    for g in petal_groups:
        src = eb[g]
        b = eb.new(f"{bud_name}_{g}")
        b.head, b.tail = M @ (src.head + lift), M @ (src.tail + lift)
        b.align_roll(rot @ src.z_axis)
    for g in petal_groups:
        b = eb[f"{bud_name}_{g}"]
        parent = eb[g].parent.name
        b.parent = eb[bud_name] if parent == "head" else eb[f"{bud_name}_{parent}"]
        b.use_connect = eb[g].use_connect
    bpy.ops.object.mode_set(mode="OBJECT")
    print("AUTORIG-BUD", bud_name, "deleted", len(gone), "copied", len(new_verts), "seat", np.round(seat, 3).tolist(), "stem x", round(k, 2))


# ---- 2. Stem and head -------------------------------------------------------------


def find_head_start(co, override):
    h = co[:, 2].max()
    if override > 0:
        return h * (1 - override)
    # Silhouette radius per slice; the head is where it's wide near the top.
    n = 40
    edges = np.linspace(0, h, n + 1)
    radii = []
    for i in range(n):
        s = co[(co[:, 2] >= edges[i]) & (co[:, 2] < edges[i + 1])]
        if len(s) < 4:
            radii.append(0.0)
            continue
        c = np.median(s[:, :2], axis=0)
        radii.append(np.percentile(np.linalg.norm(s[:, :2] - c, axis=1), 90))
    radii = np.array(radii)
    # The neck: the thinnest slice between the lower plant and the top. The
    # head starts where the silhouette widens again above it. (A share of the
    # widest slice fails on a tulip cup; the median fails when leaves or pads
    # fill the middle, as on a lotus.)
    lo_i, hi_i = int(n * 0.3), int(n * 0.92)
    filled = [k for k in range(lo_i, hi_i) if radii[k] > 0]
    neck = min(filled, key=lambda k: radii[k]) if filled else int(n * 0.7)
    stem_r = radii[neck]
    i = neck
    while i < n - 1 and radii[i] < 2.5 * stem_r:
        i += 1
    if DEBUG:
        print("AUTORIG_DEBUG", json.dumps({"stem_r": round(float(stem_r), 4), "radii": [round(float(r), 3) for r in radii], "stop": i}))
    frac = 1 - edges[i] / h
    frac = float(np.clip(frac, 0.08, 0.5))
    return h * (1 - frac)


def trace_stem(co, head_z):
    h = co[:, 2].max()
    slices = 28
    zs = np.linspace(0, head_z, slices + 1)
    centre = np.array([0.0, 0.0])
    reach = 0.035 * h
    path, radii = [], []
    for i in range(slices):
        s = co[(co[:, 2] >= zs[i]) & (co[:, 2] < zs[i + 1])]
        if len(s):
            near = s[np.linalg.norm(s[:, :2] - centre, axis=1) < reach]
            if len(near) >= 3:
                centre = np.median(near[:, :2], axis=0)
                radii.append(np.percentile(np.linalg.norm(near[:, :2] - centre, axis=1), 50))
        path.append([centre[0], centre[1], (zs[i] + zs[i + 1]) / 2])
    path = np.array([[path[0][0], path[0][1], 0.0]] + path + [[centre[0], centre[1], head_z]])
    rs = float(np.median(radii)) if radii else 0.02 * h
    return path, max(rs, 0.004 * h)


def resample(path, n):
    seg = np.linalg.norm(np.diff(path, axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)])
    t = np.linspace(0, cum[-1], n + 1)
    return np.stack([np.interp(t, cum, path[:, k]) for k in range(3)], axis=1)


def closest_on_polyline(p, pts):
    """For each point: distance to the polyline and arc-length parameter 0..1."""
    a, b = pts[:-1], pts[1:]
    ab = b - a
    L = np.linalg.norm(ab, axis=1)
    cum = np.concatenate([[0], np.cumsum(L)])
    total = cum[-1]
    ap = p[:, None, :] - a[None, :, :]
    t = np.clip((ap * ab[None]).sum(-1) / np.maximum((ab * ab).sum(-1), 1e-12)[None], 0, 1)
    proj = a[None] + t[..., None] * ab[None]
    d = np.linalg.norm(p[:, None, :] - proj, axis=-1)
    k = d.argmin(1)
    s = (cum[k] + t[np.arange(len(p)), k] * L[k]) / total
    return d[np.arange(len(p)), k], s


# ---- 3. Petals and leaves -------------------------------------------------------


def basis(d):
    d = d / np.linalg.norm(d)
    u = np.cross(d, [0, 1, 0] if abs(d[1]) < 0.9 else [1, 0, 0])
    u /= np.linalg.norm(u)
    return d, u, np.cross(d, u)


def find_leaves(co, mask, h, vox=0.025, min_n=60):
    """Clumps of off-stem geometry, by connectivity of occupied voxels."""
    idx = np.nonzero(mask)[0]
    if not len(idx):
        return []
    vox = vox * h
    keys = np.floor(co[idx] / vox).astype(np.int64)
    cells = {}
    for i, k in zip(idx, map(tuple, keys)):
        cells.setdefault(k, []).append(i)
    seen, groups = set(), []
    for k in cells:
        if k in seen:
            continue
        stack, comp = [k], []
        seen.add(k)
        while stack:
            c = stack.pop()
            comp.extend(cells[c])
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for dz in (-1, 0, 1):
                        nb = (c[0] + dx, c[1] + dy, c[2] + dz)
                        if nb in cells and nb not in seen:
                            seen.add(nb)
                            stack.append(nb)
        if len(comp) >= min_n:
            groups.append(np.array(comp))
    return groups


def grow_labels(points, mask, labels, vox):
    """Multi-source flood fill over occupied voxels: every masked point takes
    the label it is connected to first, so a stalk joins its own organ."""
    from collections import deque

    idx = np.nonzero(mask | (labels >= 0))[0]
    keys = [tuple(k) for k in np.floor(points[idx] / vox).astype(np.int64)]
    cells, lab, q = {}, {}, deque()
    for i, k in zip(idx, keys):
        cells.setdefault(k, []).append(i)
        if labels[i] >= 0 and k not in lab:
            lab[k] = labels[i]
            q.append(k)
    while q:
        c = q.popleft()
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    nb = (c[0] + dx, c[1] + dy, c[2] + dz)
                    if nb in cells and nb not in lab:
                        lab[nb] = lab[c]
                        q.append(nb)
    out = labels.copy()
    for k, ids in cells.items():
        if k in lab:
            out[ids] = np.where(out[ids] >= 0, out[ids], lab[k])
    return out


def tip_peaks(theta, rho, min_sep_deg, bins=120):
    """Petal directions around a ring: peaks of outward reach (a petal's tip
    reaches further than the gap beside it)."""
    b = ((theta + math.pi) / (2 * math.pi) * bins).astype(int) % bins
    prof = np.zeros(bins)
    for k in range(bins):
        r = rho[b == k]
        prof[k] = np.percentile(r, 92) if len(r) > 5 else 0
    sm = np.array([prof[[(k + j) % bins for j in range(-2, 3)]].mean() for k in range(bins)])
    cand = [k for k in range(bins) if sm[k] > 0 and sm[k] >= sm[k - 1] and sm[k] >= sm[(k + 1) % bins]]
    cand.sort(key=lambda k: -sm[k])
    sep = min_sep_deg / 360 * bins
    sel = []
    for k in cand:
        if all(min(abs(k - s), bins - abs(k - s)) >= sep for s in sel):
            sel.append(k)
    return sorted((k + 0.5) / bins * 2 * math.pi - math.pi for k in sel)


# ---- v3. Spikes and clumps ---------------------------------------------------------
#
# Plants that aren't one stem carrying one bloom: a spike of florets up a stem
# (`--mode spike`, a delphinium), or a bush growing from one crown (`--mode
# clump`, a chrysanthemum, a shrub). Flowers are found by colour, from the
# base-colour texture: each cluster becomes a `bloom_N` bone, pivot where it
# meets its stalk, +Y out through the flower. Foliage hangs on `branch_N_K`
# chains: sectors fanning out from the crown (a clump, or a spike's basal
# fan), or one bone per leaf up a spike's stem. A short trunk (stem_0…) runs
# up the middle, and a weightless `head` marks the top (the halo sits on it).
# Weights are continuous fields (angle, distance), so nothing tears.


def vertex_colours(obj):
    """Each vertex's base colour (sRGB, 0..1), sampled from the base-colour
    texture at its UVs (averaged over its loops)."""
    me = obj.data
    img = None
    for m in me.materials:
        if m and m.node_tree:
            for link in m.node_tree.links:
                if link.to_socket.name == "Base Color" and link.from_node.type == "TEX_IMAGE":
                    img = link.from_node.image
    n = len(me.vertices)
    if img is None or not me.uv_layers:
        return np.full((n, 3), 0.5)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)[:, :, :3]
    nl = len(me.loops)
    uv = np.empty(nl * 2)
    me.uv_layers.active.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    lv = np.empty(nl, dtype=np.int64)
    me.loops.foreach_get("vertex_index", lv)
    x = np.clip((uv[:, 0] % 1.0) * w, 0, w - 1).astype(int)
    y = np.clip((uv[:, 1] % 1.0) * h, 0, h - 1).astype(int)
    out, cnt = np.zeros((n, 3)), np.zeros(n)
    np.add.at(out, lv, px[y, x])
    np.add.at(cnt, lv, 1)
    return out / np.maximum(cnt, 1)[:, None]


def hsv(c):
    mx, mn = c.max(1), c.min(1)
    d = mx - mn
    r, g, b = c[:, 0], c[:, 1], c[:, 2]
    hue = np.where(mx == r, (g - b) / np.maximum(d, 1e-9) % 6, np.where(mx == g, (b - r) / np.maximum(d, 1e-9) + 2, (r - g) / np.maximum(d, 1e-9) + 4))
    return hue * 60.0, d / np.maximum(mx, 1e-9), mx


def shape_field(sp, h, radius):
    """Untextured models: flowers by shape. Round each surface sample, the
    spread of its neighbours: a stalk is a line, a leaf a sheet, a flower (a
    cup, a ruffle of petals) fills all three directions (smallest over
    largest spread, 0 … 1). Kept on a voxel grid, so any point (a vertex
    before or after decimation) can look it up."""
    from mathutils.kdtree import KDTree

    kd = KDTree(len(sp))
    for i, p in enumerate(sp):
        kd.insert(Vector(p), i)
    kd.balance()
    r = radius * h
    val = np.zeros(len(sp))
    flat = np.zeros(len(sp))
    for i, p in enumerate(sp):
        idx = [j for _, j, _ in kd.find_range(Vector(p), r)]
        if len(idx) < 8:
            continue
        q = sp[idx]
        ev = np.linalg.eigvalsh(np.cov((q - q.mean(0)).T))
        val[i] = ev[0] / max(ev[2], 1e-12)
        flat[i] = ev[1] / max(ev[2], 1e-12)
    vox = r / 2
    keys = np.floor(sp / vox).astype(np.int64)
    flat = (keys[:, 0] * 73856093) ^ (keys[:, 1] * 19349663) ^ (keys[:, 2] * 83492791)
    uk, inv = np.unique(flat, return_inverse=True)
    cnt = np.bincount(inv)
    mean = np.bincount(inv, val) / cnt
    mean_flat = np.bincount(inv, flat) / cnt
    if DEBUG:
        print("AUTORIG-SHAPE", np.round(np.percentile(val, [10, 25, 50, 75, 90, 95]), 4).tolist())

    def at(pts, sheet=False):
        """3D-ness (flowers high), or with `sheet`, 2D-ness (a leaf blade
        high, a stalk low)."""
        k = np.floor(pts / vox).astype(np.int64)
        f = (k[:, 0] * 73856093) ^ (k[:, 1] * 19349663) ^ (k[:, 2] * 83492791)
        j = np.clip(np.searchsorted(uk, f), 0, len(uk) - 1)
        return np.where(uk[j] == f, (mean_flat if sheet else mean)[j], 0.0)

    return at


def roundness(obj, radius):
    """How round the surface is round each vertex, by the spread of its
    neighbours' normals: on a sheet they agree, on a stalk (a tube, however
    curved) they turn round its axis only, on a flower's cup they point every
    way (smallest spread over largest, 0 … 1). Tells a stalk running through
    a cluster of bells from the bells, where the shape test blurs them."""
    from mathutils.kdtree import KDTree

    co = verts(obj)
    n = len(co)
    nm = np.zeros(n * 3)
    obj.data.vertices.foreach_get("normal", nm)
    nm = nm.reshape(-1, 3)
    kd = KDTree(n)
    for i, p in enumerate(co):
        kd.insert(Vector(p), i)
    kd.balance()
    r = radius * float(np.ptp(co[:, 2]))
    out = np.zeros(n)
    for i in range(n):
        idx = [j for _, j, _ in kd.find_range(Vector(co[i]), r)]
        if len(idx) < 6:
            continue
        q = nm[idx]
        ev = np.linalg.eigvalsh(q.T @ q / len(q))
        out[i] = ev[0] / max(ev[2], 1e-9)
    return out


def bloom_mask(col, spec, sat_min, val_min):
    hue, sat, val = hsv(col)
    if spec == "white":
        # Cream counts: generated white flowers are rarely pure white.
        return (sat < max(0.25, sat_min)) & (val > max(0.55, val_min))
    _, h0, wd = spec.split(":")
    dh = np.abs((hue - float(h0) + 180) % 360 - 180)
    return (dh < float(wd)) & (sat > sat_min) & (val > val_min)


def mesh_edges(obj):
    me = obj.data
    e = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get("vertices", e)
    return e.reshape(-1, 2)


def majority(mask, E, iters=2):
    """Clean a per-vertex mask: each vertex takes its neighbourhood's vote."""
    m = mask.astype(float)
    for _ in range(iters):
        s, c = m.copy(), np.ones(len(m))
        np.add.at(s, E[:, 0], m[E[:, 1]])
        np.add.at(s, E[:, 1], m[E[:, 0]])
        np.add.at(c, E[:, 0], 1)
        np.add.at(c, E[:, 1], 1)
        m = s / c
    return m > 0.5


def components(keep, E):
    """Connected parts of the vertices in `keep` (a label per vertex, -1 outside)."""
    lab = np.arange(len(keep))
    e = E[keep[E[:, 0]] & keep[E[:, 1]]]
    while True:
        m = np.minimum(lab[e[:, 0]], lab[e[:, 1]])
        new = lab.copy()
        np.minimum.at(new, e[:, 0], m)
        np.minimum.at(new, e[:, 1], m)
        new = new[new]
        if (new == lab).all():
            return np.where(keep, lab, -1)
        lab = new


def shrink_leaves(obj, spec):
    """Broad leaves that tower over the flowers (a lily of the valley's): find
    them, cut them free and shrink them toward their base, LEN in height and
    WIDE across, so they stay whole blades. A leaf is a big smooth sheet;
    a stalk is a thin tube and a flower all curves, so they bend too much."""
    import bmesh

    ln, wd = (float(x) for x in spec.split(":"))
    co = verts(obj)
    n = len(co)
    h = float(np.ptp(co[:, 2]))
    nm = np.zeros(n * 3)
    obj.data.vertices.foreach_get("normal", nm)
    nm = nm.reshape(-1, 3)
    E = mesh_edges(obj)
    bend = np.linalg.norm(nm[E[:, 0]] - nm[E[:, 1]], axis=1) / np.maximum(np.linalg.norm(co[E[:, 0]] - co[E[:, 1]], axis=1), 1e-9)
    deg = np.maximum(np.bincount(E[:, 0], None, n) + np.bincount(E[:, 1], None, n), 1)
    bend = (np.bincount(E[:, 0], bend, n) + np.bincount(E[:, 1], bend, n)) / deg
    lab = components(bend * h < 17, E)
    u, c = np.unique(lab[lab >= 0], return_counts=True)
    leaf = np.isin(lab, u[c > 0.0015 * n])
    # Out over the rims (too sharp to pass) to the whole blade.
    for _ in range(10):
        g = leaf.copy()
        g[E[:, 1][leaf[E[:, 0]]]] = True
        g[E[:, 0][leaf[E[:, 1]]]] = True
        leaf = g
    # Scraps the growth cut off (a tip, a strip of rim) go with their leaf.
    lab = components(~leaf, E)
    u, c = np.unique(lab[lab >= 0], return_counts=True)
    leaf |= np.isin(lab, u[c < 0.003 * n])
    # Cut free, so moving them stretches nothing.
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    on = bm.faces.layers.int.new("_leaf")
    for f in bm.faces:
        f[on] = int(all(leaf[v.index] for v in f.verts))
    # (Corners they share with a stalk, too, not only edges.)
    bmesh.ops.split(bm, geom=[f for f in bm.faces if f[on]])
    bm.verts.index_update()
    co = np.array([v.co[:] for v in bm.verts])
    leaf = np.zeros(len(co), bool)
    for f in bm.faces:
        if f[on]:
            leaf[[v.index for v in f.verts]] = True
    # Two leaves can be one piece, one wrapped round the other, so all of
    # them shrink as one about their base, height more than width: they
    # lean out a little more, and nothing tears.
    p = co[leaf]
    base = p[p[:, 2] < np.percentile(p[:, 2], 3)].mean(0)
    co[leaf] = base + (p - base) * np.array([wd, wd, ln])
    if DEBUG:
        print("AUTORIG-LEAVES", int(leaf.sum()), "verts, top", np.round(p[:, 2].max(), 2), "->", np.round(co[leaf, 2].max(), 2))
    for v in bm.verts:
        v.co = co[v.index]
    bm.faces.layers.int.remove(on)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    # Marked: shrunk, a blade's two faces are close enough to look as round
    # as a flower to the shape test.
    obj.vertex_groups.new(name="_leaf").add([int(i) for i in np.nonzero(leaf)[0]], 1.0, "REPLACE")


def kmeans(p, k, iters=20):
    # Farthest-point start, so a long spike splits along its length.
    c = [p[0]]
    for _ in range(k - 1):
        d = np.min([np.linalg.norm(p - x, axis=1) for x in c], axis=0)
        c.append(p[d.argmax()])
    c = np.array(c)
    for _ in range(iters):
        lab = np.linalg.norm(p[:, None] - c[None], axis=2).argmin(1)
        c = np.array([p[lab == j].mean(0) if (lab == j).any() else c[j] for j in range(k)])
    return lab


def find_blooms(co, mask, h, args):
    """Clusters of flower-coloured vertices, big ones split, at most
    `blooms_max` (the smallest are dropped and stay on their branch)."""
    groups = find_leaves(co, mask, h, vox=0.012, min_n=args.bloom_min)
    size = args.bloom_size * h
    out = []
    for g in groups:
        p = co[g]
        c = p.mean(0)
        span = 2 * float(np.percentile(np.linalg.norm(p - c, axis=1), 90))
        k = int(min(12, max(1, round((span / size) ** 2))))
        if k > 1 and len(g) >= 2 * k * args.bloom_min:
            lab = kmeans(p, k)
            out += [g[lab == j] for j in range(k) if (lab == j).sum() >= args.bloom_min]
        else:
            out.append(g)
    # A leaf can share the flowers' colour (Meshy paints them so): a flower
    # is crumpled, a leaf is a flat blade.
    kept = []
    for g in out:
        p = co[g]
        ev = np.linalg.eigvalsh(np.cov((p - p.mean(0)).T))
        flat = ev[0] / max(ev[2], 1e-12)
        if DEBUG:
            print("AUTORIG-BLOOM", len(g), np.round(p.mean(0), 3).tolist(), round(float(flat), 4))
        if flat >= args.bloom_flat:
            kept.append(g)
    kept.sort(key=len, reverse=True)
    return kept[: args.blooms_max]


def sector_weights(phi, centres):
    """Angular interpolation between neighbouring sector centres (sorted)."""
    S = len(centres)
    W = np.zeros((len(phi), S))
    if S == 1:
        W[:] = 1
        return W
    ext = np.concatenate([centres, [centres[0] + 2 * math.pi]])
    x = (phi - centres[0]) % (2 * math.pi) + centres[0]
    k = np.clip(np.searchsorted(ext, x, side="right") - 1, 0, S - 1)
    f = (x - ext[k]) / (ext[k + 1] - ext[k])
    f = f * f * (3 - 2 * f)
    W[np.arange(len(phi)), k] = 1 - f
    W[np.arange(len(phi)), (k + 1) % S] += f
    return W


def rig_plant(args):
    obj = load_mesh(args.inp, [d.strip().lower() for d in args.drop.split(",") if d.strip()])
    if args.cut_below > 0:
        import bmesh

        bm = bmesh.new()
        bm.from_mesh(obj.data)
        zs = np.array([v.co.z for v in bm.verts])
        hh = float(np.ptp(zs))
        cut = zs.min() + args.cut_below * hh
        ring_z, ring_r = (float(x) for x in args.cut_ring.split(":")) if args.cut_ring else (0.0, 0.0)
        ring_z = zs.min() + ring_z * hh

        def gone(v):
            return v.co.z < cut or (v.co.z < ring_z and math.hypot(v.co.x, v.co.y) > ring_r * hh)

        bmesh.ops.delete(bm, geom=[v for v in bm.verts if gone(v)], context="VERTS")
        bm.to_mesh(obj.data)
        bm.free()
        # Stand what's left on the origin again.
        co = verts(obj)
        z0 = co[:, 2].min()
        low = co[co[:, 2] < z0 + 0.03 * np.ptp(co[:, 2])]
        obj.data.transform(Matrix.Translation((-float(np.median(low[:, 0])), -float(np.median(low[:, 1])), -float(z0))))
        obj.data.update()
    if args.cut_pot:
        import bmesh

        pz, pr = (float(x) for x in args.cut_pot.split(":"))
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        zs = np.array([v.co.z for v in bm.verts])
        hh = float(np.ptp(zs))
        rim = zs.min() + pz * hh
        gone = [v for v in bm.verts if v.co.z < rim and math.hypot(v.co.x, v.co.y) < pr * hh]
        bmesh.ops.delete(bm, geom=gone, context="VERTS")
        bm.to_mesh(obj.data)
        bm.free()
        # The rim is the soil now (leaves hanging over it go below).
        obj.data.transform(Matrix.Translation((0, 0, -float(rim))))
        obj.data.update()
    if args.upright > 0:
        # Turn about the base so the plant's middle moves over it.
        co = verts(obj)
        mid = co.mean(0)
        tilt = Vector(mid.tolist()).normalized().rotation_difference(Vector((0, 0, 1)))
        tilt = Quaternion().slerp(tilt, args.upright)
        obj.data.transform(tilt.to_matrix().to_4x4())
        co = verts(obj)
        z0 = co[:, 2].min()
        low = co[co[:, 2] < z0 + 0.03 * np.ptp(co[:, 2])]
        obj.data.transform(Matrix.Translation((-float(np.median(low[:, 0])), -float(np.median(low[:, 1])), -float(z0))))
        obj.data.update()
    tris_in = triangles(obj)
    # Generated meshes can come as loose triangles: weld coincident vertices
    # first (UVs live on loops and survive), or decimation can't collapse
    # anything and the file stays big.
    import bmesh

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6 * float(np.ptp(verts(obj)[:, 2])))
    bm.to_mesh(obj.data)
    bm.free()
    if args.shrink_leaves:
        shrink_leaves(obj, args.shrink_leaves)
    col = vertex_colours(obj)
    shape = None
    if args.bloom.startswith("shape"):
        _, rad_, th_ = args.bloom.split(":")
        shape = shape_field(surface_samples(obj, 120000), float(np.ptp(verts(obj)[:, 2])), float(rad_))
    if args.decimate and tris_in > args.decimate and shape is not None:
        # Thin stalks vanish under heavy decimation and leave the flowers
        # floating, and small flowers turn to mush: everything else (leaves,
        # the bulk) takes most of the cut, flowers some, stalks least.
        f = shape(verts(obj))
        vg = obj.vertex_groups.new(name="_decimate")
        wgt = np.where(f > float(th_), args.decimate_flowers, np.where(f > 0.6 * float(th_), 1.0, 0.04))
        for wv in np.unique(wgt):
            vg.add([int(i) for i in np.nonzero(wgt == wv)[0]], float(wv), "REPLACE")
        decimate(obj, args.decimate / tris_in, vg.name)
        obj.vertex_groups.remove(obj.vertex_groups["_decimate"])
        print("AUTORIG-DECIMATE", tris_in, "->", triangles(obj))
        col = vertex_colours(obj)
    elif args.decimate and tris_in > args.decimate:
        # Small flowers would collapse first: decimate the rest.
        keep = majority(bloom_mask(col, args.bloom, args.bloom_sat, args.bloom_val), mesh_edges(obj), 1) if args.bloom and args.keep_blooms else np.zeros(len(col), bool)
        vg = obj.vertex_groups.new(name="_decimate")
        # (Only the group's vertices collapse.)
        vg.add([int(i) for i in np.nonzero(~keep)[0]], 1.0, "REPLACE")
        decimate(obj, args.decimate / tris_in, vg.name)
        obj.vertex_groups.remove(obj.vertex_groups["_decimate"])
        print("AUTORIG-DECIMATE", tris_in, "->", triangles(obj))
        col = vertex_colours(obj)
    blade = np.zeros(len(obj.data.vertices), bool)
    if "_leaf" in obj.vertex_groups:
        gi = obj.vertex_groups["_leaf"].index
        for v in obj.data.vertices:
            blade[v.index] = any(g.group == gi and g.weight > 0.5 for g in v.groups)
        obj.vertex_groups.remove(obj.vertex_groups["_leaf"])
    # Smooth shading without the import's custom normals: either would split
    # vertices in the GLB.
    bpy.context.view_layer.objects.active = obj
    if obj.data.has_custom_normals:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    obj.data.shade_smooth()
    if args.texture:
        shrink_textures(args.texture)
        drop_unused_maps(args.drop_normal)
    co = verts(obj)
    n = len(co)
    sp = surface_samples(obj)
    h = float(co[:, 2].max())
    E = mesh_edges(obj)
    spike = args.mode == "spike"

    # The trunk: up the whole spike, or the middle of a clump.
    top_z = (0.97 if spike else args.head if args.head > 0 else 0.5) * h
    path, rs = trace_stem(sp, top_z)
    rs = min(rs, 0.02 * h)
    stem_pts = resample(path, args.stem)
    d_stem, s_stem = closest_on_polyline(co, stem_pts)
    core = 1 - smooth(1.6 * rs, 3 * rs + 0.03 * h, d_stem)
    # The trunk's top: a clump's centre column above it is foliage, not trunk.
    core = core * (1 - smooth(top_z, top_z + 0.04 * h, co[:, 2]))
    core = np.maximum(core, 1 - smooth(0.03 * h, 0.1 * h, co[:, 2]))

    # Blooms, by colour.
    if shape is not None:
        # (Round, too: a stalk among the bells isn't one, however blurred.
        # Where a bell's stem joins it the stalk can look round in spots:
        # smoothed, it doesn't, though a bell's dome then looks like a tube
        # too, so that only picks where flowers are, not what they hold.)
        tube = roundness(obj, 0.8 * float(rad_)) < 0.08 if args.stalks else np.zeros(n, bool)
        mask = majority((shape(co) > float(th_)) & ~majority(tube, E, 4), E)
    else:
        mask = majority(bloom_mask(col, args.bloom, args.bloom_sat, args.bloom_val), E) if args.bloom else np.zeros(n, bool)
    mask &= (co[:, 2] > args.bloom_above * h) & ~blade
    clusters = find_blooms(co, mask, h, args)
    owner = np.full(n, -1)
    score = np.full(n, np.inf)
    hue, sat, _ = hsv(col)
    green = (hue > 85) & (hue < 170) & (sat > 0.25)
    if shape is not None:
        # Untextured: what is shaped like a stalk (a line) or a leaf blade (a
        # sheet, unless petals are flat too) stays one.
        green |= (shape(co) < 0.6 * float(th_)) & (shape(co, sheet=True) < 0.35)
        if not args.flat_petals:
            leafy = (shape(co, sheet=True) > 0.35) & (shape(co) < float(th_))
            green |= leafy
        green |= tube
    green |= blade
    blooms = []
    for k, g in enumerate(clusters):
        p = co[g]
        c = p.mean(0)
        r = max(float(np.percentile(np.linalg.norm(p - c, axis=1), 85)), 0.01 * h)
        # Whatever sits inside the flower goes with it (a heart that isn't
        # the petals' colour), but not the stem it rests on.
        d = np.linalg.norm(co - c, axis=1) / r
        take = (d < 1.05) & (core < 0.5) & ~green & (d < score)
        owner[take], score[take] = k, d[take]
        owner[g], score[g] = k, 0
        if spike:
            dd, ss = closest_on_polyline(c[None], stem_pts)
            anchor = np.array([np.interp(ss[0], np.linspace(0, 1, len(stem_pts)), stem_pts[:, j]) for j in range(3)])
        else:
            anchor = np.array([0.0, 0.0, 0.35 * c[2]])
        blooms.append({"c": c, "r": r, "anchor": anchor})
    # Stray flower-coloured bits (a petal the clustering missed) join the
    # nearest flower, so none is left standing when the flowers shrink.
    # (The flower of the nearest vertex already in one, not the nearest
    # centre: a big head's centre would claim its small neighbour's petals.)
    if blooms:
        from mathutils.kdtree import KDTree

        own_i = np.nonzero(owner >= 0)[0]
        kd = KDTree(len(own_i))
        for j, i in enumerate(own_i):
            kd.insert(Vector(co[i]), j)
        kd.balance()
        for i in np.nonzero(mask & (owner < 0))[0]:
            _, j, dist = kd.find(Vector(co[i]))
            if j is not None and dist < 0.05 * h:
                owner[i] = owner[own_i[j]]
    # Petal rims whose colour missed the test (a dark edge, a pale tip)
    # belong to the flower they fringe: grow each flower over what it
    # touches that no flower has, a few rings out, but not onto the trunk
    # or a stalk. Left out, the rim would stay put as the flower shrinks.
    # (Only within the flower's own reach: a pale stalk would carry it away.)
    if blooms:
        free = (core < 0.5) & ~green
        if args.stalks:
            # Over the whole flower (a bell's dome looks like a leaf to the
            # shape test), stopped by the stalks and leaves.
            free = (core < 0.5) & ~tube & ~blade
        cs = np.array([b["c"] for b in blooms])
        rs_ = np.array([b["r"] for b in blooms])
        rings, reach = (float(x) for x in args.bloom_grow.split(":"))
        for _ in range(int(rings)):
            a_, b_ = E[:, 0], E[:, 1]
            for x, y in ((a_, b_), (b_, a_)):
                grow = (owner[x] >= 0) & (owner[y] < 0) & free[y]
                k = owner[x[grow]]
                near = np.linalg.norm(co[y[grow]] - cs[k], axis=1) < reach * rs_[k]
                owner[y[grow][near]] = k[near]
        # Fill the holes it leaves: a vertex most of whose neighbours are one
        # flower's joins it (a speckled petal reads as noise).
        for _ in range(4):
            a_, b_ = E[:, 0], E[:, 1]
            deg = np.bincount(a_, minlength=n) + np.bincount(b_, minlength=n)
            owned = np.bincount(a_, weights=(owner[b_] >= 0), minlength=n) + np.bincount(b_, weights=(owner[a_] >= 0), minlength=n)
            any_k = np.full(n, -1)
            np.maximum.at(any_k, a_, owner[b_])
            np.maximum.at(any_k, b_, owner[a_])
            fill = (owner < 0) & (core < 0.5) & (owned >= 0.5 * np.maximum(deg, 1)) & (any_k >= 0)
            owner[fill] = any_k[fill]
            if DEBUG:
                print("AUTORIG-FILL", int(fill.sum()), "owned", int((owner >= 0).sum()))

    # Pivots: where the stalk joins. Of the flower's edge vertices (an edge
    # out to something that isn't a flower), the ones nearest the anchor
    # (the stem, or low in the middle of a clump). +Y out through the flower.
    edge_v = np.zeros(n, bool)
    a_, b_ = E[:, 0], E[:, 1]
    cross = (owner[a_] >= 0) & (owner[b_] < 0)
    edge_v[a_[cross]] = True
    cross = (owner[b_] >= 0) & (owner[a_] < 0)
    edge_v[b_[cross]] = True
    for k, b in enumerate(blooms):
        own = np.nonzero(owner == k)[0]
        if not len(own):
            b["pivot"], b["axis"] = b["c"], np.array([0.0, 0.0, 1.0])
            continue
        rim = own[edge_v[own]]
        cand = co[rim] if len(rim) >= 3 else co[own]
        da = np.linalg.norm(cand - b["anchor"], axis=1)
        pivot = cand[np.argsort(da)[: max(3, len(cand) // 10)]].mean(0)
        axis = b["c"] - pivot
        if np.linalg.norm(axis) < 0.3 * b["r"]:
            axis = b["c"] - b["anchor"]
        b["pivot"], b["axis"] = pivot, axis / max(np.linalg.norm(axis), 1e-9)

    # Foliage: crown sectors (a clump, or a spike's basal fan), and on a
    # spike one bone per leaf above the fan.
    off = 1 - core
    phi = np.arctan2(co[:, 1], co[:, 0])
    rho = np.linalg.norm(co[:, :2], axis=1)
    reach = np.linalg.norm(co, axis=1)
    fan = (co[:, 2] < args.grass * h) if spike else np.ones(n, bool)
    fan_w = (1 - smooth(args.grass * h * 0.8, args.grass * h * 1.1, co[:, 2])) if spike else np.ones(n)
    crown = stem_pts[0] + (stem_pts[1] - stem_pts[0]) * 0.5
    pick = fan & (off > 0.5) & (rho > 0.02 * h)
    centres, chains = [], []
    S = args.sectors
    for s in range(S):
        a = 2 * math.pi * s / S - math.pi
        dphi = np.abs((phi - a + math.pi) % (2 * math.pi) - math.pi)
        m = pick & (dphi < math.pi / S)
        if m.sum() < 40:
            continue
        q = np.percentile(reach[m], np.linspace(0, 95, args.branch_bones + 1))
        pts = [crown]
        for b in range(args.branch_bones):
            band = m & (reach >= q[b]) & (reach <= q[b + 1] + 1e-9)
            pts.append(co[band].mean(0) if band.sum() >= 5 else pts[-1] + (pts[-1] - crown) * 0.5)
        # The outermost joint at the sector's reach, so the chain spans it.
        far = co[m & (reach >= np.percentile(reach[m], 90))].mean(0)
        pts[-1] = far
        centres.append(a)
        chains.append({"pts": pts, "rmax": float(q[-1])})
    W = {}

    def w(name):
        return W.setdefault(name, np.zeros(n))

    # Trunk weights, blended between neighbouring bones as in step 5.
    x = np.clip(s_stem * args.stem, 0, args.stem - 1e-6)
    i0 = np.floor(x).astype(int)
    f = x - i0
    blend = smooth(0.7, 1.0, f)
    for i in range(args.stem):
        w(f"stem_{i}")[:] += np.where(i0 == i, 1 - blend * (i < args.stem - 1), 0)
        if i > 0:
            w(f"stem_{i}")[:] += np.where(i0 == i - 1, blend, 0)
    branch_bones = []  # (name, head, tail, parent)
    # Near the middle a vertex's angle is noise: neighbours would land in
    # opposite sectors and tear apart as they sag. The middle stays with the
    # trunk (whose weights, above its top, are all on its last bone).
    centre = 1 - smooth(0.03 * h, 0.14 * h, rho)
    sector_share = off * fan_w * (1 - centre)
    if chains:
        SW = sector_weights(phi, np.array(centres))
        for s, ch in enumerate(chains):
            B = len(ch["pts"]) - 1
            t = np.clip(reach / max(ch["rmax"], 1e-9), 0, 1) * B
            t = np.clip(t - 0.35, 0, B - 1e-6)
            j0 = np.floor(t).astype(int)
            bl = smooth(0.6, 1.0, t - j0)
            for b in range(B):
                wb = np.where(j0 == b, 1 - bl * (b < B - 1), 0) + (np.where(j0 == b - 1, bl, 0) if b > 0 else 0)
                w(f"branch_{s}_{b}")[:] += wb * SW[:, s] * sector_share
                branch_bones.append((f"branch_{s}_{b}", ch["pts"][b], ch["pts"][b + 1], f"stem_0" if b == 0 else f"branch_{s}_{b - 1}"))
    else:
        sector_share = np.zeros(n)
    leaf_share = off * (1 - fan_w) if spike else np.zeros(n)
    nb = len(chains)
    if spike:
        foliage = (leaf_share > 0.5) & (owner < 0)
        sp_d, _ = closest_on_polyline(sp, stem_pts)
        groups = find_leaves(co, foliage, h, vox=0.012, min_n=30)
        for g in groups:
            p = co[g]
            dg, sg = closest_on_polyline(p, stem_pts)
            near = p[np.argsort(dg)[: max(3, len(p) // 15)]]
            _, sa = closest_on_polyline(near.mean(0)[None], stem_pts)
            u = np.linspace(0, 1, len(stem_pts))
            attach = np.array([np.interp(sa[0], u, stem_pts[:, j]) for j in range(3)])
            dist = np.linalg.norm(p - attach, axis=1)
            tip = p[np.argsort(dist)[-max(3, len(p) // 10) :]].mean(0)
            L = float(np.linalg.norm(tip - attach))
            if L < 0.03 * h:
                continue
            ax = (tip - attach) / L
            # The whole off-stem neighbourhood of this leaf ramps onto it.
            dd = np.linalg.norm(co - (attach + tip) / 2, axis=1)
            near_v = (dd < 0.6 * L) & (leaf_share > 0.05)
            along = ((co - attach) @ ax) / L
            wl = np.where(near_v, smooth(0.0, 0.25, along) * leaf_share, 0)
            name = f"branch_{nb}_0"
            parent = f"stem_{min(args.stem - 1, int(sa[0] * args.stem))}"
            w(name)[:] = wl
            branch_bones.append((name, attach, tip, parent))
            nb += 1
    # The trunk keeps what the branches don't take.
    taken = sum((W[k] for k in W if k.startswith("branch_")), np.zeros(n))
    for i in range(args.stem):
        W[f"stem_{i}"] *= np.clip(1 - taken, 0, 1)

    # Blooms override whatever they sit on.
    bloom_bones = []
    for k, b in enumerate(blooms):
        idx = np.nonzero(owner == k)[0]
        if len(idx) < args.bloom_min:
            continue
        # The whole flower shrinks into its bud, petals hanging below the
        # pivot too (they'd stand out as a cone).
        f = np.zeros(n)
        f[idx] = 1.0
        # Feather the edge over a few rings of the mesh: a hard edge would
        # stretch the faces across it into webs as the flower shrinks to a
        # bud. The stalk narrows into the bud instead.
        inside = f.copy()
        for _ in range(4):
            acc, cnt = f.copy(), np.ones(n)
            np.add.at(acc, E[:, 0], f[E[:, 1]])
            np.add.at(acc, E[:, 1], f[E[:, 0]])
            np.add.at(cnt, E[:, 0], 1)
            np.add.at(cnt, E[:, 1], 1)
            f = np.maximum(acc / cnt, inside)
        f[core > 0.5] = np.minimum(f[core > 0.5], inside[core > 0.5])
        # Only around the pivot, where the stalk joins; elsewhere the edge
        # is cut (below), or faces between neighbours would stretch.
        far = np.linalg.norm(co - b["pivot"], axis=1) > 0.6 * b["r"]
        f[far] = inside[far]
        # Never into another flower: two heads that nod apart would tear.
        f[(owner >= 0) & (owner != k)] = 0
        idx = np.nonzero(f > 0.001)[0]
        wb = f[idx]
        # The bone this flower hangs from: the strongest one just under it.
        dp = np.linalg.norm(co - b["pivot"], axis=1)
        under = np.nonzero((owner != k) & (dp < 2 * b["r"]))[0]
        if not len(under):
            under = np.argsort(dp)[:20]
        names = list(W)
        tot = np.array([0.0 if nm.startswith("bloom") else W[nm][under].sum() for nm in names])
        parent = names[int(tot.argmax())]
        for nm in names:
            W[nm][idx] *= 1 - wb
        name = f"bloom_{len(bloom_bones)}"
        w(name)[idx] = wb
        bloom_bones.append((name, b["pivot"], b["pivot"] + b["axis"] * max(1.6 * b["r"], 0.02 * h), parent))

    # Armature.
    arm_data = bpy.data.armatures.new("rig")
    arm = bpy.data.objects.new("rig", arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_data.edit_bones
    stems = []
    for i in range(args.stem):
        b = eb.new(f"stem_{i}")
        b.head, b.tail = Vector(stem_pts[i]), Vector(stem_pts[i + 1])
        if stems:
            b.parent, b.use_connect = stems[-1], True
        stems.append(b)
    hb = eb.new("head")
    hb.head = Vector(stem_pts[-1])
    hb.tail = Vector(stem_pts[-1] + np.array([0, 0, 0.05 * h]))
    hb.parent = stems[-1]
    for name, a, t, parent in branch_bones + bloom_bones:
        b = eb.new(name)
        b.head, b.tail = Vector(a), Vector(t)
        if (b.tail - b.head).length < 1e-4:
            b.tail = b.head + Vector((0, 0, 0.01 * h))
    for name, a, t, parent in branch_bones + bloom_bones:
        eb[name].parent = eb[parent]
        m = re.fullmatch(r"branch_(\d+)_(\d+)", name)
        eb[name].use_connect = bool(m and int(m.group(2)) > 0)
    bpy.ops.object.mode_set(mode="OBJECT")

    total = sum(W.values())
    total[total == 0] = 1
    for nm, wv in W.items():
        vg = obj.vertex_groups.new(name=nm)
        wv = wv / total
        for i in np.nonzero(wv > 0.001)[0]:
            vg.add([int(i)], float(wv[i]), "REPLACE")
    if args.paint:
        paint(obj, args.paint, co, owner, blooms, n)

    # Generated flowers are fused to their neighbours by small faces (two
    # heads touching at the petals). They shrink into buds and nod apart, so
    # such a face would stretch into a fin between them. Each is detached
    # (its own copies of its corners) and given wholly to the flower that
    # holds most of it: no fin, and no hole in the petal rim.
    bnames = [nm for nm in W if nm.startswith("bloom")]
    if bnames:
        import bmesh

        B = np.stack([W[nm] / total for nm in bnames], axis=1)
        dom = np.where(B.max(1) > 0.5, B.argmax(1), -1)
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bm.faces.ensure_lookup_table()
        dl = bm.verts.layers.deform.active
        bridges = []
        for f in bm.faces:
            ds = [int(dom[v.index]) for v in f.verts]
            if len(set(ds) - {-1}) > 1:
                keep = max(set(ds) - {-1}, key=ds.count)
                donor = f.verts[ds.index(keep)]
                bridges.append((f, dict(donor[dl].items())))
        for f, weights in bridges:
            out = bmesh.ops.split(bm, geom=[f])
            for v in [g for g in out["geom"] if isinstance(g, bmesh.types.BMVert)]:
                d = v[dl]
                d.clear()
                for gi, wv in weights.items():
                    d[gi] = wv
        bm.to_mesh(obj.data)
        bm.free()
        print("AUTORIG-SEAMS detached", len(bridges), "faces joining two flowers")
    obj.parent = arm
    mod = obj.modifiers.new("rig", "ARMATURE")
    mod.object = arm
    export(args)
    print(
        "AUTORIG "
        + json.dumps(
            {
                "mode": args.mode,
                "verts": int(n),
                "tris_in": int(tris_in),
                "tris_out": triangles(obj),
                "height": round(h, 4),
                "stem_radius": round(float(rs), 4),
                "bloom_verts": int(mask.sum()),
                "blooms": len(bloom_bones),
                "bloom_owned": int((owner >= 0).sum()),
                "sectors": len(chains),
                "branches": nb,
                "out": args.out,
            }
        )
    )


def paint(obj, spec, co, owner, blooms, n):
    """Bake vertex colours into an untextured model, from what the rig found:
    leaves and stalks one green, each flower from its `base` colour (round
    the pivot, where a bell meets its stalk), through `petal` to `edge`,
    with a `heart` round its centre. The watercolour maps them like a
    texture's colours."""
    def lin(hexc):
        c = np.array([int(hexc[i : i + 2], 16) / 255 for i in (1, 3, 5)])
        return c**2.2

    opts = {}
    for part in spec.split(","):
        k, v = part.split("=")
        hexc, *share = v.split(":")
        opts[k] = (lin(hexc), float(share[0]) if share else 0.0)
    col = np.tile(opts["leaf"][0], (n, 1))
    for k, b in enumerate(blooms):
        idx = np.nonzero(owner == k)[0]
        if not len(idx) or "pivot" not in b:
            continue
        p = co[idx]
        t = np.clip(np.linalg.norm(p - b["c"], axis=1) / b["r"], 0, 1)
        petal = opts["petal"][0]
        edge = opts.get("edge", opts["petal"])[0]
        c = petal + (edge - petal) * smooth(0.3, 1.0, t)[:, None]
        if "inner" in opts:
            ic, is_ = opts["inner"]
            c = c + (ic - c) * (1 - smooth(0.5 * is_, is_, t))[:, None]
        if "heart" in opts:
            hc, hs = opts["heart"]
            c = c + (hc - c) * (1 - smooth(0.6 * hs, hs, t))[:, None]
        if "base" in opts:
            bc, bs = opts["base"]
            tb = np.linalg.norm(p - b["pivot"], axis=1) / b["r"]
            c = c + (bc - c) * (1 - smooth(0.5 * bs, bs, tb))[:, None]
        col[idx] = c
    attr = obj.data.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    attr.data.foreach_set("color", np.concatenate([col, np.ones((n, 1))], 1).astype(np.float32).ravel())
    obj.data.color_attributes.active_color = attr
    # A plain material that shows them (and gives the exporter one to use).
    mat = bpy.data.materials.new("plant")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    vc = nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    mat.node_tree.links.new(vc.outputs["Color"], nodes["Principled BSDF"].inputs["Base Color"])
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def drop_unused_maps(normal=False):
    """The app drops metalness and roughness maps (models.ts fixMaterials),
    so don't ship them (nor, with `normal`, the normal map)."""
    for m in bpy.data.materials:
        if not m.node_tree:
            continue
        for link in list(m.node_tree.links):
            if link.to_socket.name in ("Metallic", "Roughness") or (normal and link.to_socket.name == "Normal"):
                m.node_tree.links.remove(link)


def export(args):
    if args.blend:
        bpy.ops.wm.save_as_mainfile(filepath=args.blend)
    bpy.ops.object.select_all(action="SELECT")
    kw = dict(filepath=args.out, export_format="GLB", use_selection=False, export_yup=True, export_skins=True)
    if args.texture:
        kw["export_image_format"] = "JPEG"
    if getattr(args, "paint", ""):
        kw["export_vertex_color"] = "ACTIVE"
    if getattr(args, "draco", False):
        kw.update(export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7)
    try:
        bpy.ops.export_scene.gltf(**kw, export_animations=False, export_apply=False)
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)


# ---- 4/5. Armature and weights ---------------------------------------------------


def main():
    args = parse_args()
    if args.mode != "flower":
        return rig_plant(args)
    obj = load_mesh(args.inp, [d.strip().lower() for d in args.drop.split(",") if d.strip()])
    tris_in = triangles(obj)
    if args.decimate and tris_in > args.decimate:
        decimate(obj, args.decimate / tris_in)
    if args.texture:
        shrink_textures(args.texture)
    co = verts(obj)
    sp = surface_samples(obj)
    h = co[:, 2].max()

    head_z = find_head_start(sp, args.head)
    path, rs = trace_stem(sp, head_z)
    stem_pts = resample(path, args.stem)

    is_head = co[:, 2] >= head_z - 0.01 * h
    d_stem, s_stem = closest_on_polyline(co, stem_pts)
    is_stem = (~is_head) & (d_stem < rs * 2.2)
    is_leaf = (~is_head) & (~is_stem)

    head_verts = co[is_head]
    head_c = head_verts.mean(0) if len(head_verts) else stem_pts[-1] + [0, 0, 0.1 * h]
    top = stem_pts[-1]
    if np.linalg.norm(head_c - top) < 0.05 * h:
        head_c = top + np.array([0, 0, 0.08 * h])
    d, u, v = basis(head_c - top)

    # Petals, in rings. A lotus (like most cup flowers) has an upright inner
    # ring and an open outer ring whose petals sit in the gaps of the inner one,
    # so the angle around the head can't tell them apart; elevation from the
    # receptacle can. Within a ring each petal is found from its tip, a peak of
    # outward reach around the circle. Each petal gets a base bone (hinge to
    # mid) and a tip bone (mid to tip), so it curls along its length.
    rel = co - head_c
    along = rel @ d
    radial = rel - along[:, None] * d
    rho = np.linalg.norm(radial, axis=1)
    rho_max = rho[is_head].max() if is_head.any() else 0.1 * h
    theta = np.arctan2(radial @ v, radial @ u)
    elev = np.degrees(np.arctan2(along, rho + 1e-9))
    core = 0.16 * rho_max
    if args.petals:
        rings = [(is_head & (rho > core), [2 * math.pi * k / args.petals - math.pi for k in range(args.petals)])]
    else:
        rings = []
        for m in (is_head & (elev <= args.ring_elev) & (rho > core), is_head & (elev > args.ring_elev) & (rho > core)):
            if m.sum() > 0.05 * max(1, is_head.sum()):
                rings.append((m, tip_peaks(theta[m], rho[m], 28)))
    petals = []  # (hinge, mid, tip, vertex mask)
    for m_ring, angs in rings:
        if not angs:
            continue
        a = np.array(angs)
        nearest = np.abs((theta[:, None] - a[None] + math.pi) % (2 * math.pi) - math.pi).argmin(1)
        for k, ang in enumerate(angs):
            m = m_ring & (nearest == k)
            if m.sum() < 30:
                continue
            base = m & (rho < 2 * core)
            lift = float(np.median(along[base])) if base.sum() >= 5 else 0.0
            hinge = head_c + (math.cos(ang) * u + math.sin(ang) * v) * core + d * lift
            dist = np.linalg.norm(co[m] - hinge, axis=1)
            tip = co[m][np.argsort(dist)[-max(3, len(dist) // 12) :]].mean(0)
            span = float(np.linalg.norm(tip - hinge))
            if span < 0.03 * h:
                continue
            band = (dist / span > 0.4) & (dist / span < 0.6)
            mid = np.median(co[m][band], axis=0) if band.sum() >= 5 else (hinge + tip) / 2
            petals.append((hinge, mid, tip, m))

    # Organs: leaves, pads and buds on their own stalks. Side stalks bundle
    # along the main stem, so a cylinder around it is cut away first; what is
    # left falls apart into one clump per organ. The stalk samples inside the
    # cylinder then join the clump they are connected to (a flood fill, so a
    # stalk goes to its own pad, not the nearest one), and every off-stem
    # vertex takes the organ of its nearest sample.
    sp_d, _ = closest_on_polyline(sp, stem_pts)
    sp_off = (sp[:, 2] < head_z - 0.01 * h) & (sp[:, 2] > 0.06 * h) & (sp_d >= rs * 2.2)
    groups = find_leaves(sp, sp_off & (sp_d > args.leaf_core * h), h, vox=0.015)
    seg = np.linalg.norm(np.diff(stem_pts, axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)]) / seg.sum()
    organs = []
    if groups:
        from mathutils.kdtree import KDTree

        gl = np.full(len(sp), -1)
        for gi, g in enumerate(groups):
            gl[g] = gi
        gl = grow_labels(sp, sp_off, gl, 0.015 * h)
        lab_s = np.nonzero(gl >= 0)[0]
        kd = KDTree(len(lab_s))
        for j, i in enumerate(lab_s):
            kd.insert(Vector(sp[i]), j)
        kd.balance()
        vlab = np.full(len(co), -1)
        for vi in np.nonzero(is_leaf)[0]:
            _, j, dist = kd.find(Vector(co[vi]))
            if j is not None and dist < 0.05 * h:
                vlab[vi] = gl[lab_s[j]]

        for gi, g in enumerate(groups):
            vg = np.nonzero(vlab == gi)[0]
            if len(vg) < 40:
                continue
            clump, allp = sp[g], sp[gl == gi]
            c = clump.mean(0)
            ev, evec = np.linalg.eigh(np.cov((clump - c).T))
            n = evec[:, 0] * (1 if evec[2, 0] >= 0 else -1)
            kind = "leaf" if ev[0] / max(ev[2], 1e-12) < args.flat else "bud"
            z0 = max(float(allp[:, 2].min()), 0.04 * h)
            s_attach = float(np.interp(z0, stem_pts[:, 2], cum))
            attach = np.array([np.interp(s_attach, cum, stem_pts[:, k]) for k in range(3)])
            if kind == "leaf":
                junction = c
            else:
                zmin, zmax = clump[:, 2].min(), clump[:, 2].max()
                span = zmax - zmin
                ring = clump[(clump[:, 2] > zmax - 0.5 * span) & (clump[:, 2] < zmax - 0.4 * span)]
                junction = np.median(ring, axis=0) if len(ring) >= 5 else c
                bud_tip = clump[np.argsort(clump[:, 2])[-max(3, len(clump) // 20) :]].mean(0)
            if np.linalg.norm(junction - attach) < 0.04 * h:
                continue
            zmid = (attach[2] + junction[2]) / 2
            line_d, _ = closest_on_polyline(allp, np.array([attach, junction]))
            near = allp[(np.abs(allp[:, 2] - zmid) < 0.04 * h) & (line_d < 0.1 * h)]
            mid = np.median(near, axis=0) if len(near) >= 5 else (attach + junction) / 2
            o = {"kind": kind, "verts": vg, "attach": attach, "s_attach": s_attach, "mid": mid, "junction": junction}
            if kind == "leaf":
                axis_pt = np.array([np.interp(c[2], stem_pts[:, 2], stem_pts[:, k]) for k in range(3)])
                e1 = (c - axis_pt) - ((c - axis_pt) @ n) * n
                e1 = e1 / max(np.linalg.norm(e1), 1e-9)
                e2 = np.cross(n, e1)
                rel_c = clump - junction
                phi_c = np.arctan2(rel_c @ e2, rel_c @ e1)
                rad_c = np.linalg.norm(rel_c - (rel_c @ n)[:, None] * n, axis=1)
                rims = []
                for k in range(args.rims):
                    phi = 2 * math.pi * k / args.rims
                    dphi = np.abs((phi_c - phi + math.pi) % (2 * math.pi) - math.pi)
                    sect = rad_c[dphi < math.pi / args.rims]
                    reach = float(np.percentile(sect, 90)) if len(sect) >= 5 else float(np.percentile(rad_c, 90))
                    rims.append((phi, reach))
                o.update(n=n, e1=e1, e2=e2, rims=rims, R=float(np.percentile(rad_c, 90)))
            else:
                o["tip"] = bud_tip
            organs.append(o)

    # Armature in edit mode.
    arm_data = bpy.data.armatures.new("rig")
    arm = bpy.data.objects.new("rig", arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_data.edit_bones

    def add_bone(name, a, b, parent=None, connect=False):
        bone = eb.new(name)
        bone.head, bone.tail = Vector(a), Vector(b)
        if parent is not None:
            bone.parent, bone.use_connect = parent, connect
        return bone

    stems = []
    for i in range(args.stem):
        stems.append(add_bone(f"stem_{i}", stem_pts[i], stem_pts[i + 1], stems[-1] if stems else None, True))
    head = add_bone("head", top, head_c + d * 0.25 * max(rho_max, 0.04 * h), stems[-1], True)

    for i, (hinge, mid, tip, _) in enumerate(petals):
        base = add_bone(f"petal_{i}", hinge, mid, head)
        add_bone(f"petal_{i}_tip", mid, tip, base, True)

    for i, o in enumerate(organs):
        parent = stems[min(args.stem - 1, int(o["s_attach"] * args.stem))]
        s0 = add_bone(f"stalk_{i}_0", o["attach"], o["mid"], parent)
        s1 = add_bone(f"stalk_{i}_1", o["mid"], o["junction"], s0, True)
        if o["kind"] == "leaf":
            j, e1, e2 = o["junction"], o["e1"], o["e2"]
            pad = add_bone(f"leaf_{i}", j, j + e1 * 0.3 * o["R"], s1)
            for k, (phi, reach) in enumerate(o["rims"]):
                e = math.cos(phi) * e1 + math.sin(phi) * e2
                add_bone(f"leaf_{i}_rim_{k}", j + e * 0.35 * reach, j + e * reach, pad)
        else:
            add_bone(f"bud_{i}", o["junction"], o["tip"], s1, True)

    bpy.ops.object.mode_set(mode="OBJECT")

    # Weights.
    n = len(co)
    W = {}

    def w(name):
        return W.setdefault(name, np.zeros(n))

    # Stem: blend between neighbouring stem bones around each joint.
    x = np.clip(s_stem * args.stem, 0, args.stem - 1e-6)
    i0 = np.floor(x).astype(int)
    f = x - i0
    blend = smooth(0.7, 1.0, f)  # last 30% of a bone hands over to the next
    st = is_stem | is_leaf
    for i in range(args.stem):
        w(f"stem_{i}")[:] += np.where(st & (i0 == i), 1 - blend * (i < args.stem - 1), 0)
        if i > 0:
            w(f"stem_{i}")[:] += np.where(st & (i0 == i - 1), blend, 0)

    # Organs: the stalk takes over from the stem just above where it leaves
    # it and blends along its two bones; the blade is the pad bone in the
    # middle and the rim bones towards the edge; a bud body is its own bone.
    for i, o in enumerate(organs):
        vg = o["verts"]
        p = co[vg]
        d_s, s_s = closest_on_polyline(p, np.array([o["attach"], o["mid"], o["junction"]]))
        own = smooth(0.0, 0.12, s_s)
        xs = np.clip(s_s * 2, 0, 2 - 1e-6)
        sb = smooth(0.7, 1.0, xs - np.floor(xs))
        st0 = np.where(xs < 1, 1 - sb, 0)
        st1 = np.where(xs < 1, sb, 1)
        if o["kind"] == "leaf":
            rel_p = p - o["junction"]
            rad = np.linalg.norm(rel_p - (rel_p @ o["n"])[:, None] * o["n"], axis=1)
            blade = (d_s > 3 * rs) | (s_s > 0.97)
            phi = np.arctan2(rel_p @ o["e2"], rel_p @ o["e1"])
            rim_ramp = smooth(0.3, 0.8, rad / max(o["R"], 1e-9))
            K = len(o["rims"])
            pos = (phi % (2 * math.pi)) / (2 * math.pi) * K
            k0 = np.floor(pos).astype(int) % K
            fk = pos - np.floor(pos)
            for k in range(K):
                share = np.where(k0 == k, 1 - fk, 0) + np.where((k0 + 1) % K == k, fk, 0)
                w(f"leaf_{i}_rim_{k}")[vg] = np.where(blade, rim_ramp * share, 0)
            w(f"leaf_{i}")[vg] = np.where(blade, 1 - rim_ramp, 0)
        else:
            blade = p[:, 2] > o["junction"][2] - 0.01 * h
            w(f"bud_{i}")[vg] = np.where(blade, smooth(o["junction"][2] - 0.01 * h, o["junction"][2] + 0.02 * h, p[:, 2]), 0)
            blade = blade & (w(f"bud_{i}")[vg] > 0.999)
        own = np.where(blade, 1.0, own)
        organ_w = np.where(blade, 0.0, own)
        if o["kind"] == "bud":
            organ_w = np.where(blade, 0.0, own * (1 - w(f"bud_{i}")[vg]))
        w(f"stalk_{i}_0")[vg] = organ_w * st0
        w(f"stalk_{i}_1")[vg] = organ_w * st1
        for nm in list(W):
            if nm.startswith("stem_"):
                W[nm][vg] *= 1 - own

    # Head: the core moves with the head; petals ramp in outward and hand over
    # from base to tip bone around the middle.
    w("head")[:] += np.where(is_head, 1.0, 0)
    for i, (hinge, mid, tip, m) in enumerate(petals):
        wp = np.where(m, smooth(core, 2 * core, rho), 0)
        t = np.linalg.norm(co - hinge, axis=1) / max(np.linalg.norm(tip - hinge), 1e-9)
        tip_share = smooth(0.38, 0.62, t)
        w(f"petal_{i}")[:] = wp * (1 - tip_share)
        w(f"petal_{i}_tip")[:] = wp * tip_share
        W["head"] -= wp
    one_piece(obj, co, W)
    names = list(W)
    total = sum(W.values())
    total[total == 0] = 1
    for nm in names:
        vg = obj.vertex_groups.new(name=nm)
        w = W[nm] / total
        for i in np.nonzero(w > 0.001)[0]:
            vg.add([int(i)], float(w[i]), "REPLACE")

    if args.bud_bloom > 0:
        for b in [b.name for b in arm_data.bones if re.fullmatch(r"bud_\d+", b.name)]:
            bloom_bud(obj, arm, b, args.bud_bloom, args.bud_stem)

    obj.parent = arm
    mod = obj.modifiers.new("rig", "ARMATURE")
    mod.object = arm

    if args.blend:
        bpy.ops.wm.save_as_mainfile(filepath=args.blend)

    bpy.ops.object.select_all(action="SELECT")
    kw = dict(filepath=args.out, export_format="GLB", use_selection=False, export_yup=True, export_skins=True)
    if args.texture:
        kw["export_image_format"] = "JPEG"
    try:
        bpy.ops.export_scene.gltf(**kw, export_animations=False, export_apply=False)
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)

    print(
        "AUTORIG "
        + json.dumps(
            {
                "verts": int(n),
                "tris_in": int(tris_in),
                "tris_out": triangles(obj),
                "height": round(float(h), 4),
                "head_share": round(float(1 - head_z / h), 3),
                "stem_radius": round(float(rs), 4),
                "stem_bones": args.stem,
                "petals": len(petals),
                "leaves": sum(o["kind"] == "leaf" for o in organs),
                "buds": sum(o["kind"] == "bud" for o in organs),
                "organ_verts": [int(len(o["verts"])) for o in organs],
                "verts_stem": int(is_stem.sum()),
                "verts_leaf": int(is_leaf.sum()),
                "verts_head": int(is_head.sum()),
                "out": args.out,
            }
        )
    )


main()
