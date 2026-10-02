// Cinematic cameras (F2-F8): photographic shots that keep the ship in frame while you sail and fight.
//  F2 fly-by     a camera set up ahead of her, off her track, that pans and zooms as she sweeps past, then
//                leapfrogs ahead again
//  F3 camera boat  low on the water alongside, riding the swell
//  F4 drone      a slow, high orbit, looking down on her
//  F6 long lens  a telephoto from a mile off her quarter: flattened perspective, heat-haze distance
//  F7 deck cams  cameras bolted to the ship (bow, waterline, masthead, stern); F7 again for the next one
//  F8 director   cuts between all of these by itself
// The HUD steps aside; C (or any other view) goes back.
const FilmCam = (() => {
    const KEYS = { F2: 'flyby', F3: 'boat', F4: 'drone', F6: 'tele', F7: 'deck', F8: 'director' };
    const NAMES = { flyby: 'Fly-by', boat: 'Camera boat', drone: 'Drone', tele: 'Long lens', deck: 'Deck camera', director: 'Director' };
    // Deck cameras, ship-local: where it sits and what it looks at (deck height added from the sheer line)
    const DECK = [
        { name: 'bow', p: [0.6, 1.1, 54], at: [0, 9, 5] },
        { name: 'waterline', p: [null, 1.4, 22], at: [null, 0.8, -45], side: true },
        { name: 'masthead', p: [0, 25, 13], at: [0, 2, 52] },
        { name: 'stern', p: [0, 2.2, -55.5], at: [0, 9, 2] },
        { name: 'bridge wing', p: [5.6, 9.5, 23], at: [-2, 4, -40] }
    ];
    const st = {
        active: false, shot: 'flyby', cur: 'flyby', auto: false, cutT: 0, t: 0, deck: 0, side: 1,
        pos: new THREE.Vector3(), look: new THREE.Vector3(), lookV: new THREE.Vector3(), fov: 45, near: 2, ang: 0, alt: 90, placed: false
    };
    const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
    let labelT = 0;

    const fwd = () => _f.set(0, 0, 1).applyQuaternion(phys.quat).setY(0).normalize();
    const right = () => _r.set(_f.z, 0, -_f.x);                 // after fwd(): starboard, horizontal
    const focus = (out) => out.copy(phys.pos).setY(Math.max(phys.pos.y, -20) + 6);
    const speed = () => Math.hypot(phys.vel.x, phys.vel.z);
    const frameFov = (dist, size = 75) => THREE.MathUtils.clamp(2 * Math.atan(size / Math.max(1, dist)) * 180 / Math.PI, 3, 60);

    function label(text) {
        const el = document.getElementById('camLabel');
        if (el) el.textContent = text;
        labelT = 3.5;
        document.body.classList.remove('filmcam-quiet');
    }

    // Set up a fresh shot
    function place(shot) {
        st.cur = shot;
        st.t = 0;
        st.placed = true;
        st.fresh = true;
        fwd(); right();
        const sp = speed();
        st.side = Math.random() < 0.5 ? -1 : 1;
        if (shot === 'flyby') {
            const ahead = THREE.MathUtils.clamp(240 + sp * 16, 220, 700);
            st.pos.copy(phys.pos).addScaledVector(_f, ahead).addScaledVector(_r, st.side * rnd(30, 85));
            st.pos.y = rnd(3, 22);
        } else if (shot === 'tele') {
            const d = rnd(1100, 1800), a = rnd(0.35, 1.0) * st.side;   // off her bow or quarter
            _v.copy(_f).multiplyScalar(Math.cos(a) * (Math.random() < 0.5 ? 1 : -1)).addScaledVector(_r, Math.sin(a) * 1.4).normalize();
            st.pos.copy(phys.pos).addScaledVector(_v, d);
            st.pos.y = rnd(8, 30);
        } else if (shot === 'drone') {
            st.ang = Math.atan2(phys.pos.x - camera.position.x, phys.pos.z - camera.position.z) + Math.PI;
            st.alt = rnd(70, 130);
        } else if (shot === 'deck') {
            if (st.shot !== 'director') st.deck = st.deck % DECK.length;
        }
        focus(st.look);
        st.lookV.set(0, 0, 0);
    }

    function start(shot) {
        if (!Game.running || Person.active) return;
        if (AA.manned) AA.leave();
        if (captain.active) setCaptain(false);
        if (document.pointerLockElement) document.exitPointerLock();
        const again = st.active && st.shot === shot;
        st.active = true;
        st.shot = shot;
        st.auto = shot === 'director';
        if (shot === 'deck' && again) st.deck = (st.deck + 1) % DECK.length;
        if (cameraMode !== 'film') setCameraMode('film');
        document.body.classList.add('filmcam');
        const first = st.auto ? pickNext() : shot;
        place(first);
        st.cutT = rnd(7, 12);
        label(`${NAMES[shot]}${shot === 'deck' ? ' · ' + DECK[st.deck].name : ''}  ·  F2 fly-by · F3 boat · F4 drone · F6 long lens · F7 deck · F8 director · C back`);
    }

    function pickNext() {
        const pool = ['flyby', 'boat', 'drone', 'tele', 'deck', 'flyby', 'boat'].filter(s => s !== st.cur);
        const s = pool[Math.floor(Math.random() * pool.length)];
        if (s === 'deck') st.deck = Math.floor(Math.random() * DECK.length);
        return s;
    }

    function exit() {
        st.active = false;
        document.body.classList.remove('filmcam', 'filmcam-quiet');
        camera.up.set(0, 1, 0);
        if (camera.fov !== 45) { camera.fov = 45; camera.updateProjectionMatrix(); }
    }

    // Smoothly follow a point: an operator panning a heavy head, a little behind, never jerky
    function aim(target, dt, stiff = 3.5) {
        _v.copy(target).sub(st.look);
        st.lookV.addScaledVector(_v, stiff * stiff * dt).multiplyScalar(Math.exp(-2 * stiff * dt));
        st.look.addScaledVector(st.lookV, dt);
    }

    function update(dt, t) {
        if (!st.active) return;
        st.t += dt;
        if (labelT > 0 && (labelT -= dt) <= 0) document.body.classList.add('filmcam-quiet');
        if (st.auto && (st.cutT -= dt) <= 0) { place(pickNext()); st.cutT = rnd(7, 13); }
        const shot = st.cur;
        fwd(); right();
        const tgt = focus(_w);
        let fov = 45, near = 2, stabilise = true;

        if (shot === 'flyby') {
            // Leapfrog ahead once she's well past, or if she turned away and left us behind
            const rel = _v.copy(st.pos).sub(phys.pos);
            if (rel.dot(_f) < -260 || rel.length() > 1500) place('flyby');
            const sway = 0.15;
            camera.position.copy(st.pos);
            camera.position.x += Math.sin(t * 0.7) * sway; camera.position.y += Math.sin(t * 0.9 + 1) * sway * 0.6;
            aim(tgt, dt, 3);
            fov = frameFov(camera.position.distanceTo(phys.pos), 70);
        } else if (shot === 'boat') {
            // Station off her beam, a little ahead, on the water: rides the swell, rolls with it
            const want = _v.copy(phys.pos).addScaledVector(_f, 28).addScaledVector(_r, st.side * 72);
            if (st.fresh) st.pos.copy(want); else st.pos.lerp(want, 1 - Math.exp(-dt * 0.8));
            const h = waterHeight(st.pos.x, st.pos.z, t);
            camera.position.set(st.pos.x, h + 2.4, st.pos.z);
            aim(tgt, dt, 4);
            const e = 2, hx = waterHeight(st.pos.x + e, st.pos.z, t) - waterHeight(st.pos.x - e, st.pos.z, t);
            camera.up.set(-hx * 0.35, 1, 0).normalize();
            stabilise = false;
            fov = 40;
        } else if (shot === 'drone') {
            st.ang += dt * 0.07;
            const R = 150 + Math.sin(st.t * 0.1) * 30, H = st.alt + Math.sin(st.t * 0.13) * 15;
            const want = _v.set(phys.pos.x + Math.sin(st.ang) * R, H, phys.pos.z + Math.cos(st.ang) * R);
            if (st.fresh) st.pos.copy(want); else st.pos.lerp(want, 1 - Math.exp(-dt * 1.5));
            camera.position.copy(st.pos);
            aim(tgt, dt, 2.5);
            fov = 50;
        } else if (shot === 'tele') {
            const d = st.pos.distanceTo(phys.pos);
            if (d > 2800 || d < 500) place('tele');
            camera.position.copy(st.pos);
            camera.position.y += Math.sin(t * 0.5) * 0.3;   // the tripod on a swaying deck
            aim(tgt, dt, 2.2);
            fov = frameFov(d, 80);
        } else if (shot === 'deck') {
            // Bolted to her: the horizon tilts as she rolls
            const c = DECK[st.deck];
            const sx = c.side ? (st.side >= 0 ? 1 : -1) : 1;
            const lp = (p) => {
                const x = p[0] === null ? sx * (hullX(p[2], 1.0) + 1.3) : p[0] * sx;
                const y = c.name === 'waterline' ? p[1] : p[1] + sheerY(p[2]);
                return _v.set(x, y, p[2]);
            };
            camera.position.copy(myShip.localToWorld(lp(c.p)));
            const at = myShip.localToWorld(lp(c.at).clone());
            st.look.copy(at); st.lookV.set(0, 0, 0);
            camera.up.copy(_up).applyQuaternion(myShip.quaternion);
            stabilise = false;
            fov = c.name === 'masthead' ? 62 : 58;
            near = 0.25;
        }
        if (stabilise) {
            camera.up.copy(_up);
            if (shot !== 'deck') {   // never under the waves or inside a hill
                const floor = Math.max(waterHeight(camera.position.x, camera.position.z, t) + 1.5, Islands.groundAt(camera.position.x, camera.position.z) + 3);
                if (camera.position.y < floor) { camera.position.y = floor; st.pos.y = Math.max(st.pos.y, floor); }
            }
        }
        camera.lookAt(st.look);
        st.fov += (fov - st.fov) * Math.min(1, dt * 2.5);
        if (st.fresh) st.fov = fov;
        st.fresh = false;
        if (Math.abs(camera.fov - st.fov) > 0.01) { camera.fov = st.fov; camera.updateProjectionMatrix(); }
        st.near = near;
    }

    // F-keys while playing; returns true if it took the key
    function key(e) {
        const shot = KEYS[e.key];
        if (!shot) return false;
        e.preventDefault();
        start(shot);
        return true;
    }

    return { start, exit, update, key, get active() { return st.active; }, get near() { return st.near; } };
})();
