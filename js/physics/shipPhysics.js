// Player ship dynamics: a rigid body floated by 57 buoyancy columns on the real sea surface, driven by engine
// thrust and rudder, with hydrodynamic drag. Floodwater from damage adds weight where it lands.
//
// Seakeeping (heave, pitch, roll) follows from the columns: each one feels the sea averaged over its own patch
// of hull at mid-draft (seaPatchHeight), pushes with the hydrostatic force of what's submerged (one-sided, so a
// light hull can leave the water and slam back), and is damped by wave-making (radiation) damping. Heave and
// pitch carry the added mass of the water the hull has to shove aside.
//
// Mass slider: a ship's steadiness in a seaway comes from its size relative to the waves, so the slider makes
// the ship move like a geometrically similar hull of the chosen mass (Froude scaling). Length scale
// s = (M / M_fletcher)^(1/3): lengths and draft x s, forces and mass x s^3, stiffness x s^2, inertia x s^5,
// natural periods x sqrt(s). At 0.43 kg that is a ~60 cm hull that follows every wave like a ball; at two
// Nimitz carriers (200,000 t) a ~470 m hull with a 17 m draft that plows through. Steering, speed and the
// visible model stay the Fletcher's.

const SHIP_MASS = 2.9e6;        // kg, full load ~2,900 t
const RHO = 1025;
const CG_Y = 0.5;               // centre of gravity above the waterline
const CG_AFT_OF_LCB = -1.2;     // m; negative = aft, gives a slight stern-down trim
const ROLL_GYRADIUS = 4.6, PITCH_GYRADIUS = 28.7;
const ROLL_PERIOD = 8.0;
const V_MAX = 18.8;             // 36.5 kn
const T_MAX = 2.2e6;            // N at flank
const K_DRAG = (T_MAX - 2e4 * V_MAX) / (V_MAX * V_MAX);
const K_LAT = 3e5, K_LAT_LIN = 4e5;
const K_RUDDER = 1320, C_YAW = 1.5e7;
const K_TURN_DRAG = 7.8e5;      // speed bleeds off in hard turns
const RUDDER_MAX = 35, RUDDER_RATE = 5;   // degrees, degrees/second
// Added mass: heaving or pitching a slender hull also accelerates ~0.9 of its displacement in water
const ADDED_MASS_HEAVE = 0.9, ADDED_INERTIA_PITCH = 0.9;
// Radiation damping, fractions of critical: typical ship values (roll is lightly damped, even with bilge keels)
const HEAVE_DAMPING = 0.3, PITCH_DAMPING = 0.25, ROLL_DAMPING = 0.12;
// Viscous (quadratic) drag on the hull moving up and down through the water: bottom, bilge keels and, when the
// ship is well over, immersed topsides. Drag scales with area (s^2) and mass with volume (s^3), so it is minor
// for a ship but dominates for anything small, which is why small floating things ride along with the water.
const CD_VERTICAL = 1.0;

// --- Mass slider ---
const MASS_FOOTBALL = 0.43, MASS_2NIMITZ = 2.0e8;
const MASS_REFS = [
    [0.43, 'a football'], [7, 'a bowling ball'], [80, 'a person'], [1500, 'a car'], [12000, 'a bus'],
    [56000, 'a PT boat'], [350000, 'a submarine chaser'], [1450e3, 'a destroyer escort'], [SHIP_MASS, 'USS Fletcher (real)'],
    [11500e3, 'a heavy cruiser'], [36000e3, 'an Essex-class carrier'], [58000e3, 'an Iowa-class battleship'],
    [100000e3, 'a Nimitz-class carrier'], [MASS_2NIMITZ, 'two Nimitz carriers']
];
// Slider 0..1 -> kg, logarithmic, with the real Fletcher exactly in the middle
function shipMassAt(u) {
    const lo = Math.log10(MASS_FOOTBALL), mid = Math.log10(SHIP_MASS), hi = Math.log10(MASS_2NIMITZ);
    return Math.pow(10, u <= 0.5 ? lerp(lo, mid, u / 0.5) : lerp(mid, hi, (u - 0.5) / 0.5));
}
function shipMassLabel(u) {
    const m = shipMassAt(u);
    const txt = m < 1000 ? `${m < 10 ? m.toFixed(2) : Math.round(m)} kg` : `${(m / 1000).toLocaleString(undefined, { maximumSignificantDigits: 3 })} t`;
    let best = MASS_REFS[0];
    MASS_REFS.forEach(r => { if (Math.abs(Math.log(r[0] / m)) < Math.abs(Math.log(best[0] / m))) best = r; });
    const near = Math.abs(Math.log10(best[0] / m)) < 0.08;
    return `${txt} · ${near ? '' : '~'}${best[1]}`;
}
const hullScale = () => Math.cbrt(shipMassAt(THREE.MathUtils.clamp(SeaParams.massPos ?? 0.5, 0, 1)) / SHIP_MASS);

