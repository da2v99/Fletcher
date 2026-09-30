// Fire control shared by the captain's view and the third-person crosshair. X locks the contact under the
// crosshair and the Mk 37 director keeps tracking it wherever you look; otherwise the guns lay on the patch
// of sea under the crosshair. Space fires whatever the director is laid on.

const director = { aim: new THREE.Vector3(), aimValid: false, aimRange: Infinity, lock: null, trigger: false };
const tpAim = { x: 0, y: 0, onCanvas: false };   // third-person crosshair = mouse position (px)
const LOCK_PICK_PX = 28;                           // how close the crosshair must be to a ship to lock it
const _aimRay = new THREE.Raycaster(), _ndc = new THREE.Vector2(), _proj = new THREE.Vector3();

function resetDirector() {
    director.lock = null;
    director.aimValid = false;
    director.aimRange = Infinity;
    director.trigger = false;
}

function lockPoint(e, out = _proj) { return out.set(e.x, e.obj.position.y + 4, e.z); }

// The live enemy under screen point (sx, sy): a direct hit on its hull, else the nearest one within a few px
function enemyAtScreen(sx, sy) {
    const live = enemies.filter(e => !e.sinking);
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

// X: lock the ship under the crosshair, or release the current lock
function toggleLock(sx, sy) {
    const e = sx === undefined ? null : enemyAtScreen(sx, sy);
    if (e) {
        director.lock = e;
        hudMessage(`Director locked: ${e.type.name}, ${Math.round(Math.hypot(e.x - phys.pos.x, e.z - phys.pos.z) * 1.0936).toLocaleString()} yds — tracking`, 'info');
    } else if (director.lock) {
        director.lock = null;
        hudMessage('Director lock released', 'info');
    } else {
        hudMessage('No ship under the crosshair to lock', 'warn');
    }
}

// Lay the director: on the locked ship (with lead for time of flight), else on the sea under (sx, sy)
function updateDirector(sx, sy) {
    const tg = director.lock;
    if (tg && (tg.sinking || !enemies.includes(tg))) director.lock = null;
    director.aimValid = false;
    if (director.lock) {
        // Mk 1A fire control computer: lead the target (and allow for our own motion) by the time of flight
        const sol = firingSolution(Math.hypot(tg.x - phys.pos.x, tg.z - phys.pos.z));
        const tof = sol ? sol.tof : 0;
        const v = enemyVelocity(tg);
        director.aim.set(tg.x + (v.x - phys.vel.x) * tof, 0, tg.z + (v.z - phys.vel.z) * tof);
        director.aimValid = true;
    } else if (sx !== undefined) {
        _ndc.set(sx / window.innerWidth * 2 - 1, -sy / window.innerHeight * 2 + 1);
        _aimRay.setFromCamera(_ndc, camera);
        const o = _aimRay.ray.origin, d = _aimRay.ray.direction;
        if (d.y < -0.0002) {
            director.aim.copy(o).addScaledVector(d, -o.y / d.y).setY(0);
            director.aimValid = true;
        }
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
    window.addEventListener('pointermove', e => {
        tpAim.x = e.clientX;
        tpAim.y = e.clientY;
        tpAim.onCanvas = e.target === el;
    });
    el.addEventListener('pointerleave', () => { tpAim.onCanvas = false; });
}

// Red corner brackets round the locked ship
function drawLockBracket(ctx, w, h) {
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
        const sol = firingSolution(director.aimRange);
        lines.push(`${Math.round(director.aimRange * 1.0936).toLocaleString()} yds${sol ? '' : ' · OUT OF RANGE'}`);
    }
    if (director.lock) lines.push(`LOCKED ${director.lock.type.name.toUpperCase()}`);
    lines.push(`${ready}/${guns.length} guns ready`);
    lines.forEach((t, i) => {
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillText(t, x + 19, y + 19 + i * 13);
        ctx.fillStyle = t.startsWith('LOCKED') ? 'rgba(255,120,100,0.95)' : col;
        ctx.fillText(t, x + 18, y + 18 + i * 13);
    });
}
