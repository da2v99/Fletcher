// Our ship's damage model: hull integrity, fires, knocked-out mounts, engine damage and flooding.
// Floodwater is real weight in the physics, so a badly holed ship settles, lists, and can go down.

const playerDmg = { hull: 100, fires: [], sinking: false, sinkT: 0, lastNearMiss: 0 };

const MOUNT_Z = [39, 31.5, -22.2, -33.2, -42];   // Mt 51..55 along the hull

function resetPlayerDamage() {
    Object.assign(playerDmg, { hull: 100, fires: [], sinking: false, sinkT: 0, lastNearMiss: 0 });
}

// Is a world point inside our hull or superstructure? (slack widens the test for torpedoes)
const _pl = new THREE.Vector3();
function playerHitTest(p, slack = 0) {
    const dx = p.x - phys.pos.x, dz = p.z - phys.pos.z;
    if (dx * dx + dz * dz > 70 * 70) return false;
    _pl.copy(p);
    myShip.worldToLocal(_pl);
    if (Math.abs(_pl.z) > HALF_L) return false;
    const deck = sheerY(_pl.z);
    const superstructure = _pl.z > -37 && _pl.z < 35;
    const top = superstructure ? deck + (_pl.z > 16 && _pl.z < 29 ? 9 : 5) : deck + 2.5;
    if (_pl.y < KEEL_Y - slack || _pl.y > top) return false;
    const half = _pl.y > deck ? (superstructure ? 3.4 : deckHalfWidth(_pl.z)) : hullX(_pl.z, Math.min(_pl.y, deck));
    return Math.abs(_pl.x) < half + slack;
}

function onPlayerShellHit(p) {
    if (playerDmg.sinking) return;
    const local = myShip.worldToLocal(p.clone());
    FX.explosion(p);
    playBoom(p, 1.2, 1100, 2.4);
    if (HullDamage.onPlayer(local, 1) >= 100) breakPlayer();
    Debris.burst(p, rnd(10, 16), 0.55, { vel: phys.vel.clone(), dir: new THREE.Vector3(Math.sign(local.x || 1), 0.3, 0).applyQuaternion(phys.quat) });
    const dmg = rnd(3, 5);
    playerDmg.hull -= dmg;
    Game.stats.hitsTaken++;
    cameraShake(0.6);

    // What did it hit?
    let msg = 'Hit ' + (local.z > 20 ? 'forward' : local.z < -20 ? 'aft' : 'amidships') + (local.x > 0 ? ', port side' : ', starboard side');
    const mountIdx = MOUNT_Z.findIndex(z => Math.abs(local.z - z) < 3.5 && Math.abs(local.x) < 3);
    if (mountIdx >= 0 && !guns[mountIdx].disabled && Math.random() < 0.7) {
        guns[mountIdx].disabled = true;
        msg = `Mount 5${mountIdx + 1} knocked out!`;
    } else if (Math.abs(local.z) < 14 && Math.random() < 0.3) {
        phys.engine = Math.max(0.35, phys.engine * 0.8);
        msg = `Hit in the ${local.z > 0 ? 'forward' : 'after'} engine room — max speed ${Math.round(36.5 * Math.sqrt(phys.engine))} kn`;
    } else if (local.y < 1.2) {
        addFlood(local, 90000);
        msg += ' at the waterline — flooding';
    }
    if (Math.random() < 0.4 && playerDmg.fires.length < 6) {
        playerDmg.fires.push({ local: local.clone().setY(Math.max(local.y, sheerY(local.z) + 0.5)), t: rnd(18, 40) });
        msg += ' — fire!';
    }
    hudMessage(msg, 'alert');
}