const ORDERS = [
    { name: 'Back Full', f: -0.75 }, { name: 'Back 2/3', f: -0.5 }, { name: 'Back 1/3', f: -0.3 },
    { name: 'All Stop', f: 0 },
    { name: 'Ahead 1/3', f: 0.3 }, { name: 'Ahead 2/3', f: 0.5 }, { name: 'Ahead Standard', f: 0.65 },
    { name: 'Ahead Full', f: 0.85 }, { name: 'Ahead Flank', f: 1.0 }
];
const STOP_IDX = 3;

const phys = {
    pos: new THREE.Vector3(), vel: new THREE.Vector3(),
    quat: new THREE.Quaternion(), angVel: new THREE.Vector3(),
    // Orientation = heading (turn about the world vertical, the Fletcher's own steering dynamics) then tilt
    // (pitch and roll in the heading frame, the seakeeping dynamics of the mass-scaled hull)
    heading: 0, yawRate: 0, tiltQ: new THREE.Quaternion(), tiltW: new THREE.Vector3(),
    fresh: true,       // first step after a reset: start riding the water, not dropped onto a moving wave
    capsizeT: 0,       // seconds spent past the point of no return (game assist rights the ship)
    inertia: new THREE.Vector3(), samples: [], K: 0, Teff: 0, cCrit: 0, cRoll: 0, cgZ: 0,
    flood: 0,                                  // kg of water shipped through damage
    floodPoint: new THREE.Vector3(0, -2, 0),   // where that water sits (drives list and trim)
    engine: 1                                  // fraction of full power still available
};
// cmd: an analog rudder order in degrees (touch slider, wheel or tilt); A / D keys override it while held
const drive = { order: STOP_IDX, thrust: 0, rudder: 0, left: false, right: false, cmd: null };

// Ring up an engine order (keyboard, telegraph lever): bell and a haptic click when it changes
function setEngineOrder(i) {
    i = Math.max(0, Math.min(ORDERS.length - 1, i));
    if (i === drive.order) return;
    drive.order = i;
    if (typeof playBell === 'function' && Settings.ctl.bell) playBell(i);
    if (typeof haptic === 'function') haptic(12);
}

// Steady speed (m/s) each engine order settles at in calm water, for the telegraph's speed scale
function orderSpeed(i) {
    const f = ORDERS[i].f;
    const T = Math.sign(f) * T_MAX * f * f * (f < 0 ? 0.6 : 1);
    const a = Math.abs(T);
    const u = (-2e4 + Math.sqrt(4e8 + 4 * K_DRAG * a)) / (2 * K_DRAG);
    return Math.sign(T) * u;
}

