// Camera modes: 'chase' (behind the ship), 'orbit' (mouse orbit that follows the ship),
// 'captain' (bridge / binoculars) and 'cinematic' (slow fly-around for the menus).

let cameraMode = 'cinematic';
let cameraGrabbedFrom = null;   // the mode a drag switched away from (a touch tap switches back)
const lastShipPos = new THREE.Vector3();
const cine = { angle: 2.2, radius: 150, height: 34 };

function setCameraMode(mode, keepView = false) {
    cameraMode = mode;
    controls.enabled = mode === 'orbit';
    if (mode === 'orbit') controls.target.copy(phys.pos).add(new THREE.Vector3(0, 6, 0));
    if (mode === 'orbit' && !keepView) {
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(phys.quat);
        camera.position.copy(phys.pos).addScaledVector(fwd, 60).add(new THREE.Vector3(fwd.z * 90, 35, -fwd.x * 90));
    }
    document.getElementById('camLabel').textContent = { chase: 'Chase camera', orbit: 'Orbit camera', captain: "Captain's view", aa: 'AA gun', cinematic: '' }[mode];
}

// C: chase <-> orbit (leaves the captain's view or the AA gun)
function cycleCamera() {
    if (AA.manned) { AA.leave(); return; }
    if (captain.active) { setCaptain(false); return; }
    setCameraMode(cameraMode === 'chase' ? 'orbit' : 'chase');
}

// Grabbing the view in chase mode (left-drag pan, right-drag orbit, wheel zoom) hands over to the orbit camera.
// Capture-phase listeners run before OrbitControls' own, so the same drag carries straight on.
function initCameraInput() {
    const el = renderer.domElement;
    const grab = () => { if (Game.running && cameraMode === 'chase') { cameraGrabbedFrom = 'chase'; setCameraMode('orbit', true); } };
    el.addEventListener('pointerdown', e => { if (e.button === 0 || e.button === 2) grab(); }, { capture: true });
    el.addEventListener('wheel', grab, { capture: true });
    el.addEventListener('contextmenu', e => { if (!captain.active) e.preventDefault(); });
}

function updateCamera(dt, t) {
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(phys.quat);
    const fwdH = new THREE.Vector2(fwd.x, fwd.z).normalize();
    if (cameraMode === 'captain') {
        updateCaptainCamera(dt);
    } else if (cameraMode === 'aa') {
        AA.updateCamera(dt);
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
        camera.position.set(phys.pos.x + Math.sin(cine.angle) * cine.radius, phys.pos.y + cine.height, phys.pos.z + Math.cos(cine.angle) * cine.radius);
        camera.lookAt(phys.pos.x, phys.pos.y + 7, phys.pos.z);
    }
    lastShipPos.copy(phys.pos);
    if (cameraMode === 'aa') updateDirector();   // a lock (X in the gunsight) still lays the 5"/38s
    else if (cameraMode !== 'captain') {
        if (Game.running) {
            camera.updateMatrixWorld(true);
            updateThirdPersonAim();
        } else director.aimValid = false;
    }

    if (cameraMode !== 'captain' && cameraMode !== 'aa') {
        let floor = waterVisible() ? waterHeight(camera.position.x, camera.position.z, t) + 1.5 : -1e9;
        floor = Math.max(floor, Islands.groundAt(camera.position.x, camera.position.z) + 3);   // never inside a hill
        if (camera.position.y < floor) camera.position.y = floor;
    }
    // Near plane: as far out as the view allows, so distant coastlines don't fight the sea in the depth buffer
    const near = cameraMode === 'captain' ? (captain.binoc ? 2.5 : 0.25) : cameraMode === 'aa' ? 0.3 : 2;
    if (camera.near !== near) { camera.near = near; camera.updateProjectionMatrix(); }
    applyCameraShake(dt);
}
