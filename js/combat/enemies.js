// Enemy ships: spawning, AI (close, fight broadside, torpedo attack, retire), gunnery that walks its fall
// of shot onto us, damage, fires and sinking.

const ENEMY_TYPES = {
    maru: { build: () => IJN.maru(), name: 'Transport', hp: 12, speed: 5.2, turn: 1.0, gunRange: 6500, reload: 11, torps: 0, score: 100, draft: 6.2 },
    destroyer: { build: () => IJN.destroyer(), name: 'Destroyer', hp: 14, speed: 17, turn: 2.8, gunRange: 11500, reload: 8, torps: 6, score: 300, draft: 3.4, engage: 7000 },
    cruiser: { build: () => IJN.cruiser(), name: 'Light Cruiser', hp: 32, speed: 15.5, turn: 1.6, gunRange: 14000, reload: 10, torps: 8, score: 800, draft: 4.8, engage: 11000 },
    barge: { build: () => IJN.daihatsu(), name: 'Landing barge', hp: 2, speed: 4.2, turn: 9, gunRange: 0, reload: 99, torps: 0, score: 60, draft: 0.9 }
};
const DYE_COLORS = [[0.95, 0.45, 0.45], [0.95, 0.9, 0.45], [0.55, 0.95, 0.6], [0.95, 0.95, 0.97]];
const enemies = [];
let enemySerial = 0;

// Each type is built once, its static parts merged (a few dozen draw calls instead of hundreds), then cloned
const enemyTemplates = {};
function enemyModel(typeKey) {
    let tpl = enemyTemplates[typeKey];
    if (!tpl) {
        const m = ENEMY_TYPES[typeKey].build();
        m.turrets.forEach((t, i) => { t.name = 'tur' + i; if (t.userData.cradle) t.userData.cradle.name = 'cra' + i; });
        m.torpLaunchers.forEach((t, i) => { t.name = 'tl' + i; });
        mergeStatic(m.group, [...m.turrets, ...m.turrets.map(t => t.userData.cradle), ...m.torpLaunchers]);
        const meta = m.turrets.map(t => ({ stowYaw: t.userData.stowYaw, aft: t.userData.aft }));
        m.group.traverse(o => { o.userData = {}; });   // object references can't go through clone()
        tpl = enemyTemplates[typeKey] = { m, meta };
    }
    const m = tpl.m, g = m.group.clone();
    const turrets = m.turrets.map((t, i) => {
        const c = g.getObjectByName('tur' + i);
        c.userData = { cradle: g.getObjectByName('cra' + i), stowYaw: tpl.meta[i].stowYaw, aft: tpl.meta[i].aft };
        return c;
    });
    const torpLaunchers = m.torpLaunchers.map((t, i) => g.getObjectByName('tl' + i));
    return { group: g, turrets, torpLaunchers, stacks: m.stacks.map(v => v.clone()), len: m.len, beam: m.beam, top: m.top };
}

function spawnEnemy(typeKey, x, z, heading) {
    const type = ENEMY_TYPES[typeKey];
    if (typeKey !== 'barge') ({ x, z } = Islands.clearSpot(x, z, 600));   // never start on a reef
    const model = enemyModel(typeKey);
    scene.add(model.group);
    // Her own copy of the materials so her hull can hole, dent, sag and break (wreck.js)
    const deck = typeKey === 'maru' ? 5.5 : 4.2;
    Wreck.attach(model.group, { len: model.len, beam: model.beam, sharedGeo: true, inner: m => !!m.vertexColors, maxTilt: model.len > 80 ? 0.5 : 0.7,
        deckY: () => deck, halfDepth: (type.draft + deck) / 2, midY: (deck - type.draft) / 2,
        interior: typeKey === 'barge' ? null : () => createBoxInterior(model.len, model.beam, type.draft, deck),
        onHole: (local, r) => {
            // A gun mount or launcher holed is wrecked: it stops dead where it was, barrel down
            model.turrets.forEach(t => { if (!t.userData.wrecked && t.position.distanceTo(local) < r + 2.2) t.userData.wrecked = true; });
            model.torpLaunchers.forEach(t => { if (t.position.distanceTo(local) < r + 2.2) t.userData.wrecked = true; });
        } });
    const e = {
        id: ++enemySerial, typeKey, type, model, obj: model.group,
        x, z, heading, speed: type.speed * 0.8, hp: type.hp, alive: true, sinking: false, sinkT: 0,
        reload: rnd(2, type.reload), torps: type.torps, torpCd: rnd(20, 40), weaveT: rnd(0, 100), side: Math.random() < 0.5 ? 1 : -1,
        sigma: 900, lastPlayerVel: phys.vel.clone(), dye: DYE_COLORS[enemySerial % DYE_COLORS.length],
        fires: [], burnAcc: 0, detected: false, convoyHeading: heading, zigT: rnd(20, 40)
    };
    enemies.push(e);
    return e;
}

