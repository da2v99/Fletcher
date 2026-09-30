// Player ship dynamics: a rigid body floated by 57 buoyancy columns on the real sea surface (waterHeight),
// driven by engine thrust and rudder, with hydrodynamic drag. Floodwater from damage adds weight where it lands.

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
    inertia: new THREE.Vector3(), samples: [], K: 0, Teff: 0, cCrit: 0, cRoll: 0, cgZ: 0,
    flood: 0,                                  // kg of water shipped through damage
    floodPoint: new THREE.Vector3(0, -2, 0),   // where that water sits (drives list and trim)
    engine: 1                                  // fraction of full power still available
};
const drive = { order: STOP_IDX, thrust: 0, rudder: 0, left: false, right: false };

function initPhysics() {
    const dz = 6;
    let K = 0, lcbSum = 0;
    for (let z = -54; z <= 54.01; z += dz) {
        const hb = hullX(z, 0);
        if (hb < 0.3) continue;
        const kCol = RHO * GRAVITY * 2 * hb * dz / 3;
        // Above the waterline the flared bow is much wider: reserve buoyancy that lifts it out of waves
        const kAbove = RHO * GRAVITY * 2 * lerp(hb, deckHalfWidth(z), 0.6) * dz / 3;
        [-1, 0, 1].forEach(j => phys.samples.push({ local: new THREE.Vector3(j * hb, 0, z), k: kCol, kAbove, fb: sheerY(z) }));
        K += 3 * kCol;
        lcbSum += 3 * kCol * z;
    }
    // Centre of gravity slightly aft of the centre of buoyancy: rides a touch stern-down
    phys.cgZ = lcbSum / K + CG_AFT_OF_LCB;
    const I_roll = SHIP_MASS * ROLL_GYRADIUS * ROLL_GYRADIUS;
    // Spread the float points so the righting stiffness gives a realistic roll period
    const kRoll = I_roll * Math.pow(2 * Math.PI / ROLL_PERIOD, 2);
    const target = kRoll + SHIP_MASS * GRAVITY * CG_Y;
    const sx2 = phys.samples.reduce((s, p) => s + p.k * p.local.x * p.local.x, 0);
    const scale = Math.sqrt(target / sx2);
    phys.samples.forEach(p => { p.local.x *= scale; });
    phys.K = K;
    phys.Teff = SHIP_MASS * GRAVITY / K;
    phys.cCrit = 2 * Math.sqrt(K * SHIP_MASS);
    phys.cRoll = 0.2 * 2 * Math.sqrt(kRoll * I_roll);   // bilge keels
    phys.inertia.set(SHIP_MASS * PITCH_GYRADIUS ** 2, SHIP_MASS * PITCH_GYRADIUS ** 2, I_roll);   // body x = pitch, y = yaw, z = roll
}

const _r = new THREE.Vector3(), _f = new THREE.Vector3(), _tmp = new THREE.Vector3(), _qInv = new THREE.Quaternion();
function applyForce(F, T, rWorld, fWorld) {
    F.add(fWorld);
    T.add(_tmp.copy(rWorld).cross(fWorld));
}

function resetPhysics() {
    phys.pos.set(0, 0, 0);
    phys.vel.set(0, 0, 0);
    phys.quat.identity();
    phys.angVel.set(0, 0, 0);
    phys.flood = 0;
    phys.floodPoint.set(0, -2, 0);
    phys.engine = 1;
    Object.assign(drive, { order: STOP_IDX, thrust: 0, rudder: 0, left: false, right: false });
}