function onPlayerTorpedoHit(p) {
    if (playerDmg.sinking) return;
    const local = myShip.worldToLocal(p.clone());
    FX.waterColumn(p);
    playBoom(p, 2.2, 380, 4);
    const keel = HullDamage.onPlayer(local.clone().setY(-0.6), 4);
    Debris.burst(p.clone().setY(p.y + 3), 36, 1, { vel: phys.vel.clone(), speed: 1.2, smoky: 0.5 });
    if (keel >= 100) breakPlayer();
    cameraShake(2.2);
    playerDmg.hull -= rnd(34, 44);
    phys.engine = Math.max(0.25, phys.engine * 0.7);
    addFlood(local, 650000);
    playerDmg.fires.push({ local: local.clone().setY(sheerY(local.z) + 0.5), t: rnd(30, 50) });
    Game.stats.hitsTaken++;
    hudMessage(`TORPEDO HIT ${local.x > 0 ? 'PORT' : 'STARBOARD'} SIDE — heavy flooding!`, 'alert');
    playAlarm();
}

function onEnemyShellMiss(p) {
    const d = p.distanceTo(phys.pos);
    if (d < 140 && simTime - playerDmg.lastNearMiss > 4) {
        playerDmg.lastNearMiss = simTime;
        hudMessage(d < 60 ? 'Straddled!' : 'Near miss!', 'warn');
        cameraShake(0.25);
    }
}

// Her back is broken: she goes in two and down
function breakPlayer() {
    const W = Wreck.get(myShip);
    if (!W || W.broken) return;
    Wreck.breakApart(myShip);
    hudMessage('HER BACK IS BROKEN — she is breaking in two!', 'alert');
    playerDmg.hull = Math.min(playerDmg.hull, 0);
    addFlood(new THREE.Vector3(0, -2, W.cutZ), 900000);
    playAlarm();
}

// Floodwater collects low in the hull near the hole; the weighted average drives list and trim
function addFlood(local, kg) {
    const total = phys.flood + kg;
    const target = new THREE.Vector3(THREE.MathUtils.clamp(local.x, -4, 4), -2.5, THREE.MathUtils.clamp(local.z, -45, 45));
    phys.floodPoint.multiplyScalar(phys.flood / total).addScaledVector(target, kg / total);
    phys.flood = total;
}

function updatePlayerDamage(dt) {
    // Fires burn until damage control puts them out
    for (let i = playerDmg.fires.length - 1; i >= 0; i--) {
        const f = playerDmg.fires[i];
        f.t -= dt;
        playerDmg.hull -= 0.1 * dt;
        if (Math.random() < dt * 14) FX.burn(myShip.localToWorld(f.local.clone()), 0.9);
        if (f.t <= 0) {
            playerDmg.fires.splice(i, 1);
            hudMessage('Damage control: fire extinguished', 'good');
        }
    }
    // Pumps gain on the flooding unless the hull is failing
    if (!playerDmg.sinking) {
        const pumps = playerDmg.hull > 25 ? 1800 : -3000 * (1 - playerDmg.hull / 25);
        phys.flood = Math.max(0, phys.flood - pumps * dt);
    }
    if (!playerDmg.sinking && (playerDmg.hull <= 0 || phys.flood > 2.2e6)) {
        playerDmg.sinking = true;
        playerDmg.hull = 0;
        hudMessage('ABANDON SHIP! USS Fletcher is going down.', 'alert');
        playAlarm();
        Game.onPlayerSinking();
    }
    if (playerDmg.sinking) {
        playerDmg.sinkT += dt;
        const W = Wreck.get(myShip);
        addFlood(phys.floodPoint.clone(), (W && W.broken ? 420000 : 160000) * dt);   // broken in two she goes fast
    }
}

// Screen shake for hits and near misses
const shake = { amount: 0 };
function cameraShake(a) { shake.amount = Math.min(3, shake.amount + a); }
function applyCameraShake(dt) {
    if (shake.amount <= 0.001) return;
    camera.position.x += randn() * 0.15 * shake.amount;
    camera.position.y += randn() * 0.15 * shake.amount;
    shake.amount *= Math.exp(-dt * 5);
}