function initPhysics() {
    const dz = 6;
    let K = 0, lcbSum = 0;
    for (let z = -54; z <= 54.01; z += dz) {
        const hb = hullX(z, 0);
        if (hb < 0.3) continue;
        const kCol = RHO * GRAVITY * 2 * hb * dz / 3;
        // Above the waterline the flared bow is much wider: reserve buoyancy that lifts it out of waves
        const kAbove = RHO * GRAVITY * 2 * lerp(hb, deckHalfWidth(z), 0.6) * dz / 3;
        // Three columns across, each standing for its own third of the beam. The centre one also carries the
        // watertight deckhouse (01 level) above the main deck: reserve buoyancy high up that rights a ship
        // pushed far over or dunked by a breaking crest.
        const house = z > -36.5 && z < 35 ? LVL1_H : 0;
        [-1, 0, 1].forEach(j => phys.samples.push({ local: new THREE.Vector3(j * hb, 0, z), k: kCol, kAbove, fb: sheerY(z), sup: j === 0 ? house : 0,
            len: dz, wid: 2 * hb / 3 }));
        K += 3 * kCol;
        lcbSum += 3 * kCol * z;
    }
    // Centre of gravity slightly aft of the centre of buoyancy: rides a touch stern-down
    phys.cgZ = lcbSum / K + CG_AFT_OF_LCB;
    const I_roll = SHIP_MASS * ROLL_GYRADIUS * ROLL_GYRADIUS;
    // Spread the float points so the righting stiffness gives a realistic roll period (buoyancy acts at the
    // centre of the submerged volume, half the draft down, below the centre of gravity)
    const kRoll = I_roll * Math.pow(2 * Math.PI / ROLL_PERIOD, 2);
    const target = kRoll + SHIP_MASS * GRAVITY * (CG_Y + SHIP_MASS * GRAVITY / K / 2);
    const sx2 = phys.samples.reduce((s, p) => s + p.k * p.local.x * p.local.x, 0);
    const scale = Math.sqrt(target / sx2);
    phys.samples.forEach(p => { p.local.x *= scale; });
    phys.K = K;
    phys.Teff = SHIP_MASS * GRAVITY / K;
    phys.kPitch = phys.samples.reduce((s, p) => s + p.k * (p.local.z - phys.cgZ) ** 2, 0);
    phys.kx2 = phys.samples.reduce((s, p) => s + p.k * p.local.x * p.local.x, 0);
    phys.kRoll = kRoll;
    // Body axes: x = pitch, y = yaw, z = roll (dry: the added inertia of the water depends on how wet the hull is)
    phys.inertia.set(SHIP_MASS * PITCH_GYRADIUS ** 2, SHIP_MASS * PITCH_GYRADIUS ** 2, I_roll);
}

const _r = new THREE.Vector3(), _f = new THREE.Vector3(), _tmp = new THREE.Vector3(), _qInv = new THREE.Quaternion();
const _F = new THREE.Vector3(), _Fm = new THREE.Vector3(), _Tw = new THREE.Vector3(), _Tm = new THREE.Vector3(), _vb = new THREE.Vector3();
const _rcg = new THREE.Vector3(), _cgW = new THREE.Vector3(), _rcgL = new THREE.Vector3(), _rcgF = new THREE.Vector3();
// Force at rWorld (offset from the ship's origin); torque taken about the centre of gravity, which is what a
// free rigid body turns about (so gravity alone never spins the ship, even in mid-air off a crest). The sea
// acts about the scaled hull's CG. The steering model (drag, thrust, rudder) keeps the reference point it was
// tuned about, the origin, so the ship handles exactly as it always has.
function applyForce(F, T, rWorld, fWorld, cg = _rcg) {
    F.add(fWorld);
    T.add(_tmp.copy(rWorld).sub(cg).cross(fWorld));
}

function resetPhysics() {
    phys.pos.set(0, 0, 0);
    phys.vel.set(0, 0, 0);
    phys.quat.identity();
    phys.angVel.set(0, 0, 0);
    phys.heading = 0;
    phys.yawRate = 0;
    phys.tiltQ.identity();
    phys.tiltW.set(0, 0, 0);
    phys.fresh = true;
    phys.capsizeT = 0;
    phys.righting = false;
    phys.flood = 0;
    phys.floodPoint.set(0, -2, 0);
    phys.engine = 1;
    Object.assign(drive, { order: STOP_IDX, thrust: 0, rudder: 0, left: false, right: false, cmd: null });
}

function stepPhysics(dt, t) {
    // Light hulls ring fast (natural frequency ~ 1/sqrt(s)): sub-step so the integration stays accurate
    const s = hullScale();
    if (phys.fresh) {
        phys.fresh = false;
        const h0 = seaPatchHeight(phys.pos.x, phys.pos.z, t, 0, 1, 20 * s, 4 * s, phys.Teff * s * 0.5);
        const h1 = seaPatchHeight(phys.pos.x, phys.pos.z, t + 0.01, 0, 1, 20 * s, 4 * s, phys.Teff * s * 0.5);
        phys.pos.y = h0;
        phys.vel.y = (h1 - h0) / 0.01;
    }
    const n = Math.max(1, Math.ceil(dt * 1.4 / Math.sqrt(s) / 0.25));
    for (let i = 0; i < n; i++) stepPhysicsOnce(dt / n, t + dt * i / n, s);
    capsizeAssist(dt);
    groundShip(dt);
    settleOnBottom(dt);
}

