// Fire control shared by the captain's view and the third-person crosshair. The guns lay on whatever is under
// the crosshair: a ship, the sea, or (above the horizon) maximum range on that bearing. X locks it: a ship is
// then tracked with lead wherever you look, a point of sea stays fixed. X on the current lock releases it.
// Space fires whatever the director is laid on.

const director = { aim: new THREE.Vector3(), aimValid: false, aimRange: Infinity, lock: null, lockPoint: null, trigger: false };
const tpAim = { x: 0, y: 0, onCanvas: false };   // third-person crosshair = mouse position (px)
const LOCK_PICK_PX = 28;                           // how close the crosshair must be to a ship to lock it
const _aimRay = new THREE.Raycaster(), _ndc = new THREE.Vector2(), _proj = new THREE.Vector3();

function resetDirector() {
    director.lock = null;
    director.lockPoint = null;
    director.aimValid = false;
    director.aimRange = Infinity;
    director.trigger = false;
}

function lockPoint(e, out = _proj) { return out.set(e.x, e.lockY !== undefined ? e.lockY : e.obj.position.y + 4, e.z); }

// Everything the director can lock: enemy ships, and on the islands guns, AA, buildings and trucks
function lockables() {
    const live = enemies.filter(e => !e.sinking);
    return live.concat(Islands.targets());
}

// The live target under screen point (sx, sy): a direct hit on its model, else the nearest one within a few px
function enemyAtScreen(sx, sy) {
    const live = lockables();
    if (!live.length) return null;
    _ndc.set(sx / window.innerWidth * 2 - 1, -sy / window.innerHeight * 2 + 1);
    _aimRay.setFromCamera(_ndc, camera);
    _aimRay.far = 25000;
    const hits = _aimRay.intersectObjects(live.map(e => e.obj), true);
    if (hits.length) {
        let o = hits[0].object;
        while (o.parent && !live.some(e => e.obj === o)) o = o.parent;
        const found = live.find(e => e.obj === o);
        if (found) return found;
    }
    let best = null, bestD = LOCK_PICK_PX;
    live.forEach(e => {
        const v = lockPoint(e).project(camera);
        if (v.z >= 1) return;
        const d = Math.hypot((v.x * 0.5 + 0.5) * window.innerWidth - sx, (-v.y * 0.5 + 0.5) * window.innerHeight - sy);
        if (d < bestD) { best = e; bestD = d; }
    });
    return best;
}

// Where the crosshair ray meets the land or the sea (y = 0), or max range along its bearing when it points
// above the horizon
function crosshairSeaPoint(sx, sy, out) {
    _ndc.set(sx / window.innerWidth * 2 - 1, -sy / window.innerHeight * 2 + 1);
    _aimRay.setFromCamera(_ndc, camera);
    const o = _aimRay.ray.origin, d = _aimRay.ray.direction;
    const maxR = MAX_RANGE * 0.995;
    const tSea = d.y < -0.0002 ? -o.y / d.y : Infinity;
    const tLand = Islands.raycast(o, d, Math.min(tSea, 30000));
    if (tLand !== null) {
        out.copy(o).addScaledVector(d, tLand);
        if (Math.hypot(out.x - phys.pos.x, out.z - phys.pos.z) <= maxR) return out;
    }
    if (d.y < -0.0002) {
        out.copy(o).addScaledVector(d, -o.y / d.y).setY(0);
        const dx = out.x - phys.pos.x, dz = out.z - phys.pos.z, r = Math.hypot(dx, dz);
        if (r <= maxR) return out;
    }
    const h = Math.hypot(d.x, d.z) || 1;
    return out.set(phys.pos.x + d.x / h * maxR, 0, phys.pos.z + d.z / h * maxR);
}

const yds = (x, z) => Math.round(Math.hypot(x - phys.pos.x, z - phys.pos.z) * 1.0936).toLocaleString();

