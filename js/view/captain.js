// Captain's view from the bridge: mouse look, 3-14x binoculars with a mil reticle, and Mk 37 director lock.

const captain = {
    active: false, station: 1, yaw: 0, pitch: -0.01, binoc: false, mag: 7, fov: 55, trigger: false,
    aim: new THREE.Vector3(), aimValid: false, aimRange: Infinity, lock: null, locked: false, dragging: false,
    relBrg: 0, trueBrg: 0
};
const STATION_NAMES = ['Port Bridge Wing', 'Open Bridge', 'Starboard Bridge Wing'];
let overlay, overlayCtx;
const raycaster = new THREE.Raycaster();

function setCaptain(on) {
    captain.active = on;
    captain.trigger = false;
    captain.binoc = false;
    captain.lock = null;
    document.body.classList.toggle('captain', on);
    if (on) {
        captain.yaw = 0;
        captain.pitch = -0.01;
        camera.near = 0.25;
        setCameraMode('captain');
    } else {
        if (document.pointerLockElement) document.exitPointerLock();
        camera.near = 0.5;
        camera.fov = 45;
        setCameraMode('chase');
    }
    camera.updateProjectionMatrix();
    overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
}

function updateCaptainCamera(dt) {
    const eye = myShip.userData.eyes[captain.station];
    const p = myShip.localToWorld(eye.clone());
    camera.position.copy(p);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(phys.quat);
    const hdg = Math.atan2(fwd.x, fwd.z);
    const roll = new THREE.Euler().setFromQuaternion(phys.quat, 'YXZ').z;
    // Horizon mostly stabilised (the captain braces), a little ship roll still comes through
    camera.quaternion.setFromEuler(new THREE.Euler(captain.pitch, hdg + Math.PI + captain.yaw, -roll * 0.2, 'YXZ'));
    const targetFov = captain.binoc ? 50 / captain.mag : 55;
    captain.fov += (targetFov - captain.fov) * Math.min(1, dt * 10);
    if (Math.abs(camera.fov - captain.fov) > 0.01) {
        camera.fov = captain.fov;
        camera.updateProjectionMatrix();
    }

    // Line of sight: lock the director on any hull the crosshair touches, else range on the sea
    camera.updateMatrixWorld(true);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    raycaster.set(camera.position, dir);
    raycaster.far = 20000;
    const live = enemies.filter(e => !e.sinking);
    const hits = raycaster.intersectObjects(live.map(e => e.obj), true);
    if (hits.length) {
        let o = hits[0].object;
        while (o.parent && !live.some(e => e.obj === o)) o = o.parent;
        const found = live.find(e => e.obj === o);
        if (found && found !== captain.lock) {
            captain.lock = found;
            hudMessage(`Director locked: ${found.type.name}, ${Math.round(Math.hypot(found.x - phys.pos.x, found.z - phys.pos.z) * 1.0936).toLocaleString()} yds`, 'info');
        }
    }
    if (captain.lock) {
        const tg = captain.lock;
        const toT = new THREE.Vector3(tg.x - p.x, tg.obj.position.y + 3 - p.y, tg.z - p.z).normalize();
        if (tg.sinking || !enemies.includes(tg) || toT.angleTo(dir) > 0.035) captain.lock = null;
    }
    captain.aimValid = false;
    if (captain.lock) {
        // Mk 1A fire control computer: lead the target (and allow for our own motion) by the time of flight
        const tg = captain.lock;
        const sol = firingSolution(Math.hypot(tg.x - phys.pos.x, tg.z - phys.pos.z));
        const tof = sol ? sol.tof : 0;
        const v = enemyVelocity(tg);
        captain.aim.set(tg.x + (v.x - phys.vel.x) * tof, 0, tg.z + (v.z - phys.vel.z) * tof);
        captain.aimValid = true;
    } else if (dir.y < -0.0002) {
        captain.aim.copy(p).addScaledVector(dir, -p.y / dir.y).setY(0);
        captain.aimValid = true;
    }
    captain.aimRange = captain.aimValid ? Math.hypot(captain.aim.x - phys.pos.x, captain.aim.z - phys.pos.z) : Infinity;
    captain.relBrg = ((-captain.yaw / DEG) % 360 + 540) % 360 - 180;
    captain.trueBrg = ((-(hdg + captain.yaw) / DEG) % 360 + 720) % 360;
}

function resizeOverlay() {
    overlay.width = window.innerWidth;
    overlay.height = window.innerHeight;
}

