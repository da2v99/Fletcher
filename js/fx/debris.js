// Destruction: wreckage thrown out of shell hits and explosions, shell holes torn in the hulls, and whole
// fittings (gun mounts) blown off a ship.
//
// Debris: some twenty kinds of wreckage, each one instanced mesh, so hundreds of pieces in the air cost a
// handful of draw calls. The shapes are built once at load: torn and crumpled plate with ragged edges, curved
// hull plating with its frames still on, I-beams (straight and kinked), bent pipe with a flange, machinery,
// shrapnel, lockers, splintered planks, drums, life rings, chairs, mess tables, bunks, insulation and cork,
// crates, and now and then a sailor. Vertex colours carry primer, soot and cloth; each piece gets its own tint,
// size and proportions, so no two look alike. They fly ballistic with drag to suit (plate and insulation
// flutter, beams and machinery plough on), tumble, trail smoke or burn; the ones that land on a deck bounce off,
// the ones that hit the sea splash, bob on the waves for a while (wood, cork, bodies in kapok jackets float
// longer) and sink.
// Hull damage: scorched, jagged holes and soot patches painted onto the hull or deckhouse sides where shells
// struck, parented to the ship so they roll with it.

const Debris = (() => {
    // ---- Shape building: everything is non-indexed with a vertex colour, merged from simple parts ----
    function paint(geo, fn) {
        const g = geo.index ? geo.toNonIndexed() : geo;
        const n = g.attributes.position.count, col = new Float32Array(n * 3);
        for (let t = 0; t < n; t += 3) {
            const c = fn(t / 3, g, t);
            for (let v = 0; v < 3; v++) col.set(c, (t + v) * 3);
        }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        return g;
    }
    const flat = c => () => c;
    // Steel: mostly paint, some faces red-lead primer, some soot, all a little uneven
    const grime = () => {
        const r = Math.random(), v = rnd(0.78, 1);
        return r < 0.12 ? [0.95, 0.52, 0.42] : r < 0.24 ? [0.32, 0.3, 0.29] : [v, v, v];
    };
    const grain = () => { const v = rnd(0.82, 1); return [v, v * 0.97, v * 0.93]; };
    function merge(list) {
        let n = 0;
        list.forEach(g => { n += g.attributes.position.count; });
        const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
        let o = 0;
        list.forEach(g => {
            pos.set(g.attributes.position.array, o * 3);
            col.set(g.attributes.color.array, o * 3);
            o += g.attributes.position.count;
        });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geo.computeVertexNormals();   // non-indexed: flat, faceted shading, right for torn metal
        return geo;
    }
    const place = (g, x, y, z, rx = 0, ry = 0, rz = 0) => { g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z); return g; };
    const box = (w, h, d, x, y, z, c, rx, ry, rz, seg = [1, 1, 1]) => paint(place(new THREE.BoxGeometry(w, h, d, ...seg), x, y, z, rx, ry, rz), typeof c === 'function' ? c : flat(c));
    // Repeatable per-position noise, so vertices that coincide (box edges) move together and no gaps open
    const hashV = v => { const s = Math.sin(v.x * 127.1 + v.y * 311.7 + v.z * 74.7) * 43758.5453; return s - Math.floor(s); };
    const deform = (g, fn) => {
        const P = g.attributes.position, v = new THREE.Vector3();
        for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i); fn(v); P.setXYZ(i, v.x, v.y, v.z); }
        return g;
    };

    // Torn plate: a crumpled sheet, one corner folded, cut to a ragged outline (triangles outside it dropped)
    function tornPlate(crumple, curve, fold) {
        const g = new THREE.PlaneGeometry(1, 1, 9, 7);
        g.rotateX(-Math.PI / 2);
        const P = g.attributes.position, ph = [rnd(0, 6), rnd(0, 6), rnd(0, 6)];
        for (let i = 0; i < P.count; i++) {
            const x = P.getX(i), z = P.getZ(i);
            let y = curve * (x * x - 0.08) + crumple * (Math.sin(x * 9 + ph[0]) * Math.cos(z * 7 + ph[1]) * 0.6 + Math.sin((x + z) * 15 + ph[2]) * 0.3 + (Math.random() - 0.5) * 0.5);
            if (x + z > 0.35) y += (x + z - 0.35) * fold;
            P.setY(i, y);
        }
        const idx = g.index.array, keep = [], l0 = rnd(0, 6), l1 = rnd(0, 6);
        for (let t = 0; t < idx.length; t += 3) {
            let cx = 0, cz = 0;
            for (let k = 0; k < 3; k++) { cx += P.getX(idx[t + k]) / 3; cz += P.getZ(idx[t + k]) / 3; }
            const a = Math.atan2(cz, cx);
            const lim = 0.5 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))) * (0.72 + 0.16 * Math.sin(a * 3 + l0) + 0.1 * Math.sin(a * 7 + l1) + 0.12 * Math.random());
            if (Math.hypot(cx, cz) < lim) keep.push(idx[t], idx[t + 1], idx[t + 2]);
        }
        g.setIndex(keep);
        const out = paint(g, grime);
        out.computeVertexNormals();
        return out;
    }
    // Hull plating torn out with two of its frames still riveted on
    function hullSection() {
        const curve = 0.35;
        const plate = tornPlate(0.03, curve, 0.25);
        const frames = [-0.22, 0.2].map(x => box(0.035, 0.11, 0.95, x, curve * (x * x - 0.08) + 0.06, rnd(-0.05, 0.05), [0.62, 0.42, 0.36], 0, 0, x * 0.7));
        return merge([plate, ...frames]);
    }
    // I-beam along z; kink bends it sharply partway along, as a blast leaves them
    function ibeam(kink) {
        const seg = [1, 1, 8];
        const g = merge([box(0.32, 0.035, 1, 0, 0.16, 0, grime, 0, 0, 0, seg), box(0.32, 0.035, 1, 0, -0.16, 0, grime, 0, 0, 0, seg), box(0.03, 0.3, 1, 0, 0, 0, grime, 0, 0, 0, seg)]);
        const zk = rnd(-0.15, 0.2), tw = rnd(-0.3, 0.3);
        deform(g, v => {
            v.y += Math.sin((v.z + 0.5) * Math.PI) * 0.04;                 // bowed
            if (v.z > zk) {
                const dz = v.z - zk, c = Math.cos(kink), s = Math.sin(kink), y0 = v.y;
                const t = tw * dz, ct = Math.cos(t), st = Math.sin(t), x = v.x;
                v.x = x * ct - y0 * st;                       // twisted beyond the kink
                const y = x * st + y0 * ct;
                v.z = zk + dz * c - y * s; v.y = dz * s + y * c;
            }
        });
        g.computeVertexNormals();
        return g;
    }
    // Pipe bent through an angle, open ends, a flange on one
    function pipe(bend) {
        const tube = paint(new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 8, true).rotateX(Math.PI / 2), grime);
        const flange = paint(new THREE.TorusGeometry(0.56, 0.1, 4, 10).translate(0, 0, -0.5), flat([0.7, 0.68, 0.66]));
        const g = merge([tube, flange]);
        const R = 1 / bend;
        deform(g, v => {
            const th = (v.z + 0.5) * bend, r = R - v.y;
            v.y = R - r * Math.cos(th); v.z = -0.5 + r * Math.sin(th);
        });
        g.computeVertexNormals();
        g.translate(0, 0, 0.1);
        return g;
    }
    function lump() {
        const g = paint(new THREE.IcosahedronGeometry(0.5, 1), grime);
        const k = Array.from({ length: 6 }, () => rnd(0, 6));
        deform(g, v => { v.multiplyScalar(0.8 + 0.25 * Math.sin(v.x * 7 + k[0]) * Math.cos(v.y * 6 + k[1]) + 0.12 * Math.sin(v.z * 9 + k[2])); });
        g.computeVertexNormals();
        return g;
    }
    function shard() {
        const g = paint(new THREE.TetrahedronGeometry(0.5).scale(1, 0.35, 1.7), grime);
        deform(g, v => { const h = hashV(v); v.x += (h - 0.5) * 0.12; v.z += (hashV(v) - 0.5) * 0.2; });
        g.computeVertexNormals();
        return g;
    }
    const locker = () => merge([box(1, 1, 1, 0, 0, 0, flat([0.92, 0.92, 0.9])), box(0.8, 0.8, 0.04, 0, 0, 0.51, flat([0.75, 0.75, 0.74])), box(0.06, 0.12, 0.05, 0.3, 0.05, 0.54, flat([0.4, 0.4, 0.4]))]);
    function plank() {
        const g = new THREE.BoxGeometry(1, 0.05, 0.16, 8, 1, 2);
        deform(g, v => { if (Math.abs(v.x) > 0.4) v.x += (hashV(new THREE.Vector3(0, v.y, v.z)) - 0.6) * 0.3 * Math.sign(v.x); });   // splintered ends
        const out = paint(g, grain);
        out.computeVertexNormals();
        return out;
    }
    const drum = () => merge([paint(new THREE.CylinderGeometry(0.5, 0.5, 1, 12), flat([1, 1, 1])),
        paint(new THREE.TorusGeometry(0.51, 0.025, 4, 12).rotateX(Math.PI / 2).translate(0, 0.2, 0), flat([0.75, 0.75, 0.75])),
        paint(new THREE.TorusGeometry(0.51, 0.025, 4, 12).rotateX(Math.PI / 2).translate(0, -0.2, 0), flat([0.75, 0.75, 0.75]))]);
    const ring = () => paint(new THREE.TorusGeometry(0.36, 0.09, 6, 16).rotateX(Math.PI / 2), (t, g, i) => {
        const P = g.attributes.position, a = Math.atan2(P.getZ(i), P.getX(i));
        return Math.floor((a + Math.PI) / (Math.PI / 2)) % 2 ? [0.95, 0.94, 0.9] : [0.86, 0.3, 0.2];
    });
    const chair = () => merge([box(0.45, 0.04, 0.45, 0, 0, 0, grain), box(0.45, 0.5, 0.04, 0, 0.27, -0.21, grain, -0.12),
        ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => box(0.035, 0.45, 0.035, a * 0.2, -0.225, b * 0.2, flat([0.5, 0.5, 0.5]), b * 0.1, 0, a * rnd(0, 0.25)))]);
    const table = () => merge([box(1.2, 0.04, 0.7, 0, 0.37, 0, grain),
        ...[[-1, -1], [1, -1], [-1, 1]].map(([a, b]) => box(0.05, 0.74, 0.05, a * 0.55, 0, b * 0.3, flat([0.55, 0.56, 0.57]))),
        box(0.05, 0.4, 0.05, 0.55, 0.17, 0.3, flat([0.55, 0.56, 0.57]), 0, 0, 0.6)]);   // one leg bent away
    const bunk = () => merge([box(0.68, 0.12, 1.85, 0, 0.08, 0, (t) => t % 12 < 2 ? [0.6, 0.62, 0.7] : [0.88, 0.87, 0.82]),
        box(0.04, 0.04, 1.95, 0.36, 0, 0, flat([0.5, 0.52, 0.54])), box(0.04, 0.04, 1.95, -0.36, 0, 0, flat([0.5, 0.52, 0.54])),
        box(0.76, 0.04, 0.04, 0, 0, 0.96, flat([0.5, 0.52, 0.54])), box(0.76, 0.04, 0.04, 0, 0, -0.96, flat([0.5, 0.52, 0.54])),
        ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => box(0.04, 0.5, 0.04, a * 0.36, -0.25, b * 0.96, flat([0.5, 0.52, 0.54])))]);
    function slab() {   // insulation, cork, kapok, mattress stuffing: soft and lumpy
        const g = paint(new THREE.BoxGeometry(1, 0.25, 0.8, 3, 1, 3), () => { const v = rnd(0.8, 1); return [v, v * 0.98, v * 0.92]; });
        deform(g, v => { const h = hashV(v) - 0.5; v.x += h * 0.1; v.y += (hashV(v.clone().addScalar(3)) - 0.5) * 0.12; v.z -= h * 0.08; });
        g.computeVertexNormals();
        return g;
    }
    const crate = () => merge([box(1, 0.8, 0.8, 0, 0, 0, flat([0.86, 0.74, 0.55])),
        box(1.02, 0.09, 0.82, 0, 0.28, 0, flat([0.55, 0.44, 0.31])), box(1.02, 0.09, 0.82, 0, -0.28, 0, flat([0.55, 0.44, 0.31])),
        box(0.09, 0.82, 0.82, 0.46, 0, 0, flat([0.6, 0.48, 0.34])), box(0.09, 0.82, 0.82, -0.46, 0, 0, flat([0.6, 0.48, 0.34]))]);
    // A sailor lying along z, face up, hips at the origin: arms flung out, kapok jacket (ours) or summer whites
    function sailor(us) {
        const skin = [0.78, 0.6, 0.48], shirt = us ? [0.43, 0.53, 0.68] : [0.86, 0.85, 0.8], trou = us ? [0.17, 0.23, 0.36] : [0.82, 0.81, 0.76];
        const vest = us ? [0.56, 0.53, 0.4] : shirt, hat = us ? [0.32, 0.34, 0.31] : [0.12, 0.13, 0.18], boot = [0.1, 0.09, 0.08];
        return merge([
            box(0.14, 0.15, 0.85, -0.1, 0, -0.45, trou, 0, 0.1), box(0.14, 0.15, 0.85, 0.1, 0, -0.45, trou, 0, -0.1),
            box(0.12, 0.2, 0.12, -0.15, 0.05, -0.9, boot), box(0.12, 0.2, 0.12, 0.15, 0.05, -0.9, boot),
            box(0.4, 0.22, 0.55, 0, 0, 0.3, shirt), box(0.44, 0.27, 0.38, 0, 0.01, 0.36, vest),
            box(0.1, 0.11, 0.6, -0.36, 0, 0.36, shirt, 0, 0.5), box(0.1, 0.11, 0.6, 0.36, 0, 0.36, shirt, 0, -0.9),
            box(0.08, 0.07, 0.1, -0.5, 0, 0.62, skin), box(0.08, 0.07, 0.1, 0.62, 0, 0.62, skin),
            box(0.19, 0.22, 0.23, 0, 0, 0.7, skin), box(0.25, 0.26, us ? 0.12 : 0.08, 0, 0.02, 0.84, hat)
        ]);
    }
    // An arm or leg, cloth to a dark end. Kept simple.
    const limb = () => merge([paint(new THREE.CylinderGeometry(0.06, 0.07, 0.7, 7).rotateX(Math.PI / 2), flat([1, 1, 1])),
        paint(new THREE.CylinderGeometry(0.066, 0.066, 0.05, 7).rotateX(Math.PI / 2).translate(0, 0, 0.36), flat([0.32, 0.07, 0.05]))]);

    // ---- Tints, picked per piece (they multiply the vertex colours) ----
    const C = h => new THREE.Color(h);
    const STEEL = [C(0x6d757e), C(0x4a5159), C(0x2b2a28), C(0x5e3427), C(0x8a8f94), C(0x7a8086)];
    const PAL = {
        steel: STEEL,
        pipe: [C(0x9a9c9e), C(0xd8d6cf), C(0x8a5a3a), C(0x4f5a4a), C(0x6d757e)],
        locker: [C(0x5f5a4c), C(0x4b4f45), C(0x6a6253), C(0x7a8086)],
        wood: [C(0x6b5a44), C(0x7d6a4f), C(0x4a3d2e), C(0x2c2620), C(0x8a7658)],
        drum: [C(0x46503f), C(0x3a3d40), C(0x5b4a33), C(0x7a2a20)],
        white: [C(0xffffff), C(0xe8e4dc), C(0xcfcac0), C(0xb8b4ab)],
        furn: [C(0x7d6a4f), C(0x9a9fa4), C(0x6e7a64), C(0x5a4a38)],
        insul: [C(0xd9cf9a), C(0xd8d4c8), C(0x9c7650), C(0xa9a69c), C(0xc8b27a)],
        cloth: [C(0x2b3c5c), C(0x6f88ad), C(0x8b8a6a), C(0xd6d4cc)]
    };

    // ---- The kinds. dim(k): the piece's scale (x, y, z) for size factor k; drag: air drag (1/s); float:
    // chance it stays afloat; draft: how deep it sits (fraction of its height); flt: seconds afloat; spin ----
    const DS = THREE.DoubleSide;
    const KINDS = [
        { name: 'plate', geo: () => tornPlate(0.06, 0.12, 0.7), max: 160, pal: 'steel', side: DS, float: 0.1, draft: 0.5, drag: 0.45, spin: 8, flt: [20, 50], dim: k => [rnd(1.2, 3.6) * k, 1, rnd(1, 3) * k] },
        { name: 'plate2', geo: () => tornPlate(0.1, -0.2, -0.5), max: 160, pal: 'steel', side: DS, float: 0.1, draft: 0.5, drag: 0.45, spin: 8, flt: [20, 50], dim: k => [rnd(0.8, 2.8) * k, rnd(0.8, 1.5), rnd(0.8, 2.6) * k] },
        { name: 'hull', geo: hullSection, max: 70, pal: 'steel', side: DS, float: 0.05, draft: 0.5, drag: 0.3, spin: 4, flt: [10, 30], dim: k => { const s = rnd(2.2, 6) * k; return [s, s * rnd(0.6, 1), s * rnd(0.7, 1.2)]; } },
        { name: 'beam', geo: () => ibeam(0.12), max: 70, pal: 'steel', float: 0.04, draft: 0.5, drag: 0.15, spin: 3.5, flt: [5, 15], dim: k => { const w = rnd(0.6, 1.3); return [w, w, rnd(2.5, 8) * k]; } },
        { name: 'beamKink', geo: () => ibeam(0.75), max: 60, pal: 'steel', float: 0.04, draft: 0.5, drag: 0.15, spin: 3.5, flt: [5, 15], dim: k => { const w = rnd(0.6, 1.3); return [w, w, rnd(2.5, 7) * k]; } },
        { name: 'pipe', geo: () => pipe(1.1), max: 80, pal: 'pipe', side: DS, float: 0.15, draft: 0.5, drag: 0.25, spin: 6, flt: [10, 40], dim: k => { const d = rnd(0.12, 0.45); return [d, d, rnd(1.2, 4) * k]; } },
        { name: 'lump', geo: lump, max: 90, pal: 'steel', float: 0.03, draft: 0.6, drag: 0.12, spin: 6, flt: [3, 8], dim: k => { const s = rnd(0.4, 1.5) * k; return [s * rnd(0.7, 1.3), s * rnd(0.6, 1.1), s * rnd(0.7, 1.4)]; } },
        { name: 'shard', geo: shard, max: 600, pal: 'steel', float: 0, draft: 0.5, drag: 0.08, spin: 16, flt: [1, 2], dim: k => { const s = rnd(0.07, 0.42) * Math.sqrt(k); return [s, s, s * rnd(0.8, 2)]; } },
        { name: 'locker', geo: locker, max: 60, pal: 'locker', float: 0.6, draft: 0.45, drag: 0.25, spin: 6, flt: [30, 80], dim: () => [rnd(0.5, 0.9), rnd(0.6, 1.8), rnd(0.4, 0.6)] },
        { name: 'plank', geo: plank, max: 200, pal: 'wood', float: 1, draft: 0.04, drag: 0.35, spin: 9, flt: [60, 160], dim: k => { const w = rnd(0.8, 1.4); return [rnd(1.2, 4) * Math.sqrt(k), w, w]; } },
        { name: 'drum', geo: drum, max: 40, pal: 'drum', float: 0.9, draft: 0.25, drag: 0.2, spin: 7, flt: [60, 140], dim: () => { const s = rnd(0.55, 0.65); return [s, rnd(0.85, 0.95), s]; } },
        { name: 'ring', geo: ring, max: 30, pal: 'white', float: 1, draft: 0.05, drag: 0.4, spin: 8, flt: [90, 200], dim: () => { const s = rnd(0.95, 1.1); return [s, s, s]; } },
        { name: 'chair', geo: chair, max: 50, pal: 'furn', float: 0.7, draft: 0.3, drag: 0.4, spin: 9, flt: [40, 100], dim: () => { const s = rnd(0.9, 1.1); return [s, s, s]; } },
        { name: 'table', geo: table, max: 30, pal: 'furn', float: 0.6, draft: 0.3, drag: 0.4, spin: 6, flt: [40, 100], dim: () => [rnd(0.8, 1.4), rnd(0.9, 1.1), rnd(0.9, 1.2)] },
        { name: 'bunk', geo: bunk, max: 30, pal: 'white', float: 0.5, draft: 0.3, drag: 0.5, spin: 5, flt: [30, 80], dim: () => { const s = rnd(0.95, 1.05); return [s, s, s]; } },
        { name: 'insul', geo: slab, max: 160, pal: 'insul', float: 1, draft: 0.3, drag: 2.2, spin: 3, flt: [80, 200], dim: k => { const s = rnd(0.35, 1.5) * Math.sqrt(k); return [s, s * rnd(0.3, 0.8), s * rnd(0.6, 1.2)]; } },
        { name: 'crate', geo: crate, max: 50, pal: 'white', float: 0.85, draft: 0.4, drag: 0.25, spin: 6, flt: [60, 150], dim: () => { const s = rnd(0.7, 1.3); return [s, s * rnd(0.8, 1.1), s * rnd(0.8, 1.1)]; } },
        { name: 'sailorUS', geo: () => sailor(true), max: 30, pal: 'white', float: 0.95, draft: 0.4, drag: 0.3, spin: 4, flt: [120, 260], body: true, dim: () => { const s = rnd(0.94, 1.06); return [s, s, s]; } },
        { name: 'sailorJP', geo: () => sailor(false), max: 40, pal: 'white', float: 0.75, draft: 0.5, drag: 0.3, spin: 4, flt: [90, 200], body: true, dim: () => { const s = rnd(0.9, 1.02); return [s, s, s]; } },
        { name: 'limb', geo: limb, max: 30, pal: 'cloth', float: 0.5, draft: 0.5, drag: 0.3, spin: 7, flt: [30, 90], dim: () => [1, 1, rnd(0.9, 1.1)] }
    ];
    const KI = {};
    KINDS.forEach((k, i) => { KI[k.name] = i; });
    // What comes out of a hit depends on what was hit
    const MIX = {
        hull:  [['plate', 24], ['plate2', 16], ['hull', 14], ['beam', 7], ['beamKink', 7], ['pipe', 9], ['lump', 8], ['insul', 7], ['plank', 4], ['locker', 2], ['drum', 2]],
        house: [['plate', 14], ['plate2', 10], ['beam', 5], ['beamKink', 5], ['pipe', 9], ['insul', 14], ['locker', 7], ['chair', 7], ['table', 4], ['bunk', 4], ['plank', 8], ['crate', 4], ['ring', 3], ['lump', 6]],
        deck:  [['plank', 22], ['plate', 12], ['plate2', 8], ['drum', 9], ['ring', 6], ['crate', 10], ['locker', 7], ['pipe', 8], ['beam', 5], ['beamKink', 4], ['insul', 5], ['lump', 4]],
        blast: [['plate', 14], ['plate2', 11], ['hull', 12], ['beam', 8], ['beamKink', 9], ['pipe', 8], ['lump', 7], ['insul', 8], ['locker', 4], ['chair', 4], ['table', 2], ['bunk', 3], ['plank', 8], ['crate', 3], ['drum', 3], ['ring', 2]],
        wood:  [['plank', 60], ['crate', 12], ['chair', 8], ['table', 4], ['ring', 6], ['insul', 10]]
    };
    Object.values(MIX).forEach(m => { let s = 0; m.forEach(e => { e[0] = KI[e[0]]; s += e[1]; }); m.total = s; });
    const pickFrom = mix => { let r = Math.random() * mix.total; for (const [k, w] of mix) { if ((r -= w) <= 0) return k; } return mix[0][0]; };

    const meshes = [], pieces = [], big = [], counts = [];
    const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(),
        _e = new THREE.Euler(), _up = new THREE.Vector3(0, 1, 0), _z = new THREE.Vector3(0, 0, 1);
    let frame = 0;

    function init() {
        KINDS.forEach(k => {
            const metal = k.pal === 'steel' || k.pal === 'pipe';
            const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: metal ? 0.72 : 0.88, metalness: metal ? 0.35 : 0.05, side: k.side || THREE.FrontSide });
            const m = new THREE.InstancedMesh(k.geo(), mat, k.max);
            m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            m.count = 0;
            m.castShadow = true;
            m.frustumCulled = false;
            for (let j = 0; j < k.max; j++) m.setColorAt(j, STEEL[0]);
            scene.add(m);
            meshes.push(m);
            counts.push(0);
        });
    }

    // One piece of kind out of p. scale ~ the blast's size; opts as burst()
    function spawn(kind, p, scale, opts, fast = 1) {
        const K = KINDS[kind];
        if (counts[kind] >= K.max) {   // recycle the oldest of that kind
            let oldest = -1;
            for (let i = 0; i < pieces.length; i++) if (pieces[i].kind === kind && (oldest < 0 || pieces[i].age > pieces[oldest].age)) oldest = i;
            if (oldest >= 0) { pieces.splice(oldest, 1); counts[kind]--; }
        }
        const dim = K.dim(Math.sqrt(scale));
        const heft = Math.max(dim[0], dim[1], dim[2]);
        // Big heavy pieces are thrown slower than the small stuff
        const sp = rnd(8, 26) * Math.sqrt(scale) * (opts.speed || 1) * fast / (1 + 0.12 * Math.max(0, heft - 1));
        const d = _p.set(randn(), Math.abs(randn()) * 0.9 + 0.55, randn());
        if (opts.dir) d.addScaledVector(opts.dir, 1.4);
        d.normalize();
        const colors = opts.colors && K.pal === 'steel' ? opts.colors : PAL[K.pal];
        const steel = K.pal === 'steel';
        pieces.push({
            kind, age: 0, life: 240,
            pos: p.clone().add(new THREE.Vector3(randn() * 0.8, randn() * 0.5, randn() * 0.8)),
            vel: d.clone().multiplyScalar(sp).add(opts.vel || _s.set(0, 0, 0)),
            rot: new THREE.Euler(Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3),
            quat: new THREE.Quaternion(),
            spin: new THREE.Vector3(randn(), randn(), randn()).multiplyScalar(K.spin / Math.sqrt(Math.max(1, heft))),
            scale: new THREE.Vector3(dim[0], dim[1], dim[2]),
            color: colors[Math.floor(Math.random() * colors.length)],
            smoke: kind !== KI.shard && Math.random() < (opts.smoky ?? 0.35) * (heft > 2 ? 1.4 : 1),
            burning: kind !== KI.shard && Math.random() < (opts.burning ?? 0.25) * (steel ? 0.8 : 1.3),
            state: 'air', yaw: Math.random() * 6.3, yawRate: randn() * 0.15, bob: Math.random() * 6,
            roll: K.body && Math.random() < 0.55 ? Math.PI : 0,
            tY: 0, tN: new THREE.Vector3(0, 1, 0), sinkV: 0, floatT: 0
        });
        counts[kind]++;
    }

    // Throw wreckage out of p: up and away from the hit (opts.dir), carried with the ship (opts.vel), sized by
    // scale (1 ~ a 5" shell into the hull, 1.5 a magazine). opts.mix: hull | house | deck | blast | wood;
    // opts.crew: how many men are blown off (fractions are a chance), opts.side 'us' | 'ijn'
    function burst(p, n = 10, scale = 1, opts = {}) {
        const keep = Gfx.particleKeep;
        const k = keep < 1 ? 0.6 + 0.4 * keep : 1;
        n = Math.max(1, Math.round(n * 1.7 * k));
        const mix = MIX[opts.mix || (opts.kind === 4 ? 'wood' : 'hull')];
        for (let i = 0; i < n; i++) spawn(pickFrom(mix), p, scale, opts);
        // A spray of small fragments, faster than the rest
        if (opts.mix !== 'wood' && opts.kind !== 4) for (let i = 0; i < Math.round(n * 1.4 * k); i++) spawn(KI.shard, p, scale, opts, 1.7);
        for (let c = opts.crew || 0; c > 0; c--) {
            if (Math.random() > c) break;
            spawn(opts.side === 'us' ? KI.sailorUS : KI.sailorJP, p, 1, Object.assign({}, opts, { smoky: 0, burning: 0.05 }), 0.8);
            if (Math.random() < 0.3) spawn(KI.limb, p, 1, Object.assign({}, opts, { smoky: 0, burning: 0 }), 0.9);
        }
    }

    // Blow a fitting off its ship: it keeps its look and world pose, and flies on its own
    function blowOff(obj, vel, spinScale = 1) {
        if (!obj || !obj.parent) return;
        obj.updateMatrixWorld(true);
        const m = obj.matrixWorld.clone();
        obj.parent.remove(obj);
        m.decompose(obj.position, obj.quaternion, obj.scale);
        // Off the ship it no longer shares her holes and break line (wreck.js): plain copies of its paints
        const plain = new Map();
        obj.traverse(o => {
            if (!o.material || Array.isArray(o.material)) return;
            if (!plain.has(o.material)) {
                const c = o.material.clone();
                c.onBeforeCompile = THREE.Material.prototype.onBeforeCompile;
                c.customProgramCacheKey = THREE.Material.prototype.customProgramCacheKey;
                plain.set(o.material, c);
            }
            o.material = plain.get(o.material);
        });
        scene.add(obj);
        big.push({ obj, vel: vel.clone(), spin: new THREE.Vector3(randn() * 2, randn() * 2, randn() * 2).multiplyScalar(spinScale), age: 0, state: 'air', life: 40 });
        burst(obj.position, 10, 1, { vel: vel.clone().multiplyScalar(0.3), smoky: 0.8, burning: 0.6, mix: 'blast' });
    }

    function onDeck(pc) {
        // Landing back on our own deck: bounce and skitter
        if (typeof playerHitTest !== 'function' || !playerHitTest(pc.pos)) return false;
        pc.pos.addScaledVector(pc.vel, -0.03);
        pc.vel.y = Math.abs(pc.vel.y) * 0.3;
        pc.vel.x *= 0.5; pc.vel.z *= 0.5;
        pc.spin.multiplyScalar(0.5);
        return true;
    }

    // Afloat: sit at its own waterline and lie along the wave under it, turn slowly, drift downwind. The water
    // under it is sampled every few frames (staggered), which is plenty for something this slow.
    function floatOn(pc, dt, t, i) {
        const near = pc.pos.distanceToSquared(camera.position) < 400 * 400;
        if ((i + frame) % (near ? 3 : 7) === 0) {
            const x = pc.pos.x, z = pc.pos.z, e = 0.8;
            const h = waterHeight(x, z, t);
            if (near && (i + frame) % 6 === 0) {
                const hx = waterHeight(x + e, z, t) - waterHeight(x - e, z, t), hz = waterHeight(x, z + e, t) - waterHeight(x, z - e, t);
                pc.tN.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
            }
            pc.tY = h - KINDS[pc.kind].draft * pc.scale.y * (KINDS[pc.kind].body ? 0.3 : 1) + Math.sin(t * 1.7 + pc.bob) * 0.03;
        }
        pc.pos.y += (pc.tY - pc.pos.y) * Math.min(1, dt * 5);
        pc.yaw += pc.yawRate * dt;
        _q.setFromUnitVectors(_up, pc.tN);
        _q.multiply(_q2.setFromAxisAngle(_up, pc.yaw));
        if (pc.roll) _q.multiply(_q2.setFromAxisAngle(_z, pc.roll));   // face down
        pc.quat.slerp(_q, Math.min(1, dt * 3));
        pc.pos.x += (Sea.wind.x * 0.35 + pc.vel.x) * dt;
        pc.pos.z += (Sea.wind.y * 0.35 + pc.vel.z) * dt;
        pc.vel.multiplyScalar(Math.exp(-dt * 0.6));
    }

    function update(dt, t) {
        if (dt <= 0) return;
        frame++;
        const drawn = KINDS.map(() => 0);
        const cam = camera.position;
        for (let i = pieces.length - 1; i >= 0; i--) {
            const pc = pieces[i], K = KINDS[pc.kind];
            pc.age += dt;
            let alpha = Math.min(1, (pc.life - pc.age) / 0.6);
            if (pc.state === 'air') {
                const drag = Math.exp(-dt * K.drag);
                pc.vel.x *= drag; pc.vel.z *= drag;
                pc.vel.y = pc.vel.y * drag - GRAVITY * dt;
                if (K.drag > 1) { pc.vel.x += Math.sin(pc.age * 5 + pc.bob) * 6 * dt; pc.vel.z += Math.cos(pc.age * 4 + pc.bob) * 6 * dt; }   // fluttering
                pc.pos.addScaledVector(pc.vel, dt);
                pc.rot.x += pc.spin.x * dt; pc.rot.y += pc.spin.y * dt; pc.rot.z += pc.spin.z * dt;
                pc.quat.setFromEuler(pc.rot);
                const close = pc.pos.distanceToSquared(cam) < 2500 * 2500;
                if (pc.smoke && close && Math.random() < dt * 30) smokeFx.emit({ x: pc.pos.x, y: pc.pos.y, z: pc.pos.z, vx: Sea.wind.x, vy: 0.5, vz: Sea.wind.y,
                    life: rnd(1.2, 2.6), s0: 0.4 + 0.15 * pc.scale.x, s1: rnd(2, 4) * Math.min(2, 0.7 + 0.3 * pc.scale.x), r: 0.16, g: 0.15, b: 0.14, a: 0.45, drag: 1.4, grav: -0.3 });
                if (pc.burning && close && Math.random() < dt * 25) fireFx.emit({ x: pc.pos.x, y: pc.pos.y, z: pc.pos.z, vx: 0, vy: 0, vz: 0,
                    life: rnd(0.15, 0.3), s0: rnd(0.6, 1.1), s1: 0.3, r: 1, g: 0.6, b: 0.2, a: 0.9, drag: 0, grav: 0 });
                if (pc.vel.y < 0) onDeck(pc);
                const g = Islands.groundAt(pc.pos.x, pc.pos.z);
                const wh = pc.pos.y < 25 ? waterHeight(pc.pos.x, pc.pos.z, t) : -1e9;   // well above the waves: no need to look
                if (g > wh && pc.pos.y < g) {           // on the beach or a hillside
                    pc.pos.y = g; pc.state = 'land'; pc.vel.set(0, 0, 0); pc.life = pc.age + rnd(30, 60);
                } else if (pc.pos.y < wh) {
                    const sz = Math.max(pc.scale.x, pc.scale.z);
                    if (pc.vel.y < -5 && pc.kind !== KI.shard) FX.smallSplash(pc.pos.x, wh, pc.pos.z, Math.min(3.5, 0.5 + sz * 0.6));
                    const floats = Math.random() < K.float;
                    pc.state = 'sea';
                    pc.floatT = floats ? rnd(K.flt[0], K.flt[1]) : rnd(0.6, 4);   // steel with air trapped in it bobs a moment first
                    pc.sinkV = rnd(0.5, 2.4) * (K.pal === 'steel' ? 1.5 : 0.7);
                    pc.vel.multiplyScalar(0.15);
                    pc.vel.y = 0;
                    pc.tY = wh - K.draft * pc.scale.y;
                    pc.burning = pc.burning && floats && Math.random() < 0.5;
                    pc.smoke = pc.burning;
                }
            } else if (pc.state === 'sea') {
                floatOn(pc, dt, t, i);
                if (pc.burning && Math.random() < dt * 10 && pc.pos.distanceToSquared(cam) < 1500 * 1500) FX.burn(pc.pos, 0.25);
                pc.floatT -= dt;
                if (pc.floatT <= 0) { pc.state = 'sink'; pc.vel.set(pc.vel.x, 0, pc.vel.z); }
            } else if (pc.state === 'sink') {
                // Going down: settles to its sinking speed, tumbling slowly, gone once out of sight below
                pc.vel.y += (-pc.sinkV - pc.vel.y) * Math.min(1, dt * 1.2);
                pc.vel.x *= Math.exp(-dt * 0.8); pc.vel.z *= Math.exp(-dt * 0.8);
                pc.pos.addScaledVector(pc.vel, dt);
                pc.rot.x += pc.spin.x * 0.05 * dt; pc.rot.z += pc.spin.z * 0.05 * dt;
                _q.setFromEuler(pc.rot);
                pc.quat.slerp(_q, Math.min(1, dt * 0.5));
                const depth = (pc.tY || 0) - pc.pos.y;
                alpha = Math.min(alpha, 1 - smooth(25, 35, depth));
                if (depth > 35 || pc.pos.y < Math.max(Islands.groundAt(pc.pos.x, pc.pos.z), -70)) pc.life = Math.min(pc.life, pc.age);
            } else if (pc.state === 'land') {
                alpha = Math.min(alpha, 1);
            }
            if (pc.age >= pc.life) { pieces.splice(i, 1); counts[pc.kind]--; continue; }
            const m = meshes[pc.kind], j = drawn[pc.kind]++;
            _s.copy(pc.scale).multiplyScalar(Math.max(0.01, alpha));
            _m.compose(pc.pos, pc.quat, _s);
            m.setMatrixAt(j, _m);
            m.setColorAt(j, pc.color);
        }
        meshes.forEach((m, k) => {
            m.count = drawn[k];
            m.instanceMatrix.needsUpdate = true;
            if (m.instanceColor) m.instanceColor.needsUpdate = true;
        });

        // Blown-off fittings: fly, splash, sink out of sight
        for (let i = big.length - 1; i >= 0; i--) {
            const b = big[i], o = b.obj;
            b.age += dt;
            if (b.state === 'air') {
                b.vel.y -= GRAVITY * dt;
                o.position.addScaledVector(b.vel, dt);
                _e.set(b.spin.x * dt, b.spin.y * dt, b.spin.z * dt);
                o.quaternion.multiply(_q.setFromEuler(_e));
                if (Math.random() < dt * 40) smokeFx.emit({ x: o.position.x, y: o.position.y, z: o.position.z, vx: Sea.wind.x, vy: 1, vz: Sea.wind.y,
                    life: rnd(2, 4), s0: 1.2, s1: rnd(5, 9), r: 0.12, g: 0.11, b: 0.1, a: 0.55, drag: 1, grav: -0.3 });
                const wh = waterHeight(o.position.x, o.position.z, t);
                if (o.position.y < wh) {
                    FX.splash(o.position.x, wh, o.position.z, WHITE_SPRAY, 0.6);
                    playBoom(o.position, 0.3, 500, 0.8);
                    if (typeof Slicks !== 'undefined' && Math.random() < 0.5) Slicks.spill(o.position.x, o.position.z, rnd(12, 25));
                    b.state = 'sink';
                    b.vel.multiplyScalar(0.1);
                }
            } else {
                o.position.y -= dt * (1.5 + b.age * 0.05);
                o.position.x += b.vel.x * dt; o.position.z += b.vel.z * dt;
                o.rotateX(dt * 0.2);
                if (o.position.y < -80 || b.age > b.life) {
                    scene.remove(o);
                    big.splice(i, 1);
                }
            }
        }
    }

    function clear() {
        pieces.length = 0;
        counts.fill(0);
        big.forEach(b => scene.remove(b.obj));
        big.length = 0;
        meshes.forEach(m => { m.count = 0; });
    }

    return { init, burst, blowOff, update, clear, get count() { return pieces.length; } };
})();

