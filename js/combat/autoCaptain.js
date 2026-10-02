// The AI captain: has the conn and fights the 5"/38s while you are on an AA gun or on foot.
//
// Ship handling: closes a surface contact, then fights it broadside on with a slow weave; combs torpedo
// tracks and swings hard under diving bombers; keeps off the shoals (the same look-ahead the enemy uses);
// otherwise holds course. Steering is a PD autopilot on the rudder order. With nobody to fight and you in the
// water, it turns back for you (man overboard) and stops alongside.
// Gunnery: keeps your director lock if you set one, otherwise picks the most dangerous target in range (a
// warship over a transport, the battery we were sent for, a plane boring in), and fires when the guns bear.
// Your own A / D still override the rudder while held, and W / S engine orders are respected for a while.

const AutoCaptain = (() => {
    const st = { active: false, order: -1, manualT: -99, targetT: 0, weave: Math.random() * 100, side: 1, msgT: -99, aiLock: null, mob: false, evadeT: 0, evadeSide: 1 };

    const wantsConn = () => Game.running && !playerDmg.sinking && (AA.manned || (typeof Person !== 'undefined' && Person.active));

    // The player rang up an order themselves: leave the engines alone for a while
    function manualOrder() { st.manualT = simTime; }

    function nearestEnemy() {
        let best = null, bs = Infinity;
        for (const e of enemies) {
            if (e.sinking || e.island) continue;
            const d = Math.hypot(e.x - phys.pos.x, e.z - phys.pos.z);
            const s = d * (e.typeKey === 'maru' ? 1.6 : e.typeKey === 'barge' ? 3 : 1);
            if (s < bs) { bs = s; best = { e, d }; }
        }
        return best;
    }

    function pickGunTarget() {
        // Planes that are attacking us come first (VT shells), then surface ships, then the shore battery
        const planes = Air.targets().filter(p => p.alive && (p.state === 'dive' || p.state === 'run' || p.state === 'strafe') && p.pos.distanceTo(phys.pos) < 7000);
        if (planes.length) return planes.sort((a, b) => a.pos.distanceTo(phys.pos) - b.pos.distanceTo(phys.pos))[0];
        const ne = nearestEnemy();
        if (ne && ne.d < MAX_RANGE * 0.92) return ne.e;
        const b = Game.objective;
        if (b && b.isl.ready) {
            const g = b.guns.find(x => x.alive);
            const tg = g && Islands.targets().find(t => t.alive && Math.hypot(t.x - g.x, t.z - g.z) < 30);
            if (tg && Math.hypot(tg.x - phys.pos.x, tg.z - phys.pos.z) < MAX_RANGE * 0.9) return tg;
        }
        return null;
    }

    const valid = tg => tg && (tg.isAir || tg.isStructure ? tg.alive : enemies.includes(tg) && !tg.sinking);

    function steerTo(heading, dt) {
        const err = wrapAngle(heading - phys.heading);
        // Positive rudder turns to starboard, which lowers our heading angle; damp on the turn rate
        const cmd = -err / DEG * 2.2 + phys.yawRate / DEG * 14;
        drive.cmd = THREE.MathUtils.clamp(cmd, -RUDDER_MAX, RUDDER_MAX);
    }

    function setOrder(i) {
        if (simTime - st.manualT < 25) return;
        if (drive.order !== i) setEngineOrder(i);
    }

    function conn(dt) {
        const pos = phys.pos;
        let desired = phys.heading, order = 6;
        const ne = nearestEnemy();
        // Man overboard: you went over the side while she's afloat. Come about, close and stop.
        const p = typeof Person !== 'undefined' && Person.active ? Person.worldPos() : null;
        st.mob = !!(p && !Person.onShip && !ne);
        if (st.mob) {
            const d = Math.hypot(p.x - pos.x, p.z - pos.z);
            desired = Math.atan2(p.x - pos.x, p.z - pos.z);
            order = d > 900 ? 6 : d > 260 ? 4 : 3;
            if (d < 260) desired = phys.heading;
        } else if (ne) {
            const brg = Math.atan2(ne.e.x - pos.x, ne.e.z - pos.z);
            if (ne.d > 9000) {
                const lead = interceptHeading({ x: pos.x, z: pos.z }, orderSpeed(7), new THREE.Vector3(ne.e.x, 0, ne.e.z), enemyVelocity(ne.e));
                desired = lead ? lead.heading : brg;
                order = 7;
            } else {
                // Broadside on: keep the target 70-110° off the bow so all five mounts bear, weaving
                const rel = wrapAngle(brg - phys.heading);
                if (Math.abs(rel) > 2.6 || Math.abs(rel) < 0.35) st.side = rel > 0 ? 1 : -1;
                else st.side = rel > 0 ? 1 : -1;
                st.weave += dt;
                desired = brg - st.side * (Math.PI / 2 + 0.25 * Math.sin(st.weave / 18));
                order = ne.d < 4000 ? 8 : 7;
            }
        } else if (Game.objective && Game.objective.isl.ready) {
            const b = Game.objective, d = Math.hypot(b.x - pos.x, b.z - pos.z);
            const brg = Math.atan2(b.x - pos.x, b.z - pos.z);
            desired = d > 9000 ? brg : brg + Math.PI / 2;   // run in, then steam across the battery's front
            order = 7;
        }
        // Torpedoes in the water heading our way: turn to comb the tracks
        for (const tp of torpedoes) {
            if (tp.owner === 'player') continue;
            const dx = pos.x - tp.pos.x, dz = pos.z - tp.pos.z, d = Math.hypot(dx, dz);
            if (d > 1800) continue;
            const toUs = Math.atan2(dx, dz);
            if (Math.abs(wrapAngle(toUs - tp.heading)) > 0.6) continue;
            const a = tp.heading, b = tp.heading + Math.PI;
            desired = Math.abs(wrapAngle(a - phys.heading)) < Math.abs(wrapAngle(b - phys.heading)) ? a : b;
            order = 8;
            if (simTime - st.msgT > 12) { st.msgT = simTime; hudMessage('Captain: torpedo tracks! Combing them…', 'warn'); }
            break;
        }
        // Dive bombers pushing over: put the rudder hard over to spoil their aim
        const diving = Air.planes.some(pl => pl.alive && pl.state === 'dive' && Math.hypot(pl.pos.x - pos.x, pl.pos.z - pos.z) < 2500);
        if (diving) {
            if (st.evadeT <= 0) {
                st.evadeT = rnd(6, 9);
                st.evadeSide = -st.evadeSide;
                if (simTime - st.msgT > 12) { st.msgT = simTime; hudMessage('Captain: dive bombers! Hard over!', 'warn'); }
            }
            desired = phys.heading + st.evadeSide * 1.2;
            order = 8;
        }
        st.evadeT -= dt;
        // Keep off the shoals
        desired = Islands.steer(pos.x, pos.z, phys.heading, desired, 900 + Math.max(0, phys.vel.length()) * 30, 6);
        steerTo(desired, dt);
        setOrder(order);
    }

    function guns(dt) {
        st.targetT -= dt;
        const playerLock = director.lock && director.lock !== st.aiLock;
        if (playerLock || director.lockPoint) {
            director.aiTrigger = director.aimValid && director.aimRange < MAX_RANGE * 0.97;
            return;
        }
        if (!valid(st.aiLock) || st.targetT <= 0) {
            st.targetT = 4;
            const tg = pickGunTarget();
            if (tg !== st.aiLock) {
                st.aiLock = tg;
                director.lock = tg;
                if (tg && simTime - st.msgT > 6) {
                    st.msgT = simTime;
                    hudMessage(`Captain: commence firing on the ${tg.type ? tg.type.name.toLowerCase() : 'target'}.`, 'info');
                }
            }
        }
        if (!valid(st.aiLock)) { st.aiLock = null; if (director.lock && !valid(director.lock)) director.lock = null; }
        director.aiTrigger = !!st.aiLock && director.aimValid && director.aimRange < MAX_RANGE * 0.97;
    }

    function update(dt) {
        const want = wantsConn();
        if (want !== st.active) {
            st.active = want;
            if (want) {
                hudMessage('The captain has the conn and the 5"/38s.', 'info');
            } else {
                drive.cmd = null;
                director.aiTrigger = false;
                if (director.lock === st.aiLock) director.lock = null;
                st.aiLock = null;
            }
        }
        if (!st.active || dt <= 0) return;
        conn(dt);
        guns(dt);
    }

    function reset() {
        st.active = false;
        st.aiLock = null;
        st.manualT = -99;
        director.aiTrigger = false;
    }

    return { update, reset, manualOrder, get active() { return st.active; } };
})();
