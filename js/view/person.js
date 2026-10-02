// You, on foot: walk the Fletcher's decks, climb from deck to deckhouse to bridge, go over the side, swim (and
// dive), wade ashore, climb back aboard up a scramble net, or row the whaleboat. V steps out of whatever view
// you are in onto the deck (and back); the AI captain has the conn while you are away from the bridge.
//
// Modes:
//   deck  ship-local: your feet ride the ship (heave, roll, pitch) and walk on a plan of her walkable tops:
//         main deck with camber, the 01 deckhouses, 02 level and bridge wings, the open bridge, gun mounts.
//         Low walls (up to ~2.9 m) can be climbed with Space; the lifelines stop you unless you jump them.
//         If she goes down with you aboard you go with her, until you let go (Space) and swim for it.
//   air   world: falling, e.g. over the rail
//   swim  world: head at the surface (bobbing on the waves) or under (C / Ctrl dives, Space rises); breath
//   land  world: wading and walking on an island's beach and slopes
//   boat  world: at the oars of the 26 ft whaleboat. W / S pull, A / D turn

const Person = (() => {
    const EYE = 1.65, STEP = 0.5, MANTLE = 2.9, SEABED_LIMIT = -70;
    const st = {
        active: false, mode: 'deck',
        local: new THREE.Vector3(), lvel: new THREE.Vector3(), onGround: true,   // deck: feet, ship-local
        pos: new THREE.Vector3(), vel: new THREE.Vector3(),                       // world: feet (air, land) or head (swim)
        yaw: 0, pitch: 0, tYaw: 0, tPitch: 0, bob: 0, breath: 1, action: null, hint: '', strokeT: 0
    };
    const keys = { w: 0, a: 0, s: 0, d: 0, shift: 0, space: 0, c: 0 };
    let spaceEdge = false, shapes = null;
    const boat = { obj: null, oars: [], pos: new THREE.Vector3(), heading: 0, speed: 0, yawRate: 0, phase: 0, launched: false, q: new THREE.Quaternion() };

    const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _qh = new THREE.Quaternion(),
        _eu = new THREE.Euler(), _Y = new THREE.Vector3(0, 1, 0);

    // ------------------------------------------------------------------ the walkable ship
    function buildShapes() {
        const BRIDGE_Y = lvl1(23) + 2.4, PH_TOP = BRIDGE_Y + 2.3;
        const hwA = z => z > 32 ? lerp(3.4, 2.0, Math.pow((z - 32) / 3, 2)) : 3.4;
        const hwC = z => z < -35 ? lerp(3.2, 2.2, Math.pow((-35 - z) / 1.5, 2)) : 3.2;
        const round = (hw, zs, depth) => z => z > zs ? hw * Math.sqrt(Math.max(0, 1 - Math.pow((z - zs) / depth, 2))) : hw;
        const c = v => () => v;
        const turret = (z, base) => ({ x: 0, z, r: 2.3, top: c(base + 2.9) });
        shapes = [
            { z0: 8.5, z1: 35, hw: hwA, top: lvl1 },                         // forward deckhouse roof (01 level)
            { z0: -9.5, z1: 8.5, hw: c(2.6), top: lvl1 },                    // machinery casing
            { z0: -36.5, z1: -9.5, hw: hwC, top: lvl1 },                     // after deckhouse
            { z0: 16.5, z1: 28.2, hw: round(2.6, 26.2, 2.0), top: c(BRIDGE_Y) },   // 02 level / navigating bridge deck
            { z0: 23.7, z1: 26.7, hw: c(5.7), top: c(BRIDGE_Y) },             // bridge wings
            { z0: 22.8, z1: 27.7, hw: round(2.3, 25.4, 2.3), top: c(PH_TOP) },  // pilothouse roof: the open bridge
            { x: 0, z: 21.2, r: 1.3, top: c(PH_TOP + 2.4) },                 // Mk 37 director
            { z0: 11.3, z1: 15.7, hw: c(1.4), top: c(14.4) },                // funnels
            { z0: -6.0, z1: -1.6, hw: c(1.4), top: c(14.3) },
            { z0: 1.2, z1: 8.4, hw: c(0.9), top: c(lvl1(4.8) + 1.4) },       // torpedo mounts
            { z0: -16.8, z1: -9.6, hw: c(0.9), top: c(lvl1(-13.2) + 1.4) },
            { z0: -30.5, z1: -26.1, hw: c(2.1), top: c(lvl1(-28.2) + 1.8) },  // after 40 mm tub
            { x: 3.7, z0: 8.1, z1: 11.7, hw: c(1.7), top: lvl1 }, { x: -3.7, z0: 8.1, z1: 11.7, hw: c(1.7), top: lvl1 },   // 40 mm sponsons
            { x: 3.7, z0: -7.0, z1: -3.4, hw: c(1.7), top: lvl1 }, { x: -3.7, z0: -7.0, z1: -3.4, hw: c(1.7), top: lvl1 },
            turret(39, sheerY(39)), turret(31.5, lvl1(31.5)), turret(-22.2, lvl1(-22.2)), turret(-33.2, lvl1(-33.2)), turret(-42, sheerY(-42))
        ];
        st.bridgeY = BRIDGE_Y;
    }
    function deckY(x, z) {
        if (Math.abs(z) > HALF_L - 0.7) return -Infinity;
        const hw = deckHalfWidth(z) - 0.2;
        if (hw < 0.3 || Math.abs(x) > hw) return -Infinity;
        const f = x / hw;
        return sheerY(z) + 0.12 * (1 - f * f) * Math.min(1, hw / 3);
    }
    function surfaceAt(x, z) {
        let h = deckY(x, z);
        for (const s of shapes) {
            const inside = s.r ? (x - s.x) ** 2 + (z - s.z) ** 2 < s.r * s.r : z > s.z0 && z < s.z1 && Math.abs(x - (s.x || 0)) < s.hw(z);
            if (inside) h = Math.max(h, s.top(z));
        }
        return h;
    }

    // ------------------------------------------------------------------ entering and leaving
    function enter() {
        if (!shapes) buildShapes();
        let feet;
        if (captain.active) {
            feet = myShip.userData.eyes[captain.station].clone();
            st.yaw = captain.yaw;
            setCaptain(false);
        } else if (AA.manned) {
            const m = AA.mount.obj.position;
            feet = new THREE.Vector3(m.x + (m.x > 0 ? -1.4 : 1.4), 0, m.z - 1.6);
            AA.leave();
            st.yaw = 0;
        } else {
            feet = new THREE.Vector3(-4.4, 0, 21.5);   // starboard side, abreast the bridge
            st.yaw = Math.PI / 2 * -1 + 0.4;
        }
        const s = surfaceAt(feet.x, feet.z);
        feet.y = s === -Infinity ? sheerY(feet.z) : s;
        st.local.copy(feet);
        st.lvel.set(0, 0, 0);
        st.tYaw = st.yaw;
        st.pitch = st.tPitch = 0;
        st.mode = 'deck';
        st.onGround = true;
        st.breath = 1;
        st.active = true;
        setCameraMode('person');
        document.body.classList.add('onfoot');
        camera.fov = 70;
        camera.updateProjectionMatrix();
        hudMessage(Settings.touchUI ? 'On deck.' : 'On deck. WASD walk · Shift run · Space jump / climb · F use · V back to the ship view. Jump the rail to go over the side.', 'info');
    }

    function exit(toMode = 'chase') {
        if (!st.active) return;
        st.active = false;
        Object.keys(keys).forEach(k => { keys[k] = 0; });
        document.body.classList.remove('onfoot');
        if (document.pointerLockElement) document.exitPointerLock();
        camera.fov = 45;
        camera.updateProjectionMatrix();
        if (toMode) setCameraMode(toMode);
    }

    // Over the side: from ship-local to world, keeping the ship's motion
    function toWorld(mode) {
        const feet = myShip.localToWorld(_v.copy(st.local));
        st.pos.copy(feet);
        st.vel.copy(st.lvel).applyQuaternion(phys.quat).add(phys.vel);
        st.yaw = st.tYaw = st.yaw + phys.heading;
        st.mode = mode;
        if (mode === 'swim') st.pos.y += EYE;
    }

    // Back aboard up a scramble net onto the main deck nearest you
    function climbAboard() {
        const l = myShip.worldToLocal(_v.copy(st.pos));
        const z = THREE.MathUtils.clamp(l.z, -48, 48);
        const side = l.x >= 0 ? 1 : -1;
        let x = side * (deckHalfWidth(z) - 0.7);
        if (surfaceAt(x, z) > sheerY(z) + 0.5) x = side * (deckHalfWidth(z) - 0.25);
        st.local.set(x, surfaceAt(x, z), z);
        if (st.local.y === -Infinity) st.local.y = sheerY(z);
        st.lvel.set(0, 0, 0);
        st.yaw = st.tYaw = wrapAngle(st.yaw - phys.heading);
        st.mode = 'deck';
        st.onGround = true;
        hudMessage('Back aboard.', 'good');
    }

    // ------------------------------------------------------------------ the whaleboat
    function buildBoat() {
        boat.obj = createWhaleboat();
        boat.obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        [-1, 1].forEach(s => {
            const pivot = new THREE.Group();
            pivot.position.set(s * 1.0, 0.05, 0.4);
            const loom = addMesh(pivot, CylX(0.035, 3.6, 6), MAT.wood, s * 1.3, 0, 0);
            addMesh(pivot, Box(0.75, 0.03, 0.16), MAT.wood, s * 3.0, 0, 0);
            loom.castShadow = true;
            boat.obj.add(pivot);
            boat.oars.push(pivot);
        });
        scene.add(boat.obj);
    }
    function launchBoat(nearShip = true) {
        if (!boat.obj) buildBoat();
        boat.obj.visible = true;
        const p = nearShip ? myShip.localToWorld(_v.set(-9.5, 0, 16.5)) : _v.copy(st.pos);
        boat.pos.set(p.x, 0, p.z);
        boat.heading = phys.heading;
        boat.speed = 0;
        boat.yawRate = 0;
        boat.launched = true;
        placeBoat(simTime, 0);
    }
    function placeBoat(t, dt) {
        const fx = Math.sin(boat.heading), fz = Math.cos(boat.heading);
        const hb = waterHeight(boat.pos.x + fx * 3.2, boat.pos.z + fz * 3.2, t), hs = waterHeight(boat.pos.x - fx * 3.2, boat.pos.z - fz * 3.2, t);
        const hp = waterHeight(boat.pos.x + fz * 0.9, boat.pos.z - fx * 0.9, t), hst = waterHeight(boat.pos.x - fz * 0.9, boat.pos.z + fx * 0.9, t);
        const y = (hb + hs + hp + hst) / 4 + 0.45;
        boat.pos.y = dt > 0 ? boat.pos.y + (y - boat.pos.y) * Math.min(1, dt * 6) : y;
        boat.obj.position.copy(boat.pos);
        boat.obj.rotation.set(Math.atan2(hs - hb, 6.4) * 0.9, boat.heading, Math.atan2(hp - hst, 1.8) * 0.5, 'YXZ');
        boat.obj.updateMatrixWorld(true);
    }
    function updateBoat(dt, t, rowing) {
        if (!boat.launched) return;
        const fwdIn = rowing ? keys.w - keys.s : 0, turnIn = rowing ? keys.a - keys.d : 0;
        // A stroke: the blades bite for the first half (thrust), feather back for the second
        if (fwdIn || turnIn) boat.phase = (boat.phase + dt / 1.5) % 1;
        else boat.phase += ((boat.phase > 0.5 ? 1 : 0) - boat.phase) * Math.min(1, dt * 2);
        const bite = boat.phase < 0.5 ? Math.sin(boat.phase / 0.5 * Math.PI) : 0;
        boat.speed += (fwdIn * 1.5 * bite * (keys.shift ? 1.35 : 1) - boat.speed * Math.abs(boat.speed) * 0.35 - boat.speed * 0.12) * dt;
        boat.yawRate += (turnIn * 0.6 * (bite + 0.15) - boat.yawRate * 1.4) * dt;
        boat.heading += boat.yawRate * dt;
        boat.pos.x += (Math.sin(boat.heading) * boat.speed + Sea.wind.x * 0.12) * dt;
        boat.pos.z += (Math.cos(boat.heading) * boat.speed + Sea.wind.y * 0.12) * dt;
        // Fend off the ship's side and the beach
        if (!playerDmg.sinking || phys.pos.y > -4) {
            if (playerHitTest(_v.set(boat.pos.x, 0.5, boat.pos.z), 1.4)) {
                const l = myShip.worldToLocal(_v.copy(boat.pos));
                _w.set(Math.sign(l.x || 1), 0, 0).transformDirection(myShip.matrixWorld);
                boat.pos.addScaledVector(_w, dt * 3);
                boat.speed *= 0.9;
            }
        }
        if (Islands.groundAt(boat.pos.x, boat.pos.z) > -0.6) { boat.speed *= Math.exp(-dt * 4); }
        placeBoat(t, dt);
        boat.oars.forEach((o, i) => {
            const s = i ? 1 : -1, ph = boat.phase * Math.PI * 2;
            o.rotation.set(0, s * Math.sin(ph) * 0.5 * (turnIn && (turnIn > 0) === (s < 0) ? 0.3 : 1), s * (boat.phase < 0.5 ? -0.12 : 0.1));
        });
        if (rowing && bite > 0.9 && Math.random() < dt * 6) [-1, 1].forEach(s => {
            const p = boat.obj.localToWorld(_w.set(s * 3.6, 0, 0.4));
            FX.smallSplash(p.x, waterHeight(p.x, p.z, t), p.z, 0.5);
        });
    }

    // ------------------------------------------------------------------ movement
    function inputDir(yaw) {
        let f = keys.w - keys.s, r = keys.d - keys.a;
        const n = Math.hypot(f, r);
        if (n > 1) { f /= n; r /= n; }
        const fx = Math.sin(yaw), fz = Math.cos(yaw);
        return _w.set(fx * f - fz * r, 0, fz * f + fx * r);
    }

    function updateDeck(dt, t) {
        const L = st.local, V = st.lvel;
        const sp = keys.shift ? 5.4 : 2.5;
        const dir = inputDir(st.yaw);
        const acc = st.onGround ? 12 : 1.5;
        V.x += (dir.x * sp - V.x) * Math.min(1, dt * acc);
        V.z += (dir.z * sp - V.z) * Math.min(1, dt * acc);
        st.hint = '';
        // Horizontal: walls, climbing (Space at a low wall), lifelines (jump them to go over the side)
        const tryMove = (nx, nz) => {
            const h = surfaceAt(nx, nz);
            if (h === -Infinity) {
                if (st.onGround) { st.hint = 'Space: jump over the rail'; return 'rail'; }
                return 'over';
            }
            if (h > L.y + STEP) {
                if (h - L.y < MANTLE) {
                    if (keys.space) { L.y = h; V.y = 0; return 'ok'; }
                    st.hint = 'Space: climb up';
                }
                return 'wall';
            }
            return 'ok';
        };
        const nx = L.x + V.x * dt, nz = L.z + V.z * dt;
        if (nx !== L.x || nz !== L.z) {
            let r = tryMove(nx, nz);
            if (r === 'over') { toWorld('air'); hudMessage('Over the side!', 'warn'); return; }
            if (r === 'ok') { L.x = nx; L.z = nz; } else {
                r = tryMove(nx, L.z);
                if (r === 'ok') L.x = nx; else V.x = 0;
                r = tryMove(L.x, nz);
                if (r === 'ok') L.z = nz; else V.z = 0;
            }
        }
        // Vertical: gravity, landing, stepping down stairs-height drops
        const g = surfaceAt(L.x, L.z);
        if (st.onGround && spaceEdge && !st.hint.startsWith('Space: climb')) { V.y = 4.4; st.onGround = false; }
        V.y -= GRAVITY * dt;
        L.y += V.y * dt;
        if (g !== -Infinity && L.y <= g) { L.y = g; V.y = 0; st.onGround = true; }
        else if (g !== -Infinity && st.onGround && L.y - g < STEP && V.y <= 0) { L.y = g; V.y = 0; }
        else st.onGround = false;
        if (g === -Infinity && L.y < sheerY(L.z) - 1) { toWorld('air'); return; }
        // Walking bob
        const moving = Math.hypot(V.x, V.z);
        st.bob += dt * moving * 2.4;
        // Gone down with her: hold on, or let go and swim for it
        const eye = myShip.localToWorld(_v.set(L.x, L.y + EYE, L.z));
        if (eye.y < waterHeight(eye.x, eye.z, t) - 0.2) {
            st.hint = 'Space: let go and swim for it';
            if (spaceEdge) { toWorld('swim'); st.pos.copy(eye); st.vel.set(0, 1.5, 0); }
        }
        st.action = deckAction();
    }

    function deckAction() {
        const L = st.local;
        // An AA gun within reach
        let bi = -1, bd = 2.4;
        AA.mounts.forEach((m, i) => { const d = Math.hypot(m.obj.position.x - L.x, m.obj.position.z - L.z); if (d < bd && Math.abs(m.obj.position.y - L.y) < 2) { bd = d; bi = i; } });
        if (bi >= 0 && Game.running) return { label: `F: man the ${AA.mounts[bi].name}`, fn: () => { exit(null); AA.enter(bi); } };
        if (L.z > 22 && L.z < 28 && L.y > st.bridgeY - 0.6 && Game.running) {
            return { label: 'F: take the conn (bridge)', fn: () => { const s = L.x > 2.5 ? 0 : L.x < -2.5 ? 2 : 1; exit(null); setCaptain(true); captain.station = s; } };
        }
        if (L.x < -3 && L.z > 12.5 && L.z < 20.5 && L.y < sheerY(L.z) + LVL1_H + 0.5) {
            return { label: boat.launched ? 'F: go down into the whaleboat' : 'F: lower the whaleboat and go down into it', fn: () => {
                if (!boat.launched || boat.pos.distanceTo(phys.pos) > 200) launchBoat(true);
                toWorld('boat');
                st.yaw = st.tYaw = 0;
                hudMessage('In the whaleboat. W / S row · A / D turn · Shift pull hard · F over the side.', 'info');
            } };
        }
        return null;
    }

    function updateAir(dt, t) {
        st.vel.y -= GRAVITY * dt;
        st.vel.x *= Math.exp(-dt * 0.1); st.vel.z *= Math.exp(-dt * 0.1);
        st.pos.addScaledVector(st.vel, dt);
        // Glancing off the hull on the way down
        if (playerHitTest(st.pos, 0.3)) {
            const l = myShip.worldToLocal(_v.copy(st.pos));
            _w.set(Math.sign(l.x || 1), 0, 0).transformDirection(myShip.matrixWorld);
            st.pos.addScaledVector(_w, 0.15);
            st.vel.addScaledVector(_w, 1);
        }
        const wh = waterHeight(st.pos.x, st.pos.z, t), g = Islands.groundAt(st.pos.x, st.pos.z);
        if (g > wh - 1.2 && st.pos.y <= g) { st.pos.y = g; st.vel.set(0, 0, 0); st.mode = 'land'; return; }
        if (st.pos.y < wh) {
            FX.smallSplash(st.pos.x, wh, st.pos.z, Math.min(3, 1 + Math.abs(st.vel.y) * 0.15));
            playBoom(st.pos, 0.15, 900, 0.4);
            st.mode = 'swim';
            st.pos.y = wh - 0.4;
            st.vel.y = Math.max(-2.5, st.vel.y * 0.2);
        }
    }

    function updateSwim(dt, t) {
        const P = st.pos, V = st.vel;
        const wh = waterHeight(P.x, P.z, t);
        const under = P.y < wh - 0.3;
        const sp = keys.shift ? 2.3 : 1.3;
        const dir = inputDir(st.yaw);
        const f = keys.w - keys.s;
        // Under water you swim where you look; at the surface you swim along it
        const tv = _v.copy(dir).multiplyScalar(sp);
        if (under) {
            const cp = Math.cos(st.pitch);
            tv.x = tv.x * (keys.w || keys.s ? cp : 1);
            tv.z = tv.z * (keys.w || keys.s ? cp : 1);
            tv.y = Math.sin(st.pitch) * f * sp;
        } else tv.y = 0;
        if (keys.c) tv.y = -1.7;
        else if (keys.space) tv.y = 1.8;
        else if (under && !f) tv.y = 0.6;   // floating up
        if (st.breath <= 0) tv.y = 2.2;     // out of breath: kick for the surface
        V.x += (tv.x - V.x) * Math.min(1, dt * 3);
        V.z += (tv.z - V.z) * Math.min(1, dt * 3);
        V.y += (tv.y - V.y) * Math.min(1, dt * 3);
        P.addScaledVector(V, dt);
        // At the surface: ride the waves, head just out of the water
        const surf = wh + 0.15;
        if (!keys.c && P.y > wh - 0.6 && V.y >= -0.1) { P.y += (surf - P.y) * Math.min(1, dt * 5); if (P.y > surf) { P.y = surf; V.y = Math.min(V.y, 0); } }
        if (P.y > surf + 0.05) { P.y = surf; V.y = 0; }
        const g = Islands.groundAt(P.x, P.z), bed = Math.max(g, SEABED_LIMIT);
        if (P.y < bed + 0.5) { P.y = bed + 0.5; V.y = Math.max(0, V.y); }
        if (g > wh - 1.3) { st.mode = 'land'; P.y = g; V.set(0, 0, 0); hudMessage('Ashore.', 'info'); return; }
        // Keep out of the hull
        if (playerHitTest(P, 0.5)) {
            const l = myShip.worldToLocal(_w.copy(P));
            _w.set(Math.sign(l.x || 1), 0, 0).transformDirection(myShip.matrixWorld);
            P.addScaledVector(_w, Math.min(0.5, dt * 6));
        }
        st.breath = under ? Math.max(0, st.breath - dt / 45) : Math.min(1, st.breath + dt / 3);
        // Strokes at the surface
        if (!under && f && (st.strokeT -= dt) < 0) { st.strokeT = rnd(0.5, 0.8) / (keys.shift ? 1.5 : 1); FX.smallSplash(P.x + Math.sin(st.yaw) * 0.6, wh, P.z + Math.cos(st.yaw) * 0.6, 0.4); }
        if (under && Math.random() < dt * 3) bubble(P);
        st.bob += dt * 1.3;
        st.action = waterAction(P);
    }

    function bubble(p) {
        smokeFx.emit({ x: p.x + randn() * 0.1, y: p.y + 0.1, z: p.z + randn() * 0.1, vx: 0, vy: 1.2, vz: 0, life: rnd(0.8, 1.6), s0: 0.05, s1: 0.12, r: 0.8, g: 0.9, b: 0.95, a: 0.6, drag: 0.5, grav: -1.5 });
    }

    function waterAction(P) {
        if (boat.launched && Math.hypot(boat.pos.x - P.x, boat.pos.z - P.z) < 4.5 && P.y > boat.pos.y - 2.5) {
            return { label: 'F: climb into the whaleboat', fn: () => { st.mode = 'boat'; st.yaw = st.tYaw = wrapAngle(st.yaw - boat.heading); hudMessage('In the whaleboat. W / S row · A / D turn · Shift pull hard · F over the side.', 'info'); } };
        }
        const afloat = !playerDmg.sinking && myShip.localToWorld(_w.set(0, sheerY(0), 0)).y > waterHeight(phys.pos.x, phys.pos.z, simTime) + 1;
        if (afloat && playerHitTest(P, 3.5) && P.y > waterHeight(P.x, P.z, simTime) - 1.5) return { label: 'F: climb the scramble net', fn: climbAboard };
        return null;
    }

    function updateLand(dt, t) {
        const P = st.pos, V = st.vel;
        const sp = keys.shift ? 5.0 : 2.3;
        const dir = inputDir(st.yaw);
        V.x += (dir.x * sp - V.x) * Math.min(1, dt * 10);
        V.z += (dir.z * sp - V.z) * Math.min(1, dt * 10);
        P.x += V.x * dt; P.z += V.z * dt;
        const g = Islands.groundAt(P.x, P.z), wh = waterHeight(P.x, P.z, t);
        if (st.onGround && spaceEdge) { V.y = 4.4; st.onGround = false; }
        V.y -= GRAVITY * dt;
        P.y += V.y * dt;
        if (P.y <= g) { P.y = g; V.y = 0; st.onGround = true; } else if (st.onGround && P.y - g < 0.7) { P.y = g; V.y = 0; }
        else st.onGround = false;
        if (g < wh - 1.3) { st.mode = 'swim'; P.y = wh + 0.1; V.set(0, 0, 0); return; }
        st.bob += dt * Math.hypot(V.x, V.z) * 2.4;
        st.action = waterAction(_v.copy(P).setY(Math.max(P.y, wh)));
        if (st.action && st.action.fn === climbAboard) st.action = null;
    }

    function update(dt, t) {
        if (boat.launched && st.mode !== 'boat') updateBoat(dt, t, false);
        if (!st.active || dt <= 0) { spaceEdge = false; return; }
        st.action = null;
        if (st.mode === 'deck') updateDeck(dt, t);
        else if (st.mode === 'air') updateAir(dt, t);
        else if (st.mode === 'swim') updateSwim(dt, t);
        else if (st.mode === 'land') updateLand(dt, t);
        else if (st.mode === 'boat') {
            updateBoat(dt, t, true);
            st.action = { label: 'F: go over the side', fn: () => {
                const r = _w.set(Math.cos(boat.heading), 0, -Math.sin(boat.heading));
                st.pos.copy(boat.pos).addScaledVector(r, 1.8).setY(waterHeight(boat.pos.x, boat.pos.z, simTime) - 0.3);
                st.vel.set(0, 0, 0);
                st.yaw = st.tYaw = st.yaw + boat.heading;
                st.mode = 'swim';
                FX.smallSplash(st.pos.x, st.pos.y, st.pos.z, 2);
            } };
        }
        spaceEdge = false;
    }

    // ------------------------------------------------------------------ camera
    function updateCamera(dt, t) {
        st.yaw = easeLook(st.yaw, st.tYaw, dt);
        st.pitch = easeLook(st.pitch, st.tPitch, dt);
        const look = _eu.set(st.pitch, st.yaw + Math.PI, 0, 'YXZ');
        if (st.mode === 'deck') {
            const bob = Math.sin(st.bob * Math.PI) * 0.035;
            camera.position.copy(myShip.localToWorld(_v.set(st.local.x, st.local.y + EYE + bob, st.local.z)));
            // The deck rolls under you; your eyes keep most of it off the horizon
            _qh.setFromAxisAngle(_Y, phys.heading).slerp(phys.quat, 0.55);
            camera.quaternion.copy(_qh).multiply(_q.setFromEuler(look));
        } else if (st.mode === 'boat') {
            camera.position.copy(boat.obj.localToWorld(_v.set(0, 0.75, -2.7)));
            _qh.setFromAxisAngle(_Y, boat.heading).slerp(boat.obj.quaternion, 0.6);
            camera.quaternion.copy(_qh).multiply(_q.setFromEuler(look));
        } else {
            const head = st.mode === 'swim' ? 0 : EYE + Math.sin(st.bob * Math.PI) * 0.035;
            camera.position.copy(st.pos).y += head;
            const roll = st.mode === 'swim' ? Math.sin(t * 0.9 + st.bob) * 0.04 : 0;
            camera.quaternion.setFromEuler(_eu.set(st.pitch, st.yaw + Math.PI, roll, 'YXZ'));
        }
        camera.updateMatrixWorld(true);
    }

    // ------------------------------------------------------------------ input and HUD
    const KEYMAP = { w: 'w', arrowup: 'w', s: 's', arrowdown: 's', a: 'a', arrowleft: 'a', d: 'd', arrowright: 'd', shift: 'shift', ' ': 'space', c: 'c', control: 'c' };
    function key(k, down, e) {
        if (KEYMAP[k]) {
            keys[KEYMAP[k]] = down ? 1 : 0;
            if (k === ' ' && down && !e.repeat) spaceEdge = true;
            return true;
        }
        if (!down || e.repeat) return true;
        if (k === 'f') { if (st.action) st.action.fn(); return true; }
        if (k === 'v') {
            if (st.mode === 'deck' && Game.running) exit();
            else hudMessage(st.mode === 'deck' ? 'She is going down — swim for it!' : 'Get back aboard first (F at the ship\'s side).', 'warn');
            return true;
        }
        if (!Game.running) return true;
        if (k === 'x') toggleLock(window.innerWidth / 2, window.innerHeight / 2);
        if (k === 't') fireTorpedoes();
        if (st.mode === 'deck') {
            if (k === 'g') { exit(null); AA.enter(); }
            if (k === 'b') { exit(null); setCaptain(true); }
        }
        return true;
    }

    function initInput() {
        const el = renderer.domElement;
        el.addEventListener('pointerdown', e => {
            if (!st.active || e.pointerType !== 'mouse') return;
            if (document.pointerLockElement !== el) lockPointer(el);
        });
        window.addEventListener('mousemove', e => {
            if (!st.active || document.pointerLockElement !== el || !Number.isFinite(e.movementX)) return;
            const k = 0.0022 * camera.fov / 70 * Settings.ctl.lookSens;
            st.tYaw -= e.movementX * k;
            st.tPitch = THREE.MathUtils.clamp(st.tPitch - e.movementY * k, -1.45, 1.45);
        });
        window.addEventListener('blur', () => Object.keys(keys).forEach(k => { keys[k] = 0; }));
    }

    function drawHud(ctx, w, h) {
        const cx = w / 2, cy = h / 2;
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.beginPath(); ctx.arc(cx, cy, 2, 0, Math.PI * 2); ctx.fill();
        ctx.font = '13px Inter, sans-serif';
        ctx.textAlign = 'center';
        const lines = [];
        if (st.action) lines.push(st.action.label);
        if (st.hint) lines.push(st.hint);
        if (!Game.running && playerDmg.sinking) lines.push(`USS Fletcher is lost · final score ${Game.score.toLocaleString()} · Esc for the menu`);
        lines.forEach((t, i) => {
            const y = h * 0.66 + i * 20;
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.fillText(t, cx + 1, y + 1);
            ctx.fillStyle = i === 0 && st.action ? 'rgba(255,214,140,0.97)' : 'rgba(235,240,245,0.92)';
            ctx.fillText(t, cx, y);
        });
        // Depth and breath under water, speed in the boat
        ctx.font = '12px Consolas, monospace';
        ctx.textAlign = 'left';
        let status = { deck: 'ON DECK', air: '', swim: 'SWIMMING', land: 'ASHORE', boat: 'WHALEBOAT' }[st.mode];
        if (st.mode === 'swim') {
            const depth = waterHeight(st.pos.x, st.pos.z, simTime) - st.pos.y;
            if (depth > 0.4) status = `DIVING · ${depth.toFixed(0)} m`;
        }
        if (st.mode === 'deck' && Underwater.depth > 0.5) status = `ABOARD · ${Underwater.depth.toFixed(0)} m UNDER`;
        if (st.mode === 'boat') status += ` · ${(Math.abs(boat.speed) * 1.94).toFixed(1)} kn`;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillText(status, 23, h - 27);
        ctx.fillStyle = 'rgba(220,235,245,0.9)';
        ctx.fillText(status, 22, h - 28);
        if (st.mode === 'swim' && st.breath < 0.999) {
            ctx.fillStyle = 'rgba(0,0,0,0.45)';
            ctx.fillRect(22, h - 22, 120, 6);
            ctx.fillStyle = st.breath > 0.3 ? 'rgba(140,210,255,0.9)' : 'rgba(255,110,90,0.95)';
            ctx.fillRect(22, h - 22, 120 * st.breath, 6);
        }
        ctx.restore();
    }

    // The ship is going down: launch the whaleboat alongside for anyone who wants it
    function onShipSinking() {
        if (captain.active) enter();   // you stay on the bridge as she goes
        if (!boat.launched) launchBoat(true);
    }

    // From the game-over screen: in the water beside the wreck, the whaleboat close by
    function abandon() {
        if (!shapes) buildShapes();
        if (!boat.launched) launchBoat(true);
        const side = _w.set(-1, 0, 0).transformDirection(myShip.matrixWorld).setY(0).normalize();
        st.pos.copy(phys.pos).addScaledVector(side, 14);
        st.pos.y = waterHeight(st.pos.x, st.pos.z, simTime) + 0.1;
        st.vel.set(0, 0, 0);
        st.yaw = st.tYaw = Math.atan2(boat.pos.x - st.pos.x, boat.pos.z - st.pos.z);
        st.pitch = st.tPitch = 0;
        st.mode = 'swim';
        st.breath = 1;
        st.active = true;
        setCameraMode('person');
        document.body.classList.add('onfoot');
        camera.fov = 70;
        camera.updateProjectionMatrix();
        hudMessage('In the water. Swim to the whaleboat (WASD) and press F to climb in.', 'info');
    }

    function reset() {
        if (st.active) exit(null);
        st.mode = 'deck';
        boat.launched = false;
        if (boat.obj) boat.obj.visible = false;
    }

    function init() {
        buildShapes();
        initInput();
    }

    return {
        init, update, updateCamera, key, drawHud, enter, exit, abandon, onShipSinking, reset,
        get active() { return st.active; },
        get onShip() { return st.mode === 'deck'; },
        get mode() { return st.mode; },
        worldPos() { return st.mode === 'deck' ? myShip.localToWorld(_v.copy(st.local)) : st.mode === 'boat' ? boat.pos : st.pos; },
        get boat() { return boat; }
    };
})();