// A ship that goes down comes to rest on the bottom (70 m out in the Slot's shallower stretches, for the
// game; the island shelves where they are shallower) instead of sinking forever, so you can dive on her
const SEABED_DEPTH = 70;
function settleOnBottom(dt) {
    const bed = Math.max(typeof Islands !== 'undefined' ? Islands.groundAt(phys.pos.x, phys.pos.z) : -1000, -SEABED_DEPTH);
    const s = hullScale();
    if (phys.pos.y + (KEEL_Y - 2) * s > bed) return;
    phys.pos.y = bed - (KEEL_Y - 2) * s;
    if (phys.vel.y < 0) phys.vel.y = 0;
    const f = Math.exp(-dt * 1.5);
    phys.vel.x *= f; phys.vel.z *= f;
    phys.yawRate *= f;
    phys.tiltW.multiplyScalar(Math.exp(-dt * 2));
}

// Running aground: keel points that touch the bottom are pushed back toward deep water, the hull grinds to a
// stop on the shoal, and hitting it hard tears the bottom open. The sea still floats the ship; the bottom only
// stops it and shoves it off.
const GROUND_PTS = [[0, 56], [0, 46], [3.4, 32], [-3.4, 32], [5.6, 6], [-5.6, 6], [5.0, -24], [-5.0, -24], [0, -50]];
const _gp = new THREE.Vector3(), _gn = new THREE.Vector3();
let groundMsgT = -99;
function groundShip(dt) {
    if (typeof Islands === 'undefined' || !Islands.near(phys.pos.x, phys.pos.z, 120)) return;
    let hits = 0, worst = 0, hitZ = 0;
    for (const [lx, lz] of GROUND_PTS) {
        _gp.set(lx, KEEL_Y + 0.4, lz).applyQuaternion(phys.quat).add(phys.pos);
        const pen = Islands.groundAt(_gp.x, _gp.z) - _gp.y;
        if (pen <= 0) continue;
        hits++;
        const n = Islands.normalAt(_gp.x, _gp.z, _gn);
        let hx = n.x, hz = n.z;
        const hl = Math.hypot(hx, hz);
        if (hl < 0.03) { hx = -Math.sin(phys.heading); hz = -Math.cos(phys.heading); } else { hx /= hl; hz /= hl; }
        // No more motion into the slope, and a firm shove back down it
        const vn = phys.vel.x * hx + phys.vel.z * hz;
        if (vn < 0) { phys.vel.x -= vn * hx; phys.vel.z -= vn * hz; if (-vn > worst) { worst = -vn; hitZ = lz; } }
        const k = Math.min(pen, 3);
        phys.vel.x += hx * k * 1.2 * dt; phys.vel.z += hz * k * 1.2 * dt;
        phys.pos.x += hx * Math.min(pen, 2) * 0.4 * dt; phys.pos.z += hz * Math.min(pen, 2) * 0.4 * dt;
    }
    if (!hits) return;
    const f = Math.exp(-dt * 0.7 * hits);
    phys.vel.x *= f; phys.vel.z *= f;
    phys.yawRate *= Math.exp(-dt * 1.6 * hits);
    if (worst > 1.0 && typeof Game !== 'undefined' && Game.running && simTime - groundMsgT > 4) {
        groundMsgT = simTime;
        const hard = worst > 5;
        playerDmg.hull -= Math.min(30, (worst - 0.8) * (hard ? 1.8 : 1.2));
        addFlood(_gp.set(0, -3, hitZ), Math.min(450000, 9000 * worst * (hard ? 2 : 1)));
        hudMessage(hard ? 'RAN AGROUND at speed! The bottom is torn open — flooding!' : 'Ran aground! Hull damage — back her off the shoal.', 'alert');
        cameraShake(Math.min(3, 0.6 + worst * 0.35));
        playBoom(phys.pos, 1.3, 220, 3);
        if (typeof haptic === 'function') haptic(120);
    }
}

