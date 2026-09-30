// In-game HUD: helm and damage panel, SG radar scope, message log and the gunnery panel.

const $ = id => document.getElementById(id);

// --- Message log ---
function hudMessage(text, kind = 'info') {
    const box = $('messages');
    const el = document.createElement('div');
    el.className = 'msg ' + kind;
    el.textContent = text;
    box.prepend(el);
    while (box.children.length > 5) box.lastChild.remove();
    setTimeout(() => el.classList.add('fade'), 6000);
    setTimeout(() => el.remove(), 7500);
}

// --- SG surface-search radar: heading-up PPI with a rotating sweep; contacts paint as it passes ---
const radar = { range: 16000, sweep: 0, paints: new Map(), ctx: null };

function drawRadar(dt) {
    if (!radar.ctx) radar.ctx = $('radar').getContext('2d');
    const ctx = radar.ctx, S = 220, c = S / 2, R = c - 8;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(phys.quat);
    const hdg = Math.atan2(fwd.x, fwd.z);
    const prevSweep = radar.sweep;
    radar.sweep = (radar.sweep + dt * Math.PI * 2 / 3.2) % (Math.PI * 2);   // 3.2 s per revolution

    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#021208';
    ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(80,255,140,0.18)';
    ctx.lineWidth = 1;
    [0.33, 0.66, 1].forEach(f => { ctx.beginPath(); ctx.arc(c, c, R * f, 0, Math.PI * 2); ctx.stroke(); });
    ctx.beginPath(); ctx.moveTo(c, c - R); ctx.lineTo(c, c + R); ctx.moveTo(c - R, c); ctx.lineTo(c + R, c); ctx.stroke();

    // Sweep with a fading tail
    for (let k = 0; k < 24; k++) {
        const a = radar.sweep - k * 0.03;
        ctx.strokeStyle = `rgba(80,255,140,${0.5 * (1 - k / 24)})`;
        ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c + Math.sin(a) * R, c - Math.cos(a) * R); ctx.stroke();
    }

    // Contacts (screen angle: 0 = our bow, clockwise = starboard)
    const crossed = a => {
        const s0 = prevSweep, s1 = radar.sweep;
        return s1 >= s0 ? a > s0 && a <= s1 : a > s0 || a <= s1;
    };
    enemies.forEach(e => {
        const dx = e.x - phys.pos.x, dz = e.z - phys.pos.z, d = Math.hypot(dx, dz);
        if (d > radar.range) return;
        const rel = (-(Math.atan2(dx, dz) - hdg) % (Math.PI * 2) + Math.PI * 4) % (Math.PI * 2);
        if (crossed(rel)) {
            radar.paints.set(e.id, { rel, d, t: performance.now(), size: e.model.len / 60, sinking: e.sinking });
            if (!e.detected && Game.hostile) {
                e.detected = true;
                hudMessage(`Radar contact: ${e.type.name}, bearing ${fmt3(compassDeg(dx, dz))}, ${Math.round(d * 1.0936).toLocaleString()} yds`, 'info');
            }
        }
    });
    radar.paints.forEach((p, id) => {
        const age = (performance.now() - p.t) / 3200;
        if (age > 1.2 || !enemies.some(e => e.id === id)) { radar.paints.delete(id); return; }
        const r = p.d / radar.range * R;
        ctx.fillStyle = `rgba(150,255,170,${Math.max(0, 1 - age) * (p.sinking ? 0.4 : 1)})`;
        ctx.beginPath();
        ctx.arc(c + Math.sin(p.rel) * r, c - Math.cos(p.rel) * r, 2 + p.size * 1.5, 0, Math.PI * 2);
        ctx.fill();
    });
    // Own ship
    ctx.fillStyle = '#9fffb4';
    ctx.beginPath(); ctx.moveTo(c, c - 6); ctx.lineTo(c - 3, c + 4); ctx.lineTo(c + 3, c + 4); ctx.fill();
    ctx.fillStyle = 'rgba(150,255,170,0.7)';
    ctx.font = '10px Consolas, monospace';
    ctx.fillText('16 km', c + 4, c - R + 12);
}

