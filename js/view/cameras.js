// Camera modes: 'chase' (behind the ship), 'orbit' (mouse orbit that follows the ship), 'aim' (left-click:
// the mouse is captured and orbits the camera round the ship, crosshair fixed in the centre for fine aim),
// 'captain' (bridge / binoculars), 'aa' (on a light AA gun), 'person' (on foot, swimming or in a boat) and
// 'cinematic' (slow fly-around for the menus).

let cameraMode = 'cinematic';
let cameraGrabbedFrom = null;   // the mode a drag switched away from (a touch tap switches back)
const lastShipPos = new THREE.Vector3();
const cine = { angle: 2.2, radius: 150, height: 34 };
// Gun-aim camera: world yaw / pitch of the line of sight (eased toward the mouse's targets), distance behind
// the ship, and a hold-to-zoom scope
const aimCam = { yaw: 0, pitch: -0.04, tYaw: 0, tPitch: -0.04, dist: 95, tDist: 95, fov: 45, zoom: false };

function setCameraMode(mode, keepView = false) {
    const prev = cameraMode;
    cameraMode = mode;
    if (prev === 'film' && mode !== 'film') FilmCam.exit();
    controls.enabled = mode === 'orbit';
    if (mode === 'orbit') controls.target.copy(phys.pos).add(new THREE.Vector3(0, 6, 0));
    if (mode === 'orbit' && !keepView) {
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(phys.quat);
        camera.position.copy(phys.pos).addScaledVector(fwd, 60).add(new THREE.Vector3(fwd.z * 90, 35, -fwd.x * 90));
    }
    if (prev === 'aim' && mode !== 'aim') {
        aimCam.zoom = false;
        director.trigger = false;
        if (camera.fov !== 45) { camera.fov = 45; camera.updateProjectionMatrix(); }
        if (mode === 'orbit' && keepView) controls.target.copy(phys.pos).add(new THREE.Vector3(0, 6, 0));
    }
    document.body.classList.toggle('aimcam', mode === 'aim');
    document.getElementById('camLabel').textContent = {
        chase: 'Chase camera · click to aim', orbit: 'Orbit camera · click to aim', aim: 'Gun-aim camera · click / Space fire · right mouse zoom · Esc frees the mouse',
        captain: "Captain's view", aa: 'AA gun', person: 'On foot', cinematic: '', film: ''
    }[mode];
}

// C: chase <-> orbit (leaves the captain's view, the AA gun or the aim camera)
function cycleCamera() {
    if (AA.manned) { AA.leave(); return; }
    if (captain.active) { setCaptain(false); return; }
    if (cameraMode === 'aim') { if (document.pointerLockElement) document.exitPointerLock(); setCameraMode('chase'); return; }
    if (cameraMode === 'film') { setCameraMode('chase'); return; }
    setCameraMode(cameraMode === 'chase' ? 'orbit' : 'chase');
}

// Enter the gun-aim camera from wherever the third-person camera is now, looking the same way
function enterAimCamera() {
    const dir = camera.getWorldDirection(new THREE.Vector3());
    aimCam.yaw = aimCam.tYaw = Math.atan2(dir.x, dir.z);
    aimCam.pitch = aimCam.tPitch = THREE.MathUtils.clamp(Math.asin(dir.y), -1.2, 0.5);
    aimCam.dist = aimCam.tDist = THREE.MathUtils.clamp(camera.position.distanceTo(phys.pos), 45, 420);
    aimCam.fov = camera.fov;
    setCameraMode('aim');
    lockPointer(renderer.domElement);
}

// A mouse button pressed while another is already held arrives as a pointermove with new e.buttons, not as a
// pointerdown (Pointer Events "chorded" buttons), so holding right mouse to zoom would swallow the left click
// that fires. This reports every press and release in a chord: fn(button 0 | 2, down).
function onMouseChord(fn) {
    let last = 0;
    const seen = e => { if (e.pointerType === 'mouse') last = e.buttons; };
    window.addEventListener('pointerdown', seen, true);
    window.addEventListener('pointerup', seen, true);
    window.addEventListener('pointermove', e => {
        if (e.pointerType !== 'mouse' || e.buttons === last) return;
        const ch = e.buttons ^ last;
        last = e.buttons;
        if (ch & 1) fn(0, !!(e.buttons & 1));
        if (ch & 2) fn(2, !!(e.buttons & 2));
    }, true);
}