function stepPhysics(dt, t) {
    const { pos, vel, quat, angVel } = phys;
    const mass = SHIP_MASS + phys.flood;
    const F = new THREE.Vector3();
    const T = new THREE.Vector3();
    // Ship weight at its centre of gravity, floodwater weight where it collected
    applyForce(F, T, _r.set(0, CG_Y, phys.cgZ).applyQuaternion(quat), _f.set(0, -SHIP_MASS * GRAVITY, 0));
    if (phys.flood > 0) applyForce(F, T, _r.copy(phys.floodPoint).applyQuaternion(quat), _f.set(0, -phys.flood * GRAVITY, 0));

    // Buoyancy columns
    for (const s of phys.samples) {
        _r.copy(s.local).applyQuaternion(quat);
        const px = pos.x + _r.x, py = pos.y + _r.y, pz = pos.z + _r.z;
        let sub = waterHeight(px, pz, t) - py + phys.Teff;
        if (sub <= 0) continue;
        const below = Math.min(sub, phys.Teff);
        const above = Math.min(Math.max(sub - phys.Teff, 0), s.fb);
        const vy = vel.y + (angVel.z * _r.x - angVel.x * _r.z);
        const fy = s.k * below + s.kAbove * above - 0.3 * phys.cCrit * (s.k / phys.K) * vy;
        applyForce(F, T, _r, _f.set(0, fy, 0));
    }

    // Hydrodynamics in the body frame
    _qInv.copy(quat).invert();
    const vb = vel.clone().applyQuaternion(_qInv);
    const u = vb.z, vl = vb.x;
    const toWorld = v => v.applyQuaternion(quat);

    const yawRate = Math.abs(angVel.y);
    _f.set(-K_LAT * vl * Math.abs(vl) - K_LAT_LIN * vl, 0, -K_DRAG * u * Math.abs(u) - 2e4 * u - K_TURN_DRAG * yawRate * u);
    applyForce(F, T, toWorld(_r.set(0, -2.0, 0)), toWorld(_f));

    applyForce(F, T, toWorld(_r.set(0, -3.5, -46)), toWorld(_f.set(0, 0, drive.thrust * phys.engine)));

    const delta = THREE.MathUtils.degToRad(drive.rudder);
    const flow = u * Math.abs(u) + Math.max(drive.thrust * phys.engine, 0) / 8000;
    applyForce(F, T, toWorld(_r.set(0, -2.5, -51)), toWorld(_f.set(K_RUDDER * delta * flow, 0, 0)));

    // Angular integration (body frame, with damping)
    const I = phys.inertia;
    const wb = angVel.clone().applyQuaternion(_qInv);
    const Tb = T.applyQuaternion(_qInv);
    Tb.x -= 0.15 * 2 * Math.sqrt(phys.K * 800 * I.x) * wb.x;
    Tb.y -= C_YAW * wb.y * (Math.abs(u) + 2);
    Tb.z -= phys.cRoll * wb.z;
    const gyro = wb.clone().cross(new THREE.Vector3(I.x * wb.x, I.y * wb.y, I.z * wb.z));
    wb.x += (Tb.x - gyro.x) / I.x * dt;
    wb.y += (Tb.y - gyro.y) / I.y * dt;
    wb.z += (Tb.z - gyro.z) / I.z * dt;
    angVel.copy(wb).applyQuaternion(quat);

    vel.addScaledVector(F, dt / mass);
    pos.addScaledVector(vel, dt);

    const dq = new THREE.Quaternion(angVel.x * dt * 0.5, angVel.y * dt * 0.5, angVel.z * dt * 0.5, 0).multiply(quat);
    quat.set(quat.x + dq.x, quat.y + dq.y, quat.z + dq.z, quat.w + dq.w).normalize();
}

function updateDrive(dt) {
    const f = ORDERS[drive.order].f;
    const target = Math.sign(f) * T_MAX * f * f * (f < 0 ? 0.6 : 1);
    drive.thrust += (target - drive.thrust) * Math.min(1, dt / 4);   // engine spool-up lag
    const rTarget = (drive.right ? RUDDER_MAX : 0) - (drive.left ? RUDDER_MAX : 0);
    const step = RUDDER_RATE * dt;
    drive.rudder += Math.max(-step, Math.min(step, rTarget - drive.rudder));
}