// Game assist, not physics: the hull's stability is real (righting arm peaks near 40° and vanishes near 72°,
// like a destroyer's), so a very light setting in a steep sea can roll it over. Rather than leave the player
// floating upside down, a ship that stays capsized for a few seconds is eased back upright.
const _up = new THREE.Vector3(), _qId = new THREE.Quaternion();
function capsizeAssist(dt) {
    const up = _up.set(0, 1, 0).applyQuaternion(phys.tiltQ).y;
    phys.capsizeT = up < 0.3 ? phys.capsizeT + dt : Math.max(0, phys.capsizeT - dt * 2);
    if (phys.capsizeT > 1.5) {
        if (!phys.righting && typeof hudMessage === 'function') hudMessage('Capsized! Righting the ship…', 'warn');
        phys.righting = true;
    }
    if (phys.righting) {
        phys.tiltQ.slerp(_qId, Math.min(1, dt * 2.5));
        phys.tiltW.set(0, 0, 0);
        phys.quat.setFromAxisAngle(_yAxis, phys.heading).multiply(phys.tiltQ);
        if (_up.set(0, 1, 0).applyQuaternion(phys.tiltQ).y > 0.97) { phys.righting = false; phys.capsizeT = 0; }
    }
}

const _qy = new THREE.Quaternion(), _dq = new THREE.Quaternion(), _yAxis = new THREE.Vector3(0, 1, 0);
function stepPhysicsOnce(dt, t, s) {
    const { pos, vel, quat, angVel } = phys;
    const s2 = s * s, s3 = s2 * s, s4 = s2 * s2, s5 = s4 * s;
    const F = _F.set(0, 0, 0);     // weight and the sea: act on the scaled hull
    const Tw = _Tw.set(0, 0, 0);
    const Fm = _Fm.set(0, 0, 0);   // propulsion, rudder and drag: the Fletcher's own
    const Tm = _Tm.set(0, 0, 0);
    const flood = phys.flood * s3;
    const mass = SHIP_MASS * s3;
    const draft = phys.Teff * s;
    const Iy = phys.inertia.y;
    // Centre of gravity: pos is the ship's origin (midships on the waterline), vel is the CG's velocity
    _rcgL.set(0, CG_Y * s, phys.cgZ * s);
    _rcg.copy(_rcgL).applyQuaternion(quat);
    _cgW.copy(pos).add(_rcg);
    _rcgF.set(0, 0, 0);

    // Weight at the centre of gravity, floodwater weight where it collected
    applyForce(F, Tw, _r.set(0, CG_Y * s, phys.cgZ * s).applyQuaternion(quat), _f.set(0, -mass * GRAVITY, 0));
    if (flood > 0) applyForce(F, Tw, _r.copy(phys.floodPoint).multiplyScalar(s).applyQuaternion(quat), _f.set(0, -flood * GRAVITY, 0));

    // Buoyancy columns, each feeling the sea averaged over its own patch of hull at mid-draft. Alongside, sum
    // up what the wetted columns see of the water's own vertical motion, projected onto heave, pitch and roll.
    const ch = Math.cos(phys.heading), sh = Math.sin(phys.heading);
    const fx = sh, fz = ch;
    let Sw = 0, Swx2 = 0, Swz2 = 0, Sv = 0, Svx = 0, Svz = 0, Sa = 0, A = 0, Ax3 = 0, Az3 = 0;
    for (const c of phys.samples) {
        _r.copy(c.local).multiplyScalar(s).applyQuaternion(quat);
        const px = pos.x + _r.x, py = pos.y + _r.y, pz = pos.z + _r.z;
        const eta = seaPatchHeight(px, pz, t, fx, fz, c.len * s, c.wid * s, draft * 0.5);
        // How fast the surface rises under this moving column, and the water's vertical acceleration
        const wv = seaPatchKin.v + vel.x * seaPatchKin.gx + vel.z * seaPatchKin.gz, wa = seaPatchKin.a;
        const sub = eta - py + draft;
        if (sub <= 0) continue;   // this part of the hull is out of the water
        // Submerged hull below the waterline, flared topsides up to the deck, then deckhouse; the force acts
        // at the centre of what's under water, which climbs as the column goes deeper
        const below = Math.min(sub, draft);
        const above = Math.min(sub - below, c.fb * s);
        const house = Math.min(sub - below - above, c.sup * s);
        const fB = c.k * below, fA = c.kAbove * above, fH = c.k * house;
        const fTot = fB + fA + fH;
        const yc = (fB * (below / 2 - draft) + fA * (above / 2) + fH * (c.fb * s + house / 2)) / fTot;
        _r.copy(c.local).multiplyScalar(s).setY(yc).applyQuaternion(quat);
        applyForce(F, Tw, _r, _f.set(0, s2 * fTot, 0));
        const x = c.local.x * s, z = (c.local.z - phys.cgZ) * s, w = c.k, a = c.len * c.wid * s2;
        Sw += w; Swx2 += w * x * x; Swz2 += w * z * z;
        Sv += w * wv; Svx += w * wv * x; Svz += w * wv * z;
        Sa += w * wa;
        A += a; Ax3 += a * Math.abs(x) ** 3; Az3 += a * Math.abs(z) ** 3;
    }
    // Added mass and inertia come with the water around the hull: none in mid-air (it falls at g), in full when
    // floating. Yaw keeps the Fletcher's own (steering is unscaled).
    const wet = Math.min(1, Sw / phys.K);
    const mHeave = mass * (1 + ADDED_MASS_HEAVE * wet) + flood;
    const Ip = phys.inertia.x * s5 * (1 + ADDED_INERTIA_PITCH * wet), Ir = phys.inertia.z * s5;
    // The water's own heave velocity and pitch / roll rates under the hull (same sign conventions as the hull's)
    const wHeave = Sw > 0 ? Sv / Sw : 0;
    const wPitch = Swz2 > 0 ? -Svz / Swz2 : 0;
    const wRoll = Swx2 > 0 ? Svx / Swx2 : 0;
    // The added mass works both ways: the water it stands for is accelerated by the wave too, and carries the
    // hull with it (Morison), so a small hull rides a steep face instead of lagging under it
    if (Sw > 0) F.y += ADDED_MASS_HEAVE * mass * wet * (Sa / Sw);

    // Hydrodynamics in the body frame (Fletcher-sized: steering and speed don't change with the mass slider)
    _qInv.copy(quat).invert();
    const vb = _vb.copy(vel).applyQuaternion(_qInv);
    const u = vb.z, vl = vb.x;
    const toWorld = v => v.applyQuaternion(quat);

    const yawRate = Math.abs(phys.yawRate);
    _f.set(-K_LAT * vl * Math.abs(vl) - K_LAT_LIN * vl, 0, -K_DRAG * u * Math.abs(u) - 2e4 * u - K_TURN_DRAG * yawRate * u);
    applyForce(Fm, Tm, toWorld(_r.set(0, -2.0, 0)), toWorld(_f), _rcgF);

    applyForce(Fm, Tm, toWorld(_r.set(0, -3.5, -46)), toWorld(_f.set(0, 0, drive.thrust * phys.engine)), _rcgF);

    const delta = THREE.MathUtils.degToRad(drive.rudder);
    const flow = u * Math.abs(u) + Math.max(drive.thrust * phys.engine, 0) / 8000;
    applyForce(Fm, Tm, toWorld(_r.set(0, -2.5, -51)), toWorld(_f.set(K_RUDDER * delta * flow, 0, 0)), _rcgF);

    // Heading: turning about the world vertical, the Fletcher's own inertia and yaw damping
    phys.yawRate += (Tm.y + Tw.y - C_YAW * phys.yawRate * (Math.abs(u) + 2)) / Iy * dt;
    phys.heading += phys.yawRate * dt;

    // Tilt: pitch about the heading frame's lateral axis, roll about its longitudinal axis. Torques from the sea
    // act on the scaled hull; the Fletcher's own heel and trim from steering are scaled with the hull's righting
    // stiffness (x s^4) so a turn leans every hull by the same angle.
    const tx = Tw.x + Tm.x * s4, tz = Tw.z + Tm.z * s4;
    const tw = phys.tiltW;
    tw.x += (tx * ch - tz * sh) / Ip * dt;   // lateral axis (cos h, 0, -sin h)
    tw.z += (tx * sh + tz * ch) / Ir * dt;   // longitudinal axis (sin h, 0, cos h)

    // Damping on the hull's motion relative to the water under it (a hull riding a rising wave isn't held back,
    // one moving through the water is): linear radiation damping plus quadratic drag, scaled by how much of
    // the hull is wet, integrated implicitly so it stays stable however small and light the hull gets
    if (Sw > 0) {
        const halfRhoCd = 0.5 * RHO * CD_VERTICAL;
        const cH = HEAVE_DAMPING * 2 * Math.sqrt(phys.K * s2 * mHeave) * wet;
        const cP = PITCH_DAMPING * 2 * Math.sqrt(phys.kPitch * s4 * Ip) * (Swz2 / (phys.kPitch * s2));
        const cR = ROLL_DAMPING * 2 * Math.sqrt(phys.kRoll * s4 * Ir) * (Swx2 / (phys.kx2 * s2));
        const relax = (v, vw, c, D, m) => {
            const r = v - vw;
            return vw + r / (1 + dt * (c + D * Math.abs(r)) / m);
        };
        vel.y = relax(vel.y + (F.y + Fm.y * s3) * dt / mHeave, wHeave, cH, halfRhoCd * A, mHeave);
        tw.x = relax(tw.x, wPitch, cP, halfRhoCd * Az3, Ip);
        tw.z = relax(tw.z, wRoll, cR, halfRhoCd * Ax3, Ir);
    } else {
        vel.y += (F.y + Fm.y * s3) * dt / mHeave;
    }
    const ang = Math.hypot(tw.x, tw.z) * dt;
    if (ang > 0) {
        _dq.setFromAxisAngle(_r.set(tw.x, 0, tw.z).normalize(), ang);
        phys.tiltQ.premultiply(_dq);
        // Pitching while rolled swings the bow sideways a little: hand that change of heading over to the
        // heading, keeping the orientation exactly as it is, so the tilt never carries a heading of its own
        const f = _r.set(0, 0, 1).applyQuaternion(phys.tiltQ);
        const dh = Math.atan2(f.x, f.z);
        if (Math.abs(dh) > 1e-9 && Math.hypot(f.x, f.z) > 1e-3) {
            phys.tiltQ.premultiply(_qy.setFromAxisAngle(_yAxis, -dh)).normalize();
            phys.heading += dh;
            // ...and re-express the tilt rates in the turned frame, so the spin itself doesn't change
            const cd = Math.cos(dh), sd = Math.sin(dh), wx = tw.x, wz = tw.z;
            tw.x = wx * cd - wz * sd;
            tw.z = wx * sd + wz * cd;
        }
    }
    quat.setFromAxisAngle(_yAxis, phys.heading).multiply(phys.tiltQ);
    // World angular velocity (for the columns' vertical speed next step)
    angVel.set(tw.x * ch + tw.z * sh, phys.yawRate, -tw.x * sh + tw.z * ch);

    // Surge and sway: the Fletcher's own mass (heave, above, is the scaled hull's; the steering forces' vertical
    // share when heeled or trimmed is scaled with it, x s^3, so it lifts it by the same fraction of its size)
    const mH = SHIP_MASS + phys.flood;
    vel.x += (F.x + Fm.x) * dt / mH;
    vel.z += (F.z + Fm.z) * dt / mH;
    // Move the CG, then place the origin from it with the new orientation
    _cgW.addScaledVector(vel, dt);
    pos.copy(_cgW).sub(_rcg.copy(_rcgL).applyQuaternion(quat));
}

function updateDrive(dt) {
    const f = ORDERS[drive.order].f;
    const target = Math.sign(f) * T_MAX * f * f * (f < 0 ? 0.6 : 1);
    drive.thrust += (target - drive.thrust) * Math.min(1, dt / 4);   // engine spool-up lag
    const keys = drive.left || drive.right;
    const rTarget = keys || drive.cmd === null ? (drive.right ? RUDDER_MAX : 0) - (drive.left ? RUDDER_MAX : 0)
        : THREE.MathUtils.clamp(drive.cmd, -RUDDER_MAX, RUDDER_MAX);
    const step = RUDDER_RATE * dt;
    drive.rudder += Math.max(-step, Math.min(step, rTarget - drive.rudder));
}