function clearEnemies() {
    enemies.forEach(e => { scene.remove(e.obj); Wreck.remove(e.obj); });
    enemies.length = 0;
}

const _ev = new THREE.Vector3();
function enemyVelocity(e) { return _ev.set(Math.sin(e.heading) * e.speed, 0, Math.cos(e.heading) * e.speed); }

function updateEnemies(dt, t) {
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        const dx = phys.pos.x - e.x, dz = phys.pos.z - e.z;
        const d = Math.hypot(dx, dz);
        const brg = Math.atan2(dx, dz);

        if (!e.sinking) {
            let desired = e.heading, desiredSpeed = e.type.speed;
            e.weaveT += dt;
            if (e.typeKey === 'barge') {
                // Moored at the pier until the alarm goes, then off along the coast at full speed
                if (e.fleeing || (e.home && e.home.alert)) {
                    e.fleeing = true;
                    desired = brg + Math.PI + e.side * 0.7;
                } else desiredSpeed = 0;
            } else if (e.typeKey === 'maru') {
                // Transports hold the convoy course and zig-zag once they know we are near
                desired = e.convoyHeading;
                if (d < 9000) {
                    e.zigT -= dt;
                    if (e.zigT < 0) { e.zigT = rnd(25, 45); e.side = -e.side; }
                    desired = e.convoyHeading + e.side * 0.5;
                }
            } else if (e.hp < e.type.hp * 0.3) {
                desired = brg + Math.PI;                                       // badly hurt: retire at full speed
            } else if (d > e.type.engage) {
                const lead = interceptHeading({ x: e.x, z: e.z }, e.type.speed, phys.pos, phys.vel);
                desired = lead ? lead.heading : brg;                          // close the range
            } else {
                // Fight broadside-on and weave to throw off our fire control
                if (Math.abs(wrapAngle(e.heading - brg)) < 0.3) e.side = Math.random() < 0.5 ? 1 : -1;
                desired = brg + e.side * (1.2 + 0.35 * Math.sin(e.weaveT / 14));
                desiredSpeed = e.type.speed * 0.85;
            }
            // Keep off the islands: look ahead for shoal water and turn for open sea
            e.navT = (e.navT || 0) - dt;
            if (e.navT <= 0) {
                e.navT = 0.5 + Math.random() * 0.2;
                const h = Islands.steer(e.x, e.z, e.heading, desired, e.typeKey === 'barge' ? 300 : 700 + e.speed * 25, e.type.draft + 2);
                e.navHeading = Math.abs(wrapAngle(h - desired)) > 0.01 ? h : null;
            }
            if (e.navHeading !== null && e.navHeading !== undefined) desired = e.navHeading;
            if (e.typeKey === 'barge' && !e.fleeing) desired = e.heading;
            e.heading += Math.max(-e.type.turn * DEG * dt, Math.min(e.type.turn * DEG * dt, wrapAngle(desired - e.heading)));
            e.speed = stepToward(e.speed, desiredSpeed, (e.typeKey === 'barge' ? 0.8 : 0.25) * dt);
            e.x += Math.sin(e.heading) * e.speed * dt;
            e.z += Math.cos(e.heading) * e.speed * dt;
            // Aground: the bow is on the bottom
            const bx = e.x + Math.sin(e.heading) * e.model.len * 0.45, bz = e.z + Math.cos(e.heading) * e.model.len * 0.45;
            if (Islands.groundAt(bx, bz) > -e.type.draft) {
                e.x -= Math.sin(e.heading) * e.speed * dt * 1.5;
                e.z -= Math.cos(e.heading) * e.speed * dt * 1.5;
                e.speed *= Math.exp(-dt * 2);
                e.navT = 0;
            }

            if (Game.hostile && dt > 0) {
                enemyGunnery(e, d, dt);
                enemyTorpedoes(e, d, dt);
            }
        } else {
            e.sinkT += dt;
            e.speed = Math.max(0, e.speed - dt * 0.8);
            e.x += Math.sin(e.heading) * e.speed * dt;
            e.z += Math.cos(e.heading) * e.speed * dt;
        }

        // Float on the sea: bow, stern and both sides, each averaging the sea over its half of the hull
        const L = e.model.len * 0.4, B = e.model.beam * 0.45;
        const sx = Math.sin(e.heading), cz = Math.cos(e.heading);
        const pl = e.model.len * 0.5, pw = e.model.beam * 0.5, pd = 2;
        const hb = seaPatchHeight(e.x + sx * L, e.z + cz * L, t, sx, cz, pl, pw, pd);
        const hs = seaPatchHeight(e.x - sx * L, e.z - cz * L, t, sx, cz, pl, pw, pd);
        const hp = seaPatchHeight(e.x + cz * B, e.z - sx * B, t, sx, cz, pl, pw, pd);
        const hst = seaPatchHeight(e.x - cz * B, e.z + sx * B, t, sx, cz, pl, pw, pd);
        const W = e.obj.userData.wreck, broken = W && W.broken;
        // Broken in two the halves pivot up and go down fast; whole, she settles and lists as she floods
        const sink = e.sinking ? (broken ? e.sinkT * e.sinkT * 0.014 + e.sinkT * 0.05 : e.sinkT * e.sinkT * 0.01 + e.sinkT * 0.12) : 0;
        const tilt = e.sinking ? e.sinkT : 0;
        e.obj.position.set(e.x, (hb + hs + hp + hst) / 4 - sink, e.z);
        e.obj.rotation.set(Math.atan2(hs - hb, 2 * L) * 0.8 + (broken ? 0 : tilt * 0.004 * e.side), e.heading, Math.atan2(hp - hst, 2 * B) * 0.6 + tilt * (broken ? 0.005 : 0.012) * e.side, 'YXZ');
        e.obj.updateMatrixWorld(true);
        if (broken) Wreck.pose(e.obj, dt);

        // Fires and funnel smoke
        const damage = 1 - e.hp / e.type.hp;
        if (sink < 10) {
            e.burnAcc += dt * (damage > 0 ? 4 + damage * 16 : 0);
            while (e.burnAcc > 1) {
                e.burnAcc -= 1;
                const fp = e.fires.length ? e.fires[Math.floor(Math.random() * e.fires.length)] : new THREE.Vector3(0, 6, 0);
                FX.burn(e.obj.localToWorld(fp.clone()), Math.min(1, damage + 0.2));
            }
            if (!e.sinking && Math.random() < dt * 3 && (e.typeKey !== 'barge' || e.speed > 1)) {
                const s = e.model.stacks[Math.floor(Math.random() * e.model.stacks.length)];
                const p = e.obj.localToWorld(s.clone());
                smokeFx.emit({ x: p.x, y: p.y, z: p.z, vx: 3 - Math.sin(e.heading) * e.speed * 0.8, vy: 2.5, vz: 1.5 - Math.cos(e.heading) * e.speed * 0.8,
                    life: rnd(6, 10), s0: 3, s1: 16, r: 0.25, g: 0.24, b: 0.24, a: 0.35, drag: 0.4, grav: -0.2 });
            }
        }
        if (sink > (broken ? 28 : 20) || d > 26000) {
            scene.remove(e.obj);
            Wreck.remove(e.obj);
            enemies.splice(i, 1);
        }
    }
}

