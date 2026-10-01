// Touch controls for phones and tablets: an engine-order telegraph lever, the rudder (slider, ship's wheel or
// tilting the phone), action buttons, and gestures on the view: tap to lock, drag to look, pinch to zoom.
// Everything acts in the same frame as the touch, through the same calls the keyboard and mouse use.

// --- Gyro: tilt steering from gravity, look/aim from the rotation rate ---
const Gyro = (() => {
    const g = { x: 0, y: 0, z: 0, ok: false, rate: { yaw: 0, pitch: 0 }, zero: 0, granted: false, listening: false, steer: 0 };
    let lastRateT = 0;
    // Rotate device axes into screen axes for the current orientation
    const screenAngle = () => (screen.orientation && typeof screen.orientation.angle === 'number' ? screen.orientation.angle : (window.orientation || 0));
    function onMotion(e) {
        const a = e.accelerationIncludingGravity;
        if (a && a.x !== null) {
            const ang = screenAngle() * DEG;
            const c = Math.cos(ang), s = Math.sin(ang);
            g.x = a.x * c + a.y * s;    // screen right
            g.y = -a.x * s + a.y * c;   // screen up
            g.z = a.z;
            g.ok = true;
        }
        const r = e.rotationRate;
        if (r && r.alpha !== null) {
            const ang = screenAngle() * DEG;
            const c = Math.cos(ang), s = Math.sin(ang);
            // rotationRate: alpha about z (out of screen), beta about x, gamma about y (degrees per second)
            const rx = r.beta * c + r.gamma * s, ry = -r.beta * s + r.gamma * c;
            g.rate.pitch = rx;   // tipping the top of the screen away/toward you
            g.rate.yaw = ry;     // turning left/right
            lastRateT = performance.now();
        }
    }
    function listen() {
        if (g.listening) return;
        g.listening = true;
        window.addEventListener('devicemotion', onMotion);
    }
    // iOS asks for permission, and only from a tap
    function request() {
        try {
            if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
                DeviceMotionEvent.requestPermission().then(r => { if (r === 'granted') { g.granted = true; listen(); } }).catch(() => {});
            } else { g.granted = true; listen(); }
        } catch (e) { /* no motion sensors */ }
    }
    function calibrate() { if (g.ok) g.zero = Math.atan2(g.x, Math.abs(g.y) > 0.5 ? Math.abs(g.y) : Math.hypot(g.y, g.z)); }
    // Rudder order (deg) from tilt: deadzone, full rudder at ~28 degrees of tilt / sensitivity
    function steer() {
        if (!g.ok) return 0;
        const r = Math.atan2(g.x, Math.abs(g.y) > 0.5 ? Math.abs(g.y) : Math.hypot(g.y, g.z)) - g.zero;
        const dz = 2.5 * DEG, full = 28 * DEG / Settings.ctl.gyroSens;
        const m = Math.max(0, Math.abs(r) - dz) / (full - dz);
        g.steer = Math.sign(r) * Math.min(1, m) * RUDDER_MAX;
        return g.steer;
    }
    // Look deltas (radians this frame) from the rotation rate, for the captain's and AA views
    function look(dt) {
        if (performance.now() - lastRateT > 250) return { yaw: 0, pitch: 0 };
        const k = DEG * dt * Settings.ctl.gyroSens;
        return { yaw: g.rate.yaw * k, pitch: g.rate.pitch * k };
    }
    return { request, calibrate, steer, look, state: g };
})();