// X: lock whatever is under the crosshair (a ship, else that point of sea); X on the current lock releases it
function toggleLock(sx, sy) {
    if (sx === undefined) {
        if (director.lock || director.lockPoint) { director.lock = director.lockPoint = null; hudMessage('Director lock released', 'info'); }
        else hudMessage('Point the crosshair at a ship or the sea to lock', 'warn');
        return;
    }
    const e = enemyAtScreen(sx, sy);
    const onCurrent = e ? e === director.lock : director.lockPoint && lockMarkerNear(sx, sy);
    if (onCurrent) {
        director.lock = director.lockPoint = null;
        hudMessage('Director lock released', 'info');
    } else if (e) {
        director.lock = e;
        director.lockPoint = null;
        hudMessage(`Director locked: ${e.type.name}, ${yds(e.x, e.z)} yds — tracking`, 'info');
    } else {
        const pt = crosshairSeaPoint(sx, sy, new THREE.Vector3());
        director.lock = null;
        director.lockPoint = pt;
        hudMessage(`Director locked on ${pt.y > 0.5 ? 'the shore' : 'the sea'}, bearing ${fmt3(compassDeg(pt.x - phys.pos.x, pt.z - phys.pos.z))}, ${yds(pt.x, pt.z)} yds`, 'info');
    }
}

function lockMarkerNear(sx, sy) {
    const v = _proj.copy(director.lockPoint).project(camera);
    return v.z < 1 && Math.hypot((v.x * 0.5 + 0.5) * window.innerWidth - sx, (-v.y * 0.5 + 0.5) * window.innerHeight - sy) < LOCK_PICK_PX;
}

// Lay the director: locked ship (with lead for time of flight), locked sea point, else whatever is under (sx, sy)
function updateDirector(sx, sy) {
    const lk = director.lock;
    if (lk && (lk.sinking || !(lk.isStructure ? lk.alive : enemies.includes(lk)))) director.lock = null;
    director.aimValid = false;
    const leadOn = tg => {
        // Mk 1A fire control computer: lead the target (and allow for our own motion) by the time of flight
        const sol = firingSolution(Math.hypot(tg.x - phys.pos.x, tg.z - phys.pos.z));
        const tof = sol ? sol.tof : 0;
        const v = enemyVelocity(tg);
        director.aim.set(tg.x + (v.x - phys.vel.x) * tof, tg.aimY || 0, tg.z + (v.z - phys.vel.z) * tof);
        director.aimValid = true;
    };
    if (director.lock) leadOn(director.lock);
    else if (director.lockPoint) { director.aim.copy(director.lockPoint); director.aimValid = true; }
    else if (sx !== undefined) {
        const e = enemyAtScreen(sx, sy);
        if (e) leadOn(e);
        else { crosshairSeaPoint(sx, sy, director.aim); director.aimValid = true; }
    }
    director.aimRange = director.aimValid ? Math.hypot(director.aim.x - phys.pos.x, director.aim.z - phys.pos.z) : Infinity;
}

// Third-person cameras: the crosshair follows the mouse
function updateThirdPersonAim() {
    if (tpAim.onCanvas) updateDirector(tpAim.x, tpAim.y);
    else updateDirector();
}

function initThirdPersonAim() {
    const el = renderer.domElement;
    // The crosshair follows a mouse or pen; on touch screens a tap locks instead (touch.js)
    window.addEventListener('pointermove', e => {
        if (e.pointerType === 'touch') return;
        tpAim.x = e.clientX;
        tpAim.y = e.clientY;
        tpAim.onCanvas = e.target === el;
    });
    el.addEventListener('pointerleave', () => { tpAim.onCanvas = false; });
}

// Red corner brackets round the locked ship, or a diamond on the locked patch of sea
function drawLockBracket(ctx, w, h) {
    if (director.lockPoint) {
        const v = _proj.copy(director.lockPoint).project(camera);
        if (v.z >= 1) return;
        const sx = (v.x * 0.5 + 0.5) * w, sy = (-v.y * 0.5 + 0.5) * h, s = 9;
        ctx.strokeStyle = 'rgba(255,90,70,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx, sy - s); ctx.lineTo(sx + s, sy); ctx.lineTo(sx, sy + s); ctx.lineTo(sx - s, sy); ctx.closePath();
        ctx.moveTo(sx, sy - s - 5); ctx.lineTo(sx, sy - s - 1);
        ctx.stroke();
        return;
    }
    if (!director.lock) return;
    const v = lockPoint(director.lock).project(camera);
    if (v.z >= 1) return;
    const sx = (v.x * 0.5 + 0.5) * w, sy = (-v.y * 0.5 + 0.5) * h, s = 18;
    ctx.strokeStyle = 'rgba(255,90,70,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([a, b]) => {
        ctx.moveTo(sx + a * s, sy + b * s * 0.4); ctx.lineTo(sx + a * s, sy + b * s); ctx.lineTo(sx + a * s * 0.4, sy + b * s);
    });
    ctx.stroke();
}

