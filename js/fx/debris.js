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
    const KINDS = [
        { geo: () => new THREE.BoxGeometry(1, 0.06, 0.7), max: 70 },          // torn plate
        { geo: () => new THREE.BoxGeometry(0.16, 0.16, 1.6), max: 60 },       // beam, splinter, pipe
        { geo: () => new THREE.IcosahedronGeometry(0.45, 0), max: 60 },       // lump, machinery
        { geo: () => new THREE.BoxGeometry(0.7, 0.5, 0.6), max: 30 }          // box, locker, ready-ammo
    ];
    const meshes = [], pieces = [], big = [];
    const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();
    const STEEL = [new THREE.Color(0x6d757e), new THREE.Color(0x4a5159), new THREE.Color(0x2b2a28), new THREE.Color(0x5e3427), new THREE.Color(0x8a8f94)];

    function init() {
        KINDS.forEach((k, i) => {
            const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0.35 });
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

    // Throw n pieces out of p: up and away from the hit, carried with the ship (vel), size ~ scale metres
    function burst(p, n = 10, scale = 1, opts = {}) {
        const keep = Gfx.particleKeep;
        n = Math.max(1, Math.round(n * (keep < 1 ? 0.6 + 0.4 * keep : 1)));
        const base = opts.vel || null, dir = opts.dir || null, colors = opts.colors || STEEL;
        for (let i = 0; i < n; i++) {
            const kind = opts.kind !== undefined ? opts.kind : (Math.random() < 0.45 ? 0 : Math.random() < 0.5 ? 1 : Math.random() < 0.7 ? 2 : 3);
            const perKind = pieces.filter(x => x.kind === kind);
            if (perKind.length >= KINDS[kind].max) {   // recycle the oldest of that kind
                const old = perKind.reduce((a, b) => (a.age > b.age ? a : b));
                pieces.splice(pieces.indexOf(old), 1);
            }
            const sp = rnd(8, 26) * Math.sqrt(scale) * (opts.speed || 1);
            const d = _p.set(randn(), Math.abs(randn()) * 0.9 + 0.55, randn());
            if (dir) d.addScaledVector(dir, 1.4);
            d.normalize();
            const sz = scale * rnd(0.45, 1.25);
            pieces.push({
                kind, age: 0, life: rnd(14, 26),
                pos: p.clone().add(new THREE.Vector3(randn() * 0.6, randn() * 0.4, randn() * 0.6)),
                vel: d.clone().multiplyScalar(sp).add(base || _s.set(0, 0, 0)),
                rot: new THREE.Euler(Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3),
                spin: new THREE.Vector3(randn() * 9, randn() * 9, randn() * 9),
                scale: new THREE.Vector3(sz * rnd(0.6, 1.5), sz * rnd(0.6, 1.4), sz * rnd(0.6, 1.5)),
                color: colors[Math.floor(Math.random() * colors.length)],
                smoke: Math.random() < (opts.smoky ?? 0.35), burning: Math.random() < (opts.burning ?? 0.25),
                state: 'air', buoy: Math.random() < 0.5 ? rnd(6, 20) : rnd(0.5, 3), bob: Math.random() * 6
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

    function update(dt, t) {
        if (dt <= 0) return;
        const counts = [0, 0, 0, 0];
        for (let i = pieces.length - 1; i >= 0; i--) {
            const pc = pieces[i];
            pc.age += dt;
            if (pc.age > pc.life) { pieces.splice(i, 1); continue; }
            if (pc.state === 'air') {
                const drag = Math.exp(-dt * 0.25);
                pc.vel.x *= drag; pc.vel.z *= drag;
                pc.vel.y = pc.vel.y * drag - GRAVITY * dt;
                pc.pos.addScaledVector(pc.vel, dt);
                pc.rot.x += pc.spin.x * dt; pc.rot.y += pc.spin.y * dt; pc.rot.z += pc.spin.z * dt;
                if (pc.smoke && Math.random() < dt * 30) smokeFx.emit({ x: pc.pos.x, y: pc.pos.y, z: pc.pos.z, vx: Sea.wind.x, vy: 0.5, vz: Sea.wind.y,
                    life: rnd(1.2, 2.6), s0: 0.4, s1: rnd(2, 4), r: 0.16, g: 0.15, b: 0.14, a: 0.45, drag: 1.4, grav: -0.3 });
                if (pc.burning && Math.random() < dt * 25) fireFx.emit({ x: pc.pos.x, y: pc.pos.y, z: pc.pos.z, vx: 0, vy: 0, vz: 0,
                    life: rnd(0.15, 0.3), s0: rnd(0.6, 1.1), s1: 0.3, r: 1, g: 0.6, b: 0.2, a: 0.9, drag: 0, grav: 0 });
                if (pc.vel.y < 0) onDeck(pc);
                const g = Islands.groundAt(pc.pos.x, pc.pos.z);
                const wh = waterHeight(pc.pos.x, pc.pos.z, t);
                if (g > wh && pc.pos.y < g) {           // on the beach or a hillside
                    pc.pos.y = g; pc.state = 'land'; pc.vel.set(0, 0, 0);
                } else if (pc.pos.y < wh) {
                    if (pc.vel.y < -6) FX.smallSplash(pc.pos.x, wh, pc.pos.z, Math.min(2.2, pc.scale.x * 1.4));
                    pc.state = 'sea';
                    pc.vel.multiplyScalar(0.2);
                    pc.spin.multiplyScalar(0.15);
                    pc.life = Math.min(pc.life, pc.age + pc.buoy + 4);
                }
            } else if (pc.state === 'sea') {
                // Bob on the waves, drift downwind, then fill and sink
                const wh = waterHeight(pc.pos.x, pc.pos.z, t);
                const sinking = pc.age > pc.life - 4;
                const target = sinking ? wh - (pc.age - (pc.life - 4)) * 1.5 : wh - 0.05;
                pc.pos.y += (target - pc.pos.y) * Math.min(1, dt * 4);
                pc.pos.x += (Sea.wind.x * 0.3 + pc.vel.x) * dt;
                pc.pos.z += (Sea.wind.y * 0.3 + pc.vel.z) * dt;
                pc.vel.multiplyScalar(Math.exp(-dt * 0.5));
                pc.rot.x += Math.sin(t * 1.3 + pc.bob) * dt * 0.3;
                pc.rot.z += Math.cos(t * 1.1 + pc.bob) * dt * 0.3;
            }
            const m = meshes[pc.kind], j = counts[pc.kind]++;
            const fade = Math.min(1, (pc.life - pc.age) / 0.6);
            _q.setFromEuler(pc.rot);
            _s.copy(pc.scale).multiplyScalar(Math.max(0.01, fade));
            _m.compose(pc.pos, _q, _s);
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

    // Our ship: find the hull, deckhouse or deck surface nearest the hit (ship-local)
    function onPlayer(local) {
        const z = THREE.MathUtils.clamp(local.z, -HALF_L + 2, HALF_L - 3);
        const deck = sheerY(z), side = local.x >= 0 ? 1 : -1;
        const size = rnd(1.6, 2.6);
        if (local.y < deck - 0.3) {
            const y = Math.max(local.y, 0.6);
            const x = hullX(z, y);
            const n = new THREE.Vector3(side, 0.15, 0).normalize();
            decal(myShip, new THREE.Vector3(side * x, y, z), n, size, 'hole');
            decal(myShip, new THREE.Vector3(side * x, y + 0.9, z), n, size * 1.6, 'soot');
        } else {
            const house = (z < 35 && z > 8.5 && Math.abs(local.x) < 3.6) || (z < 8.5 && z > -9.5 && Math.abs(local.x) < 2.8) || (z < -9.5 && z > -36.5 && Math.abs(local.x) < 3.4);
            if (house && local.y < deck + LVL1_H) {
                const hw = z > 8.5 ? (z > 32 ? 2.6 : 3.4) : z > -9.5 ? 2.6 : 3.2;
                decal(myShip, new THREE.Vector3(side * (hw + 0.02), Math.max(local.y, deck + 0.7), z), new THREE.Vector3(side, 0, 0), size * 0.9, 'hole');
            } else if (!house) {
                const y = deck + 0.12 * (1 - Math.pow(local.x / Math.max(1, deckHalfWidth(z)), 2));
                decal(myShip, new THREE.Vector3(THREE.MathUtils.clamp(local.x, -deckHalfWidth(z) + 0.8, deckHalfWidth(z) - 0.8), y, z), new THREE.Vector3(0, 1, 0), size * 1.3, 'soot');
            }
        }
    }

    // Enemy ship: its hull side at the hit's station (the same plan taper the hit test uses)
    function onEnemy(e, local) {
        const L = e.model.len, z = THREE.MathUtils.clamp(local.z, -L / 2 + 2, L / 2 - 2);
        const halfLen = L / 2 - (Math.abs(z) > L * 0.3 ? (Math.abs(z) - L * 0.3) * 0.6 : 0);
        const hw = e.model.beam / 2 * (halfLen / (L / 2));
        const side = local.x >= 0 ? 1 : -1;
        const y = THREE.MathUtils.clamp(local.y, 0.8, 4);
        const size = rnd(1.8, 2.8) * Math.max(0.5, Math.min(1.2, e.model.beam / 10));
        decal(e.obj, new THREE.Vector3(side * hw, y, z), new THREE.Vector3(side, 0.1, 0).normalize(), size, 'hole');
        if (Math.random() < 0.6) decal(e.obj, new THREE.Vector3(side * hw, y + 1.1, z + randn()), new THREE.Vector3(side, 0, 0), size * 1.7, 'soot');
    }

    function clear(ship) {
        (ship.userData.decals || []).forEach(m => { ship.remove(m); m.geometry.dispose(); m.material.dispose(); });
        ship.userData.decals = [];
    }

    return { onPlayer, onEnemy, clear };
})();
