// Exterior ballistics and every shell in flight, ours and the enemy's.

const SHELL_V0 = 792;          // m/s, 5"/38 (the IJN 12.7 cm/50 is close enough to share the table)
const SHELL_K = 8.6e-5;        // quadratic drag, gives ~16 km max range like the real gun
const GUN_H = 7;
const BALLISTIC = [];          // one trajectory per elevation, sampled every TRAJ_DT, heights relative to the muzzle
const TRAJ_DT = 0.1;
let MAX_RANGE = 0;
const shells = [];
let shellGeo, playerShellMat, enemyShellMat;

function buildBallisticTable() {
    for (let el = -10; el <= 85.01; el += el < 45 ? 0.25 : 0.5) {
        const a = el * DEG;
        let vx = SHELL_V0 * Math.cos(a), vy = SHELL_V0 * Math.sin(a), x = 0, y = 0, t = 0, next = TRAJ_DT;
        let range = null, tof = 0;
        const dt = 0.02, xs = [0], ys = [0];
        while (y > -GUN_H - 600 && t < 110) {
            const v = Math.hypot(vx, vy), px = x, py = y;
            vx -= SHELL_K * v * vx * dt;
            vy -= (GRAVITY + SHELL_K * v * vy) * dt;
            x += vx * dt; y += vy * dt; t += dt;
            if (range === null && y < -GUN_H && vy < 0) {   // sea level, from a gun GUN_H up
                const f = (py + GUN_H) / (py - y);
                range = px + (x - px) * f;
                tof = t - dt * (1 - f);
            }
            if (t >= next - 1e-9) { xs.push(x); ys.push(y); next += TRAJ_DT; }
        }
        BALLISTIC.push({ el: a, range: range ?? x, tof, xs: Float32Array.from(xs), ys: Float32Array.from(ys) });
    }
    MAX_RANGE = Math.max(...BALLISTIC.map(b => b.range));
}

// Height above the muzzle and time of flight where trajectory b reaches horizontal distance r (null: never)
const _traj = { y: 0, t: 0 };
function trajAt(b, r) {
    const xs = b.xs, n = xs.length;
    if (r > xs[n - 1]) return null;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] < r) lo = m; else hi = m; }
    const f = (r - xs[lo]) / (xs[hi] - xs[lo] || 1);
    _traj.y = b.ys[lo] + (b.ys[hi] - b.ys[lo]) * f;
    _traj.t = (lo + f) * TRAJ_DT;
    return _traj;
}

// Gun elevation and time of flight to put a shell on a target at horizontal range `range`, dh metres above the
// muzzle (default: the sea, from a 5" mount). The lowest elevation that gets there: the flat, fast trajectory.
function firingSolution(range, dh = -GUN_H) {
    range = Math.max(range, 1);
    let prev = null, prevY = 0, prevT = 0;
    for (let i = 0; i < BALLISTIC.length; i++) {
        const b = BALLISTIC[i], r = trajAt(b, range);
        if (!r) { prev = null; continue; }
        if (r.y >= dh) {
            if (!prev) return { el: b.el, tof: r.t };
            const f = (dh - prevY) / (r.y - prevY);
            return { el: lerp(prev.el, b.el, f), tof: lerp(prevT, r.t, f) };
        }
        prev = b; prevY = r.y; prevT = r.t;
    }
    return null;
}

function initShells() {
    buildBallisticTable();
    shellGeo = CylZ(0.16, 0.16, 4.5, 6);
    playerShellMat = new THREE.MeshBasicMaterial({ color: 0xffc46b, fog: false });
    enemyShellMat = new THREE.MeshBasicMaterial({ color: 0xff7a5c, fog: false });
}

