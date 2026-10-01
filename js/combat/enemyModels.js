// Procedural IJN ship models. Each builder returns { group, turrets, torpLaunchers, stacks, len, beam, top }
// in the same local frame as our own ship (+Z bow, Y = 0 waterline).
//
// Hulls are lofted from real proportions: sheer line, flared clipper bow, cruiser stern, and painted in bands
// (red bottom, black boot topping, grey topsides). The upperworks follow the 1943 layouts:
//   Kagero-class destroyer (118.5 m): twin 12.7 cm Type C mounts, one forward and a superfiring pair aft;
//     two raked funnels, quad Long Lance mounts between and abaft them, reloads beside the fore funnel.
//   Nagara-class light cruiser (162 m): seven single 14 cm guns (two forward, one either side of the bridge,
//     three aft), three funnels, twin torpedo banks either beam, catapult aft between Nos. 5 and 6.
//   Maru: a 1930s cargo liner taken up as a transport: raised forecastle and poop, well decks with hatches
//     and derricks on kingposts and masts, midships bridge house and funnel.

const IJN = (() => {
    let M = null;
    function mats() {
        if (M) return M;
        const std = (color, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.78, metalness: 0.1, flatShading: true, side: THREE.DoubleSide }, o));
        M = {
            gray: std(0x787d7b),          // Kure arsenal grey
            grayDark: std(0x585d5b),
            grayLight: std(0x8c918f),
            lino: std(0x4f3326),          // linoleum decks with brass strips
            wood: std(0x6f5d44),
            black: std(0x1a1a1b),
            gun: std(0x464b4e, { metalness: 0.35 }),
            canvas: std(0xb9b096),
            glass: std(0x1b2228, { roughness: 0.2, metalness: 0.6 }),
            maruUpper: std(0xbdb6a3),
            maruMast: std(0x8f7a55),
            hull: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.08, side: THREE.DoubleSide })
        };
        return M;
    }

    const add = (parent, geo, mat, x = 0, y = 0, z = 0) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        m.castShadow = true;
        parent.add(m);
        return m;
    };
    const smoothC = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

    // --- Lofted hull ---
    // o: L, B, T (draft), sheer(z) deck height, rake (stem overhang at deck), entry (bow taper length),
    //    flare (bow flare above water), run (stern taper length), sternW (width left at the stern), colors
    function loftHull(o) {
        const NZ = 96, NY = 12, hw = o.B / 2, zB = o.L / 2, zS = -o.L / 2;
        const keel = z => {
            const fore = smoothC(zB - o.entry * 0.55, zB, z);          // forefoot cut away under the raked stem
            const aft = smoothC(zS + o.run * 0.8, zS, z);               // cruiser stern sweeps up
            return -o.T * (1 - 0.85 * fore) + aft * o.T * 0.75;
        };
        // Clipper stem: curves back from the deck to the forefoot
        const stemZ = (y, z) => zB - o.rake * Math.pow(clamp01((o.sheer(zB) - y) / (o.sheer(zB) + o.T)), 0.7);
        const halfB = (z, y) => {
            const sz = stemZ(y, z);
            if (z >= sz) return 0;
            // plan: fine entry forward, parallel middle body, rounded stern
            const wb = clamp01((sz - z) / o.entry);
            let p = 1 - Math.pow(1 - wb, 2.3);
            const ws = clamp01((z - zS) / o.run);
            p *= lerp(o.sternW, 1, Math.sqrt(1 - Math.pow(1 - ws, 2)));
            // section: U midships, V toward the bow, flare above the waterline at the bow
            const k = keel(z), deck = o.sheer(z);
            let s;
            if (y < 0) {
                const t = clamp01((y - k) / Math.max(-k, 0.3));
                const bowness = 1 - wb;
                s = Math.pow(t, lerp(0.22, 0.75, bowness));
            } else {
                const t = clamp01(y / deck);
                s = 1 + o.flare * (1 - wb) * Math.pow(t, 1.4) - 0.02 * t;
            }
            return hw * p * s;
        };
        const pos = [], col = [], idx = [];
        const cRed = new THREE.Color(o.colors.bottom), cBoot = new THREE.Color(o.colors.boot), cSide = new THREE.Color(o.colors.side);
        const ring = [];   // per station: array of vertex indices (port side; starboard mirrored)
        for (let i = 0; i <= NZ; i++) {
            const z = lerp(zS, zB, i / NZ);
            const k = keel(z), deck = o.sheer(z);
            const row = [];
            for (let j = 0; j <= NY; j++) {
                const y = lerp(k, deck, j / NY);
                const x = halfB(z, y);
                [1, -1].forEach(side => {
                    pos.push(side * x, y, z);
                    const c = y < -0.12 ? cRed : y < 0.55 ? cBoot : cSide;
                    // grime and rust streaks low on the topsides
                    const grime = y >= 0.55 ? 1 - 0.18 * Math.exp(-(y - 0.55) / 1.2) - 0.05 * Math.max(0, Math.sin(z * 1.7 + side) * Math.sin(z * 0.37)) : 1;
                    col.push(c.r * grime, c.g * grime, c.b * grime);
                });
                row.push(pos.length / 3 - 2);   // port index; starboard is +1
            }
            ring.push(row);
        }
        for (let i = 0; i < NZ; i++) {
            for (let j = 0; j < NY; j++) {
                const a = ring[i][j], b = ring[i + 1][j], c = ring[i][j + 1], d = ring[i + 1][j + 1];
                idx.push(a, b, c, b, d, c);                         // port
                idx.push(a + 1, c + 1, b + 1, b + 1, c + 1, d + 1); // starboard
            }
            // keel seam
            idx.push(ring[i][0], ring[i][0] + 1, ring[i + 1][0], ring[i + 1][0], ring[i][0] + 1, ring[i + 1][0] + 1);
        }
        // Transom / stern closure
        const r0 = ring[0];
        for (let j = 0; j < NY; j++) idx.push(r0[j], r0[j] + 1, r0[j + 1], r0[j + 1], r0[j] + 1, r0[j + 1] + 1);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        const g = new THREE.Group();
        const hullMesh = add(g, geo, mats().hull);
        hullMesh.receiveShadow = true;
        // Deck: a strip between the deck edges, a hair below the sheer
        const dpos = [], didx = [];
        for (let i = 0; i <= NZ; i++) {
            const z = lerp(zS, zB, i / NZ), y = o.sheer(z) - 0.03, x = halfB(z, o.sheer(z)) * 0.995;
            dpos.push(x, y, z, -x, y, z);
            if (i < NZ) { const a = i * 2; didx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
        }
        const dgeo = new THREE.BufferGeometry();
        dgeo.setAttribute('position', new THREE.Float32BufferAttribute(dpos, 3));
        dgeo.setIndex(didx);
        dgeo.computeVertexNormals();
        add(g, dgeo, o.deckMat).receiveShadow = true;
        // Rows of scuttles along the crew spaces, and hawse pipes at the bow
        if (o.scuttles) {
            const pts = [];
            o.scuttles.forEach(([z0, z1, dy]) => {
                for (let z = z0; z <= z1; z += 1.3) {
                    const y = o.sheer(z) - dy;
                    [1, -1].forEach(side => pts.push([side * (halfB(z, y) + 0.03), y, z, side]));
                }
            });
            const sgeo = CylX(0.16, 0.06, 8);
            const inst = new THREE.InstancedMesh(sgeo, mats().black, pts.length);
            const d = new THREE.Object3D();
            pts.forEach(([x, y, z], i) => { d.position.set(x, y, z); d.updateMatrix(); inst.setMatrixAt(i, d.matrix); });
            g.add(inst);
        }
        [1, -1].forEach(side => {
            const z = zB - o.entry * 0.18, y = o.sheer(z) - 1.6;
            const h = add(g, CylX(0.32, 0.1, 10), mats().black, side * (halfB(z, y) + 0.02), y, z);
            h.scale.set(1, 1, 1.4);
        });
        g.userData.halfB = halfB;
        return g;
    }

    // Raised deck block (forecastle or poop) following the hull plan, as a deck level step
    function raisedDeck(g, halfB, z0, z1, y0, y1, mat, deckMat) {
        const pts = [], n = 14;
        for (let i = 0; i <= n; i++) { const z = lerp(z0, z1, i / n); pts.push([halfB(z, y0) * 0.99, z]); }
        for (let i = n; i >= 0; i--) { const z = lerp(z0, z1, i / n); pts.push([-halfB(z, y0) * 0.99, z]); }
        const ok = pts.filter(([x]) => Math.abs(x) > 0.05);
        // convex-ish outline: use a prism via ExtrudeGeometry on a Shape (x,z plane)
        const shape = new THREE.Shape();
        ok.forEach(([x, z], i) => i ? shape.lineTo(x, z) : shape.moveTo(x, z));
        const geo = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false });
        geo.rotateX(Math.PI / 2);
        geo.translate(0, y1, 0);
        add(g, geo, mat);
        const top = new THREE.ShapeGeometry(shape);
        top.rotateX(Math.PI / 2);
        top.translate(0, y1 + 0.02, 0);
        add(g, top, deckMat);
    }

    // IJN Type C twin 12.7 cm gunhouse: rounded, sloped front, flat roof falling aft, blast bags
    function twinTypeC(scale = 1) {
        const m = mats();
        const t = new THREE.Group();
        add(t, Cyl(1.75 * scale, 1.85 * scale, 0.3, 18), m.grayDark, 0, 0.15, 0);
        const base = [], top = [];
        for (let i = 0; i <= 10; i++) {
            const a = -Math.PI / 2 + Math.PI * i / 10;
            base.push([Math.sin(a) * 1.75, 1.15 + Math.cos(a) * 1.15]);
            top.push([Math.sin(a) * 1.5, 0.55 + Math.cos(a) * 0.95]);
        }
        base.push([1.75, -2.6], [-1.75, -2.6]);
        top.push([1.5, -2.45], [-1.5, -2.45]);
        // loftPrism wants matching counts in order around the outline
        const b2 = base.slice(0, 11).concat([[1.75, -2.6], [-1.75, -2.6]]).map(([x, z]) => [x * scale, z * scale]);
        const t2 = top.slice(0, 11).concat([[1.5, -2.45], [-1.5, -2.45]]).map(([x, z]) => [x * scale, z * scale]);
        add(t, loftPrism(b2, 0.3, t2, 0.3 + 2.25 * scale), m.gray);
        add(t, Box(0.6 * scale, 0.35 * scale, 0.9 * scale), m.grayDark, 1.0 * scale, 2.62 * scale, -0.6 * scale);   // sighting hood
        add(t, Box(0.6 * scale, 0.35 * scale, 0.9 * scale), m.grayDark, -1.0 * scale, 2.62 * scale, -0.6 * scale);
        const cradle = new THREE.Group();
        cradle.position.set(0, 1.25 * scale, 1.4 * scale);
        t.add(cradle);
        [-0.48, 0.48].forEach(x => {
            const b = CylZ(0.085, 0.12, 6.0 * scale, 10);
            b.translate(0, 0, 2.9 * scale);
            add(cradle, b, m.gun, x * scale, 0, 0);
            add(cradle, CylZ(0.22 * scale, 0.26 * scale, 0.6 * scale, 10), m.canvas, x * scale, 0, 0.25 * scale);
        });
        t.userData.cradle = cradle;
        return t;
    }

    // Single 14 cm/50 behind a curved open-backed shield (Nagara), or a Maru's old 12 cm gun
    function singleShielded(scale = 1, barrelLen = 6.2) {
        const m = mats();
        const t = new THREE.Group();
        add(t, Cyl(1.15 * scale, 1.25 * scale, 0.3, 14), m.grayDark, 0, 0.15, 0);
        const shield = new THREE.CylinderGeometry(1.35 * scale, 1.35 * scale, 2.0 * scale, 14, 1, true, -1.25, 2.5);
        add(t, shield, m.gray, 0, 1.3 * scale, -0.4 * scale);
        add(t, Box(2.4 * scale, 0.08, 1.4 * scale), m.gray, 0, 2.32 * scale, 0.2 * scale);   // roof
        add(t, Box(0.5 * scale, 0.9 * scale, 0.7 * scale), m.gun, 0, 0.75 * scale, -0.3 * scale);
        const cradle = new THREE.Group();
        cradle.position.set(0, 1.2 * scale, 0.5 * scale);
        t.add(cradle);
        const b = CylZ(0.075, 0.11, barrelLen * scale, 10);
        b.translate(0, 0, barrelLen * 0.48 * scale);
        add(cradle, b, m.gun);
        add(cradle, CylZ(0.18 * scale, 0.2 * scale, 0.5 * scale, 10), m.canvas, 0, 0, 0.6 * scale);
        t.userData.cradle = cradle;
        return t;
    }

    // Type 92 quadruple 61 cm torpedo mount with its splinter shield (muzzles toward +Z)
    function quadLauncher(tubes = 4) {
        const m = mats();
        const g = new THREE.Group();
        add(g, Cyl(1.6, 1.7, 0.4, 16), m.grayDark, 0, 0.2, 0);
        for (let i = 0; i < tubes; i++) add(g, CylZ(0.36, 0.36, 8.8, 10), m.gray, (i - (tubes - 1) / 2) * 0.8, 1.05, 0.6);
        add(g, loftPrism([[-1.9, 1.0], [1.9, 1.0], [2.0, -3.2], [-2.0, -3.2]], 0.45, [[-1.6, 0.2], [1.6, 0.2], [1.75, -3.0], [-1.75, -3.0]], 2.05), m.gray);
        add(g, Box(1.0, 0.7, 1.0), m.grayDark, -0.9, 2.3, -2.2);   // director hood
        return g;
    }

    // Raked oval funnel with a black-banded cap; returns the smoke point
    function funnel(g, z, y, h, wx, wz, rake = 0.16) {
        const m = mats();
        const f = new THREE.Group();
        f.position.set(0, y, z);
        f.rotation.x = -rake;
        g.add(f);
        const body = Cyl(1, 1, h, 18);
        body.scale(wx, 1, wz);
        add(f, body, m.gray, 0, h / 2, 0);
        const cap = Cyl(1.04, 1.0, 0.9, 18);
        cap.scale(wx, 1, wz);
        add(f, cap, m.black, 0, h - 0.35, 0);
        const lip = Cyl(1.0, 1.0, 0.12, 18);
        lip.scale(wx * 1.06, 1, wz * 1.06);
        add(f, lip, m.grayDark, 0, h * 0.62, 0);
        f.updateMatrix();
        return new THREE.Vector3(0, h, 0).applyMatrix4(f.matrix);
    }

    // Tripod mast: main leg with two raked legs, a starfish/spotting top and a topmast with yard
    function tripod(g, z, y, h, spread, yard, top = true) {
        const m = mats();
        add(g, Cyl(0.16, 0.3, h, 8), m.grayDark, 0, y + h / 2, z);
        [-1, 1].forEach(s => strut(g, new THREE.Vector3(s * spread, y, z - spread * 1.1), new THREE.Vector3(0, y + h * 0.66, z), 0.13, m.grayDark, 6));
        if (top) {
            add(g, Cyl(1.0, 0.7, 0.5, 10), m.grayDark, 0, y + h * 0.68, z);
            add(g, Box(1.6, 0.9, 1.4), m.gray, 0, y + h * 0.68 + 0.7, z);
        }
        if (yard) add(g, CylX(0.07, yard, 6), m.grayDark, 0, y + h * 0.85, z);
        add(g, Cyl(0.05, 0.08, h * 0.35, 6), m.grayDark, 0, y + h * 1.12, z);
    }

    // Rounded-front bridge tier (IJN style), optionally with a band of windows
    function bridgeTier(g, z, y, h, hw, depth, windows, mat) {
        const m = mats();
        add(g, prism(roundFrontOutline(hw, z - depth, z - hw * 0.6, hw * 0.9, 10), y, y + h), mat || m.gray);
        if (windows) {
            for (let i = -4; i <= 4; i++) {
                const a = i * Math.PI / 11;
                const w = add(g, Box(0.45, 0.55, 0.05), m.glass, Math.sin(a) * hw * 0.98, y + h * 0.62, z - hw * 0.6 + Math.cos(a) * hw * 0.9 * 0.99);
                w.rotation.y = a;
            }
        }
    }

    const deckOutline = (halfB, zs, y) => zs.map(z => [halfB(z, y), z]);

    // ===================== Kagero-class destroyer =====================
    function destroyer() {
        const m = mats();
        const L = 118.5, FCB = 12.5;   // forecastle break
        const sheer = z => z > FCB ? 6.0 + 2.2 * Math.pow(clamp01((z - FCB) / (L / 2 - FCB)), 1.9) : 3.7 + 0.3 * Math.pow(clamp01(-z / (L / 2)), 2);
        const g = loftHull({ L, B: 10.8, T: 3.8, sheer, rake: 7.0, entry: 36, run: 22, sternW: 0.18, flare: 0.26,
            colors: { bottom: 0x6e2a22, boot: 0x1a1b1c, side: 0x787d7b }, deckMat: m.lino, scuttles: [[16, 44, 1.3], [-40, -24, 1.0]] });
        const halfB = g.userData.halfB;
        // Forecastle sides close the step at the break
        add(g, Box(10.0, 2.35, 0.2), m.gray, 0, 4.85, FCB);
        // Turret A on the forecastle
        const turrets = [];
        const tA = twinTypeC(); tA.position.set(0, sheer(42), 42); g.add(tA);
        // Bridge: three rounded tiers with a big rangefinder on top
        const yb = sheer(33);
        bridgeTier(g, 35.5, yb, 2.3, 3.2, 8, false);
        bridgeTier(g, 35.2, yb + 2.3, 2.0, 2.9, 6.5, true);
        bridgeTier(g, 34.4, yb + 4.3, 1.4, 2.2, 4.2, false);
        add(g, Box(6.8, 0.15, 3.0), m.gray, 0, yb + 4.3, 31.5);                   // bridge wings
        add(g, Cyl(0.9, 1.0, 0.9, 12), m.grayDark, 0, yb + 6.15, 33.0);           // director base
        add(g, CylX(0.22, 4.6, 8), m.grayDark, 0, yb + 6.75, 33.0);               // 3 m rangefinder arms
        add(g, Box(1.6, 0.9, 1.4), m.gray, 0, yb + 6.75, 33.0);
        tripod(g, 28.5, yb + 1.0, 15, 1.4, 7.5);
        // Fore funnel (two boilers trunked, large oval) and reload lockers either side
        const stacks = [];
        stacks.push(funnel(g, 15.5, sheer(15.5) - 0.2, 8.6, 1.65, 2.4, 0.17));
        [-1, 1].forEach(s => add(g, Box(1.6, 1.3, 9.5), m.gray, s * 3.6, sheer(16) + 0.65, 16));
        // No. 1 torpedo mount between the funnels, on the main deck
        const t1 = quadLauncher(); t1.position.set(0, sheer(4.5), 4.5); g.add(t1);
        // After funnel (single boiler, smaller), searchlight platform
        stacks.push(funnel(g, -4.5, sheer(-4.5) + 2.0, 7.0, 1.25, 1.7, 0.17));
        add(g, Box(3.4, 2.0, 6.5), m.gray, 0, sheer(-4.5) + 1.0, -4.5);          // boiler casing under the stack
        add(g, Box(3.2, 0.2, 3.2), m.gray, 0, sheer(-10) + 3.4, -10);              // 25 mm AA platform
        [-1, 1].forEach(s => { const aa = add(g, CylZ(0.05, 0.05, 2.0, 6), m.gun, s * 0.6, sheer(-10) + 4.1, -9.2); aa.rotation.x = -0.6; });
        // No. 2 torpedo mount, reload lockers to starboard of the after deckhouse
        const t2 = quadLauncher(); t2.position.set(0, sheer(-16), -16); g.add(t2);
        add(g, Box(1.5, 1.3, 8), m.gray, -3.5, sheer(-25) + 0.65, -25);
        // Mainmast, after deckhouse with superfiring B, then C on the main deck
        add(g, Cyl(0.13, 0.22, 11, 8), m.grayDark, 0, sheer(-21) + 5.5, -21);
        add(g, CylX(0.06, 5, 6), m.grayDark, 0, sheer(-21) + 9, -21);
        add(g, Box(5.4, 2.4, 13), m.gray, 0, sheer(-31) + 1.2, -31);
        const tB = twinTypeC(); tB.position.set(0, sheer(-31) + 2.4, -31); tB.rotation.y = Math.PI; g.add(tB);
        const tC = twinTypeC(); tC.position.set(0, sheer(-42), -42); tC.rotation.y = Math.PI; g.add(tC);
        [tA, tB, tC].forEach(t => { t.userData.stowYaw = t.rotation.y; t.userData.aft = t.position.z < 0; turrets.push(t); });
        // Depth charge rails at the stern, boats amidships
        [-1, 1].forEach(s => {
            add(g, Box(0.5, 0.6, 6), m.grayDark, s * 1.6, sheer(-55) + 0.3, -55);
            const boat = add(g, Box(1.6, 1.0, 6.5), m.wood, s * 4.4, sheer(-1) + 1.6, -1);
            boat.scale.set(1, 1, 1);
        });
        return { group: g, turrets, torpLaunchers: [t1, t2], stacks, len: L, beam: 10.8, top: 13 };
    }

    // ===================== Nagara-class light cruiser =====================
    function cruiser() {
        const m = mats();
        const L = 162, FCB = 30;
        const sheer = z => z > FCB ? 7.3 + 2.4 * Math.pow(clamp01((z - FCB) / (L / 2 - FCB)), 1.9) : 4.6 + 0.4 * Math.pow(clamp01(-z / (L / 2)), 2);
        const g = loftHull({ L, B: 14.2, T: 4.8, sheer, rake: 8.5, entry: 48, run: 30, sternW: 0.2, flare: 0.2,
            colors: { bottom: 0x6e2a22, boot: 0x1a1b1c, side: 0x787d7b }, deckMat: m.lino, scuttles: [[34, 66, 1.4], [-70, -40, 1.1], [-38, 26, 1.0]] });
        add(g, Box(13.2, 2.8, 0.25), m.gray, 0, 6.0, FCB);
        const turrets = [];
        const gun = (x, y, z, yaw) => { const t = singleShielded(1.05); t.position.set(x, y, z); t.rotation.y = yaw; t.userData.stowYaw = yaw; t.userData.aft = z < 0; g.add(t); turrets.push(t); return t; };
        gun(0, sheer(66), 66, 0);                         // No. 1
        add(g, Box(3.0, 1.6, 3.2), m.gray, 0, sheer(57) + 0.8, 57);
        gun(0, sheer(57) + 1.6, 57, 0);                   // No. 2, superfiring before the bridge
        // Bridge tower with the hangar block underneath, compass platform and director
        const yb = sheer(48);
        add(g, Box(8.5, 3.2, 9), m.gray, 0, yb + 1.6, 46);
        bridgeTier(g, 50, yb + 3.2, 2.6, 3.6, 7, true);
        bridgeTier(g, 49, yb + 5.8, 2.2, 3.0, 5.5, true);
        bridgeTier(g, 48, yb + 8.0, 1.8, 2.3, 4.0, false);
        add(g, CylX(0.24, 6.0, 8), m.grayDark, 0, yb + 10.5, 46.5);
        add(g, Box(2.2, 1.1, 1.8), m.gray, 0, yb + 10.5, 46.5);
        tripod(g, 42, yb + 3, 20, 2.0, 10);
        gun(5.6, sheer(44), 44, 0.45);                    // No. 3, port side of the bridge
        gun(-5.6, sheer(44), 44, -0.45);                  // No. 4, starboard
        // Three raked funnels
        const stacks = [
            funnel(g, 24, sheer(24) - 0.2, 11.5, 1.7, 2.4, 0.14),
            funnel(g, 13, sheer(13) - 0.2, 12.0, 1.7, 2.4, 0.14),
            funnel(g, 2, sheer(2) - 0.2, 11.0, 1.6, 2.2, 0.14)
        ];
        add(g, Box(5.5, 2.4, 30), m.gray, 0, sheer(13) + 1.2, 13);                // boiler casings
        // Twin torpedo banks on either beam
        const tl = [];
        [[5.4, 19], [-5.4, 19], [5.4, 7], [-5.4, 7]].forEach(([x, z]) => {
            const t = quadLauncher(2); t.scale.setScalar(0.85); t.position.set(x, sheer(z), z); t.rotation.y = x > 0 ? 0.25 : -0.25; g.add(t); tl.push(t);
        });
        gun(0, sheer(-12) + 2.0, -12, Math.PI);           // No. 5 on the after deckhouse
        add(g, Box(6.5, 2.0, 16), m.gray, 0, sheer(-12) + 1.0, -13);
        // Catapult with a floatplane between Nos. 5 and 6, mainmast with the aircraft crane
        const cat = add(g, Box(1.2, 0.5, 19), m.grayDark, 0, sheer(-28) + 1.8, -28);
        cat.rotation.y = 0.12;
        add(g, Cyl(0.9, 1.1, 1.6, 10), m.grayDark, 0, sheer(-28) + 0.8, -28);
        const plane = new THREE.Group();
        plane.position.set(0, sheer(-28) + 2.6, -27);
        add(plane, CylZ(0.55, 0.6, 8.5, 8), m.grayLight);
        add(plane, Box(11, 0.2, 1.8), m.grayLight, 0, 0.6, 0.6);
        [-2.2, 2.2].forEach(x => add(plane, CylZ(0.3, 0.3, 5, 6), m.grayLight, x, -1.0, 0.5));
        g.add(plane);
        tripod(g, -38, sheer(-38), 16, 1.6, 7, false);
        strut(g, new THREE.Vector3(0, sheer(-38) + 10, -38), new THREE.Vector3(0, sheer(-38) + 4, -30), 0.12, m.grayDark);
        gun(0, sheer(-48) + 1.6, -48, Math.PI);           // No. 6, superfiring
        add(g, Box(3.0, 1.6, 3.2), m.gray, 0, sheer(-48) + 0.8, -48);
        gun(0, sheer(-62), -62, Math.PI);                 // No. 7 on the quarterdeck
        return { group: g, turrets, torpLaunchers: tl, stacks, len: L, beam: 14.2, top: 20 };
    }

    // ===================== Maru transport =====================
    function maru() {
        const m = mats();
        const L = 110;
        const sheer = z => 5.0 + 1.6 * Math.pow(clamp01(z / (L / 2)), 2) + 0.9 * Math.pow(clamp01(-z / (L / 2)), 2);
        const g = loftHull({ L, B: 15.2, T: 6.0, sheer, rake: 4.0, entry: 30, run: 24, sternW: 0.45, flare: 0.08,
            colors: { bottom: 0x6e2a22, boot: 0x1d1e20, side: 0x34373a }, deckMat: m.wood, scuttles: [[-6, 8, 1.2]] });
        const halfB = g.userData.halfB;
        // Raised forecastle and poop
        raisedDeck(g, halfB, 41, 54.2, sheer(41), sheer(47) + 2.3, m.gray, m.wood);
        raisedDeck(g, halfB, -54.2, -42, sheer(-42), sheer(-47) + 2.4, m.gray, m.wood);
        // Midships house: bridge front at the fore end, funnel and boats behind
        add(g, Box(13.5, 2.6, 22), m.maruUpper, 0, sheer(0) + 1.3, 0);
        add(g, Box(11, 2.4, 14), m.maruUpper, 0, sheer(0) + 3.8, 2.5);
        add(g, Box(7.5, 2.2, 5.5), m.maruUpper, 0, sheer(0) + 6.1, 7.0);
        add(g, Box(7.6, 0.6, 5.6), m.glass, 0, sheer(0) + 6.6, 7.05);
        add(g, Box(14.5, 0.15, 3.0), m.maruUpper, 0, sheer(0) + 5.0, 8.0);        // bridge wings
        const stacks = [funnel(g, -3.5, sheer(0) + 5.0, 8.5, 1.9, 2.6, 0.06)];
        [-1, 1].forEach(s => {
            [-7, 2].forEach(z => {
                const boat = add(g, Box(1.8, 1.0, 6.5), m.wood, s * 6.2, sheer(0) + 5.3, z);
                strut(g, new THREE.Vector3(s * 5.3, sheer(0) + 5.0, z + 2.5), new THREE.Vector3(s * 6.4, sheer(0) + 7.3, z + 2.5), 0.07, m.maruUpper);
                strut(g, new THREE.Vector3(s * 5.3, sheer(0) + 5.0, z - 2.5), new THREE.Vector3(s * 6.4, sheer(0) + 7.3, z - 2.5), 0.07, m.maruUpper);
                boat.userData.boat = true;
            });
        });
        // Hatches with tarpaulins, masts and kingposts with derricks
        [33, 20, -17, -30].forEach(z => {
            add(g, Box(7.2, 1.0, 7.5), m.grayDark, 0, sheer(z) + 0.5, z);
            add(g, Box(7.0, 0.25, 7.3), m.canvas, 0, sheer(z) + 1.12, z);
        });
        const mastAt = (z, h) => {
            add(g, Cyl(0.22, 0.32, h, 8), m.maruMast, 0, sheer(z) + h / 2, z);
            add(g, Cyl(0.05, 0.08, 5, 6), m.maruMast, 0, sheer(z) + h + 2.5, z);
            add(g, CylX(0.06, 6, 6), m.maruMast, 0, sheer(z) + h * 0.85, z);
            [-1, 1].forEach(dir => [-1, 1].forEach(s => {
                strut(g, new THREE.Vector3(s * 0.6, sheer(z) + 1.6, z), new THREE.Vector3(s * 2.4, sheer(z) + h * 0.62, z + dir * 6.5), 0.11, m.maruMast);
            }));
            [-1, 1].forEach(s => add(g, Box(0.6, 3.6, 0.6), m.maruMast, s * 3.2, sheer(z) + 1.8, z));   // kingposts
        };
        mastAt(26.5, 17);
        mastAt(-23.5, 15);
        // Deck cargo: crated vehicles and drums on the after well deck
        for (let i = 0; i < 6; i++) add(g, Box(2.2, 1.6, 3.6), m.wood, (i % 2 ? 1 : -1) * 4.4, sheer(-38) + 0.8, -36 - (i >> 1) * 2.2);
        const gun = singleShielded(0.85, 4.5); gun.position.set(0, sheer(-50) + 2.4, -50); gun.rotation.y = Math.PI;
        gun.userData.stowYaw = Math.PI; gun.userData.aft = true; g.add(gun);
        const bowGun = singleShielded(0.75, 3.8); bowGun.position.set(0, sheer(50) + 2.3, 50);
        bowGun.userData.stowYaw = 0; bowGun.userData.aft = false; g.add(bowGun);
        return { group: g, turrets: [gun, bowGun], torpLaunchers: [], stacks, len: L, beam: 15.2, top: 16 };
    }

    // Daihatsu Type 14 m landing barge: open well with a bow ramp, a small armoured coxswain's position aft
    function daihatsu() {
        const m = mats();
        const g = new THREE.Group();
        const L = 14.9, B = 3.3;
        const hull = add(g, prism([[-B / 2, -L / 2], [B / 2, -L / 2], [B / 2, L / 2 - 2.2], [B / 2 - 0.5, L / 2], [-B / 2 + 0.5, L / 2], [-B / 2, L / 2 - 2.2]], -0.8, 1.2), m.grayDark);
        hull.receiveShadow = true;
        add(g, Box(B - 0.5, 0.1, L - 4.5), m.wood, 0, 0.2, -0.6);                   // well deck
        const ramp = add(g, Box(B - 1.0, 1.7, 0.18), m.gray, 0, 1.0, L / 2 - 0.3);   // bow ramp, raised
        ramp.rotation.x = -0.12;
        add(g, Box(1.8, 1.3, 1.6), m.gray, 0, 1.85, -L / 2 + 1.6);                  // coxswain's shelter
        add(g, Box(1.6, 0.25, 0.1), m.glass, 0, 2.2, -L / 2 + 2.42);
        add(g, Cyl(0.12, 0.12, 1.1, 6), m.black, 0.6, 2.3, -L / 2 + 0.6);           // diesel exhaust
        // A few troops and supply crates in the well
        for (let i = 0; i < 5; i++) add(g, Box(0.9, 0.7, 1.1), m.wood, (i % 2 ? 0.6 : -0.6), 0.6, 3 - i * 1.6);
        return { group: g, turrets: [], torpLaunchers: [], stacks: [new THREE.Vector3(0.6, 3, -L / 2 + 0.6)], len: L, beam: B, top: 3 };
    }

    return { destroyer, maru, cruiser, daihatsu };
})();
