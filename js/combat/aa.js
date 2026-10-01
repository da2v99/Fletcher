// Our light anti-aircraft battery: five twin 40 mm Bofors (160 rounds a minute a barrel, 881 m/s) and six 20 mm
// Oerlikons (450 a minute, 820 m/s). AI gun crews engage aircraft on their own (Controls: AI gunners), leading the
// target by the round's time of flight and drop, as the Mk 51 directors and Mk 14 gyro sights did.
// Take a gun yourself with G (or the AA button): mouse / drag to aim, click / Space / FIRE to shoot, right mouse or
// Z to zoom, Q / E for the next gun, G to leave. X locks the plane in your sight for the 5"/38s (VT shells).

const AA_GUNS = {
    40: { name: '40 mm Bofors', v0: 881, drag: 2.4e-4, interval: 60 / 320, life: 4.6, size: 1.7, color: [1, 0.42, 0.18], dmg: 1.3,
        range: 2800, train: 55, elev: 45, manTrain: 110, manElev: 90, spread: 0.0032, loud: 0.55, pitch: 0.55 },
    20: { name: '20 mm Oerlikon', v0: 820, drag: 4.2e-4, interval: 0.2, life: 3.0, size: 1.1, color: [1, 0.56, 0.22], dmg: 0.45,
        range: 1200, train: 90, elev: 80, manTrain: 170, manElev: 150, spread: 0.0045, loud: 0.35, pitch: 1.25 }
};