// Left click in the chase or orbit camera captures the mouse for the gun-aim camera; right drag orbits and the
// wheel zooms as before (a drag in chase view hands over to the orbit camera). Capture-phase listeners run
// before OrbitControls' own.
function initCameraInput() {
    const el = renderer.domElement;
    const grab = () => { if (Game.running && cameraMode === 'chase') { cameraGrabbedFrom = 'chase'; setCameraMode('orbit', true); } };
    el.addEventListener('pointerdown', e => {
        if (e.pointerType === 'mouse' && Game.running && !Game.paused && (cameraMode === 'chase' || cameraMode === 'orbit') && e.button === 0) {
            e.stopImmediatePropagation();
            ensureAudio();
            enterAimCamera();
            return;
        }
        if (cameraMode === 'aim' && e.pointerType === 'mouse') {
            e.stopImmediatePropagation();
            if (document.pointerLockElement !== el) { lockPointer(el); return; }
            if (e.button === 0) { ensureAudio(); director.trigger = true; }
            if (e.button === 2) aimCam.zoom = true;
            return;
        }
        if (e.button === 2) grab();
    }, { capture: true });
    window.addEventListener('pointerup', e => {
        if (cameraMode !== 'aim' || e.pointerType !== 'mouse') return;
        if (e.button === 0) director.trigger = false;
        if (e.button === 2) aimCam.zoom = false;
    });
    onMouseChord((b, down) => {
        if (cameraMode !== 'aim' || document.pointerLockElement !== el) return;
        if (b === 0) { if (down) ensureAudio(); director.trigger = down; } else aimCam.zoom = down;
    });
    el.addEventListener('wheel', e => {
        if (cameraMode === 'aim') {
            e.preventDefault();
            e.stopImmediatePropagation();
            aimCam.tDist = THREE.MathUtils.clamp(aimCam.tDist * (e.deltaY > 0 ? 1.12 : 0.89), 45, 420);
            return;
        }
        grab();
    }, { capture: true, passive: false });
    el.addEventListener('contextmenu', e => { if (!captain.active) e.preventDefault(); });
    window.addEventListener('mousemove', e => {
        if (cameraMode !== 'aim' || document.pointerLockElement !== el || !Number.isFinite(e.movementX)) return;
        const k = 0.0021 * aimCam.fov / 45 * zoomSens(aimCam.fov) * Settings.ctl.lookSens;
        aimCam.tYaw -= e.movementX * k;
        aimCam.tPitch = THREE.MathUtils.clamp(aimCam.tPitch - e.movementY * k, -1.25, 0.55);
    });
    // Esc (the browser's own pointer-lock exit) leaves the aim camera for the free orbit camera
    document.addEventListener('pointerlockchange', () => {
        if (cameraMode === 'aim' && document.pointerLockElement !== el) setCameraMode('orbit', true);
    });
}

const _acDir = new THREE.Vector3(), _acPiv = new THREE.Vector3();
function updateAimCamera(dt) {
    aimCam.yaw = easeLook(aimCam.yaw, aimCam.tYaw, dt);
    aimCam.pitch = easeLook(aimCam.pitch, aimCam.tPitch, dt);
    aimCam.dist += (aimCam.tDist - aimCam.dist) * (1 - Math.exp(-dt * 8));
    const cp = Math.cos(aimCam.pitch);
    const dir = _acDir.set(Math.sin(aimCam.yaw) * cp, Math.sin(aimCam.pitch), Math.cos(aimCam.yaw) * cp);
    // The camera sits behind and above a pivot over the ship and looks exactly along the line of sight, so
    // the ship sits low in the frame and the crosshair looks over it at the horizon
    const piv = _acPiv.copy(phys.pos).setY(phys.pos.y + 12);
    camera.position.copy(piv).addScaledVector(dir, -aimCam.dist);
    camera.position.y += aimCam.dist * 0.16;
    camera.lookAt(piv.copy(camera.position).add(dir));
    const fov = aimCam.zoom ? 14 : 45;
    aimCam.fov += (fov - aimCam.fov) * Math.min(1, dt * 12);
    if (Math.abs(camera.fov - aimCam.fov) > 0.01) { camera.fov = aimCam.fov; camera.updateProjectionMatrix(); }
}

function updateCamera(dt, t) {
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(phys.quat);
    const fwdH = new THREE.Vector2(fwd.x, fwd.z).normalize();
    if (cameraMode === 'captain') {
        updateCaptainCamera(dt);
    } else if (cameraMode === 'aa') {
        AA.updateCamera(dt);
    } else if (cameraMode === 'person') {
        Person.updateCamera(dt, t);
    } else if (cameraMode === 'aim') {
        updateAimCamera(dt);
    } else if (cameraMode === 'film') {
        FilmCam.update(dt, t);
    } else if (cameraMode === 'chase') {
        const desired = new THREE.Vector3(phys.pos.x - fwdH.x * 85, phys.pos.y + 26, phys.pos.z - fwdH.y * 85);
        camera.position.lerp(desired, 1 - Math.exp(-dt * 2.6));
        camera.lookAt(phys.pos.x + fwdH.x * 25, phys.pos.y + 6, phys.pos.z + fwdH.y * 25);
    } else if (cameraMode === 'orbit') {
        const delta = phys.pos.clone().sub(lastShipPos);
        camera.position.add(delta);
        controls.target.add(delta);
        controls.update();
    } else {
        cine.angle += dt * 0.045;
        camera.position.set(phys.pos.x + Math.sin(cine.angle) * cine.radius, Math.max(phys.pos.y, 0) + cine.height, phys.pos.z + Math.cos(cine.angle) * cine.radius);
        camera.lookAt(phys.pos.x, phys.pos.y + 7, phys.pos.z);
    }
    lastShipPos.copy(phys.pos);
    if (cameraMode === 'aa' || cameraMode === 'person' || cameraMode === 'film') updateDirector();   // a lock still lays the 5"/38s
    else if (cameraMode !== 'captain') {
        if (Game.running) {
            camera.updateMatrixWorld(true);
            updateThirdPersonAim();
        } else director.aimValid = false;
    }

    if (cameraMode !== 'captain' && cameraMode !== 'aa' && cameraMode !== 'person' && cameraMode !== 'film') {
        let floor = waterVisible() ? waterHeight(camera.position.x, camera.position.z, t) + 1.5 : -1e9;
        floor = Math.max(floor, Islands.groundAt(camera.position.x, camera.position.z) + 3);   // never inside a hill
        if (camera.position.y < floor) camera.position.y = floor;
    }
    // Near plane: as far out as the view allows, so distant coastlines don't fight the sea in the depth buffer
    const near = cameraMode === 'captain' ? (captain.binoc ? 2.5 : 0.25) : cameraMode === 'aa' || cameraMode === 'person' ? 0.12 : cameraMode === 'film' ? FilmCam.near : 2;
    if (camera.near !== near) { camera.near = near; camera.updateProjectionMatrix(); }
    applyCameraShake(dt);
}
