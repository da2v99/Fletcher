// Our armament: five 5"/38 mounts under Mk 37 director control, and two Mk 15 quintuple torpedo mounts.

const TRAIN_RATE = 28 * DEG, ELEV_RATE = 15 * DEG;
const RELOAD = 4.0;            // ~15 rounds/min per gun
const guns = [];
const torpMounts = [];

function initPlayerWeapons() {
    guns.length = 0;
    myShip.userData.turrets.forEach((t, i) => guns.push({
        mount: t, pivot: t.userData.barrel, name: 'MT 5' + (i + 1), aftGroup: i >= 2,
        stowYaw: t.rotation.y, train: t.rotation.y, elev: 0, reload: 0, recoil: 0, status: 'stowed', onTarget: false, disabled: false
    }));
    torpMounts.length = 0;
    myShip.userData.torpMounts.forEach((m, i) => torpMounts.push({ obj: m, name: i === 0 ? 'Fwd tubes' : 'Aft tubes', left: 5, train: 0, disabled: false, pending: null }));
}

function resetPlayerWeapons() {
    guns.forEach(g => {
        Object.assign(g, { train: g.stowYaw, elev: 0, reload: 0, recoil: 0, status: 'stowed', onTarget: false, disabled: false });
        g.mount.rotation.y = g.stowYaw;
        g.pivot.rotation.x = 0;
    });
    torpMounts.forEach(m => { Object.assign(m, { left: 5, train: 0, disabled: false, pending: null }); m.obj.rotation.y = 0; });
}

const _mp = new THREE.Vector3(), _qi = new THREE.Quaternion();
function updatePlayerGuns(dt) {
    const aim = Game.running && director.aimValid ? director.aim : null;
    _qi.copy(phys.quat).invert();
    guns.forEach(g => {
        g.reload = Math.max(0, g.reload - dt);
        g.recoil = Math.max(0, g.recoil - dt * 1.7);
        let tTrain = g.stowYaw, tElev = 0, canFire = false;
        g.status = g.disabled ? 'damaged' : 'stowed';
        if (aim && !g.disabled) {
            g.mount.getWorldPosition(_mp);
            const dx = aim.x - _mp.x, dz = aim.z - _mp.z, R = Math.hypot(dx, dz);
            const sol = firingSolution(R);
            const el = sol ? sol.el : 40 * DEG;
            // World firing direction -> ship frame: the director compensates for roll and pitch
            const ld = new THREE.Vector3(dx / R * Math.cos(el), Math.sin(el), dz / R * Math.cos(el)).applyQuaternion(_qi);
            const brg = Math.atan2(ld.x, ld.z);
            const blocked = g.aftGroup ? Math.abs(brg) < 35 * DEG : Math.abs(brg) > 150 * DEG;
            if (blocked) {
                g.status = 'blocked';
                tTrain = g.train;
            } else {
                tTrain = brg;
                tElev = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(ld.y, -1, 1)), -10 * DEG, 85 * DEG);
                g.status = sol ? 'training' : 'range';
                canFire = !!sol;
            }
        }
        if (g.disabled) { tTrain = g.train; tElev = g.elev; }
        const dT = wrapAngle(tTrain - g.train);
        g.train = wrapAngle(g.train + Math.max(-TRAIN_RATE * dt, Math.min(TRAIN_RATE * dt, dT)));
        g.elev = stepToward(g.elev, tElev, ELEV_RATE * dt);
        g.mount.rotation.y = g.train;
        g.pivot.rotation.x = -g.elev;
        g.pivot.position.z = 1.0 - 0.6 * g.recoil;
        g.onTarget = canFire && Math.abs(wrapAngle(tTrain - g.train)) < 0.007 && Math.abs(tElev - g.elev) < 0.005;
        if (canFire && g.onTarget) g.status = g.reload > 0 ? 'loading' : 'ready';
    });

    // Mk 37 director follows the line of sight
    const mk37 = myShip.userData.mk37;
    if (mk37) {
        let tYaw = 0;
        if (aim) {
            const l = myShip.worldToLocal(aim.clone());
            tYaw = Math.atan2(l.x, l.z - mk37.position.z);
        }
        mk37.rotation.y += Math.max(-0.8 * dt, Math.min(0.8 * dt, wrapAngle(tYaw - mk37.rotation.y)));
    }

    if (Game.running && director.trigger) guns.forEach(g => { if (g.onTarget && g.reload <= 0) fireGun(g); });
}

