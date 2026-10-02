// Destruction: wreckage thrown out of shell hits and explosions, shell holes torn in the hulls, and whole
// fittings (gun mounts) blown off a ship.
//
// Debris: a few kinds of chunk (plates, splinters, beams, lumps), each one instanced mesh, so a hundred pieces
// in the air cost a handful of draw calls. They fly ballistic with air drag and tumble; some trail smoke; the
// ones that land on a deck bounce off, the ones that hit the sea splash, bob on the waves for a while (wood
// and light plate float longer) and sink.
// Hull damage: scorched, jagged holes and soot patches painted onto the hull or deckhouse sides where shells
// struck, parented to the ship so they roll with it.

const Debris = (() => {
    // float: chance a piece of this kind stays afloat (wood, drums and floats do; steel mostly sinks after a
    // moment, some with air trapped in it). draft: how deep it sits, as a fraction of its size.
    const KINDS = [
        { geo: () => new THREE.BoxGeometry(1, 0.06, 0.7), max: 140, float: 0.12, draft: 0.4 },     // 0 torn plate
        { geo: () => new THREE.BoxGeometry(0.16, 0.16, 1.6), max: 120, float: 0.15, draft: 0.5 },  // 1 beam, splinter, pipe
        { geo: () => new THREE.IcosahedronGeometry(0.45, 0), max: 90, float: 0.05, draft: 0.6 },   // 2 lump, machinery
        { geo: () => new THREE.BoxGeometry(0.7, 0.5, 0.6), max: 60, float: 0.7, draft: 0.45 },     // 3 box, locker, ready-ammo
        { geo: () => new THREE.BoxGeometry(2.2, 0.09, 0.3), max: 140, float: 1, draft: 0.04 },     // 4 plank, decking, splinter shield wood
        { geo: () => new THREE.CylinderGeometry(0.3, 0.3, 0.9, 10), max: 40, float: 0.9, draft: 0.25 },   // 5 drum
        { geo: () => new THREE.TorusGeometry(0.36, 0.09, 6, 14), max: 30, float: 1, draft: 0.05 }   // 6 life ring, cork float
    ];
    const meshes = [], pieces = [], big = [];
    const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(),
        _e = new THREE.Euler(), _n = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
    const STEEL = [new THREE.Color(0x6d757e), new THREE.Color(0x4a5159), new THREE.Color(0x2b2a28), new THREE.Color(0x5e3427), new THREE.Color(0x8a8f94)];
    const PALETTE = [STEEL, STEEL, STEEL, [new THREE.Color(0x5f5a4c), new THREE.Color(0x4b4f45), new THREE.Color(0x6a6253)],
        [new THREE.Color(0x6b5a44), new THREE.Color(0x7d6a4f), new THREE.Color(0x4a3d2e), new THREE.Color(0x2c2620)],
        [new THREE.Color(0x46503f), new THREE.Color(0x3a3d40), new THREE.Color(0x5b4a33)],
        [new THREE.Color(0xd8d2c4), new THREE.Color(0xc9893f)]];
    let frame = 0;

    function init() {
        KINDS.forEach(k => {
            const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78, metalness: 0.3 });
            const m = new THREE.InstancedMesh(k.geo(), mat, k.max);
            m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            m.count = 0;
            m.castShadow = true;
            m.frustumCulled = false;
            for (let j = 0; j < k.max; j++) m.setColorAt(j, STEEL[0]);
            scene.add(m);
            meshes.push(m);
        });
    }

    function pickKind() {
        const r = Math.random();
        return r < 0.3 ? 0 : r < 0.47 ? 1 : r < 0.6 ? 2 : r < 0.7 ? 3 : r < 0.9 ? 4 : r < 0.96 ? 5 : 6;
    }

    // Throw n pieces out of p: up and away from the hit (dir), carried with the ship (vel), size ~ scale metres
    function burst(p, n = 10, scale = 1, opts = {}) {
        const keep = Gfx.particleKeep;
        n = Math.max(1, Math.round(n * (keep < 1 ? 0.6 + 0.4 * keep : 1)));
        const base = opts.vel || null, dir = opts.dir || null;
        for (let i = 0; i < n; i++) {
            const kind = opts.kind !== undefined ? opts.kind : pickKind();
            const K = KINDS[kind];
            let count = 0, oldest = null;
            for (const x of pieces) if (x.kind === kind) { count++; if (!oldest || x.age > oldest.age) oldest = x; }
            if (count >= K.max) pieces.splice(pieces.indexOf(oldest), 1);   // recycle the oldest of that kind
            const sp = rnd(8, 26) * Math.sqrt(scale) * (opts.speed || 1);
            const d = _p.set(randn(), Math.abs(randn()) * 0.9 + 0.55, randn());
            if (dir) d.addScaledVector(dir, 1.4);
            d.normalize();
            const sz = (kind >= 4 ? Math.max(0.6, scale) : scale) * rnd(0.45, 1.25);
            const colors = opts.colors || PALETTE[kind];
            pieces.push({
                kind, age: 0, life: 240,
                pos: p.clone().add(new THREE.Vector3(randn() * 0.6, randn() * 0.4, randn() * 0.6)),
                vel: d.clone().multiplyScalar(sp).add(base || _s.set(0, 0, 0)),
                rot: new THREE.Euler(Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3),
                quat: new THREE.Quaternion(),
                spin: new THREE.Vector3(randn() * 9, randn() * 9, randn() * 9),
                scale: new THREE.Vector3(sz * rnd(0.6, 1.5), sz * rnd(0.6, 1.4), sz * rnd(0.6, 1.5)),
                color: colors[Math.floor(Math.random() * colors.length)],
                smoke: Math.random() < (opts.smoky ?? 0.35), burning: Math.random() < (opts.burning ?? 0.25),
                state: 'air', yaw: Math.random() * 6.3, yawRate: randn() * 0.15, bob: Math.random() * 6,
                tY: 0, tN: new THREE.Vector3(0, 1, 0), sinkV: 0, floatT: 0
            });
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
        burst(obj.position, 10, 0.8, { vel: vel.clone().multiplyScalar(0.3), smoky: 0.8, burning: 0.6 });
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
    // under it is sampled every third frame (staggered), which is plenty for something this slow.
    function floatOn(pc, dt, t, i) {
        if ((i + frame) % 3 === 0) {
            const x = pc.pos.x, z = pc.pos.z, e = 0.8;
            const h = waterHeight(x, z, t);
            const near = pc.pos.distanceToSquared(camera.position) < 600 * 600;
            if (near) {
                const hx = waterHeight(x + e, z, t) - waterHeight(x - e, z, t), hz = waterHeight(x, z + e, t) - waterHeight(x, z - e, t);
                pc.tN.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
            }
            pc.tY = h - KINDS[pc.kind].draft * pc.scale.y + Math.sin(t * 1.7 + pc.bob) * 0.03;
        }
        pc.pos.y += (pc.tY - pc.pos.y) * Math.min(1, dt * 5);
        pc.yaw += pc.yawRate * dt;
        _q.setFromUnitVectors(_up, pc.tN);
        _q2.setFromAxisAngle(_up, pc.yaw);
        _q.multiply(_q2);
        pc.quat.slerp(_q, Math.min(1, dt * 3));
        pc.pos.x += (Sea.wind.x * 0.35 + pc.vel.x) * dt;
        pc.pos.z += (Sea.wind.y * 0.35 + pc.vel.z) * dt;
        pc.vel.multiplyScalar(Math.exp(-dt * 0.6));
    }

    function update(dt, t) {
        if (dt <= 0) return;
        frame++;
        const counts = KINDS.map(() => 0);
        for (let i = pieces.length - 1; i >= 0; i--) {
            const pc = pieces[i];
            pc.age += dt;
            let alpha = Math.min(1, (pc.life - pc.age) / 0.6);
            if (pc.state === 'air') {
                const drag = Math.exp(-dt * 0.25);
                pc.vel.x *= drag; pc.vel.z *= drag;
                pc.vel.y = pc.vel.y * drag - GRAVITY * dt;
                pc.pos.addScaledVector(pc.vel, dt);
                pc.rot.x += pc.spin.x * dt; pc.rot.y += pc.spin.y * dt; pc.rot.z += pc.spin.z * dt;
                pc.quat.setFromEuler(pc.rot);
                if (pc.smoke && Math.random() < dt * 30) smokeFx.emit({ x: pc.pos.x, y: pc.pos.y, z: pc.pos.z, vx: Sea.wind.x, vy: 0.5, vz: Sea.wind.y,
                    life: rnd(1.2, 2.6), s0: 0.4, s1: rnd(2, 4), r: 0.16, g: 0.15, b: 0.14, a: 0.45, drag: 1.4, grav: -0.3 });
                if (pc.burning && Math.random() < dt * 25) fireFx.emit({ x: pc.pos.x, y: pc.pos.y, z: pc.pos.z, vx: 0, vy: 0, vz: 0,
                    life: rnd(0.15, 0.3), s0: rnd(0.6, 1.1), s1: 0.3, r: 1, g: 0.6, b: 0.2, a: 0.9, drag: 0, grav: 0 });
                if (pc.vel.y < 0) onDeck(pc);
                const g = Islands.groundAt(pc.pos.x, pc.pos.z);
                const wh = waterHeight(pc.pos.x, pc.pos.z, t);
                if (g > wh && pc.pos.y < g) {           // on the beach or a hillside
                    pc.pos.y = g; pc.state = 'land'; pc.vel.set(0, 0, 0); pc.life = pc.age + rnd(30, 60);
                } else if (pc.pos.y < wh) {
                    if (pc.vel.y < -5) FX.smallSplash(pc.pos.x, wh, pc.pos.z, Math.min(2.4, 0.6 + pc.scale.x * 1.2));
                    const K = KINDS[pc.kind];
                    const floats = Math.random() < K.float;
                    pc.state = 'sea';
                    pc.floatT = floats ? rnd(45, 110) : rnd(0.6, 4);   // steel with air trapped in it bobs a moment first
                    pc.sinkV = rnd(0.5, 2.4) * (pc.kind === 2 ? 1.5 : 1);
                    pc.vel.multiplyScalar(0.15);
                    pc.vel.y = 0;
                    pc.tY = wh - K.draft * pc.scale.y;
                    pc.burning = pc.burning && floats && Math.random() < 0.5;
                    pc.smoke = pc.burning;
                }
            } else if (pc.state === 'sea') {
                floatOn(pc, dt, t, i);
                if (pc.burning && Math.random() < dt * 10) FX.burn(pc.pos, 0.25);
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
            if (pc.age >= pc.life) { pieces.splice(i, 1); continue; }
            const m = meshes[pc.kind], j = counts[pc.kind]++;
            _s.copy(pc.scale).multiplyScalar(Math.max(0.01, alpha));
            _m.compose(pc.pos, pc.quat, _s);
            m.setMatrixAt(j, _m);
            m.setColorAt(j, pc.color);
        }
        meshes.forEach((m, k) => {
            m.count = counts[k];
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
        big.forEach(b => scene.remove(b.obj));
        big.length = 0;
        meshes.forEach(m => { m.count = 0; });
    }

    return { init, burst, blowOff, update, clear };
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
        m.position.copy(local).addScaledVector(normal, 0.03);
        m.lookAt(m.position.clone().add(normal));
        m.rotateZ(Math.random() * Math.PI * 2);
        m.renderOrder = 1;
        ship.add(m);
        list.push(m);
    }

    // Our ship: find the hull, deckhouse or deck surface nearest the hit (ship-local), soot it, and tear the
    // hole and dent into the structure there (wreck.js). power: 1 = 5" shell, ~4 = torpedo. Returns keel damage.
    function onPlayer(local, power = 1) {
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
    function onEnemy(e, local, power = 1) {
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