// Salvo fire: aim at where we will be after the shell's time of flight, with a spread that tightens
// salvo by salvo while we hold course and speed, and blows open again when we manoeuvre.
function enemyGunnery(e, d, dt) {
    e.reload -= dt;
    const t = e.model.turrets;
    const rel = wrapAngle(Math.atan2(phys.pos.x - e.x, phys.pos.z - e.z) - e.heading);
    t.forEach(tr => {
        if (tr.userData.wrecked) { const cr = tr.userData.cradle; if (cr) cr.rotation.x += (0.12 - cr.rotation.x) * Math.min(1, dt); return; }
        const blocked = tr.userData.aft ? Math.abs(rel) < 30 * DEG : Math.abs(rel) > 150 * DEG;
        const aim = blocked ? tr.userData.stowYaw : rel;
        tr.rotation.y += Math.max(-dt * 0.4, Math.min(dt * 0.4, wrapAngle(aim - tr.rotation.y)));
    });
    if (e.reload > 0 || d > e.type.gunRange || !Game.hostile) return;
    e.reload = e.type.reload * rnd(0.9, 1.15);

    const dv = phys.vel.distanceTo(e.lastPlayerVel);
    e.lastPlayerVel.copy(phys.vel);
    // Best achievable spread (~300 m at 4 km); any real change of our course or speed throws it open again
    const floor = 180 + 0.03 * d;
    e.sigma = dv > 2.5 ? Math.max(e.sigma, 500 + 0.05 * d) : Math.max(floor, e.sigma * 0.82);
    const stormPenalty = 1 + weather.storm * 0.4;

    const sol0 = firingSolution(d);
    const tof = sol0 ? sol0.tof : 20;
    const px = phys.pos.x + phys.vel.x * tof, pz = phys.pos.z + phys.vel.z * tof;
    let fired = false;
    t.forEach(tr => {
        if (tr.userData.wrecked || Math.abs(wrapAngle(tr.rotation.y - rel)) > 0.08) return;   // wrecked, or not trained on us yet
        tr.updateMatrixWorld(true);
        const cr = tr.userData.cradle;
        const muzzle = cr.localToWorld(new THREE.Vector3(0, 0, 5.2));
        const ax = px + randn() * 18 * stormPenalty, az = pz + randn() * 18 * stormPenalty;
        const R = Math.hypot(ax - muzzle.x, az - muzzle.z) + randn() * e.sigma * stormPenalty;
        const sol = firingSolution(Math.max(200, R));
        if (!sol) return;
        const h = Math.atan2(ax - muzzle.x, az - muzzle.z);
        cr.rotation.x = -sol.el;
        const dir = new THREE.Vector3(Math.sin(h) * Math.cos(sol.el), Math.sin(sol.el), Math.cos(h) * Math.cos(sol.el));
        spawnShell(muzzle, dir, enemyVelocity(e), 'enemy', e.dye);
        FX.muzzle(muzzle, dir, enemyVelocity(e), 0.8);
        fired = true;
    });
    if (fired) {
        playBoom(e.obj.position, 0.6, 700, 1.4);
        if (!e.detected) { e.detected = true; }
    }
}

