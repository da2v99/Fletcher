// Under the surface: whenever the camera is below the waves (diving, or still aboard as she goes down).
//
// The water closes in: green-blue murk with ~20 m visibility near the surface, darker and thicker the deeper
// you go (daylight falls off roughly e^(-depth/16)), until the wreck lies in near darkness at the bottom.
// Looking up, the surface is Snell's window (ocean.js). Marine snow drifts past, air streams up out of the
// sinking hull, and a school of fish (and a few big ones) come in to circle the wreck, closer the longer
// she lies there.

const Underwater = (() => {
    const st = { under: false, depth: 0, amount: 0, shipUnderT: 0 };
    const base = { sun: 1, amb: 0.2, fog: new THREE.Color(), dens: 0.0002 };
    const col = new THREE.Color(), bg = new THREE.Color();
    let snow = null, snowPos = null, fishBody = null, fishTail = null;
    const SNOW_N = 1400, SNOW_R = 14;
    const fish = [];
    const FISH_N = 180, BIG_N = 7, SCHOOLS = 6;
    const _m = new THREE.Matrix4(), _t = new THREE.Matrix4(), _r = new THREE.Matrix4(), _v = new THREE.Vector3(), _c = new THREE.Vector3(),
        _a = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _s = new THREE.Vector3();

    function init() {
        // Marine snow: a box of slowly sinking specks that wraps round the camera
        snowPos = new Float32Array(SNOW_N * 3);
        for (let i = 0; i < SNOW_N * 3; i++) snowPos[i] = rnd(-SNOW_R, SNOW_R);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
        const dot = document.createElement('canvas');
        dot.width = dot.height = 16;
        const dctx = dot.getContext('2d'), grad = dctx.createRadialGradient(8, 8, 0, 8, 8, 8);
        grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
        dctx.fillStyle = grad; dctx.fillRect(0, 0, 16, 16);
        snow = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xa8c4bc, size: 0.07, map: new THREE.CanvasTexture(dot), sizeAttenuation: true, transparent: true, opacity: 0.6, depthWrite: false }));
        snow.frustumCulled = false;
        snow.visible = false;
        scene.add(snow);

        // Fish: a body and a tail that beats, both instanced
        const body = new THREE.SphereGeometry(1, 12, 8);
        body.scale(0.085, 0.19, 0.42);
        const tail = new THREE.BufferGeometry();
        tail.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0.17, -0.28, 0, -0.17, -0.28, 0, 0, 0, 0, -0.17, -0.28, 0, 0.17, -0.28], 3));
        tail.computeVertexNormals();
        const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.55, emissive: 0x1c2e34 });   // silver sides catching what light there is
        fishBody = new THREE.InstancedMesh(body, mat, FISH_N);
        fishTail = new THREE.InstancedMesh(tail, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide }), FISH_N);
        [fishBody, fishTail].forEach(m => { m.frustumCulled = false; m.visible = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); });
        const silver = [new THREE.Color(0x9fb4c0), new THREE.Color(0x7f98a8), new THREE.Color(0xb8c6a0), new THREE.Color(0xc9b77a)];
        // Schools: each holds its own station along the wreck and depth, its fish swimming round it together
        const schools = Array.from({ length: SCHOOLS }, () => ({ oy: rnd(-3, 9), oz: rnd(-0.42, 0.42), r: rnd(5, 11), w: (Math.random() < 0.5 ? 1 : -1) * rnd(0.15, 0.3) }));
        for (let i = 0; i < FISH_N; i++) {
            const big = i < BIG_N, sc = schools[i % SCHOOLS];
            const c = big ? new THREE.Color(0x4a5560) : silver[Math.floor(Math.random() * silver.length)];
            fishBody.setColorAt(i, c);
            fishTail.setColorAt(i, c);
            fish.push({
                pos: new THREE.Vector3(), vel: new THREE.Vector3(), big, scale: big ? rnd(5.5, 8) : rnd(0.8, 1.4),
                th: big ? Math.random() * Math.PI * 2 : (i % SCHOOLS) * 1.1 + randn() * 0.35, w: big ? (Math.random() < 0.5 ? 1 : -1) * rnd(0.04, 0.07) : sc.w * rnd(0.92, 1.08),
                r: big ? rnd(10, 18) : sc.r + randn() * 1.2, oy: big ? rnd(-3, 8) : sc.oy + randn() * 0.8, oz: big ? rnd(-0.45, 0.45) : sc.oz + randn() * 0.02,
                ph: Math.random() * 10, wag: Math.random() * 10,
                speed: big ? rnd(1.2, 2) : rnd(1.8, 3.2), placed: false
            });
        }
    }

    function scatter(center) {
        fish.forEach(f => {
            const a = Math.random() * Math.PI * 2, d = rnd(20, 40);
            f.pos.set(center.x + Math.cos(a) * d, center.y + rnd(-6, 6), center.z + Math.sin(a) * d);
            f.vel.set(0, 0, 0);
            f.placed = true;
        });
    }

    function updateFish(dt, t, wh) {
        // What they gather round: the wreck once she is under (closer the longer she lies there), else you
        const deck = myShip.localToWorld(_v.set(0, sheerY(0), 0)).y;
        const wreck = deck < waterHeight(phys.pos.x, phys.pos.z, t) - 2;
        st.shipUnderT = wreck ? st.shipUnderT + dt : 0;
        const interest = wreck ? smooth(1, 18, st.shipUnderT) : 0;
        if (!fish[0].placed) scatter(wreck ? phys.pos : camera.position);
        const cam = camera.position;
        for (let i = 0; i < FISH_N; i++) {
            const f = fish[i];
            f.th += f.w * dt;
            let tx, ty, tz;
            if (wreck) {
                const r = lerp(28, f.r, interest);
                const along = myShip.localToWorld(_c.set(0, f.oy * 0.5 + 2, f.oz * SHIP_LENGTH));
                tx = along.x + Math.cos(f.th) * r; ty = along.y + Math.sin(f.th * 0.7 + f.ph) * 2; tz = along.z + Math.sin(f.th) * r;
            } else {
                // A school wandering round the diver, keeping its distance
                camera.getWorldDirection(_c);
                const cx = cam.x + _c.x * 14, cz = cam.z + _c.z * 14;
                const r = f.r + 6;
                tx = cx + Math.cos(f.th) * r; ty = cam.y + f.oy * 0.4 + Math.sin(f.th + f.ph); tz = cz + Math.sin(f.th) * r;
            }
            ty = Math.min(ty, wh - 1.5);
            const d = _a.set(tx - f.pos.x, ty - f.pos.y, tz - f.pos.z);
            const dl = d.length() || 1;
            const sp = f.speed * (dl > 20 ? 1.6 : 1);
            f.vel.lerp(d.multiplyScalar(sp / dl), Math.min(1, dt * (f.big ? 0.6 : 1.4)));
            // Shy of the diver
            const away = _a.subVectors(f.pos, cam), ad = away.length();
            if (ad < 3 * (f.big ? 2 : 1)) f.vel.addScaledVector(away.normalize(), dt * 8);
            f.pos.addScaledVector(f.vel, dt);
            if (f.pos.y > wh - 0.8) f.pos.y = wh - 0.8;
            f.wag += dt * (4 + f.vel.length() * 3) / (f.big ? 2.5 : 1);
            const vl = f.vel.length();
            _v.copy(f.pos).addScaledVector(vl > 1e-3 ? f.vel : _c.set(0, 0, 1), 1 / Math.max(vl, 1e-3));
            _m.lookAt(_v, f.pos, _up);   // +Z along the swim direction
            _m.scale(_s.setScalar(f.scale));
            _m.setPosition(f.pos);
            fishBody.setMatrixAt(i, _m);
            _t.makeTranslation(0, 0, -0.36);
            _r.makeRotationY(Math.sin(f.wag) * 0.55);
            fishTail.setMatrixAt(i, _m.multiply(_t).multiply(_r));
        }
        fishBody.instanceMatrix.needsUpdate = true;
        fishTail.instanceMatrix.needsUpdate = true;
        if (fishBody.instanceColor) fishBody.instanceColor.needsUpdate = true;
        if (fishTail.instanceColor) fishTail.instanceColor.needsUpdate = true;
    }

    function updateSnow(dt) {
        const c = camera.position;
        snow.position.copy(c);
        for (let i = 0; i < SNOW_N; i++) {
            const k = i * 3;
            snowPos[k + 1] -= dt * 0.05;
            snowPos[k] += Math.sin(i + simTime * 0.2) * dt * 0.03;
            for (let a = 0; a < 3; a++) {
                if (snowPos[k + a] > SNOW_R) snowPos[k + a] -= 2 * SNOW_R; else if (snowPos[k + a] < -SNOW_R) snowPos[k + a] += 2 * SNOW_R;
            }
        }
        // Keep the specks fixed in the water, not glued to the camera: shift them against its motion
        const d = st.lastCam ? _v.subVectors(c, st.lastCam) : _v.set(0, 0, 0);
        if (d.lengthSq() < 100) for (let i = 0; i < SNOW_N; i++) { snowPos[i * 3] -= d.x; snowPos[i * 3 + 1] -= d.y; snowPos[i * 3 + 2] -= d.z; }
        st.lastCam = (st.lastCam || new THREE.Vector3()).copy(c);
        snow.geometry.attributes.position.needsUpdate = true;
    }

    // Air pouring out of a sinking hull
    function wreckBubbles(dt, t) {
        if (!playerDmg.sinking || st.shipUnderT > 150) return;
        const wh = waterHeight(phys.pos.x, phys.pos.z, t);
        if (phys.pos.y > wh - 2) return;
        const rate = st.shipUnderT < 40 ? 30 : 8;
        for (let n = Math.floor(rate * dt + Math.random()); n > 0; n--) {
            const p = myShip.localToWorld(_v.set(rnd(-3, 3), rnd(2, 8), rnd(-50, 50)));
            if (p.y > wh) continue;
            const rise = rnd(1.2, 2.2);
            smokeFx.emit({ x: p.x, y: p.y, z: p.z, vx: randn() * 0.2, vy: rise, vz: randn() * 0.2, life: Math.min(12, (wh - p.y) / (rise + 1.5)),
                s0: rnd(0.08, 0.25), s1: rnd(0.3, 0.7), r: 0.75, g: 0.88, b: 0.92, a: 0.55, drag: 0.2, grav: -0.6, fade: 0.6 });
        }
        // ...and boiling up at the surface over her
        if (Math.random() < dt * (st.shipUnderT < 40 ? 6 : 1.5)) {
            const p = myShip.localToWorld(_v.set(rnd(-4, 4), 0, rnd(-50, 50)));
            FX.smallSplash(p.x, wh, p.z, rnd(1, 2.5));
        }
    }

    function apply(on) {
        st.under = on;
        skyDome.visible = !on;
        rain.lines.visible = !on;
        snow.visible = on;
        fishBody.visible = fishTail.visible = on;
        UNDER_U.uUnder.value = on ? 1 : 0;
        if (!on) {
            scene.fog.color.copy(base.fog);
            scene.fog.density = base.dens;
            scene.background = null;
            sunLight.intensity = base.sun;
            ambLight.intensity = base.amb;
            fish.forEach(f => { f.placed = false; });
        }
    }

    function update(dt, t) {
        const c = camera.position;
        const wh = waterVisible() ? waterHeight(c.x, c.z, t) : -1e9;
        st.depth = wh - c.y;
        // Under the very surface you see: the same wave maths as the sea's mesh (waterHeight), a hair of hysteresis
        const want = st.depth > (st.under ? -0.02 : 0.02);
        // Near the surface the sea is drawn from both sides, so a camera dipping under a crest sees the water's
        // underside, never the sky through it
        ocean.material.side = st.depth > -1.5 ? THREE.DoubleSide : THREE.FrontSide;
        UNDER_U.uUnderDens.value = st.under ? UNDER_U.uUnderDens.value : 0.05;
        if (!st.under) {   // remember the surface settings to put back
            base.sun = sunLight.intensity; base.amb = ambLight.intensity;
            base.fog.copy(scene.fog.color); base.dens = scene.fog.density;
        }
        if (want !== st.under) apply(want);
        st.amount += ((want ? 1 : 0) - st.amount) * Math.min(1, dt * 8);
        wreckBubbles(dt, t);
        if (!st.under) return;
        if (Stars.points) Stars.points.visible = false;
        const depth = Math.max(0, st.depth);
        const day = smooth(-0.1, 0.3, SUN_DIR.y) * 0.8 + 0.2;
        // A floor on the light: at the bottom you can still just make out the wreck and what swims round it
        const light = Math.max(0.1, Math.exp(-depth / 16) * day * (1 - 0.5 * weather.storm) * (1 - 0.85 * (weather.night || 0)));
        col.setRGB(0.05, 0.21, 0.23).multiplyScalar(0.35 + 0.65 * light);
        bg.copy(col);
        scene.background = bg;
        scene.fog.color.copy(col);
        scene.fog.density = Math.min(0.075, 0.042 + depth * 0.0005);
        UNDER_U.uUnderCol.value.copy(col);
        UNDER_U.uUnderDens.value = scene.fog.density;
        sunLight.intensity = base.sun * light * 0.7;
        ambLight.intensity = base.amb * (0.3 + 0.7 * light);
        hemiLight.intensity *= 0.25 + 0.75 * light;
        updateSnow(dt);
        updateFish(dt, t, wh);
    }

    function reset() {
        if (st.under) apply(false);
        st.shipUnderT = 0;
        st.amount = 0;
        fish.forEach(f => { f.placed = false; });
    }

    return { init, update, reset, get depth() { return st.depth; }, get under() { return st.under; }, get amount() { return st.amount; } };
})();