function drawOverlay() {
    const ctx = overlayCtx, w = overlay.width, h = overlay.height;
    ctx.clearRect(0, 0, w, h);
    if (!captain.active) return;
    const cx = w / 2, cy = h / 2;
    const mil = (h / 2) / Math.tan(camera.fov * DEG / 2) * 0.001;
    if (camera.fov < 30) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'destination-out';
        const r = Math.min(h * 0.47, w * 0.27);
        [cx - r * 0.6, cx + r * 0.6].forEach(x => {
            const g = ctx.createRadialGradient(x, cy, r * 0.84, x, cy, r);
            g.addColorStop(0, 'rgba(0,0,0,1)');
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, cy, r, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.globalCompositeOperation = 'source-over';
        // Mil reticle (US Navy Mk 28 style)
        ctx.strokeStyle = 'rgba(15,15,15,0.85)';
        ctx.fillStyle = 'rgba(15,15,15,0.85)';
        ctx.lineWidth = 1.2;
        ctx.font = '11px Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.beginPath();
        ctx.moveTo(cx - 60 * mil, cy); ctx.lineTo(cx + 60 * mil, cy);
        ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + 30 * mil);
        for (let m = -60; m <= 60; m += 5) {
            const len = m % 10 === 0 ? 8 : 4;
            ctx.moveTo(cx + m * mil, cy - len); ctx.lineTo(cx + m * mil, cy);
        }
        for (let m = 5; m <= 30; m += 5) {
            ctx.moveTo(cx - (m % 10 === 0 ? 7 : 4), cy + m * mil); ctx.lineTo(cx, cy + m * mil);
        }
        ctx.stroke();
        for (let m = -60; m <= 60; m += 20) if (m) ctx.fillText(Math.abs(m / 10), cx + m * mil, cy - 12);
    } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx - 12, cy); ctx.lineTo(cx - 4, cy);
        ctx.moveTo(cx + 4, cy); ctx.lineTo(cx + 12, cy);
        ctx.moveTo(cx, cy - 12); ctx.lineTo(cx, cy - 4);
        ctx.moveTo(cx, cy + 4); ctx.lineTo(cx, cy + 12);
        ctx.stroke();
    }
    // Locked-target bracket
    if (captain.lock) {
        const v = new THREE.Vector3(captain.lock.x, captain.lock.obj.position.y + 4, captain.lock.z).project(camera);
        if (v.z < 1) {
            const sx = (v.x * 0.5 + 0.5) * w, sy = (-v.y * 0.5 + 0.5) * h, s = 18;
            ctx.strokeStyle = 'rgba(255,90,70,0.9)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([a, b]) => {
                ctx.moveTo(sx + a * s, sy + b * s * 0.4); ctx.lineTo(sx + a * s, sy + b * s); ctx.lineTo(sx + a * s * 0.4, sy + b * s);
            });
            ctx.stroke();
        }
    }
}

function initCaptainInput() {
    overlay = document.getElementById('overlay');
    overlayCtx = overlay.getContext('2d');
    resizeOverlay();
    const el = renderer.domElement;
    document.addEventListener('pointerlockchange', () => { captain.locked = document.pointerLockElement === el; });
    el.addEventListener('contextmenu', e => { if (captain.active) e.preventDefault(); });
    el.addEventListener('mousedown', e => {
        if (!captain.active || !Game.running) return;
        ensureAudio();
        if (!captain.locked && el.requestPointerLock) {
            el.requestPointerLock();
            captain.dragging = true;
            return;
        }
        if (e.button === 0) captain.trigger = true;
        if (e.button === 2) captain.binoc = true;
    });
    window.addEventListener('mouseup', e => {
        captain.dragging = false;
        if (e.button === 0) captain.trigger = false;
        if (e.button === 2 && captain.locked) captain.binoc = false;
    });
    window.addEventListener('mousemove', e => {
        if (!captain.active || (!captain.locked && !captain.dragging)) return;
        const sens = 0.0022 * captain.fov / 55;
        captain.yaw -= e.movementX * sens;
        captain.pitch = THREE.MathUtils.clamp(captain.pitch - e.movementY * sens, -1.2, 1.2);
    });
    el.addEventListener('wheel', e => {
        if (!captain.active) return;
        e.preventDefault();
        captain.binoc = true;
        captain.mag = THREE.MathUtils.clamp(captain.mag * (e.deltaY > 0 ? 0.87 : 1.15), 3, 14);
    }, { passive: false });
}