// Long Lance attack: a spread aimed at our predicted position, then turn away
function enemyTorpedoes(e, d, dt) {
    e.torpCd -= dt;
    if (e.torps <= 0 || e.torpCd > 0 || d > 8500 || d < 1200 || !e.model.torpLaunchers.some(t => !t.userData.wrecked)) return;
    const rel = wrapAngle(Math.atan2(phys.pos.x - e.x, phys.pos.z - e.z) - e.heading);
    if (Math.abs(Math.abs(rel) - Math.PI / 2) > 50 * DEG) return;   // needs a beam-ish angle
    const lead = interceptHeading({ x: e.x, z: e.z }, TORP_TYPES.type93.speed, phys.pos, phys.vel);
    if (!lead) return;
    const n = Math.min(4, e.torps);
    e.torps -= n;
    e.torpCd = rnd(70, 110);
    const launcher = e.model.torpLaunchers.find(t => !t.userData.wrecked);
    launcher.rotation.y = rel;
    const origin = e.obj.localToWorld(launcher.position.clone());
    for (let k = 0; k < n; k++) {
        const spread = (k - (n - 1) / 2) * 2.5 * DEG;
        launchTorpedo(origin.clone().setY(origin.y - 1), lead.heading + spread, 'enemy', 'type93');
    }
    e.side = -e.side;   // turn away after launching
}

// Point-in-hull test for our shells and torpedoes (slack widens the box)
// Is world point p inside this hull (obj: the ship, or the stern half of a broken one)? Returns the ship-local point
function inHull(e, obj, p, slack) {
    _ev.copy(p);
    obj.worldToLocal(_ev);
    const halfLen = e.model.len / 2 - (Math.abs(_ev.z) > e.model.len * 0.3 ? (Math.abs(_ev.z) - e.model.len * 0.3) * 0.6 : 0);
    return Math.abs(_ev.z) < e.model.len / 2 && Math.abs(_ev.x) < e.model.beam / 2 * (halfLen / (e.model.len / 2)) + slack &&
        _ev.y > -e.type.draft - slack && _ev.y < (Math.abs(_ev.z) < e.model.len * 0.3 ? e.model.top : 7) ? _ev : null;
}
// wrecks: sinking ships (and both halves of a broken one) still stop rounds
function enemyHitTest(p, slack = 0, wrecks = false) {
    for (const e of enemies) {
        if (e.sinking && !wrecks) continue;
        const dx = p.x - e.x, dz = p.z - e.z;
        const r = e.model.len / 2 + 16;
        if (dx * dx + dz * dz > r * r) continue;
        const W = e.obj.userData.wreck;
        if (W && W.broken) {
            const a = inHull(e, e.obj, p, slack);
            if (a && a.z > W.cutZ - 1) return e;
            const b = inHull(e, W.half.root, p, slack);
            if (b && b.z < W.cutZ + 1) return e;
            continue;
        }
        if (inHull(e, e.obj, p, slack)) return e;
    }
    return null;
}