const AA = (() => {
    const mounts = [];
    const st = { manned: false, idx: 0, yaw: 0, pitch: 0.25, zoom: false, fov: 62, strafedMsgT: -99 };
    const _mw = new THREE.Vector3(), _dir = new THREE.Vector3(), _aim = new THREE.Vector3(), _p = new THREE.Vector3(), _v = new THREE.Vector3(),
        _l = new THREE.Vector3(), _qi = new THREE.Quaternion(), _eye = new THREE.Vector3();

    function init() {
        mounts.length = 0;
        (myShip.userData.aa || []).forEach((d, i) => {
            const cradle = d.obj.userData.barrel;
            const m = Object.assign({}, d, {
                gun: AA_GUNS[d.kind], cradle, i, stowYaw: d.obj.rotation.y, stowEl: -cradle.rotation.x,
                yaw: d.obj.rotation.y, el: -cradle.rotation.x, fireT: 0, barrel: 0, target: null, retarget: Math.random() * 0.5,
                errYaw: 0, errEl: 0, errYawT: 0, errElT: 0, errT: 0, disabled: 0, rounds: 0, soundT: Math.random() * 0.3, cut: false,
                muzzles: d.kind === 40 ? [new THREE.Vector3(0.32, 0, 3.4), new THREE.Vector3(-0.32, 0, 3.4)] : [new THREE.Vector3(0, 0, 1.75)]
            });
            m.opts = tracerOpts(m);
            mounts.push(m);
        });
        initInput();
    }

    // ------------------------------------------------------------------ rounds
    function roundHits(a, b) {
        const pl = Air.hitTest(a, b);
        if (pl) return pl;
        if (b.y < 30) {
            const e = enemyHitTest(b);
            if (e) return e;
            if (b.y < 60) { const s = Islands.structureAt(b); if (s) return s; }
        }
        return null;
    }
    function tracerOpts(m) {
        const gun = m.gun, small = m.kind === 40 ? 0.12 : 0.05;
        return {
            color: gun.color, drag: gun.drag, life: gun.life, size: gun.size, fade: true,
            test: roundHits,
            onHit: (hit, p) => {
                if (hit.isAir) Air.damage(hit, gun.dmg * rnd(0.75, 1.3), p, st.manned && mounts[st.idx] === m ? 'you' : m.name);
                else if (hit.isStructure) { FX.spark(p, 6); Islands.impact(p, small, hit, true); }
                else {
                    FX.spark(p, 6);
                    if (hit.typeKey === 'barge') damageEnemy(hit, small * 3, p);
                    else { hit.hp -= small * 0.3; if (hit.hp <= 0) damageEnemy(hit, 0.01, p); }
                }
            },
            onLand: p => { FX.dirt(p, m.kind === 40 ? 0.1 : 0.04); Islands.impact(p, small, null, true); },
            onWater: p => FX.smallSplash(p.x, waterHeight(p.x, p.z, simTime), p.z, m.kind === 40 ? 1 : 0.6),
            burst: m.kind === 40 ? p => FX.flak(p, 0.3) : null
        };
    }

    // Firing cut-outs: the guns can't fire into our own ship
    function blocked(m, l) {
        const el = Math.asin(THREE.MathUtils.clamp(l.y, -1, 1));
        if (el > 0.8) return false;                                  // high-angle fire clears the upperworks
        if (m.side !== 0) return l.x * m.side < -0.2 && el < 0.5;    // across the deck
        return l.z > 0.7 && el < 0.45;                               // centreline aft mount: stack and deckhouse ahead
    }

    // Where to aim so a round meets the plane: its position after the round's time of flight (quadratic drag),
    // raised for the drop, less the ship's own motion (the round carries it)
    function lead(m, plane, from, out) {
        const gun = m.gun;
        let t = 0;
        for (let k = 0; k < 3; k++) {
            _p.copy(plane.pos).addScaledVector(plane.vel, t);
            const d = _p.distanceTo(from);
            t = (Math.exp(gun.drag * d) - 1) / (gun.drag * gun.v0);
        }
        out.copy(_p).addScaledVector(phys.vel, -t);
        out.y += 0.5 * GRAVITY * t * t * 1.15;
        return t;
    }

    function pickTarget(m) {
        let best = null, bs = Infinity;
        for (const p of Air.planes) {
            if (!p.alive) continue;
            const d = p.pos.distanceTo(_mw);
            if (d > m.gun.range * 1.2) continue;
            _l.subVectors(p.pos, _mw).normalize().applyQuaternion(_qi);
            if (blocked(m, _l)) continue;
            const attacking = p.state === 'dive' || p.state === 'run' || p.state === 'strafe';
            const closing = p.vel.dot(_v.subVectors(phys.pos, p.pos)) > 0;
            const s = d - (attacking ? 1800 : 0) - (closing ? 400 : 0);
            if (s < bs) { bs = s; best = p; }
        }
        return best;
    }

    function fire(m, loudFactor) {
        const gun = m.gun, mz = m.muzzles[m.barrel++ % m.muzzles.length];
        _p.copy(mz).applyMatrix4(m.cradle.matrixWorld);
        _dir.set(0, 0, 1).transformDirection(m.cradle.matrixWorld);
        _dir.x += randn() * gun.spread; _dir.y += randn() * gun.spread; _dir.z += randn() * gun.spread;
        _v.copy(_dir.normalize()).multiplyScalar(gun.v0).add(phys.vel);
        Tracers.fire(_p, _v, m.opts);
        fireFx.emit({ x: _p.x, y: _p.y, z: _p.z, vx: _dir.x * 30 + phys.vel.x, vy: _dir.y * 30, vz: _dir.z * 30 + phys.vel.z,
            life: 0.06, s0: m.kind === 40 ? 1.6 : 0.9, s1: m.kind === 40 ? 2.6 : 1.4, r: 1, g: 0.75, b: 0.35, a: 1, drag: 8, grav: 0 });
        if (Math.random() < 0.5) smokeFx.emit({ x: _p.x, y: _p.y, z: _p.z, vx: phys.vel.x * 0.6 + _dir.x * 4, vy: 1 + _dir.y * 4, vz: phys.vel.z * 0.6 + _dir.z * 4,
            life: rnd(1, 2.2), s0: 0.6, s1: m.kind === 40 ? 4 : 2.5, r: 0.85, g: 0.84, b: 0.82, a: 0.3, drag: 1.5, grav: -0.2 });
        if (loudFactor > 1) playBurst(_p, 1, 0, gun.loud * loudFactor, gun.pitch);   // our own gun: every report, right now
        else m.rounds++;
    }

    function updateMount(m, dt, manned) {
        const gun = m.gun;
        m.cradle.getWorldPosition(_mw);
        if (m.disabled > 0) m.disabled -= dt;
        let tYaw = m.stowYaw, tEl = m.stowEl, wantFire = false, aligned = true;
        let trainRate = gun.train * DEG, elevRate = gun.elev * DEG;
        m.cut = false;
        if (manned) {
            const cp = Math.cos(st.pitch);
            _l.set(Math.sin(st.yaw) * cp, Math.sin(st.pitch), Math.cos(st.yaw) * cp).applyQuaternion(_qi);
            tYaw = Math.atan2(_l.x, _l.z); tEl = Math.asin(THREE.MathUtils.clamp(_l.y, -1, 1));
            trainRate = gun.manTrain * DEG; elevRate = gun.manElev * DEG;
            m.cut = blocked(m, _l);
            wantFire = AA.trigger && m.disabled <= 0 && Game.running;
        } else if (Settings.ctl.aaAuto && Game.running && m.disabled <= 0) {
            m.retarget -= dt;
            if (m.retarget <= 0 || (m.target && !m.target.alive)) {
                const prev = m.target;
                m.retarget = rnd(0.35, 0.7);
                m.target = pickTarget(m);
                if (m.target && m.target !== prev) m.react = rnd(1.5, 4);   // spotting it, slewing on, getting the range
            }
            m.react = Math.max(0, (m.react || 0) - dt);
            const p = m.target;
            if (p && p.alive) {
                lead(m, p, _mw, _aim);
                _l.subVectors(_aim, _mw).normalize().applyQuaternion(_qi);
                // The crew's aim wanders: worse at long range and when the ship rolls hard
                m.errT -= dt;
                if (m.errT <= 0) {
                    m.errT = rnd(0.35, 0.8);
                    const d = p.pos.distanceTo(_mw), sig = (1.1 + 1.3 * d / 1500) * DEG * (1 + Math.abs(phys.tiltW.z) * 4);
                    m.errYawT = randn() * sig; m.errElT = randn() * sig;
                }
                m.errYaw += (m.errYawT - m.errYaw) * Math.min(1, dt * 3);
                m.errEl += (m.errElT - m.errEl) * Math.min(1, dt * 3);
                tYaw = Math.atan2(_l.x, _l.z) + m.errYaw;
                tEl = Math.asin(THREE.MathUtils.clamp(_l.y, -1, 1)) + m.errEl;
                const inRange = p.pos.distanceTo(_mw) < gun.range;
                m.cut = blocked(m, _l);
                wantFire = inRange && !m.cut && m.react <= 0;
                aligned = false;
            } else m.target = null;
        }
        const dYaw = wrapAngle(tYaw - m.yaw);
        m.yaw = wrapAngle(m.yaw + THREE.MathUtils.clamp(dYaw, -trainRate * dt, trainRate * dt));
        tEl = THREE.MathUtils.clamp(tEl, -0.09, 1.5);
        m.el = stepToward(m.el, tEl, elevRate * dt);
        m.obj.rotation.y = m.yaw;
        m.cradle.rotation.x = -m.el;
        if (!aligned) aligned = Math.abs(wrapAngle(tYaw - m.yaw)) < 0.035 && Math.abs(tEl - m.el) < 0.035;
        m.fireT -= dt;
        if (wantFire && aligned && !m.cut) {
            m.obj.updateMatrixWorld(true);
            while (m.fireT <= 0) { m.fireT += gun.interval * rnd(0.9, 1.1); fire(m, manned ? 1.8 : 1); }
        } else m.fireT = Math.max(m.fireT, 0);
        // AI guns: their reports in short batches
        m.soundT -= dt;
        if (m.soundT <= 0) {
            m.soundT = 0.3;
            if (m.rounds > 0) { playBurst(_mw, m.rounds, 0.3 / m.rounds, gun.loud, gun.pitch); m.rounds = 0; }
        }
    }

    // ------------------------------------------------------------------ manning a gun
    // The gun that best covers the nearest plane (or what's ahead of the camera), forward port 40 mm by default
    function bestMount() {
        const plane = Air.planes.filter(p => p.alive).sort((a, b) => a.pos.distanceTo(phys.pos) - b.pos.distanceTo(phys.pos))[0];
        _qi.copy(phys.quat).invert();
        let best = 0, bs = Infinity;
        mounts.forEach((m, i) => {
            m.cradle.getWorldPosition(_mw);
            if (plane) _l.subVectors(plane.pos, _mw).normalize().applyQuaternion(_qi);
            else camera.getWorldDirection(_l).applyQuaternion(_qi);
            const s = (blocked(m, _l) ? 10 : 0) + (m.kind === 40 ? 0 : 0.5) + (m.disabled > 0 ? 20 : 0) - _l.x * m.side * 0.2;
            if (s < bs) { bs = s; best = i; }
        });
        return best;
    }
    function aimAlongMount(m) {
        m.cradle.updateMatrixWorld(true);
        _dir.set(0, 0, 1).transformDirection(m.cradle.matrixWorld);
        st.yaw = Math.atan2(_dir.x, _dir.z);
        st.pitch = THREE.MathUtils.clamp(Math.asin(_dir.y), -0.05, 1.4);
    }
    function enter(idx) {
        if (!Game.running || !mounts.length) return;
        if (captain.active) setCaptain(false);
        st.manned = true;
        st.idx = idx === undefined ? bestMount() : idx;
        const m = mounts[st.idx];
        aimAlongMount(m);
        const plane = Air.planes.find(p => p.alive);
        if (plane) { m.cradle.getWorldPosition(_mw); _dir.subVectors(plane.pos, _mw).normalize(); st.yaw = Math.atan2(_dir.x, _dir.z); st.pitch = Math.asin(_dir.y); }
        st.fov = 62;
        setCameraMode('aa');
        document.body.classList.add('aaview');
        hudMessage(`On the ${m.name} ${m.gun.name}. ${Settings.touchUI ? 'Drag to aim, hold FIRE.' : 'Mouse aims · click / Space fires · right mouse zooms · Q/E next gun · X locks the plane for the 5" · G leaves'}`, 'info');
    }
    function leave() {
        if (!st.manned) return;
        st.manned = false;
        AA.trigger = false;
        st.zoom = false;
        document.body.classList.remove('aaview');
        if (document.pointerLockElement) document.exitPointerLock();
        camera.fov = 45;
        camera.updateProjectionMatrix();
        if (cameraMode === 'aa') setCameraMode('chase');
    }
    function cycle(d) {
        if (!st.manned) return;
        st.idx = (st.idx + d + mounts.length) % mounts.length;
        const m = mounts[st.idx];
        hudMessage(`${m.name} ${m.gun.name}${m.disabled > 0 ? ' — crew down' : ''}`, 'info');
    }
    function look(dYaw, dPitch) {
        if (!st.manned) return;
        st.yaw = wrapAngle(st.yaw + dYaw);
        st.pitch = THREE.MathUtils.clamp(st.pitch + dPitch, -0.12, 1.5);
    }
    function updateCamera(dt) {
        const m = mounts[st.idx];
        m.obj.updateMatrixWorld(true);
        // The pointer's seat: behind and beside the breech, turning with the mount
        _eye.set(m.kind === 40 ? 0.85 : 0.0, m.kind === 40 ? 2.0 : 1.75, m.kind === 40 ? -1.1 : -0.85);
        camera.position.copy(m.obj.localToWorld(_eye));
        camera.rotation.set(st.pitch, st.yaw + Math.PI, 0, 'YXZ');
        st.fov += ((st.zoom ? 22 : 62) - st.fov) * Math.min(1, dt * 12);
        if (Math.abs(camera.fov - st.fov) > 0.01) { camera.fov = st.fov; camera.updateProjectionMatrix(); }
        camera.updateMatrixWorld(true);
    }

    function initInput() {
        const el = renderer.domElement;
        el.addEventListener('pointerdown', e => {
            if (!st.manned || e.pointerType === 'touch') return;
            ensureAudio();
            if (document.pointerLockElement !== el && el.requestPointerLock) el.requestPointerLock();
            if (e.button === 0) AA.trigger = true;
            if (e.button === 2) st.zoom = true;
        });
        window.addEventListener('pointerup', e => {
            if (e.pointerType === 'touch') return;
            if (e.button === 0 && st.manned) AA.trigger = false;
            if (e.button === 2) st.zoom = false;
        });
        window.addEventListener('mousemove', e => {
            if (!st.manned || !Number.isFinite(e.movementX)) return;
            if (document.pointerLockElement !== el && !(e.buttons & 1)) return;   // without the pointer captured, drag to aim
            const k = 0.0021 * st.fov / 62 * Settings.ctl.lookSens;
            look(-e.movementX * k, -e.movementY * k);
        });
        el.addEventListener('contextmenu', e => { if (st.manned) e.preventDefault(); });
    }

    // ------------------------------------------------------------------ damage to the battery
    function strafed(p) {
        const local = myShip.worldToLocal(p.clone());
        mounts.forEach(m => {
            if (m.disabled > 0 || m.obj.position.distanceTo(local) > 3.2) return;
            m.disabled = rnd(15, 35);
            if (simTime - st.strafedMsgT > 5) { st.strafedMsgT = simTime; hudMessage(`Strafing hit the ${m.name} crew!`, 'alert'); }
        });
    }
    function knockOut(local, r) {
        mounts.forEach(m => { if (m.obj.position.distanceTo(local) < r) m.disabled = Math.max(m.disabled, rnd(60, 120)); });
    }
    function repairAll() { mounts.forEach(m => { m.disabled = 0; }); }

    // ------------------------------------------------------------------ the gunsight
    // Mk 14-style reflector sight: 50 and 100 mil rings, and the computed lead pip on the plane nearest the sight
    function drawSight(ctx, w, h) {
        const m = mounts[st.idx], cx = w / 2, cy = h / 2;
        const ppr = (h / 2) / Math.tan(camera.fov * DEG / 2);
        ctx.save();
        const col = m.cut || m.disabled > 0 ? 'rgba(255,90,70,0.9)' : 'rgba(255,160,70,0.92)';
        ctx.strokeStyle = ctx.fillStyle = col;
        ctx.lineWidth = 1.6;
        [0.05, 0.1].forEach((mil, i) => {
            ctx.beginPath();
            ctx.arc(cx, cy, mil * ppr, 0, Math.PI * 2);
            ctx.stroke();
            if (i === 1) [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(([a, b]) => {
                ctx.beginPath();
                ctx.moveTo(cx + a * mil * ppr, cy + b * mil * ppr);
                ctx.lineTo(cx + a * (mil * ppr + 10), cy + b * (mil * ppr + 10));
                ctx.stroke();
            });
        });
        ctx.beginPath(); ctx.arc(cx, cy, 2.2, 0, Math.PI * 2); ctx.fill();
        // Planes: brackets, and a lead pip on the one nearest the sight line
        m.cradle.getWorldPosition(_mw);
        let best = null, bd = 0.35;
        camera.getWorldDirection(_dir);
        for (const p of Air.planes) {
            if (!p.alive) continue;
            _v.subVectors(p.pos, camera.position);
            const ang = _v.angleTo(_dir);
            if (ang < bd) { bd = ang; best = p; }
        }
        ctx.font = '11px Consolas, monospace';
        ctx.textAlign = 'center';
        for (const p of Air.planes) {
            if (!p.alive) continue;
            const v = _p.copy(p.pos).project(camera);
            if (v.z >= 1) continue;
            const sx = (v.x * 0.5 + 0.5) * w, sy = (-v.y * 0.5 + 0.5) * h, s = 12;
            ctx.strokeStyle = p === best ? 'rgba(255,90,70,0.95)' : 'rgba(255,190,110,0.75)';
            ctx.beginPath();
            [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([a, b]) => { ctx.moveTo(sx + a * s, sy + b * s * 0.45); ctx.lineTo(sx + a * s, sy + b * s); ctx.lineTo(sx + a * s * 0.45, sy + b * s); });
            ctx.stroke();
            ctx.fillStyle = ctx.strokeStyle;
            ctx.fillText(`${p.type.name.toUpperCase()} ${Math.round(p.pos.distanceTo(_mw))} m`, sx, sy - s - 5);
        }
        if (best) {
            lead(m, best, _mw, _aim);
            const v = _p.copy(_aim).project(camera);
            if (v.z < 1) {
                const sx = (v.x * 0.5 + 0.5) * w, sy = (-v.y * 0.5 + 0.5) * h;
                ctx.strokeStyle = 'rgba(120,255,150,0.95)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(sx, sy - 7); ctx.lineTo(sx + 7, sy); ctx.lineTo(sx, sy + 7); ctx.lineTo(sx - 7, sy); ctx.closePath();
                ctx.stroke();
                ctx.setLineDash([3, 4]);
                ctx.beginPath();
                const b = _p.copy(best.pos).project(camera);
                ctx.moveTo((b.x * 0.5 + 0.5) * w, (-b.y * 0.5 + 0.5) * h); ctx.lineTo(sx, sy);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }
        // Status
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.font = '12px Consolas, monospace';
        const lines = [`${m.name.toUpperCase()} · ${m.gun.name.toUpperCase()}${m.kind === 40 ? ' TWIN' : ''}`];
        if (m.disabled > 0) lines.push('CREW DOWN — Q / E: another gun');
        else if (m.cut) lines.push('CUT-OUT: CAN\'T FIRE INTO THE SHIP');
        else if (best) lines.push('PUT THE GREEN PIP IN THE CENTRE');
        else if (!Air.planes.some(p => p.alive)) lines.push(Settings.ctl.airRaids === 'off' ? 'AIR RAIDS ARE OFF (CONTROLS)' : 'NO AIRCRAFT · SURFACE AND SHORE TARGETS ONLY');
        lines.forEach((t, i) => {
            const y = h - 120 + i * 16;
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillText(t, cx + 1, y + 1);
            ctx.fillStyle = i === 0 ? 'rgba(255,200,130,0.95)' : col;
            ctx.fillText(t, cx, y);
        });
        ctx.restore();
    }

    function update(dt) {
        if (!mounts.length) return;
        _qi.copy(phys.quat).invert();
        if (st.manned && (!Game.running || playerDmg.sinking)) leave();
        mounts.forEach((m, i) => updateMount(m, dt, st.manned && i === st.idx));
    }

    function reset() {
        leave();
        mounts.forEach(m => {
            Object.assign(m, { yaw: m.stowYaw, el: m.stowEl, target: null, disabled: 0, rounds: 0, fireT: 0 });
            m.obj.rotation.y = m.stowYaw;
            m.cradle.rotation.x = -m.stowEl;
        });
    }

    return {
        trigger: false,
        get manned() { return st.manned; },
        get mount() { return mounts[st.idx]; },
        mounts, init, update, reset, enter, leave, cycle, look, updateCamera, drawSight, strafed, knockOut, repairAll,
        toggleManned() { if (st.manned) leave(); else enter(); },
        toggleZoom() { st.zoom = !st.zoom; },
        blocked, lead
    };
})();