// --- Shell holes: decals on hull and deckhouse sides ---
const HullDamage = (() => {
    let holeTex = null, sootTex = null;
    const MAX_PER_SHIP = 28;

    function makeTex(kind) {
        const N = 128, c = document.createElement('canvas');
        c.width = c.height = N;
        const ctx = c.getContext('2d');
        const jag = (r0, rough, n = 22) => {
            ctx.beginPath();
            for (let i = 0; i <= n; i++) {
                const a = i / n * Math.PI * 2, r = r0 * (1 + (Math.random() - 0.5) * rough);
                const x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r;
                if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
            }
            ctx.closePath();
        };
        if (kind === 'hole') {
            // Soot fan, scorched rim, peeled-back plate, black hole
            const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
            g.addColorStop(0, 'rgba(10,9,8,0.95)'); g.addColorStop(0.45, 'rgba(25,22,20,0.75)'); g.addColorStop(1, 'rgba(30,28,26,0)');
            ctx.fillStyle = g; ctx.fillRect(0, 0, N, N);
            ctx.fillStyle = 'rgba(70,40,25,0.9)'; jag(30, 0.55); ctx.fill();
            ctx.fillStyle = 'rgba(95,95,98,0.95)'; jag(24, 0.7, 14); ctx.fill();
            ctx.fillStyle = 'rgba(4,4,4,1)'; jag(17, 0.6, 16); ctx.fill();
            ctx.strokeStyle = 'rgba(160,150,140,0.6)'; ctx.lineWidth = 1.5;
            for (let i = 0; i < 9; i++) {
                const a = Math.random() * 6.28;
                ctx.beginPath(); ctx.moveTo(64 + Math.cos(a) * 17, 64 + Math.sin(a) * 17); ctx.lineTo(64 + Math.cos(a) * rnd(24, 34), 64 + Math.sin(a) * rnd(24, 34)); ctx.stroke();
            }
        } else {
            for (let i = 0; i < 14; i++) {
                const x = 64 + randn() * 16, y = 64 + randn() * 16, r = rnd(14, 34);
                const g = ctx.createRadialGradient(x, y, 0, x, y, r);
                g.addColorStop(0, 'rgba(12,11,10,0.5)'); g.addColorStop(1, 'rgba(12,11,10,0)');
                ctx.fillStyle = g; ctx.fillRect(0, 0, N, N);
            }
        }
        const t = new THREE.CanvasTexture(c);
        t.anisotropy = 4;
        return t;
    }

    function decal(ship, local, normal, size, kind) {
        if (!holeTex) { holeTex = makeTex('hole'); sootTex = makeTex('soot'); }
        const list = ship.userData.decals || (ship.userData.decals = []);
        if (list.length >= MAX_PER_SHIP) ship.remove(list.shift());
        const mat = new THREE.MeshStandardMaterial({
            map: kind === 'hole' ? holeTex : sootTex, transparent: true, depthWrite: false, roughness: 0.95, metalness: 0.1,
            polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4
        });
        const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
        m.name = 'decal';
        m.position.copy(local).addScaledVector(normal, 0.03);
        m.lookAt(m.position.clone().add(normal));
        m.rotateZ(Math.random() * Math.PI * 2);
        m.renderOrder = 1;
        ship.add(m);
        list.push(m);
    }

    // Our ship: find the hull, deckhouse or deck surface nearest the hit (ship-local), soot it, and tear the
    // hole and dent into the structure there (wreck.js). power: 1 = 5" shell, ~4 = torpedo. Returns keel damage.
    // from / dir (world): where the round came from, to find the exact spot on the mesh it struck
    function onPlayer(local, power = 1, from = null, dir = null) {
        const s = from && Wreck.surfaceHit(myShip, from, dir, 40);
        if (s) {
            decal(s.root, s.local.clone().addScaledVector(s.normal, 0.02).add(new THREE.Vector3(0, Math.abs(s.normal.y) > 0.7 ? 0 : 0.6, 0)), s.normal, rnd(2.4, 3.6) * Math.sqrt(power), 'soot');
            return Wreck.hit(myShip, s.local, s.normal, power);
        }
        const z = THREE.MathUtils.clamp(local.z, -HALF_L + 2, HALF_L - 3);
        const deck = sheerY(z), side = local.x >= 0 ? 1 : -1;
        const size = rnd(1.6, 2.6) * Math.sqrt(power);
        let at, n;
        if (local.y < deck - 0.3) {
            const y = THREE.MathUtils.clamp(local.y, -2.5, deck - 0.4);
            at = new THREE.Vector3(side * hullX(z, y), y, z);
            n = new THREE.Vector3(side, 0.15, 0).normalize();
        } else {
            const house = (z < 35 && z > 8.5 && Math.abs(local.x) < 3.6) || (z < 8.5 && z > -9.5 && Math.abs(local.x) < 2.8) || (z < -9.5 && z > -36.5 && Math.abs(local.x) < 3.4);
            if (house && local.y < deck + LVL1_H) {
                const hw = z > 8.5 ? (z > 32 ? 2.6 : 3.4) : z > -9.5 ? 2.6 : 3.2;
                at = new THREE.Vector3(side * hw, Math.max(local.y, deck + 0.7), z);
                n = new THREE.Vector3(side, 0, 0);
            } else {
                const hw = deckHalfWidth(z);
                const x = THREE.MathUtils.clamp(local.x, -hw + 0.8, hw - 0.8);
                at = new THREE.Vector3(x, house ? deck + LVL1_H : deck + 0.12 * (1 - Math.pow(x / Math.max(1, hw), 2)), z);
                n = new THREE.Vector3(0, 1, 0);
            }
        }
        decal(myShip, at.clone().addScaledVector(n, 0.02).add(new THREE.Vector3(0, n.y ? 0 : 0.7, 0)), n, size * 1.5, 'soot');
        return Wreck.hit(myShip, at, n, power);
    }

    // Enemy ship: her hull side at the hit's station (the same plan taper the hit test uses)
    function onEnemy(e, local, power = 1, from = null, dir = null) {
        const s = from && Wreck.surfaceHit(e.obj, from, dir, 40);
        if (s) {
            decal(s.root, s.local.clone().addScaledVector(s.normal, 0.02).add(new THREE.Vector3(0, Math.abs(s.normal.y) > 0.7 ? 0 : 0.6, 0)), s.normal, rnd(2.4, 3.6) * Math.sqrt(power), 'soot');
            return Wreck.hit(e.obj, s.local, s.normal, power);
        }
        const L = e.model.len, z = THREE.MathUtils.clamp(local.z, -L / 2 + 2, L / 2 - 2);
        const halfLen = L / 2 - (Math.abs(z) > L * 0.3 ? (Math.abs(z) - L * 0.3) * 0.6 : 0);
        const hw = e.model.beam / 2 * (halfLen / (L / 2));
        const side = local.x >= 0 ? 1 : -1;
        const y = THREE.MathUtils.clamp(local.y, -1.5, 4);
        const size = rnd(1.8, 2.8) * Math.max(0.5, Math.min(1.2, e.model.beam / 10)) * Math.sqrt(power);
        const at = new THREE.Vector3(side * hw, y, z), n = new THREE.Vector3(side, 0.1, 0).normalize();
        decal(e.obj, new THREE.Vector3(side * (hw + 0.03), y + 1.0, z + randn() * 0.5), new THREE.Vector3(side, 0, 0), size * 1.6, 'soot');
        return Wreck.hit(e.obj, at, n, power);
    }

    function clear(ship) {
        (ship.userData.decals || []).forEach(m => { ship.remove(m); m.geometry.dispose(); m.material.dispose(); });
        ship.userData.decals = [];
    }

    return { onPlayer, onEnemy, clear };
})();