function damageEnemy(e, amount, worldP) {
    if (e.sinking) return;
    e.hp -= amount;
    if (e.fires.length < 5) e.fires.push(e.obj.worldToLocal(worldP.clone()).setY(5));
    if (e.hp <= 0) {
        e.sinking = true;
        Game.onEnemySunk(e);
        // Her magazine or boilers go: a secondary explosion, wreckage everywhere, a mount or two blown off
        const big = e.model.len > 40;
        const p = e.obj.localToWorld(new THREE.Vector3(0, 3, rnd(-0.2, 0.2) * e.model.len));
        FX.explosion(p, big ? 2.2 : 1);
        if (big) FX.fuelBlast(p, 0.7);
        playBoom(p, 1.6, 300, 3.5);
        Debris.burst(p, big ? 50 : 16, big ? 1.3 : 0.7, { vel: enemyVelocity(e).clone(), speed: 1.4, smoky: 0.6, burning: 0.45 });
        Debris.burst(p, big ? 30 : 10, big ? 1 : 0.6, { vel: enemyVelocity(e).clone(), speed: 0.7, kind: 4 });
        for (let k = 0; k < (big ? 2 : 0); k++) blowOffMount(e, 1.4);
        // A broken back, a magazine or a torpedo amidships: she breaks in two
        const W = e.obj.userData.wreck;
        if (big && W && (W.keel > 45 || Math.random() < 0.3)) Wreck.breakApart(e.obj);
    }
}

// A gun mount (or torpedo launcher) torn off the ship by a hit and thrown into the air
const _bo = new THREE.Vector3();
function blowOffMount(e, force = 1) {
    const list = e.model.turrets.length ? e.model.turrets : e.model.torpLaunchers;
    if (!list.length) return;
    const t = list.splice(Math.floor(Math.random() * list.length), 1)[0];
    const v = enemyVelocity(e).clone().add(_bo.set(randn() * 5, rnd(14, 24) * force, randn() * 5));
    Debris.blowOff(t, v, force);
}

// dir: the shell's direction of flight, to find exactly where on her it struck
function onEnemyShellHit(e, p, dir = null) {
    FX.explosion(p);
    playBoom(p, 0.8, 900, 2.2);
    // Wreckage out of the hit, a hole in her side, and now and then a mount blown clean off once she is hurt
    const local = e.obj.worldToLocal(p.clone());
    const keel = HullDamage.onEnemy(e, local, 1, dir ? p.clone().addScaledVector(dir, -15) : null, dir);
    _bo.set(Math.sign(local.x || 1), 0, 0).transformDirection(e.obj.matrixWorld);
    Debris.burst(p, rnd(10, 16), 0.55, { vel: enemyVelocity(e).clone(), dir: _bo.clone() });
    if (e.sinking) return;   // a wreck going down: torn up further, nothing more to score
    Game.onHit(e);
    if (keel >= 100 && e.model.len > 40) { damageEnemy(e, e.hp + 1, p); if (!e.obj.userData.wreck.broken) Wreck.breakApart(e.obj); return; }
    if (e.hp < e.type.hp * 0.55 && e.model.len > 40 && Math.random() < 0.18) blowOffMount(e);
    damageEnemy(e, 1, p);
}

function onEnemyTorpedoHit(e, p) {
    FX.waterColumn(p);
    playBoom(p, 1.6, 400, 3.5);
    if (!e.sinking) hudMessage(`Torpedo hit on the ${e.type.name.toLowerCase()}!`, 'good');
    const local = e.obj.worldToLocal(p.clone());
    // Into her side below the waterline: cast in toward her centreline to find the plating
    const at = p.clone().setY(p.y - 0.8), dir = new THREE.Vector3(e.x - p.x, 0, e.z - p.z).normalize();
    const keel = HullDamage.onEnemy(e, local.setY(-0.8), 4, at.clone().addScaledVector(dir, -12), dir);
    Debris.burst(p.clone().setY(p.y + 2), 34, 1, { vel: enemyVelocity(e).clone(), speed: 1.2, smoky: 0.5 });
    if (e.sinking) return;
    damageEnemy(e, TORP_TYPES.mk15.damage + e.type.hp * 0.35, p);
    if (keel >= 60 && e.model.len > 40) { if (!e.sinking) damageEnemy(e, e.hp + 1, p); Wreck.breakApart(e.obj); }
}
