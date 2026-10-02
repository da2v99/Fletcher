// Bootstrap and main loop. Everything else lives in its own module; this file wires them together.

let scene, camera, renderer, controls, ocean, skyDome, rain;
let myShip;
let simTime = 0, physAcc = 0;
const PHYS_DT = 1 / 120;
const clock = new THREE.Clock();

const waterVisible = () => ocean && ocean.visible;

window.addEventListener('load', () => {
    initRenderer();
    myShip = buildShip(scene);
    // Our hull can hole, dent, sag and break in two (wreck.js): the Fletcher's materials are hers alone
    const hullMat = myShip.children[0].material;
    Wreck.attach(myShip, { ownMaterials: true, inner: m => m === hullMat || m === MAT.deck, maxTilt: 0.6 });
    initPhysics();
    resetPhysics();

    buildSea();
    const cube = Clouds.init();
    skyDome = Clouds.createSkyDome(cube);
    scene.add(skyDome);
    scene.add(Stars.build(cube));
    ocean = createOcean(cube);
    scene.add(ocean);
    rain = createRain();
    scene.add(rain.lines);

    initEffects();
    Debris.init();
    Underwater.init();
    Tracers.init();
    Islands.init();
    initShells();
    initTorpedoes();
    initPlayerWeapons();
    AA.init();
    initCaptainInput();
    initThirdPersonAim();
    initCameraInput();
    Person.init();
    initMenus();
    initKeys();
    TouchUI.apply();
    applyWeather();
    Gfx.apply();
    Clouds.update(renderer, true);

    setCameraMode('cinematic');
    showScreen('mainMenu');
    $('loading').classList.add('hidden');
    animate();
});

function initRenderer() {
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x8899aa, 0.0002);

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 70000);
    camera.position.set(-85, 32, 85);

    renderer = Gfx.createRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    $('canvas-container').appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;   // crisp, with just enough glide
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.minDistance = 8;
    controls.maxDistance = 600;
    controls.mouseButtons = { LEFT: -1, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };   // left click: gun-aim camera (cameras.js)
    controls.enabled = false;

    ambLight = new THREE.AmbientLight(0xffffff, 0.22);
    hemiLight = new THREE.HemisphereLight(0xbfdcff, 0x0f2a45, 0.5);
    sunLight = new THREE.DirectionalLight(0xfff8ee, 1.6);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(4096, 4096);
    Object.assign(sunLight.shadow.camera, { near: 10, far: 400, left: -75, right: 75, top: 75, bottom: -75 });
    sunLight.shadow.bias = -0.0004;
    sunLight.shadow.normalBias = 0.04;
    const fill = new THREE.DirectionalLight(0x9cc4ff, 0.3);
    fill.position.set(100, 20, -50);
    scene.add(ambLight, hemiLight, sunLight, sunLight.target, fill);

    const onResize = () => {
        Gfx.resize();
        if (overlay) resizeOverlay();
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => setTimeout(onResize, 250));
}

function initKeys() {
    window.addEventListener('keydown', e => {
        const k = e.key.toLowerCase();
        if (k.startsWith('arrow') || k === ' ') e.preventDefault();
        if (k === 'escape' || k === 'p') {
            if ((Game.running && !Game.over) || Person.active) Game.setPaused(!Game.paused);
            return;
        }
        // On foot, in the water or in the boat: the walker gets the keys (even after the ship is lost)
        if (Person.active) { if (!Game.paused) Person.key(k, true, e); return; }
        if (!Game.running || Game.paused) return;
        if (k === 'a' || k === 'arrowleft') drive.left = true;
        if (k === 'd' || k === 'arrowright') drive.right = true;
        if (k === ' ') { ensureAudio(); if (AA.manned) AA.trigger = true; else director.trigger = true; }
        if (e.repeat) return;
        if (k === 'g') { ensureAudio(); AA.toggleManned(); return; }
        if (k === 'e') { ensureAudio(); Person.enter(); return; }   // step out of the ship view onto the deck
        if (AA.manned) {
            if (k === 'q') AA.cycle(e.shiftKey ? -1 : 1);
            if (k === 'z') AA.toggleZoom();
            if (k === 'r') AA.toggleBattery();
            if (k === 'x') toggleLock(window.innerWidth / 2, window.innerHeight / 2);
            if (k === 'b') { AA.leave(); setCaptain(true); }
            if (k === 'c') AA.leave();
            if (k === 'w' || k === 'arrowup') { ensureAudio(); setEngineOrder(drive.order + 1); AutoCaptain.manualOrder(); }
            if (k === 's' || k === 'arrowdown') { ensureAudio(); setEngineOrder(drive.order - 1); AutoCaptain.manualOrder(); }
            if (k === '0') { setEngineOrder(STOP_IDX); AutoCaptain.manualOrder(); }
            if (k === 't') fireTorpedoes();
            return;
        }
        if (k === 'w' || k === 'arrowup') { ensureAudio(); setEngineOrder(drive.order + 1); }
        if (k === 's' || k === 'arrowdown') { ensureAudio(); setEngineOrder(drive.order - 1); }
        if (k === '0') setEngineOrder(STOP_IDX);
        if (k === 'x') {
            if (captain.active || cameraMode === 'aim') toggleLock(window.innerWidth / 2, window.innerHeight / 2);
            else if (tpAim.onCanvas) toggleLock(tpAim.x, tpAim.y);
            else toggleLock();   // mouse off the view: X just releases
        }
        if (k === 'c') cycleCamera();
        if (k === 'b') setCaptain(!captain.active);
        if (k === 't') fireTorpedoes();
        if (k === 'h') ocean.visible = !ocean.visible;
        if (captain.active) {
            if (k === 'z') captain.binoc = !captain.binoc;
            if (k === 'q') captain.station = Math.max(0, captain.station - 1);
            if (k === 'r') captain.station = Math.min(2, captain.station + 1);
        }
    });
    window.addEventListener('blur', () => { drive.left = drive.right = false; director.trigger = false; AA.trigger = false; });
    window.addEventListener('keyup', e => {
        const k = e.key.toLowerCase();
        if (Person.active) { Person.key(k, false, e); return; }
        if (k === 'a' || k === 'arrowleft') drive.left = false;
        if (k === 'd' || k === 'arrowright') drive.right = false;
        if (k === ' ') { director.trigger = false; AA.trigger = false; }
    });
}

