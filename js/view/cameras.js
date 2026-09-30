// Camera modes: 'chase' (behind the ship), 'orbit' (mouse orbit that follows the ship),
// 'captain' (bridge / binoculars) and 'cinematic' (slow fly-around for the menus).

let cameraMode = 'cinematic';
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
    document.getElementById('camLabel').textContent = { chase: 'Chase camera', orbit: 'Orbit camera', captain: "Captain's view", cinematic: '' }[mode];
}

// C: chase <-> orbit (leaves the captain's view if we are on the bridge)
function cycleCamera() {
    if (captain.active) { setCaptain(false); return; }
    setCameraMode(cameraMode === 'chase' ? 'orbit' : 'chase');
}

// Grabbing the view in chase mode (left-drag pan, right-drag orbit, wheel zoom) hands over to the orbit camera.
// Capture-phase listeners run before OrbitControls' own, so the same drag carries straight on.
function initCameraInput() {
    const el = renderer.domElement;
    const grab = () => { if (Game.running && cameraMode === 'chase') setCameraMode('orbit', true); };
    el.addEventListener('pointerdown', e => { if (e.button === 0 || e.button === 2) grab(); }, { capture: true });
    el.addEventListener('wheel', grab, { capture: true });
    el.addEventListener('contextmenu', e => { if (!captain.active) e.preventDefault(); });
}

function updateCamera(dt, t) {
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(phys.quat);
    const fwdH = new THREE.Vector2(fwd.x, fwd.z).normalize();
    if (cameraMode === 'captain') {
        updateCaptainCamera(dt);
    } else if (cameraMode === 'chase') {
        const desired = new THREE.Vector3(phys.pos.x - fwdH.x * 85, phys.pos.y + 26, phys.pos.z - fwdH.y * 85);
        camera.position.lerp(desired, 1 - Math.exp(-dt * 1.5));
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
    if (cameraMode !== 'captain') {
        if (Game.running) {
            camera.updateMatrixWorld(true);
            updateThirdPersonAim();
        } else director.aimValid = false;
    }

    if (cameraMode !== 'captain' && waterVisible()) {
        const wh = waterHeight(camera.position.x, camera.position.z, t) + 1.5;
        if (camera.position.y < wh) camera.position.y = wh;
    }
    applyCameraShake(dt);
}