const STATUS_STYLE = {
    ready: ['#6fe08a', 'READY'], loading: ['#ffd27a', 'LOADING'], training: ['#ffd27a', 'TRAINING'],
    blocked: ['#7b8794', 'CAN\'T BEAR'], range: ['#ff7b6b', 'NO RANGE'], stowed: ['#7b8794', 'STOWED'], damaged: ['#ff5a4a', 'DAMAGED']
};

let hudAcc = 0;
function updateHud(dt) {
    drawRadar(dt);
    hudAcc += dt;
    if (hudAcc < 0.1) return;
    hudAcc = 0;

    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(phys.quat);
    const u = phys.vel.dot(fwd);
    $('hudSpeed').textContent = (u * 1.94384).toFixed(1);
    $('hudHeading').textContent = fmt3(compassDeg(fwd.x, fwd.z));
    $('hudOrder').textContent = ORDERS[drive.order].name;
    const r = drive.rudder;
    $('rudderNeedle').style.left = (50 + r / RUDDER_MAX * 48) + '%';
    $('hudRudder').textContent = Math.abs(r) < 0.5 ? 'Amidships' : `${Math.abs(r).toFixed(0)}° ${r > 0 ? 'Right' : 'Left'}`;

    const hull = Math.max(0, playerDmg.hull);
    $('hullBar').style.width = hull + '%';
    $('hullBar').style.background = hull > 60 ? '#6fe08a' : hull > 30 ? '#ffd27a' : '#ff5a4a';
    $('hullPct').textContent = Math.round(hull) + '%';
    const listDeg = new THREE.Euler().setFromQuaternion(phys.quat, 'YXZ').z / DEG;
    const status = [];
    if (playerDmg.fires.length) status.push(`${playerDmg.fires.length} fire${playerDmg.fires.length > 1 ? 's' : ''}`);
    if (phys.flood > 20000) status.push(`flooding ${Math.round(phys.flood / 1000)} t`);
    if (Math.abs(listDeg) > 2 && phys.flood > 20000) status.push(`list ${Math.abs(listDeg).toFixed(0)}° ${listDeg > 0 ? 'stbd' : 'port'}`);
    if (phys.engine < 0.99) status.push(`engines ${Math.round(phys.engine * 100)}%`);
    $('dmgStatus').textContent = status.join(' · ') || 'No damage';
    $('torpCount').textContent = torpMounts.map(m => m.left).join(' + ');

    $('scoreVal').textContent = Game.score.toLocaleString();
    $('waveVal').textContent = Game.mode === 'patrol' ? Game.wave : '—';
    $('contactsVal').textContent = enemies.filter(e => !e.sinking).length;

    if (captain.active) updateCaptainPanel();
}

function updateCaptainPanel() {
    $('cpStation').textContent = STATION_NAMES[captain.station] + (captain.binoc ? ` · ${captain.mag.toFixed(0)}× binoculars` : '');
    let rangeTxt = 'RANGE ——';
    if (director.aimValid) {
        const sol = firingSolution(director.aimRange);
        rangeTxt = `RANGE ${Math.round(director.aimRange * 1.0936).toLocaleString()} yds` +
            (sol ? ` · TOF ${sol.tof.toFixed(1)} s` : ' · OUT OF RANGE') + (director.lock ? ` · LOCKED: ${director.lock.type.name.toUpperCase()}` : '');
    }
    $('cpRange').textContent = rangeTxt;
    $('cpBearing').textContent = `BRG ${fmt3(captain.trueBrg)}° T · REL ${Math.abs(Math.round(captain.relBrg))}° ${captain.relBrg > 0.5 ? 'STBD' : captain.relBrg < -0.5 ? 'PORT' : ''}`;
    $('cpGuns').innerHTML = guns.map(g => {
        const [c, label] = STATUS_STYLE[g.status] || STATUS_STYLE.stowed;
        return `<span class="gun" style="border-color:${c};color:${c}">${g.name}<br><small>${label}</small></span>`;
    }).join('') + torpMounts.map(m => {
        const c = m.left ? (m.pending ? '#ffd27a' : '#6fe08a') : '#7b8794';
        return `<span class="gun" style="border-color:${c};color:${c}">TT ${m.name[0]}<br><small>${m.pending ? 'TRAINING' : m.left + ' FISH'}</small></span>`;
    }).join('');
}
