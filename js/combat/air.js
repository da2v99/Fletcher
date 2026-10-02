// Japanese air raids: Aichi D3A "Val" dive bombers, Nakajima B5N "Kate" torpedo bombers and Mitsubishi A6M
// Zero fighters come in every few minutes (Settings.ctl.airRaids).
//   Val:  approaches at ~3,400 m, pushes over into a 55-60° dive, releases its 250 kg bomb at ~500 m and pulls
//         out low. Its bombsight logic is closed-loop: it steers so a bomb released now would land on the
//         ship's predicted position, so only a hard turn during the dive throws it off.
//   Kate: comes in low on the beam (30-40 m) and drops a Type 91 aerial torpedo (42 kn, ~2,000 m run) at about
//         1,000 m, then breaks away over the ship.
//   Zero: escorts the bombers, then strafes with two 20 mm cannon and two 7.7 mm guns, two or three passes.
// Flight: each plane turns toward a point within its load-factor limit and banks into the turn.

const PLANE_TYPES = {
    val: { name: 'Val', hp: 3.2, cruise: 95, maxG: 3.4, score: 200, span: 14.4 },
    kate: { name: 'Kate', hp: 3.0, cruise: 92, maxG: 3.0, score: 250, span: 15.5 },
    zero: { name: 'Zero', hp: 2.1, cruise: 112, maxG: 5.5, score: 150, span: 12.0 }
};

