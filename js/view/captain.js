// Captain's view from the bridge: mouse look, 3-14x binoculars with a mil reticle. X locks the Mk 37 director
// on the ship under the crosshair (see aiming.js).

const captain = {
    active: false, station: 1, yaw: 0, pitch: -0.01, binoc: false, mag: 7, fov: 55,
    locked: false, dragging: false, relBrg: 0, trueBrg: 0
};
const STATION_NAMES = ['Port Bridge Wing', 'Open Bridge', 'Starboard Bridge Wing'];
let overlay, overlayCtx;
function setCaptain(on) {
    captain.active = on;
    director.trigger = false;
    captain.binoc = false;
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

    camera.updateMatrixWorld(true);
    updateDirector(window.innerWidth / 2, window.innerHeight / 2);
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
    if (!Game.running) return;
    drawObjectiveMarker(ctx, w, h);
    if (!captain.active) {
        drawLockBracket(ctx, w, h);
        drawThirdPersonCrosshair(ctx);
        return;
    }
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
    drawLockBracket(ctx, w, h);
}

function initCaptainInput() {
    overlay = document.getElementById('overlay');
    overlayCtx = overlay.getContext('2d');
    resizeOverlay();
    const el = renderer.domElement;
    document.addEventListener('pointerlockchange', () => { captain.locked = document.pointerLockElement === el; });
    el.addEventListener('contextmenu', e => { if (captain.active) e.preventDefault(); });
    // Mouse only: touch screens look around by dragging (touch.js)
    el.addEventListener('pointerdown', e => {
        if (e.pointerType !== 'mouse' || !captain.active || !Game.running) return;
        ensureAudio();
        if (!captain.locked && el.requestPointerLock) {
            el.requestPointerLock();
            captain.dragging = true;
            return;
        }
        if (e.button === 0) director.trigger = true;
        if (e.button === 2) captain.binoc = true;
    });
    window.addEventListener('pointerup', e => {
        if (e.pointerType !== 'mouse') return;
        captain.dragging = false;
        if (e.button === 0 && captain.active) director.trigger = false;
        if (e.button === 2 && captain.locked) captain.binoc = false;
    });
    window.addEventListener('mousemove', e => {
        if (!captain.active || (!captain.locked && !captain.dragging) || !Number.isFinite(e.movementX)) return;
        const sens = 0.0022 * captain.fov / 55 * Settings.ctl.lookSens;
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
