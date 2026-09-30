// Exterior ballistics and every shell in flight, ours and the enemy's.

const SHELL_V0 = 792;          // m/s, 5"/38 (the IJN 12.7 cm/50 is close enough to share the table)
const SHELL_K = 8.6e-5;        // quadratic drag, gives ~16 km max range like the real gun
const GUN_H = 7;
const BALLISTIC = [];
let MAX_RANGE = 0;
const shells = [];
let shellGeo, playerShellMat, enemyShellMat;

function buildBallisticTable() {
    for (let el = -2; el <= 45.01; el += 0.25) {
        const a = el * DEG;
        let vx = SHELL_V0 * Math.cos(a), vy = SHELL_V0 * Math.sin(a), x = 0, y = GUN_H, t = 0;
        const dt = 0.02;
        while (y > 0 && t < 120) {
            const v = Math.hypot(vx, vy);
            vx -= SHELL_K * v * vx * dt;
            vy -= (GRAVITY + SHELL_K * v * vy) * dt;
            x += vx * dt; y += vy * dt; t += dt;
        }
        BALLISTIC.push({ el: a, range: x, tof: t });
    }
    MAX_RANGE = Math.max(...BALLISTIC.map(b => b.range));
}

// Gun elevation and time of flight to hit the sea at a horizontal range
function firingSolution(range) {
    if (range > MAX_RANGE) return null;
    if (range <= BALLISTIC[0].range) return { el: BALLISTIC[0].el, tof: BALLISTIC[0].tof };
    for (let i = 1; i < BALLISTIC.length; i++) {
        const a = BALLISTIC[i - 1], b = BALLISTIC[i];
        if (b.range >= range) {
            const f = (range - a.range) / (b.range - a.range);
            return { el: lerp(a.el, b.el, f), tof: lerp(a.tof, b.tof, f) };
        }
    }
    return null;
}

function initShells() {
    buildBallisticTable();
    shellGeo = CylZ(0.16, 0.16, 4.5, 6);
    playerShellMat = new THREE.MeshBasicMaterial({ color: 0xffc46b, fog: false });
    enemyShellMat = new THREE.MeshBasicMaterial({ color: 0xff7a5c, fog: false });
}

// owner: 'player' | 'enemy'; tint: splash colour
function spawnShell(origin, dir, inheritVel, owner, tint) {
    const mesh = new THREE.Mesh(shellGeo, owner === 'player' ? playerShellMat : enemyShellMat);
    mesh.position.copy(origin);
    scene.add(mesh);
    shells.push({ pos: origin.clone(), vel: dir.clone().multiplyScalar(SHELL_V0).add(inheritVel), mesh, age: 0, owner, tint, whistled: false });
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
            if (!done && s.pos.y < 8) {
                const wh = waterHeight(s.pos.x, s.pos.z, t);
                if (s.pos.y < wh) {
                    FX.splash(s.pos.x, wh, s.pos.z, s.tint);
                    playBoom(s.pos, 0.35, 500, 1.0);
                    if (s.owner === 'enemy') onEnemyShellMiss(s.pos);
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
