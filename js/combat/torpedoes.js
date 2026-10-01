// Torpedoes in the water: US Mk 15 (45 kn, ~4.5 km) and IJN Type 93 "Long Lance" (48 kn, long range).
// They run at a set depth under the real sea surface and leave a trail of bubbles.

const TORP_TYPES = {
    mk15: { speed: 23.2, range: 5500, damage: 10, depth: 3 },
    type93: { speed: 24.7, range: 11000, damage: 38, depth: 4 },
    type91: { speed: 21.6, range: 2000, damage: 30, depth: 3 }        // aerial, dropped by Kates (42 kn)
};
const torpedoes = [];
let torpGeo, torpMat;

function initTorpedoes() {
    torpGeo = CylZ(0.27, 0.27, 7.2, 8);
    torpMat = new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.6, metalness: 0.5 });
}

function launchTorpedo(origin, heading, owner, typeKey) {
    const type = TORP_TYPES[typeKey];
    const mesh = new THREE.Mesh(torpGeo, torpMat);
    scene.add(mesh);
    torpedoes.push({
        pos: origin.clone(), heading, owner, type, mesh, run: 0, bubbleAcc: 0, warned: false,
        entered: false, vy: -2   // splashes in, then settles at running depth
    });
    FX.splash(origin.x, origin.y, origin.z, WHITE_SPRAY, 0.35);
}

function clearTorpedoes() {
    torpedoes.forEach(tp => scene.remove(tp.mesh));
    torpedoes.length = 0;
}

function updateTorpedoes(dt, t) {
    for (let i = torpedoes.length - 1; i >= 0; i--) {
        const tp = torpedoes[i];
        const dx = Math.sin(tp.heading), dz = Math.cos(tp.heading);
        const step = tp.type.speed * dt;
        tp.pos.x += dx * step;
        tp.pos.z += dz * step;
        tp.run += step;
        const surface = waterHeight(tp.pos.x, tp.pos.z, t);
        tp.pos.y = Math.max(surface - tp.type.depth, tp.pos.y + tp.vy * dt);
        tp.vy -= 6 * dt;

        // Bubble track on the surface
        tp.bubbleAcc += dt;
        if (tp.bubbleAcc > 0.08) {
            tp.bubbleAcc = 0;
            FX.bubbles(tp.pos.x - dx * 12, surface, tp.pos.z - dz * 12, tp.owner === 'enemy' ? 0.7 : 1);
        }

        let hit = null;
        // Into the shallows: the warhead goes off on the bottom or the beach
        const ground = Islands.groundAt(tp.pos.x, tp.pos.z);
        if (ground > tp.pos.y - 0.6) {
            const p = tp.pos.clone().setY(Math.max(surface, ground));
            if (ground > surface) FX.dirt(p, 2.5); else FX.waterColumn(p);
            playBoom(p, 1.6, 400, 3.5);
            Islands.impact(p, 2.5, null, tp.owner === 'player');
            hit = true;
        } else if (tp.owner === 'player') {
            hit = enemyHitTest(tp.pos, 3);
            if (hit) onEnemyTorpedoHit(hit, tp.pos.clone().setY(surface));
        } else {
            if (playerHitTest(tp.pos, 1.5)) {
                hit = true;
                onPlayerTorpedoHit(tp.pos.clone().setY(surface));
            } else if (!tp.warned && tp.pos.distanceTo(phys.pos) < 2600 && headingThreatens(tp)) {
                tp.warned = true;
                const brg = compassDeg(tp.pos.x - phys.pos.x, tp.pos.z - phys.pos.z);
                hudMessage(`TORPEDO WAKE BEARING ${fmt3(brg)}!`, 'alert');
                playAlarm();
            }
        }
        if (hit || tp.run > tp.type.range) {
            scene.remove(tp.mesh);
            torpedoes.splice(i, 1);
            continue;
        }
        tp.mesh.position.copy(tp.pos);
        tp.mesh.rotation.set(0, tp.heading, 0);
    }
}

// Will this torpedo pass within ~150 m of us in the next minute or so?
function headingThreatens(tp) {
    const rx = phys.pos.x - tp.pos.x, rz = phys.pos.z - tp.pos.z;
    const vx = Math.sin(tp.heading) * tp.type.speed - phys.vel.x, vz = Math.cos(tp.heading) * tp.type.speed - phys.vel.z;
    const tca = (rx * vx + rz * vz) / Math.max(vx * vx + vz * vz, 1e-3);
    if (tca < 0 || tca > 120) return false;
    return Math.hypot(rx - vx * tca, rz - vz * tca) < 150;
}

// Heading that intercepts a target moving at constant velocity (null if it can't be caught)
function interceptHeading(from, speed, targetPos, targetVel) {
    const rx = targetPos.x - from.x, rz = targetPos.z - from.z;
    const a = targetVel.x * targetVel.x + targetVel.z * targetVel.z - speed * speed;
    const b = 2 * (rx * targetVel.x + rz * targetVel.z);
    const c = rx * rx + rz * rz;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    const tHit = [(-b - sq) / (2 * a), (-b + sq) / (2 * a)].filter(v => v > 0).sort((p, q) => p - q)[0];
    if (!tHit) return null;
    return { heading: Math.atan2(rx + targetVel.x * tHit, rz + targetVel.z * tHit), time: tHit };
}