// A few frames in, make sure the ocean and sky shaders compiled on this device; if not, step down a level
let shaderChecks = 0;
function checkShaders() {
    if (shaderChecks > 3 || ++shaderChecks < 3) return;
    shaderChecks = 99;
    if (Gfx.failed(ocean.material)) {
        const q = ocean.userData.quality;
        if (q > 0) {
            Settings.gfx.ocean = q - 1;
            Settings.save();
            rebuildOcean(q - 1);
            shaderChecks = 0;   // check the simpler one too
            console.warn('Ocean shader failed on this device; using quality', q - 1);
        }
    }
}

function animate() {
    requestAnimationFrame(animate);
    const realDt = Math.min(clock.getDelta(), 0.1);
    // Pause freezes the battle, not the sea: waves and the ship keep moving so settings changes are visible
    const dt = Game.paused ? 0 : realDt;

    updateDrive(realDt);
    physAcc += realDt;
    while (physAcc >= PHYS_DT) {
        stepPhysics(PHYS_DT, simTime);
        simTime += PHYS_DT;
        physAcc -= PHYS_DT;
    }
    updateEnemies(dt, simTime);   // dt = 0 while paused: they only ride the waves
    if (dt > 0) {
        Game.update(dt);
        if (Game.mode !== 'menu') updatePlayerDamage(dt);
        updateShells(dt, simTime);
        updateTorpedoes(dt, simTime);
    }
    WEATHER_U.uTime.value = simTime;

    myShip.position.copy(phys.pos);
    myShip.quaternion.copy(phys.quat);
    myShip.updateMatrixWorld(true);
    Wreck.pose(myShip, dt);   // broken in two: each half pivots about the break
    if (dt > 0) {
        AutoCaptain.update(dt);
        updatePlayerGuns(dt);
        updateTorpedoMounts(dt);
        Air.update(dt, simTime);
        AA.update(dt);
    }
    Person.update(dt, simTime);
    {
        const spin = drive.thrust * phys.engine / T_MAX * 0.5;
        myShip.userData.props[0].rotation.z -= spin;
        myShip.userData.props[1].rotation.z += spin;
        const flag = myShip.userData.flag;
        const p = flag.geometry.attributes.position, base = flag.userData.basePos;
        const flutter = 7 + weather.storm * 6;
        for (let i = 0; i < p.count; i++) {
            const fly = -base[i * 3 + 2];
            p.setX(i, base[i * 3] + Math.sin(fly * 3.2 - simTime * flutter) * 0.09 * fly);
        }
        p.needsUpdate = true;
    }

    TouchUI.update(realDt);
    updateCamera(realDt, simTime);
    Islands.update(dt, simTime);
    Tracers.update(dt, simTime);
    updateOcean(ocean, simTime, phys.pos, phys.quat, phys.vel);
    sunLight.target.position.copy(phys.pos);
    sunLight.position.copy(phys.pos).addScaledVector(SUN_DIR, 200);

    rain.update(dt, phys.vel);
    updateLightning(realDt);
    updateEffects(dt);
    Debris.update(dt, simTime);
    Clouds.update(renderer);
    skyDome.position.copy(camera.position);
    Stars.update();
    updateFogColor();
    Underwater.update(realDt, simTime);

    Wreck.update();
    GunDrive.frame();
    Gfx.render(realDt * 1000, simTime);
    checkShaders();
    drawOverlay();
    if (Game.mode !== 'menu') updateHud(realDt);
}