function fireGun(g) {
    ensureAudio();
    g.pivot.updateMatrixWorld(true);
    const tip = g.pivot.localToWorld(new THREE.Vector3(0, 0, 5.3));
    const dir = new THREE.Vector3(0, 0, 1).transformDirection(g.pivot.matrixWorld);
    dir.x += randn() * 0.0016; dir.y += randn() * 0.0016; dir.z += randn() * 0.0016;   // dispersion
    dir.normalize();
    spawnShell(tip, dir, phys.vel, 'player', WHITE_SPRAY);
    FX.muzzle(tip, dir, phys.vel);
    playBoom(tip, 1.0, 1400, 1.4);
    g.reload = RELOAD + Math.random() * 0.4;
    g.recoil = 1;
    Game.stats.rounds++;
}

// --- Torpedoes: train the mount that bears, then fire a five-torpedo spread with ~2° between fish ---
function torpedoSolution() {
    // Aim: the director's locked target (with lead), else the crosshair aim point, else the nearest contact
    let targetPos = null, targetVel = new THREE.Vector3();
    if (director.lock && !director.lock.sinking) {
        targetPos = new THREE.Vector3(director.lock.x, 0, director.lock.z);
        targetVel.copy(enemyVelocity(director.lock));
    } else if (director.aimValid) {
        targetPos = director.aim.clone();
    } else {
        let best = null;
        enemies.forEach(e => {
            if (e.sinking) return;
            const d = Math.hypot(e.x - phys.pos.x, e.z - phys.pos.z);
            if (d < TORP_TYPES.mk15.range && (!best || d < best.d)) best = { e, d };
        });
        if (best) { targetPos = new THREE.Vector3(best.e.x, 0, best.e.z); targetVel.copy(enemyVelocity(best.e)); }
    }
    if (!targetPos) return null;
    const lead = interceptHeading(phys.pos, TORP_TYPES.mk15.speed, targetPos, targetVel);
    const heading = lead ? lead.heading : Math.atan2(targetPos.x - phys.pos.x, targetPos.z - phys.pos.z);
    const range = Math.hypot(targetPos.x - phys.pos.x, targetPos.z - phys.pos.z);
    return { heading, range };
}

function fireTorpedoes() {
    const sol = torpedoSolution();
    if (!sol) { hudMessage('No torpedo target — point the crosshair at a ship and press X', 'warn'); return; }
    if (sol.range > TORP_TYPES.mk15.range) { hudMessage('Target beyond torpedo range (5,500 m)', 'warn'); return; }
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(phys.quat);
    const rel = wrapAngle(sol.heading - Math.atan2(fwd.x, fwd.z));   // relative to our bow, + = port
    const bears = Math.abs(rel) > 25 * DEG && Math.abs(rel) < 155 * DEG;
    const mount = torpMounts.find(m => m.left > 0 && !m.disabled && !m.pending);
    if (!mount) { hudMessage('All torpedoes expended', 'warn'); return; }
    if (!bears) { hudMessage('Torpedoes cannot bear — turn to bring the target abeam', 'warn'); return; }
    mount.pending = { rel, heading: sol.heading };
    hudMessage(`${mount.name} training out, bearing ${Math.round(Math.abs(rel) / DEG)}° ${rel > 0 ? 'port' : 'starboard'}`, 'info');
}

function updateTorpedoMounts(dt) {
    torpMounts.forEach(m => {
        const target = m.pending ? m.pending.rel : 0;
        m.train += Math.max(-12 * DEG * dt, Math.min(12 * DEG * dt, wrapAngle(target - m.train)));
        m.obj.rotation.y = m.train;
        if (m.pending && Math.abs(wrapAngle(target - m.train)) < 0.02) {
            m.obj.updateMatrixWorld(true);
            for (let k = 0; k < m.left; k++) {
                const p = m.obj.localToWorld(new THREE.Vector3((k - 2) * 0.64, 1.1, 4.5 + k * 0.8));
                launchTorpedo(p, m.pending.heading + (k - 2) * 2 * DEG, 'player', 'mk15');
            }
            playBoom(m.obj.getWorldPosition(new THREE.Vector3()), 0.5, 900, 0.6);
            const sol = torpedoSolution();
            hudMessage(`${m.name}: ${m.left} fish away${sol ? `, running time ${Math.round(sol.range / TORP_TYPES.mk15.speed)} s` : ''}`, 'good');
            Game.stats.torps += m.left;
            m.left = 0;
            m.pending = null;
        }
    });
}