// owner: 'player' | 'enemy'; tint: splash colour; opts.vt: proximity (VT) fuze against aircraft, opts.fuze:
// time fuze backup (s), bursting in the air if it misses
function spawnShell(origin, dir, inheritVel, owner, tint, opts = null) {
    const mesh = new THREE.Mesh(shellGeo, owner === 'player' ? playerShellMat : enemyShellMat);
    mesh.position.copy(origin);
    scene.add(mesh);
    shells.push({ pos: origin.clone(), vel: dir.clone().multiplyScalar(SHELL_V0).add(inheritVel), mesh, age: 0, owner, tint, whistled: false,
        vt: !!(opts && opts.vt), fuze: opts && opts.fuze ? opts.fuze : 0 });
}

function clearShells() {
    shells.forEach(s => scene.remove(s.mesh));
    shells.length = 0;
}

const _prev = new THREE.Vector3(), _lp = new THREE.Vector3(), _hp = new THREE.Vector3();
function updateShells(dt, t) {
    const steps = 3, h = dt / steps;
    for (let i = shells.length - 1; i >= 0; i--) {
        const s = shells[i];
        let done = false;
        for (let k = 0; k < steps && !done; k++) {
            _prev.copy(s.pos);
            const v = s.vel.length();
            s.vel.x -= SHELL_K * v * s.vel.x * h;
            s.vel.z -= SHELL_K * v * s.vel.z * h;
            s.vel.y -= (GRAVITY + SHELL_K * v * s.vel.y) * h;
            s.pos.addScaledVector(s.vel, h);
            s.age += h;

            // Hits: sample the segment so fast shells can't tunnel through a hull
            for (let j = 1; j <= 4 && !done; j++) {
                _hp.copy(_prev).lerp(s.pos, j / 4);
                if (s.owner === 'player') {
                    const e = enemyHitTest(_hp);
                    if (e) { onEnemyShellHit(e, _hp.clone()); done = true; }
                } else if (playerHitTest(_hp)) {
                    onPlayerShellHit(_hp.clone());
                    done = true;
                }
            }
            // VT fuze: bursts as it passes a plane, or on its time fuze
            if (s.vt && !done) {
                if (Air.proximity(s.pos, 18) || (s.fuze && s.age > s.fuze)) { Air.flak(s.pos.clone()); done = true; }
            }
            // The land: the ground itself, or a building standing on it
            if (!done && s.pos.y < 520) {
                const g = Islands.groundAt(s.pos.x, s.pos.z);
                if (g > -999 && s.pos.y < g + 45) {
                    const st = s.pos.y < g ? null : Islands.structureAt(s.pos);
                    if (st || s.pos.y < g) {
                        const p = s.pos.clone();
                        if (!st) { p.y = g; FX.dirt(p, 1); } else FX.explosion(p, 0.9);
                        playBoom(p, 0.9, 700, 1.8);
                        Islands.impact(p, s.owner === 'player' ? 1 : 1.2, st, s.owner === 'player');
                        if (s.owner === 'enemy') onEnemyShellMiss(s.pos);
                        done = true;
                    }
                }
            }
            if (!done && s.pos.y < 8) {
                const wh = waterHeight(s.pos.x, s.pos.z, t);
                if (s.pos.y < wh) {
                    FX.splash(s.pos.x, wh, s.pos.z);
                    playBoom(s.pos, 0.35, 500, 1.0);
                    if (s.owner === 'enemy') onEnemyShellMiss(s.pos);
                    else Islands.alertNear(s.pos);
                    done = true;
                }
            }
        }
        // Incoming whistle when an enemy shell is about to land close by
        if (!done && s.owner === 'enemy' && !s.whistled && s.vel.y < 0) {
            const d = s.pos.distanceTo(camera.position);
            if (d < 900) { s.whistled = true; playWhistle(s.pos, d / s.vel.length()); }
        }
        if (done || s.age > 80) {
            scene.remove(s.mesh);
            shells.splice(i, 1);
            continue;
        }
        s.mesh.position.copy(s.pos);
        s.mesh.lookAt(_lp.copy(s.pos).add(s.vel));
        s.mesh.scale.setScalar(1 + s.pos.distanceTo(camera.position) / 1200);
    }
}