const Air = (() => {
    const planes = [], bombs = [];
    let mat = null, burntMat, propMat, G = null;
    let raidT = 120, raidNo = 0, raidSize = 0, raidDown = 0, raidLive = false, attackCalled = false;
    const _d = new THREE.Vector3(), _a = new THREE.Vector3(), _r = new THREE.Vector3(), _t = new THREE.Vector3(),
        _up = new THREE.Vector3(0, 1, 0), _p = new THREE.Vector3(), _ZERO = new THREE.Vector3();

    // ------------------------------------------------------------------ models
    const C = { top: 0x2c3826, under: 0xa9ada3, cowl: 0x18181a, glass: 0x48596a, red: 0xa1131a, white: 0xd2d2c8, yellow: 0xb5891c, metal: 0x5c5c58 };

    function lathe(L, R, prof) {
        const g = new THREE.LatheGeometry(prof.map(([r, z]) => new THREE.Vector2(Math.max(0.001, r * R), z * L)), 12);
        g.rotateX(Math.PI / 2);   // lathe axis Y -> fuselage along +Z (nose)
        return g;
    }
    // Wing planform: span, root chord, tip chord, elliptical or tapered, sweep of the leading edge, thickness, dihedral
    function wing(span, c0, c1, ellip, sweep, thick, dih) {
        const N = 18, le = [], te = [];
        for (let i = 0; i <= N; i++) {
            const x = -span / 2 + span * i / N, u = Math.abs(2 * x / span);
            let c = ellip ? c0 * Math.sqrt(Math.max(0.03, 1 - Math.pow(u, 2.4))) : lerp(c0, c1, u);
            if (!ellip && u > 0.86) c *= Math.sqrt(Math.max(0.06, 1 - Math.pow((u - 0.86) / 0.14, 2)));
            le.push([x, 0.28 * c - sweep * u]);
            te.push([x, -0.72 * c - sweep * u * 0.4]);
        }
        const sh = new THREE.Shape();
        sh.moveTo(le[0][0], -le[0][1]);
        le.forEach(([x, z]) => sh.lineTo(x, -z));
        te.reverse().forEach(([x, z]) => sh.lineTo(x, -z));
        const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: false });
        g.rotateX(-Math.PI / 2);
        g.translate(0, -thick / 2, 0);
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + Math.abs(p.getX(i)) * Math.tan(dih));
        g.computeVertexNormals();
        return g;
    }
    function fin(pts, thick) {
        const sh = new THREE.Shape();
        sh.moveTo(pts[0][0], pts[0][1]);
        pts.forEach(([z, y]) => sh.lineTo(z, y));
        const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: false });
        g.rotateY(-Math.PI / 2);
        g.translate(thick / 2, 0, 0);
        return g;
    }
    const disc = (r, h = 0.03) => new THREE.CylinderGeometry(r, r, h, 18);
    // Hinomaru: red discs on the wings (upper and lower) and the fuselage sides, white-ringed on the fuselage
    function roundels(k, span, dih, wy, wz, L, R) {
        [-1, 1].forEach(s => {
            const x = s * span * 0.33, y = wy + Math.abs(x) * Math.tan(dih);
            k.add(disc(0.62), C.red, MX(x, y + 0.08, wz));
            k.add(disc(0.62), C.red, MX(x, y - 0.08, wz));
            k.add(disc(0.5, 0.02).rotateZ(Math.PI / 2), C.white, MX(s * R * 0.93, 0.05, -L * 0.22));
            k.add(disc(0.4, 0.03).rotateZ(Math.PI / 2), C.red, MX(s * R * 0.95, 0.05, -L * 0.22));
        });
    }
    function common(k, L, R, span, c0, ellip, dih, wingY, wingZ, canopyLen, canopyZ) {
        const tt = [C.top, C.under];
        k.add(lathe(L, R, [[0.06, -0.5], [0.16, -0.45], [0.36, -0.27], [0.6, -0.05], [0.84, 0.15], [0.98, 0.3], [1, 0.38], [0.97, 0.46], [0.72, 0.5]]), tt, MX());
        k.add(new THREE.CylinderGeometry(R * 1.05, R * 1.08, 1.0, 14, 1, true).rotateX(Math.PI / 2), C.cowl, MX(0, 0, L * 0.5 - 0.45));
        k.add(disc(R * 0.98, 0.06).rotateX(Math.PI / 2), C.cowl, MX(0, 0, L * 0.5 + 0.03));
        k.add(new THREE.CylinderGeometry(0, 0.2, 0.55, 10).rotateX(Math.PI / 2), C.metal, MX(0, 0, L * 0.5 + 0.3));
        k.add(wing(span, c0, c0 * 0.42, ellip, 0.15, 0.24, dih), tt, MX(0, wingY, wingZ));
        // Yellow identification stripes on the inboard leading edges
        [-1, 1].forEach(s => k.box(span * 0.17, 0.26, 0.22, C.yellow, s * span * 0.16, wingY + span * 0.16 * Math.tan(dih), wingZ + c0 * 0.26));
        k.add(wing(span * 0.33, 1.25, 0.7, false, 0.25, 0.1, 0), tt, MX(0, 0.15, -L * 0.44));
        k.add(fin([[-L * 0.5, 0], [-L * 0.5 + 1.6, 0], [-L * 0.5 + 0.55, 1.3], [-L * 0.5 + 0.1, 1.6], [-L * 0.5 - 0.35, 1.3], [-L * 0.5 - 0.25, 0.2]], 0.12), C.top, MX(0, R * 0.4, 0));
        k.add(new THREE.CylinderGeometry(0.4, 0.42, canopyLen, 8).rotateX(Math.PI / 2), C.glass, MX(0, R * 0.78, canopyZ, 0, 0, 0, 1, 1.25, 1));
        roundels(k, span, dih, wingY, wingZ, L, R);
    }
    function buildModels() {
        if (G) return G;
        // A little self-light: seen from the ship, the undersides face the dark sea and would read as black
        mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2, flatShading: true, side: THREE.DoubleSide, emissive: 0x1c2024 });
        burntMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.1, flatShading: true, side: THREE.DoubleSide, color: 0x3a3532 });
        propMat = new THREE.MeshBasicMaterial({ color: 0x151515, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
        G = {};
        // Val: elliptical wing, fixed spatted undercarriage, long greenhouse, 250 kg bomb on a swing-out crutch
        {
            const L = 10.2, R = 0.72, k = colorKit();
            common(k, L, R, 14.4, 2.75, true, 0.1, -0.35, 0.25, 3.4, 0.0);
            [-1, 1].forEach(s => {
                k.strut(s * 1.6, -0.45, 0.85, s * 1.75, -1.45, 0.95, 0.07, C.under);
                k.add(new THREE.SphereGeometry(0.42, 10, 8), C.top, MX(s * 1.75, -1.62, 0.9, 0, 0, 0, 0.7, 0.9, 2.1));
            });
            const ord = colorKit();
            ord.add(new THREE.CylinderGeometry(0.15, 0.19, 1.5, 8).rotateX(Math.PI / 2), 0x2c2c2a, MX(0, -R - 0.35, 0.4));
            ord.add(new THREE.CylinderGeometry(0, 0.19, 0.35, 8).rotateX(Math.PI / 2), 0x2c2c2a, MX(0, -R - 0.35, 1.32));
            G.val = { body: k.build(), ord: ord.build(), prop: 1.6, noseZ: L * 0.5 + 0.35 };
        }
        // Kate: tapered wing, retracted gear, three-seat greenhouse, Type 91 torpedo offset to starboard
        {
            const L = 10.3, R = 0.68, k = colorKit();
            common(k, L, R, 15.5, 2.9, false, 0.09, -0.38, 0.15, 4.4, -0.3);
            const ord = colorKit();
            ord.add(new THREE.CylinderGeometry(0.23, 0.23, 4.6, 10).rotateX(Math.PI / 2), 0x3a3d40, MX(-0.15, -R - 0.32, 0.3));
            ord.add(new THREE.SphereGeometry(0.23, 10, 6), 0x3a3d40, MX(-0.15, -R - 0.32, 2.6, 0, 0, 0, 1, 1, 1.4));
            ord.box(0.7, 0.04, 0.4, 0x3a3d40, -0.15, -R - 0.32, -2.1);
            G.kate = { body: k.build(), ord: ord.build(), prop: 1.65, noseZ: L * 0.5 + 0.35 };
        }
        // Zero: slim fuselage, round-tipped wing, short bubble canopy
        {
            const L = 9.1, R = 0.62, k = colorKit();
            common(k, L, R, 12.0, 2.5, false, 0.11, -0.3, 0.4, 2.0, 0.2);
            [-1, 1].forEach(s => k.add(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 6).rotateX(Math.PI / 2), C.metal, MX(s * 2.3, -0.38 + 2.3 * Math.tan(0.11), 1.9)));
            G.zero = { body: k.build(), ord: null, prop: 1.45, noseZ: L * 0.5 + 0.35 };
        }
        const b = colorKit();
        b.add(new THREE.CylinderGeometry(0.17, 0.19, 1.5, 8).rotateX(Math.PI / 2), 0x2c2c2a, MX());
        b.add(new THREE.CylinderGeometry(0, 0.19, 0.35, 8).rotateX(Math.PI / 2), 0x2c2c2a, MX(0, 0, 0.92));
        b.box(0.6, 0.03, 0.3, 0x2c2c2a, 0, 0, -0.7); b.box(0.03, 0.6, 0.3, 0x2c2c2a, 0, 0, -0.7);
        G.bomb = b.build();
        G.propDisc = r => new THREE.CircleGeometry(r, 20);
        return G;
    }

    // ------------------------------------------------------------------ spawning
    function makePlane(kind, pos, heading) {
        buildModels();
        const T = PLANE_TYPES[kind], M = G[kind];
        const obj = new THREE.Group();
        const body = new THREE.Mesh(M.body, mat);
        obj.add(body);
        let ord = null;
        if (M.ord) { ord = new THREE.Mesh(M.ord, mat); obj.add(ord); }
        const prop = new THREE.Mesh(G.propDisc(M.prop), propMat);
        prop.position.z = M.noseZ;
        obj.add(prop);
        obj.position.copy(pos);
        scene.add(obj);
        const fwd = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
        const p = {
            kind, type: T, obj, body, ord, prop, pos: pos.clone(), fwd, vel: fwd.clone().multiplyScalar(T.cruise), speed: T.cruise, bank: 0,
            hp: T.hp, state: kind === 'zero' ? 'escort' : 'approach', t: 0, alive: true, falling: false, sinking: false, gone: false,
            isAir: true, x: pos.x, z: pos.z, lockY: pos.y, heading, payload: kind !== 'zero', passes: 0, fireT: 0, burstT: 0, smokeAcc: 0,
            aimErr: new THREE.Vector3(randn() * 22, 0, randn() * 22), shortfall: new THREE.Vector3(), dropR: rnd(950, 1250),
            side: Math.random() < 0.5 ? -1 : 1, spin: 0, leader: null, offset: new THREE.Vector3(), wp: new THREE.Vector3(), alt: pos.y
        };
        planes.push(p);
        return p;
    }

    function spawnRaid() {
        raidNo++;
        const strength = Game.mode === 'patrol' ? Math.min(7, 2 + Math.floor((Game.wave + raidNo) / 2)) : 2 + Math.floor(Math.random() * 3);
        const comp = [];
        for (let i = 0; i < strength; i++) {
            const r = Math.random();
            comp.push(i === 0 ? (Math.random() < 0.55 ? 'val' : 'kate') : r < 0.38 ? 'val' : r < 0.68 ? 'kate' : 'zero');
        }
        const brg = Math.random() * Math.PI * 2, dist = rnd(7800, 9200);
        const cx = phys.pos.x + Math.sin(brg) * dist, cz = phys.pos.z + Math.cos(brg) * dist;
        const hd = brg + Math.PI;
        let leader = null;
        comp.forEach((kind, i) => {
            const alt = kind === 'kate' ? 170 : kind === 'zero' ? 2900 : 3400;
            const side = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 70, back = Math.ceil(i / 2) * 45;
            const pos = new THREE.Vector3(cx + Math.cos(hd) * side - Math.sin(hd) * back, alt + rnd(-60, 60), cz - Math.sin(hd) * side - Math.cos(hd) * back);
            const p = makePlane(kind, pos, hd);
            if (kind !== 'zero' && !leader) leader = p;
            if (kind === 'zero') { p.offset.set(randn() * 150, 350 + Math.random() * 200, -150 - Math.random() * 200); p.state = 'escort'; }
        });
        planes.forEach(p => { if (p.kind === 'zero' && !p.leader) p.leader = leader; });
        raidSize = comp.length; raidDown = 0; raidLive = true; attackCalled = false;
        const vals = comp.filter(k => k === 'val').length, kates = comp.filter(k => k === 'kate').length, zeros = comp.filter(k => k === 'zero').length;
        const what = [vals && `${vals} Val${vals > 1 ? 's' : ''}`, kates && `${kates} Kate${kates > 1 ? 's' : ''}`, zeros && `${zeros} Zero${zeros > 1 ? 's' : ''}`].filter(Boolean).join(', ');
        hudMessage(`AIR RAID! ${comp.length} bogeys bearing ${fmt3(compassDeg(Math.sin(brg), Math.cos(brg)))}, ${(dist / 1852).toFixed(0)} miles — ${what}. ${Settings.touchUI ? 'Tap AA' : 'Press G'} to man a gun.`, 'alert');
        playAlarm();
        showBanner('Air raid', `${what} inbound`);
    }

    function nextDelay(first) {
        const f = Settings.ctl.airRaids === 'frequent' ? 0.5 : 1;
        return (first ? rnd(80, 130) : rnd(150, 250)) * f;
    }

    // ------------------------------------------------------------------ flight
    // Turn toward `target` within the load factor maxG, bank into the turn, hold speedWant (dives speed up)
    function fly(p, dt, target, speedWant, maxG) {
        _d.subVectors(target, p.pos);
        const dist = _d.length();
        if (dist > 1e-3) {
            _d.divideScalar(dist);
            const h0 = Math.atan2(p.fwd.x, p.fwd.z);
            const omega = maxG * GRAVITY / Math.max(p.speed, 35);
            const ang = Math.acos(THREE.MathUtils.clamp(p.fwd.dot(_d), -1, 1));
            if (ang > 1e-5) {
                _a.crossVectors(p.fwd, _d);
                if (_a.lengthSq() < 1e-10) _a.set(0, 1, 0);
                p.fwd.applyAxisAngle(_a.normalize(), Math.min(ang, omega * dt)).normalize();
            }
            const yawRate = wrapAngle(Math.atan2(p.fwd.x, p.fwd.z) - h0) / Math.max(dt, 1e-4);
            const bankT = THREE.MathUtils.clamp(-Math.atan(p.speed * yawRate / GRAVITY), -1.3, 1.3);
            p.bank += (bankT - p.bank) * Math.min(1, dt * 3);
        }
        p.speed += THREE.MathUtils.clamp(speedWant - p.speed, -7 * dt, 7 * dt) - p.fwd.y * GRAVITY * dt * 0.45;
        p.speed = THREE.MathUtils.clamp(p.speed, 45, 175);
        p.vel.copy(p.fwd).multiplyScalar(p.speed);
        p.pos.addScaledVector(p.vel, dt);
        return dist;
    }

    // Never fly into the sea or a hill (alive planes): raise the target over the terrain ahead
    function floorFor(p, target, minAlt) {
        _p.copy(p.pos).addScaledVector(p.fwd, Math.max(300, p.speed * 4));
        const g = Math.max(Islands.groundAt(_p.x, _p.z), Islands.groundAt(p.pos.x, p.pos.z), 0);
        if (target.y < g + minAlt) target.y = g + minAlt;
        return target;
    }

    function shipAhead(t, out) { return out.set(phys.pos.x + phys.vel.x * t, 0, phys.pos.z + phys.vel.z * t); }

    // Where a bomb released now would hit the sea (or null if the plane isn't diving)
    function bombImpact(p, out) {
        const vy = p.vel.y, y = p.pos.y;
        const disc = vy * vy + 2 * GRAVITY * y;
        const tf = (vy + Math.sqrt(Math.max(disc, 0))) / GRAVITY;
        return out.set(p.pos.x + p.vel.x * tf, 0, p.pos.z + p.vel.z * tf).setY(tf);
    }

    function updatePlane(p, dt, t) {
        p.t += dt;
        const T = p.type;
        const dx = phys.pos.x - p.pos.x, dz = phys.pos.z - p.pos.z, dH = Math.hypot(dx, dz);
        const tgt = _t;
        if (p.kind === 'val') {
            if (p.state === 'approach') {
                // To the push-over point ~2.2 km short of the ship, high
                tgt.set(phys.pos.x - dx / dH * 1900, 3400, phys.pos.z - dz / dH * 1900);
                fly(p, dt, floorFor(p, tgt, 150), T.cruise, 2.0);
                if (dH < 2350 && p.pos.y > 1500) { p.state = 'dive'; p.t = 0; callAttack('Dive bombers!'); }
            } else if (p.state === 'dive') {
                // Closed-loop dive: steer so the bomb's impact point lands on the ship where it will be
                const imp = bombImpact(p, _r);   // (y carries the bomb's time of fall)
                shipAhead(imp.y, _a).add(p.aimErr);
                // where the flight path meets the sea, versus where the bomb would land: aim long by the difference
                const tLine = p.vel.y < -1 ? p.pos.y / -p.vel.y : 0;
                if (tLine > 0) p.shortfall.set(p.pos.x + p.vel.x * tLine - imp.x, 0, p.pos.z + p.vel.z * tLine - imp.z);
                tgt.copy(_a).add(p.shortfall);
                fly(p, dt, tgt, 128, 2.6);
                if (p.pos.y < 520 && p.payload) { dropBomb(p); p.state = 'pullout'; }
                if (p.pos.y < 300) p.state = 'pullout';
            } else if (p.state === 'pullout') {
                tgt.set(p.pos.x + p.fwd.x * 1200, 260, p.pos.z + p.fwd.z * 1200);
                fly(p, dt, floorFor(p, tgt, 60), T.cruise + 15, 5.5);
                if (p.fwd.y > 0.05 || p.t > 12) { p.state = 'egress'; p.t = 0; }
            } else egress(p, dt, dH);
        } else if (p.kind === 'kate') {
            const hdg = Math.atan2(phys.vel.x, phys.vel.z) || phys.heading;
            if (p.state === 'approach') {
                // Round to a point off the ship's beam, low
                const bx = Math.sin(hdg + p.side * Math.PI / 2), bz = Math.cos(hdg + p.side * Math.PI / 2);
                tgt.set(phys.pos.x + bx * 4300 + Math.sin(hdg) * 900, dH < 6500 ? 45 : 170, phys.pos.z + bz * 4300 + Math.cos(hdg) * 900);
                const d = fly(p, dt, floorFor(p, tgt, 30), T.cruise, 2.4);
                if (d < 700 || dH < 4400) { p.state = 'run'; p.t = 0; callAttack('Torpedo bombers low on the beam!'); }
            } else if (p.state === 'run') {
                const ic = interceptHeading(p.pos, TORP_TYPES.type91.speed, phys.pos, phys.vel);
                const h = ic ? ic.heading : Math.atan2(dx, dz);
                tgt.set(p.pos.x + Math.sin(h) * 1200, 32, p.pos.z + Math.cos(h) * 1200);
                fly(p, dt, floorFor(p, tgt, 22), 95, 2.2);
                const ph = Math.atan2(p.fwd.x, p.fwd.z);
                if (p.payload && dH < p.dropR && Math.abs(wrapAngle(ph - h)) < 10 * DEG) {
                    p.payload = false;
                    if (p.ord) p.ord.visible = false;
                    launchTorpedo(new THREE.Vector3(p.pos.x, Math.max(p.pos.y - 1.5, 2), p.pos.z), h + randn() * 2 * DEG, 'enemy', 'type91');
                    p.state = 'breakaway'; p.t = 0;
                }
                if (dH < 450) { p.state = 'breakaway'; p.t = 0; }
            } else if (p.state === 'breakaway') {
                tgt.set(phys.pos.x + p.fwd.x * 1500 + p.side * 300, 140, phys.pos.z + p.fwd.z * 1500);
                fly(p, dt, floorFor(p, tgt, 40), T.cruise + 10, 3.5);
                if (p.t > 14) { p.state = 'egress'; p.t = 0; }
            } else egress(p, dt, dH);
        } else {
            if (p.state === 'escort') {
                const L = p.leader && p.leader.alive ? p.leader : null;
                if (L) tgt.copy(L.pos).add(p.offset); else tgt.set(phys.pos.x, 1500, phys.pos.z);
                fly(p, dt, floorFor(p, tgt, 200), T.cruise + 5, 3);
                if (!L || L.state !== 'approach' || dH < 4200) { p.state = 'setup'; p.t = 0; p.wp.set(NaN, 0, 0); }
            } else if (p.state === 'setup') {
                if (isNaN(p.wp.x)) { const a = Math.random() * Math.PI * 2; p.wp.set(Math.sin(a) * 2700, 420, Math.cos(a) * 2700); }
                tgt.set(phys.pos.x + p.wp.x, p.wp.y, phys.pos.z + p.wp.z);
                const d = fly(p, dt, floorFor(p, tgt, 150), T.cruise + 10, 4.5);
                if (d < 450 || p.t > 25) { p.state = 'strafe'; p.t = 0; p.burstT = 0; }
            } else if (p.state === 'strafe') {
                shipAhead(dH / 140, tgt).y = 4;
                fly(p, dt, floorFor(p, tgt, 25), 140, 4);
                const toShip = _a.set(phys.pos.x - p.pos.x, phys.pos.y + 4 - p.pos.y, phys.pos.z - p.pos.z).normalize();
                if (dH < 950 && dH > 250 && p.fwd.dot(toShip) > 0.995) strafe(p, dt);
                if (dH < 260 || p.pos.y < 30 || p.t > 30) { p.state = 'zoom'; p.t = 0; p.passes++; }
            } else if (p.state === 'zoom') {
                tgt.set(p.pos.x + p.fwd.x * 700, 600, p.pos.z + p.fwd.z * 700);
                fly(p, dt, floorFor(p, tgt, 100), T.cruise, 5.5);
                if (p.pos.y > 380 || p.t > 9) { p.state = p.passes < 3 ? 'setup' : 'egress'; p.t = 0; p.wp.set(NaN, 0, 0); }
            } else egress(p, dt, dH);
        }
        return dH;
    }
    function egress(p, dt, dH) {
        const ax = -(phys.pos.x - p.pos.x) / Math.max(dH, 1), az = -(phys.pos.z - p.pos.z) / Math.max(dH, 1);
        _t.set(p.pos.x + ax * 3000, p.kind === 'kate' ? 150 : 600, p.pos.z + az * 3000);
        fly(p, dt, floorFor(p, _t, 80), p.type.cruise + 12, 2.5);
        if (dH > 9500) p.gone = true;
    }
    function callAttack(msg) {
        if (attackCalled || !Game.running) return;
        attackCalled = true;
        hudMessage(`${msg} All AA guns, commence firing!`, 'alert');
    }

    // ------------------------------------------------------------------ weapons
    const _sp = new THREE.Vector3();
    function hitsShip(a, b) {
        const ax = a.x - phys.pos.x, az = a.z - phys.pos.z, bx = b.x - phys.pos.x, bz = b.z - phys.pos.z;
        if (ax * ax + az * az > 8100 && bx * bx + bz * bz > 8100) return null;
        for (let k = 1; k <= 4; k++) if (playerHitTest(_sp.copy(a).lerp(b, k / 4))) return true;
        return null;
    }
    function strafeHit(p, dmg, cannon, prev) {
        FX.spark(p, cannon ? 10 : 4);
        if (prev) Wreck.bullet(myShip, prev, p, cannon ? 0.24 : 0.09);
        if (playerDmg.sinking || !Game.running) return;
        playerDmg.hull -= dmg;
        if (cannon && typeof AA !== 'undefined') AA.strafed(p);
        if (cannon && Math.random() < 0.025 && playerDmg.fires.length < 6) {
            playerDmg.fires.push({ local: myShip.worldToLocal(p.clone()), t: rnd(10, 20) });
            hudMessage('Strafing run started a fire!', 'alert');
        }
    }
    const splashSmall = p => FX.smallSplash(p.x, waterHeight(p.x, p.z, simTime), p.z, 0.6);
    const GUN20 = { color: [1, 0.72, 0.35], drag: 7e-4, life: 2.4, size: 1.0, test: hitsShip, onHit: (h, p, prev) => strafeHit(p, 0.3, true, prev), onWater: splashSmall };
    const GUN77 = { color: [1, 0.92, 0.65], drag: 1e-3, life: 1.9, size: 0.55, test: hitsShip, onHit: (h, p, prev) => strafeHit(p, 0.025, false, prev), onWater: splashSmall };
    function strafe(p, dt) {
        p.fireT -= dt;
        if (p.burstT <= 0) {
            p.burstT = 1;
            playBurst(p.pos, 14, 0.07, 0.4, 1.6);
        }
        p.burstT -= dt;
        while (p.fireT <= 0) {
            p.fireT += 0.055;
            const cannon = Math.random() < 0.4;
            const s = cannon ? (Math.random() < 0.5 ? -2.3 : 2.3) : (Math.random() < 0.5 ? -0.25 : 0.25);
            _r.set(-p.fwd.z, 0, p.fwd.x).normalize();
            _p.copy(p.pos).addScaledVector(_r, s).addScaledVector(p.fwd, 2);
            _d.copy(p.fwd);
            const spread = cannon ? 0.012 : 0.008;
            _d.x += randn() * spread; _d.y += randn() * spread; _d.z += randn() * spread;
            _d.normalize().multiplyScalar(cannon ? 600 : 750).add(p.vel);
            Tracers.fire(_p, _d, cannon ? GUN20 : GUN77);
        }
    }

    function dropBomb(p) {
        p.payload = false;
        if (p.ord) p.ord.visible = false;
        const mesh = new THREE.Mesh(G.bomb, mat);
        mesh.position.copy(p.pos);
        scene.add(mesh);
        bombs.push({ pos: p.pos.clone().addScaledVector(_up, -1.4), vel: p.vel.clone(), mesh, whistled: false });
    }
    function updateBombs(dt, t) {
        for (let i = bombs.length - 1; i >= 0; i--) {
            const b = bombs[i];
            let done = false;
            for (let k = 0; k < 3 && !done; k++) {
                const h = dt / 3;
                b.vel.y -= GRAVITY * h;
                b.pos.addScaledVector(b.vel, h);
                if (playerHitTest(b.pos, 0.8)) { bombHit(b.pos.clone()); done = true; break; }
                const g = Islands.groundAt(b.pos.x, b.pos.z);
                if (b.pos.y < g) {
                    const pp = b.pos.clone().setY(g);
                    FX.dirt(pp, 2.4); playBoom(pp, 1.8, 400, 3.5);
                    Islands.impact(pp, 2.6, null, false);
                    done = true;
                } else if (b.pos.y < 3) {
                    const wh = waterHeight(b.pos.x, b.pos.z, t);
                    if (b.pos.y < wh) {
                        FX.splash(b.pos.x, wh, b.pos.z, WHITE_SPRAY, 1.8);
                        playBoom(b.pos, 1.5, 450, 3);
                        if (playerHitTest(b.pos, 16)) nearMiss(b.pos.clone());
                        done = true;
                    }
                }
            }
            if (!done && !b.whistled && b.vel.y < 0) {
                const d = b.pos.distanceTo(camera.position);
                if (d < 700) { b.whistled = true; playWhistle(b.pos, d / b.vel.length()); }
            }
            if (done) { scene.remove(b.mesh); bombs.splice(i, 1); continue; }
            b.mesh.position.copy(b.pos);
            b.mesh.lookAt(_p.copy(b.pos).add(b.vel));
        }
    }
    function bombHit(p) {
        FX.explosion(p, 1.9);
        playBoom(p, 2.2, 650, 3.5);
        cameraShake(1.8);
        if (playerDmg.sinking) return;
        const local = myShip.worldToLocal(p.clone());
        // A crater blown in her: straight down through the deck where it struck
        if (HullDamage.onPlayer(local, 3, p.clone().setY(p.y + 14), new THREE.Vector3(0, -1, 0)) >= 100) breakPlayer();
        Debris.burst(p, 26, 0.9, { vel: phys.vel.clone(), speed: 1.2, smoky: 0.5, burning: 0.4 });
        playerDmg.hull -= rnd(10, 16);
        Game.stats.hitsTaken++;
        let msg = `BOMB HIT ${local.z > 20 ? 'forward' : local.z < -20 ? 'aft' : 'amidships'}!`;
        const mi = MOUNT_Z.findIndex(z => Math.abs(local.z - z) < 4.5);
        if (mi >= 0 && !guns[mi].disabled && Math.random() < 0.75) { guns[mi].disabled = true; msg += ` Mount 5${mi + 1} wrecked.`; }
        else if (Math.abs(local.z) < 16 && Math.random() < 0.45) { phys.engine = Math.max(0.3, phys.engine * 0.75); msg += ' Engine room damaged.'; }
        if (typeof AA !== 'undefined') AA.knockOut(local, 7);
        if (local.y < 2) { addFlood(local, 250000); msg += ' Flooding below decks.'; }
        if (playerDmg.fires.length < 6) { playerDmg.fires.push({ local: local.clone().setY(Math.max(local.y, sheerY(local.z) + 0.5)), t: rnd(25, 45) }); msg += ' Fire!'; }
        hudMessage(msg, 'alert');
        playAlarm();
    }
    function nearMiss(p) {
        cameraShake(0.9);
        if (playerDmg.sinking || !Game.running) return;
        playerDmg.hull -= rnd(0.8, 2.5);
        addFlood(myShip.worldToLocal(p.clone()).setY(-2), 60000);
        hudMessage('Near miss alongside — splinters and some flooding', 'warn');
    }

    // ------------------------------------------------------------------ damage
    function damage(p, amt, at, by) {
        if (!p.alive) return;
        p.hp -= amt;
        FX.spark(at, 5);
        if (p.hp <= 0) kill(p, by);
    }
    function kill(p, by) {
        p.alive = false; p.falling = true; p.sinking = true;
        raidDown++;
        if (typeof director !== 'undefined' && director.lock === p) director.lock = null;
        if (Game.running) {
            Game.stats.planes++;
            Game.score += p.type.score;
            hudMessage(by === 'you' ? `Splash one ${p.type.name}! +${p.type.score}` : `${by} splashed a ${p.type.name}! +${p.type.score}`, 'good');
        }
        if (Math.random() < 0.3) {
            // Blown apart in the air
            FX.explosion(p.pos.clone(), 1.1);
            playBoom(p.pos, 1.2, 800, 2.4);
            for (let i = 0; i < 26; i++) {
                const d = new THREE.Vector3(randn(), randn() + 0.3, randn()).normalize(), sp = rnd(10, 40);
                smokeFx.emit({ x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: p.vel.x * 0.5 + d.x * sp, vy: d.y * sp, vz: p.vel.z * 0.5 + d.z * sp,
                    life: rnd(2, 5), s0: rnd(0.4, 1.0), s1: 0.5, r: 0.1, g: 0.09, b: 0.08, a: 1, fade: 0.5, drag: 0.3, grav: GRAVITY });
            }
            p.gone = true;
        } else {
            p.spin = (Math.random() < 0.5 ? -1 : 1) * rnd(1.2, 2.8);
            p.body.material = burntMat;
        }
    }
    function updateFalling(p, dt, t) {
        _t.set(p.pos.x + p.fwd.x * 300, p.pos.y - 260, p.pos.z + p.fwd.z * 300);
        const bank = p.bank;
        fly(p, dt, _t, p.speed + 15, 1.6);
        p.bank = bank + p.spin * dt;
        p.smokeAcc += dt * 40 * Gfx.particleKeep;
        while (p.smokeAcc > 1) {
            p.smokeAcc -= 1;
            fireFx.emit({ x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: p.vel.x * 0.2 + randn(), vy: p.vel.y * 0.2 + randn(), vz: p.vel.z * 0.2 + randn(),
                life: rnd(0.25, 0.6), s0: rnd(2, 3.5), s1: rnd(4, 6), r: 1, g: 0.6, b: 0.2, r1: 0.8, g1: 0.2, b1: 0.05, a: 1, drag: 2, grav: -1 });
            smokeFx.emit({ x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: Sea.wind.x, vy: 1, vz: Sea.wind.y, life: rnd(6, 11), s0: rnd(2, 3), s1: rnd(10, 18),
                r: 0.08, g: 0.075, b: 0.07, a: 0.6, drag: 0.5, grav: -0.1 });
        }
        const g = Islands.groundAt(p.pos.x, p.pos.z), wh = p.pos.y < 30 ? waterHeight(p.pos.x, p.pos.z, t) : -1;
        if (p.pos.y < Math.max(g, wh)) {
            if (g > wh) { FX.dirt(p.pos.clone().setY(g), 1.6); Islands.impact(p.pos.clone().setY(g), 1.4, null, false); }
            else { FX.splash(p.pos.x, wh, p.pos.z, WHITE_SPRAY, 1.3); FX.explosion(p.pos.clone().setY(wh + 1), 0.7); }
            playBoom(p.pos, 1.2, 500, 2.5);
            if (playerHitTest(p.pos, 6)) { playerDmg.hull -= rnd(4, 8); hudMessage('A burning plane crashed into the ship!', 'alert'); }
            p.gone = true;
        }
    }

    // Damage-smoke trail on a hit plane
    function smokeTrail(p, dt) {
        const dmg = 1 - p.hp / p.type.hp;
        if (dmg < 0.3) return;
        p.smokeAcc += dt * 18 * dmg * Gfx.particleKeep;
        while (p.smokeAcc > 1) {
            p.smokeAcc -= 1;
            const gr = dmg > 0.65 ? 0.12 : 0.45;
            smokeFx.emit({ x: p.pos.x - p.fwd.x * 2, y: p.pos.y, z: p.pos.z - p.fwd.z * 2, vx: Sea.wind.x, vy: 0.5, vz: Sea.wind.y,
                life: rnd(3, 6), s0: 1.2, s1: rnd(5, 9), r: gr, g: gr, b: gr, a: 0.45, drag: 0.6, grav: 0 });
        }
    }

    // ------------------------------------------------------------------ loop
    function update(dt, t) {
        if (dt <= 0) return;
        const on = Game.running && !Game.over && Settings.ctl.airRaids !== 'off' && !playerDmg.sinking;
        if (on) {
            raidT -= dt;
            if (raidT <= 0 && !planes.some(p => p.alive)) { spawnRaid(); raidT = nextDelay(false); }
        }
        for (let i = planes.length - 1; i >= 0; i--) {
            const p = planes[i];
            if (p.alive) { updatePlane(p, dt, t); smokeTrail(p, dt); }
            else if (!p.gone) updateFalling(p, dt, t);
            if (p.gone) { scene.remove(p.obj); planes.splice(i, 1); continue; }
            p.x = p.pos.x; p.z = p.pos.z; p.lockY = p.pos.y; p.aimY = p.pos.y;
            p.heading = Math.atan2(p.vel.x, p.vel.z); p.speed2 = Math.hypot(p.vel.x, p.vel.z);
            p.obj.position.copy(p.pos);
            p.obj.lookAt(_p.copy(p.pos).add(p.fwd));
            p.obj.rotateZ(p.bank);
            p.prop.rotation.z += dt * 60;
        }
        updateBombs(dt, t);
        if (raidLive && !planes.length) {
            raidLive = false;
            if (Game.running) hudMessage(`Raid over: ${raidDown} of ${raidSize} shot down.`, raidDown ? 'good' : 'info');
        }
    }

    function reset() {
        planes.forEach(p => scene.remove(p.obj));
        planes.length = 0;
        bombs.forEach(b => scene.remove(b.mesh));
        bombs.length = 0;
        raidT = nextDelay(true);
        raidNo = 0; raidLive = false;
    }

    // Is a round passing through a plane? (segment a -> b against each live plane)
    function hitTest(a, b) {
        for (const p of planes) {
            if (!p.alive) continue;
            const r = p.type.span * 0.26;
            _d.subVectors(b, a);
            const l2 = _d.lengthSq();
            const f = l2 > 0 ? THREE.MathUtils.clamp(_a.subVectors(p.pos, a).dot(_d) / l2, 0, 1) : 0;
            _r.copy(a).addScaledVector(_d, f);
            if (_r.distanceToSquared(p.pos) < r * r && Math.random() < 0.55) return p;
        }
        return null;
    }
    function proximity(pos, r) {
        let best = null, bd = r;
        for (const p of planes) { if (!p.alive) continue; const d = p.pos.distanceTo(pos); if (d < bd) { bd = d; best = p; } }
        return best;
    }
    // A 5"/38 burst: everything within ~30 m takes fragments, lethal close in
    function flak(pos, by = 'Mk 37 director') {
        FX.flak(pos, 1);
        playBoom(pos, 0.5, 900, 1.2);
        for (const p of planes) {
            if (!p.alive) continue;
            const d = p.pos.distanceTo(pos);
            if (d < 32) damage(p, 2.6 * Math.pow(1 - d / 32, 1.6) + 0.15, p.pos, by);
        }
    }
    const targets = () => planes.filter(p => p.alive && Math.hypot(p.pos.x - phys.pos.x, p.pos.z - phys.pos.z) < 12000);

    // Bogey markers on the third-person and bridge views
    function drawMarkers(ctx, w, h) {
        ctx.save();
        ctx.font = '10px Consolas, monospace';
        ctx.textAlign = 'center';
        for (const p of planes) {
            if (!p.alive) continue;
            const d = p.pos.distanceTo(camera.position);
            if (d > 9500) continue;
            const v = _p.copy(p.pos).project(camera);
            if (v.z >= 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) continue;
            const sx = (v.x * 0.5 + 0.5) * w, sy = (-v.y * 0.5 + 0.5) * h;
            const col = p.state === 'dive' || p.state === 'run' || p.state === 'strafe' ? 'rgba(255,90,70,0.95)' : 'rgba(255,190,90,0.9)';
            ctx.strokeStyle = ctx.fillStyle = col;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(sx - 7, sy + 12); ctx.lineTo(sx, sy + 7); ctx.lineTo(sx + 7, sy + 12);
            ctx.stroke();
            ctx.fillText(`${p.type.name.toUpperCase()} ${(d / 1000).toFixed(1)}k`, sx, sy + 23);
        }
        ctx.restore();
    }
    // Air contacts on the radar scope (the SC air-search set): small crosses
    function drawRadar(ctx, c, R, range, hdg) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255,210,120,0.9)';
        ctx.lineWidth = 1.2;
        for (const p of planes) {
            if (!p.alive) continue;
            const dx = p.pos.x - phys.pos.x, dz = p.pos.z - phys.pos.z, d = Math.hypot(dx, dz);
            if (d > range) continue;
            const rel = hdg - Math.atan2(dx, dz), r = d / range * R;
            const x = c + Math.sin(rel) * r, y = c - Math.cos(rel) * r;
            ctx.beginPath();
            ctx.moveTo(x - 3, y); ctx.lineTo(x + 3, y); ctx.moveTo(x, y - 3); ctx.lineTo(x, y + 3);
            ctx.stroke();
        }
        ctx.restore();
    }

    return {
        update, reset, hitTest, proximity, flak, damage, targets, drawMarkers, drawRadar, spawnRaid,
        get planes() { return planes; },
        get bombs() { return bombs; },
        get raidIn() { return raidT; },
        set raidIn(v) { raidT = v; }
    };
})();