// Small third-person crosshair with range, lock and gun readiness under it
function drawThirdPersonCrosshair(ctx) {
    if (!tpAim.onCanvas) return;
    const x = tpAim.x, y = tpAim.y;
    const ready = guns.filter(g => g.status === 'ready').length;
    const col = ready ? 'rgba(111,224,138,0.95)' : 'rgba(255,210,122,0.95)';
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.moveTo(x - 14, y); ctx.lineTo(x - 9, y);
    ctx.moveTo(x + 9, y); ctx.lineTo(x + 14, y);
    ctx.moveTo(x, y - 14); ctx.lineTo(x, y - 9);
    ctx.moveTo(x, y + 9); ctx.lineTo(x, y + 14);
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.fillRect(x - 1, y - 1, 2, 2);

    ctx.font = '11px Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    const lines = [];
    if (director.aimValid) {
        const sol = firingSolution(director.aimRange, director.aim.y - GUN_H);
        lines.push(`${Math.round(director.aimRange * 1.0936).toLocaleString()} yds${sol ? '' : ' · OUT OF RANGE'}`);
    }
    if (director.lock) lines.push(`LOCKED ${director.lock.type.name.toUpperCase()}`);
    else if (director.lockPoint) lines.push('LOCKED ON POINT');
    lines.push(`${ready}/${guns.length} guns ready`);
    lines.forEach((t, i) => {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillText(t, x + 19, y + 19 + i * 13);
        ctx.fillStyle = t.startsWith('LOCKED') ? 'rgba(255,120,100,0.95)' : col;
        ctx.fillText(t, x + 18, y + 18 + i * 13);
    });
}

// Shore bombardment: a marker over the battery, or an arrow at the edge of the view pointing toward it
function drawObjectiveMarker(ctx, w, h) {
    const b = Game.objective;
    if (!b || !b.isl.ready || b.guns.every(g => !g.alive)) return;
    const gun = b.guns.find(g => g.alive);
    const v = _proj.set(gun.x, gun.y + 25, gun.z).project(camera);
    const yd = Math.round(Math.hypot(gun.x - phys.pos.x, gun.z - phys.pos.z) * 1.0936).toLocaleString();
    let sx = (v.x * 0.5 + 0.5) * w, sy = (-v.y * 0.5 + 0.5) * h;
    const behind = v.z > 1;
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = 'rgba(255,205,90,0.95)';
    ctx.lineWidth = 2;
    ctx.font = '11px Consolas, monospace';
    ctx.textAlign = 'center';
    if (!behind && sx > 40 && sx < w - 40 && sy > 70 && sy < h - 70) {
        ctx.beginPath();
        ctx.moveTo(sx, sy - 9); ctx.lineTo(sx + 7, sy); ctx.lineTo(sx, sy + 9); ctx.lineTo(sx - 7, sy); ctx.closePath();
        ctx.stroke();
        ctx.fillText(`BATTERY · ${yd} yds`, sx, sy - 15);
    } else {
        let dx = sx - w / 2, dy = sy - h / 2;
        if (behind) { dx = -dx; dy = -dy; }
        const k = Math.min((w / 2 - 44) / Math.max(Math.abs(dx), 1e-3), (h / 2 - 80) / Math.max(Math.abs(dy), 1e-3));
        const ex = w / 2 + dx * k, ey = h / 2 + dy * k, a = Math.atan2(dy, dx);
        ctx.beginPath();
        ctx.moveTo(ex + Math.cos(a) * 12, ey + Math.sin(a) * 12);
        ctx.lineTo(ex + Math.cos(a + 2.5) * 10, ey + Math.sin(a + 2.5) * 10);
        ctx.lineTo(ex + Math.cos(a - 2.5) * 10, ey + Math.sin(a - 2.5) * 10);
        ctx.closePath();
        ctx.fill();
        ctx.fillText(`BATTERY ${yd} yds`, ex - Math.cos(a) * 20, ey - Math.sin(a) * 20 + 4);
    }
    ctx.restore();
}