// --- The on-screen controls ---
const TouchUI = (() => {
    let root, thr, thrHandle, thrSpeed, thrLabels = [], rud, rudHandle, rudNeedle, wheel, wheelSvg, gyroInd, gyroNeedle, btns = {};
    let active = false;
    const st = { order: -1, wheelAngle: 0, rudderHeld: false, hintShown: false };
    const speeds = [];   // steady speed per engine order

    const LABELS = ['FULL', '2/3', '1/3', 'STOP', '1/3', '2/3', 'STD', 'FULL', 'FLANK'];

    function el(tag, cls, parent, html) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html !== undefined) e.innerHTML = html;
        if (parent) parent.appendChild(e);
        return e;
    }

    // Engine-order telegraph lever: Flank at the top, Back Full at the bottom, a click at every order
    function buildThrottle() {
        thr = el('div', 'tc tthrottle', root);
        const face = el('div', 'tt-face', thr);
        el('div', 'tt-astern', face);
        el('div', 'tt-slot', face);
        for (let i = 0; i < ORDERS.length; i++) {
            const lab = el('div', 'tt-label' + (i < STOP_IDX ? ' astern' : i === STOP_IDX ? ' stop' : ''), face, LABELS[i]);
            lab.style.top = ((ORDERS.length - 1 - i) / (ORDERS.length - 1) * 84 + 8) + '%';
            thrLabels.push(lab);
        }
        el('div', 'tt-cap ahead', face, 'AHEAD');
        el('div', 'tt-cap back', face, 'ASTERN');
        thrSpeed = el('div', 'tt-speed', face);
        thrHandle = el('div', 'tt-handle', face, '<div class="grip"></div>');
        el('div', 'tc-caption', thr, 'ENGINES');
        const pick = e => {
            const r = face.getBoundingClientRect();
            const f = clamp01((e.clientY - r.top - r.height * 0.08) / (r.height * 0.84));
            ensureAudio();
            setEngineOrder(Math.round((1 - f) * (ORDERS.length - 1)));
        };
        thr.addEventListener('pointerdown', e => { e.preventDefault(); thr.setPointerCapture(e.pointerId); pick(e); thr.classList.add('held'); });
        thr.addEventListener('pointermove', e => { if (thr.hasPointerCapture(e.pointerId)) pick(e); });
        const up = e => { thr.classList.remove('held'); };
        thr.addEventListener('pointerup', up);
        thr.addEventListener('pointercancel', up);
    }

    // Rudder slider: port red on the left, starboard green on the right, springs back amidships
    function buildRudder() {
        rud = el('div', 'tc trudder', root);
        const track = el('div', 'tr-track', rud);
        for (let d = -35; d <= 35; d += 5) {
            const t = el('div', 'tr-tick' + (d % 15 === 0 ? ' major' : ''), track);
            t.style.left = (50 + d / 35 * 46) + '%';
        }
        el('div', 'tr-side port', track, 'PORT');
        el('div', 'tr-side stbd', track, 'STBD');
        rudNeedle = el('div', 'tr-needle', track);
        rudHandle = el('div', 'tr-handle', track);
        el('div', 'tc-caption', rud, 'RUDDER');
        const pick = e => {
            const r = track.getBoundingClientRect();
            const f = THREE.MathUtils.clamp((e.clientX - r.left - r.width * 0.04) / (r.width * 0.92) * 2 - 1, -1, 1);
            drive.cmd = Math.round(f * RUDDER_MAX);
        };
        rud.addEventListener('pointerdown', e => { e.preventDefault(); rud.setPointerCapture(e.pointerId); st.rudderHeld = true; rud.classList.add('held'); pick(e); });
        rud.addEventListener('pointermove', e => { if (rud.hasPointerCapture(e.pointerId)) pick(e); });
        const up = () => {
            st.rudderHeld = false;
            rud.classList.remove('held');
            if (!Settings.ctl.stickyRudder) drive.cmd = 0;
        };
        rud.addEventListener('pointerup', up);
        rud.addEventListener('pointercancel', up);
        rud.addEventListener('dblclick', () => { drive.cmd = 0; });
    }

    // Ship's wheel: turn it with a finger, 1.5 turns lock to lock, stays where you leave it; double-tap centres
    function buildWheel() {
        wheel = el('div', 'tc twheel', root);
        const spokes = [];
        for (let i = 0; i < 8; i++) {
            const a = i * 45;
            spokes.push(`<g transform="rotate(${a} 100 100)">
                <rect x="96.5" y="8" width="7" height="72" rx="3" fill="url(#wSpoke)"/>
                <rect x="94" y="0" width="12" height="22" rx="6" fill="url(#wHandle)"/>
                ${i === 0 ? '<rect x="95" y="27" width="10" height="7" rx="2" fill="#d9b25a"/>' : ''}
            </g>`);
        }
        wheel.innerHTML = `<svg viewBox="0 0 200 200" class="wheel-svg">
            <defs>
                <linearGradient id="wSpoke" x1="0" x2="1"><stop offset="0" stop-color="#5a3216"/><stop offset="0.5" stop-color="#a86b34"/><stop offset="1" stop-color="#5a3216"/></linearGradient>
                <linearGradient id="wHandle" x1="0" x2="1"><stop offset="0" stop-color="#4b2a12"/><stop offset="0.45" stop-color="#b9783d"/><stop offset="1" stop-color="#4b2a12"/></linearGradient>
                <radialGradient id="wHub"><stop offset="0" stop-color="#f4dc98"/><stop offset="0.6" stop-color="#b8913f"/><stop offset="1" stop-color="#6b5220"/></radialGradient>
            </defs>
            <g class="wheel-rot">
                ${spokes.join('')}
                <circle cx="100" cy="100" r="66" fill="none" stroke="#3a210e" stroke-width="15"/>
                <circle cx="100" cy="100" r="66" fill="none" stroke="#9a6230" stroke-width="11"/>
                <circle cx="100" cy="100" r="66" fill="none" stroke="#c48a4e" stroke-width="3" opacity="0.55"/>
                <circle cx="100" cy="100" r="20" fill="url(#wHub)" stroke="#5d4720" stroke-width="2"/>
                <circle cx="100" cy="100" r="7" fill="#3b2c12"/>
            </g>
        </svg>`;
        wheelSvg = wheel.querySelector('.wheel-rot');
        el('div', 'tc-caption', wheel, 'HELM');
        let last = null, lastTap = 0;
        const angleOf = e => { const r = wheel.getBoundingClientRect(); return Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) / DEG; };
        wheel.addEventListener('pointerdown', e => {
            e.preventDefault();
            wheel.setPointerCapture(e.pointerId);
            const now = performance.now();
            if (now - lastTap < 320) { st.wheelAngle = 0; drive.cmd = 0; haptic(20); }
            lastTap = now;
            last = angleOf(e);
            wheel.classList.add('held');
        });
        wheel.addEventListener('pointermove', e => {
            if (!wheel.hasPointerCapture(e.pointerId) || last === null) return;
            const a = angleOf(e);
            let d = a - last;
            if (d > 180) d -= 360; if (d < -180) d += 360;
            last = a;
            const before = Math.floor(st.wheelAngle / 30);
            st.wheelAngle = THREE.MathUtils.clamp(st.wheelAngle + d, -270, 270);
            if (Math.floor(st.wheelAngle / 30) !== before) haptic(6);
            drive.cmd = st.wheelAngle / 270 * RUDDER_MAX;
        });
        const up = () => { last = null; wheel.classList.remove('held'); };
        wheel.addEventListener('pointerup', up);
        wheel.addEventListener('pointercancel', up);
    }

    // Tilt steering indicator; tap it to recentre
    function buildGyro() {
        gyroInd = el('div', 'tc tgyro', root, '<div class="g-arc"></div><div class="g-needle"></div><div class="g-txt">TILT TO STEER<br><small>tap to recentre</small></div>');
        gyroNeedle = gyroInd.querySelector('.g-needle');
        gyroInd.addEventListener('pointerdown', e => { e.preventDefault(); Gyro.request(); Gyro.calibrate(); haptic(20); });
    }

    // Round brass-ringed buttons; hold ones report press/release
    function button(id, label, cls, onDown, onUp) {
        const b = el('button', 'tb ' + (cls || ''), root, `<span>${label}</span>`);
        b.id = id;
        b.addEventListener('pointerdown', e => {
            e.preventDefault();
            ensureAudio();
            b.setPointerCapture(e.pointerId);
            b.classList.add('down');
            haptic(10);
            onDown && onDown(e);
        });
        const up = e => { if (!b.classList.contains('down')) return; b.classList.remove('down'); onUp && onUp(e); };
        b.addEventListener('pointerup', up);
        b.addEventListener('pointercancel', up);
        b.addEventListener('contextmenu', e => e.preventDefault());
        btns[id] = b;
        return b;
    }

    // With nothing locked, FIRE and LOCK take the ship nearest the middle of the view (aim assist)
    function lockNearestToCentre() {
        let best = null, bestD = Infinity;
        enemies.forEach(e => {
            if (e.sinking) return;
            const v = lockPoint(e, new THREE.Vector3()).project(camera);
            if (v.z >= 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) return;
            const d = Math.hypot(v.x, v.y * 0.6);
            if (d < bestD) { bestD = d; best = e; }
        });
        if (best && bestD < 0.9) {
            director.lock = best;
            director.lockPoint = null;
            hudMessage(`Director locked: ${best.type.name}, ${Math.round(Math.hypot(best.x - phys.pos.x, best.z - phys.pos.z) * 1.0936).toLocaleString()} yds`, 'info');
            return true;
        }
        return false;
    }

    function buildButtons() {
        button('tFire', 'FIRE', 'big fire', () => {
            if (typeof AA !== 'undefined' && AA.manned) { AA.trigger = true; return; }
            if (!director.lock && !director.lockPoint) lockNearestToCentre();
            director.trigger = true;
        }, () => { director.trigger = false; if (typeof AA !== 'undefined') AA.trigger = false; });
        button('tLock', 'LOCK', '', () => {
            if (captain.active) { toggleLock(window.innerWidth / 2, window.innerHeight / 2); return; }
            if (director.lock || director.lockPoint) { director.lock = director.lockPoint = null; hudMessage('Director lock released', 'info'); }
            else if (!lockNearestToCentre()) hudMessage('Tap a ship to lock it', 'warn');
        });
        button('tTorp', 'TORP', '', () => fireTorpedoes());
        button('tAA', 'AA', '', () => { if (typeof AA !== 'undefined') AA.toggleManned(); });
        button('tView', 'VIEW', 'small', () => cycleTouchView());
        button('tZoom', 'ZOOM', 'small', () => { captain.binoc = !captain.binoc; });
        button('tPause', '❚❚', 'small pause', () => { if (Game.running && !Game.over) Game.setPaused(true); });
    }

    // VIEW: chase → free orbit → bridge (binoculars) → chase
    function cycleTouchView() {
        if (typeof AA !== 'undefined' && AA.manned) { AA.leave(); return; }
        if (captain.active) { setCaptain(false); setCameraMode('chase'); return; }
        if (cameraMode === 'chase') setCameraMode('orbit');
        else setCaptain(true);
    }

    // --- Gestures on the 3D view ---
    const pts = new Map();
    let pinch0 = 0, mag0 = 7, modeAtDown = null, downT = 0;
    function onDown(e) {
        if (e.pointerType !== 'touch' || !Game.running) return;
        pts.set(e.pointerId, { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: e.timeStamp, moved: 0 });
        if (pts.size === 1) { modeAtDown = cameraGrabbedFrom || cameraMode; downT = performance.now(); }
        if (pts.size === 2) {
            const [a, b] = [...pts.values()];
            pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
            mag0 = captain.mag;
        }
    }
    function onMove(e) {
        const p = pts.get(e.pointerId);
        if (!p) return;
        const dx = e.clientX - p.x, dy = e.clientY - p.y;
        p.x = e.clientX; p.y = e.clientY;
        p.moved = Math.max(p.moved, Math.hypot(p.x - p.x0, p.y - p.y0));
        const sens = 0.0042 * Settings.ctl.lookSens;
        if (captain.active) {
            if (pts.size === 1) {
                const k = sens * captain.fov / 55;
                captain.yaw -= dx * k;
                captain.pitch = THREE.MathUtils.clamp(captain.pitch - dy * k, -1.2, 1.2);
            } else if (pts.size === 2) {
                const [a, b] = [...pts.values()];
                const d = Math.hypot(a.x - b.x, a.y - b.y);
                if (pinch0 > 20) {
                    captain.binoc = true;
                    captain.mag = THREE.MathUtils.clamp(mag0 * d / pinch0, 3, 14);
                }
            }
        } else if (typeof AA !== 'undefined' && AA.manned && pts.size === 1) {
            AA.look(-dx * sens * 0.8, -dy * sens * 0.8);
        }
    }
    function onUp(e) {
        const p = pts.get(e.pointerId);
        if (!p) return;
        pts.delete(e.pointerId);
        const tap = p.moved < 14 && e.timeStamp - p.t0 < api.tapMs && pts.size === 0;
        if (tap) {
            // A tap locks the ship (or patch of sea) under the finger; it is not a camera drag
            if (modeAtDown === 'chase' && cameraMode === 'orbit') setCameraMode('chase');
            cameraGrabbedFrom = null;
            if (!(typeof AA !== 'undefined' && AA.manned)) toggleLock(e.clientX, e.clientY);
        }
    }

    function build() {
        root = el('div', '', document.body);
        root.id = 'touchUI';
        buildThrottle();
        buildRudder();
        buildWheel();
        buildGyro();
        buildButtons();
        const c = renderer.domElement;
        c.addEventListener('pointerdown', onDown, { passive: true });
        window.addEventListener('pointermove', onMove, { passive: true });
        window.addEventListener('pointerup', onUp, { passive: true });
        window.addEventListener('pointercancel', e => pts.delete(e.pointerId), { passive: true });
        for (let i = 0; i < ORDERS.length; i++) speeds.push(orderSpeed(i));
    }

    // Show / hide / lay out to match the settings
    function apply() {
        if (!root) build();
        active = Settings.touchUI;
        document.body.classList.toggle('touch', active);
        document.body.classList.toggle('lefthand', !!Settings.ctl.leftHanded);
        root.style.setProperty('--s', Settings.ctl.btnScale);
        const steer = Settings.ctl.steering;
        rud.style.display = steer === 'slider' ? '' : 'none';
        wheel.style.display = steer === 'wheel' ? '' : 'none';
        gyroInd.style.display = steer === 'gyro' ? '' : 'none';
        if (steer === 'gyro' || Settings.ctl.aimGyro) Gyro.request();
        if (steer !== 'gyro' && drive.cmd !== null && !active) drive.cmd = null;
        if (controls) {
            // One finger orbits, two pinch-zoom and turn; never pan away from the ship on a phone
            controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
        }
    }

    // Per frame: needles, the speed marker, the wheel, gyro steering, buttons for the current view
    function update(dt) {
        if (!active || !Game.running) return;
        // Telegraph: handle at the ordered position, cyan marker at the actual speed
        if (st.order !== drive.order) {
            st.order = drive.order;
            thrHandle.style.top = ((ORDERS.length - 1 - drive.order) / (ORDERS.length - 1) * 84 + 8) + '%';
            thrLabels.forEach((l, i) => l.classList.toggle('on', i === drive.order));
        }
        const fwd = _tfwd.set(0, 0, 1).applyQuaternion(phys.quat);
        const u = phys.vel.dot(fwd);
        let pos = 0;
        if (u <= speeds[0]) pos = 0;
        else if (u >= speeds[speeds.length - 1]) pos = speeds.length - 1;
        else for (let i = 0; i < speeds.length - 1; i++) if (u >= speeds[i] && u <= speeds[i + 1]) { pos = i + (u - speeds[i]) / Math.max(speeds[i + 1] - speeds[i], 1e-3); break; }
        thrSpeed.style.top = ((ORDERS.length - 1 - pos) / (ORDERS.length - 1) * 84 + 8) + '%';
        // Rudder
        const steer = Settings.ctl.steering;
        if (steer === 'gyro') {
            drive.cmd = Gyro.steer();
            gyroNeedle.style.transform = `rotate(${drive.cmd / RUDDER_MAX * 60}deg)`;
        }
        if (steer === 'slider') {
            const c = drive.cmd === null ? 0 : drive.cmd;
            rudHandle.style.left = (50 + c / RUDDER_MAX * 46) + '%';
            rudNeedle.style.left = (50 + drive.rudder / RUDDER_MAX * 46) + '%';
        }
        if (steer === 'wheel') wheelSvg.setAttribute('transform', `rotate(${st.wheelAngle} 100 100)`);
        // Gyro look in the captain's view
        if (Settings.ctl.aimGyro && captain.active) {
            const l = Gyro.look(dt);
            const k = captain.fov / 55;
            captain.yaw += l.yaw * k;
            captain.pitch = THREE.MathUtils.clamp(captain.pitch + l.pitch * k, -1.2, 1.2);
        }
        // Buttons for the current view
        const aaOn = typeof AA !== 'undefined';
        const manned = aaOn && AA.manned;
        btns.tZoom.style.display = captain.active ? '' : 'none';
        btns.tAA.style.display = aaOn ? '' : 'none';
        btns.tAA.classList.toggle('lit', manned);
        btns.tLock.style.display = manned ? 'none' : '';
        btns.tTorp.style.display = manned ? 'none' : '';
        btns.tLock.classList.toggle('lit', !!(director.lock || director.lockPoint));
        btns.tView.querySelector('span').textContent = manned ? 'EXIT' : captain.active ? 'SHIP' : cameraMode === 'chase' ? 'ORBIT' : 'BRIDGE';
        if (!st.hintShown) {
            st.hintShown = true;
            hudMessage('Tap a ship to lock it · hold FIRE · drag to look around · pinch to zoom', 'info');
        }
    }
    const _tfwd = new THREE.Vector3();

    const api = {
        apply, update, lockNearestToCentre,
        tapMs: 450,   // a touch shorter than this (and nearly still) is a tap
        get active() { return active; },
        resetWheel() { st.wheelAngle = 0; }
    };
    return api;
})();

// Phones: go fullscreen (and landscape where the browser allows) when a game starts
function goFullscreenLandscape() {
    if (!Settings.touchUI) return;
    const d = document.documentElement;
    try {
        const p = d.requestFullscreen ? d.requestFullscreen({ navigationUI: 'hide' }) : d.webkitRequestFullscreen ? d.webkitRequestFullscreen() : null;
        if (p && p.then) p.then(() => { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); }).catch(() => {});
    } catch (e) { /* not supported (iPhone Safari): add to home screen for fullscreen */ }
}
