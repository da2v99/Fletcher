// Synthesised sound (no audio files): gunfire, splashes, explosions, thunder, all delayed by distance.

const audio = { ctx: null, noise: null, master: null, volume: 0.8 };

function ensureAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audio.ctx) {
        audio.ctx = new AC();
        audio.master = audio.ctx.createGain();
        audio.master.gain.value = audio.volume;
        audio.master.connect(audio.ctx.destination);
        const len = audio.ctx.sampleRate * 3;
        audio.noise = audio.ctx.createBuffer(1, len, audio.ctx.sampleRate);
        const d = audio.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (audio.ctx.state === 'suspended') audio.ctx.resume();
}

function setVolume(v) {
    audio.volume = v;
    if (audio.master) audio.master.gain.value = v;
}

function playBoom(worldPos, loudness, cutoff, length) {
    if (!audio.ctx) return;
    const ctx = audio.ctx;
    const dist = worldPos.distanceTo(camera.position);
    const t0 = ctx.currentTime + dist / 343;
    const vol = loudness / (1 + dist / 250);
    if (vol < 0.002) return;
    const src = ctx.createBufferSource();
    src.buffer = audio.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff / (1 + dist / 1500);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + length + dist / 4000);
    src.connect(f).connect(g).connect(audio.master);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + length + 2);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(70, t0);
    o.frequency.exponentialRampToValueAtTime(28, t0 + 0.5);
    const og = ctx.createGain();
    og.gain.setValueAtTime(vol * 1.2, t0);
    og.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.6);
    o.connect(og).connect(audio.master);
    o.start(t0);
    o.stop(t0 + 0.7);
}

// Incoming shell whistle, heard just before it lands near us
function playWhistle(worldPos, eta) {
    if (!audio.ctx) return;
    const ctx = audio.ctx;
    const dist = worldPos.distanceTo(camera.position);
    if (dist > 600) return;
    const t0 = ctx.currentTime + Math.max(0, eta - 1.2);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(1400, t0);
    o.frequency.exponentialRampToValueAtTime(380, t0 + 1.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.08 / (1 + dist / 150), t0 + 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.2);
    o.connect(g).connect(audio.master);
    o.start(t0);
    o.stop(t0 + 1.3);
}

// General quarters alarm (a short klaxon)
function playAlarm() {
    if (!audio.ctx) return;
    const ctx = audio.ctx;
    for (let i = 0; i < 3; i++) {
        const t0 = ctx.currentTime + i * 0.55;
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(220, t0);
        o.frequency.linearRampToValueAtTime(330, t0 + 0.4);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.06, t0);
        g.gain.linearRampToValueAtTime(0.0001, t0 + 0.45);
        o.connect(g).connect(audio.master);
        o.start(t0);
        o.stop(t0 + 0.5);
    }
}

// Engine-order telegraph: the double ring of the bridge telegraph answering from the engine room
function playBell(order) {
    if (!audio.ctx) return;
    const ctx = audio.ctx;
    const base = 1180 + (order === undefined ? 0 : (order - 3) * 18);
    [0, 0.17].forEach((d, k) => {
        const t0 = ctx.currentTime + d;
        [1, 2.76, 5.4].forEach((h, j) => {
            const o = ctx.createOscillator();
            o.type = 'sine';
            o.frequency.value = base * h * (k ? 0.985 : 1);
            const g = ctx.createGain();
            g.gain.setValueAtTime(0.0001, t0);
            g.gain.exponentialRampToValueAtTime(0.05 / (j + 1), t0 + 0.005);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9 / (j + 1));
            o.connect(g).connect(audio.master);
            o.start(t0);
            o.stop(t0 + 1);
        });
    });
}

// Short vibration on phones that support it
function haptic(ms) {
    if (!Settings.ctl.haptics || !navigator.vibrate) return;
    try { navigator.vibrate(ms); } catch (e) { /* not allowed before a user gesture */ }
}

// A burst from an automatic weapon: n sharp reports `gap` seconds apart (pitch: 1 = 25 mm, higher = rifle calibre)
function playBurst(worldPos, n, gap, loudness = 0.3, pitch = 1) {
    if (!audio.ctx) return;
    const ctx = audio.ctx;
    const dist = worldPos.distanceTo(camera.position);
    const vol = loudness / (1 + dist / 220);
    if (vol < 0.002) return;
    const t0 = ctx.currentTime + dist / 343;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 700 * pitch / (1 + dist / 2500);
    f.Q.value = 0.7;
    f.connect(audio.master);
    for (let i = 0; i < n; i++) {
        const ts = t0 + i * gap * (0.9 + Math.random() * 0.2);
        const src = ctx.createBufferSource();
        src.buffer = audio.noise;
        const g = ctx.createGain();
        g.gain.setValueAtTime(vol, ts);
        g.gain.exponentialRampToValueAtTime(0.0004, ts + 0.09 + 0.05 / pitch);
        src.connect(g).connect(f);
        src.start(ts, Math.random() * 2.5);
        src.stop(ts + 0.16);
    }
}

// Air-raid siren wailing over a camp that has been alerted
function playSiren(worldPos, dur = 6) {
    if (!audio.ctx) return;
    const ctx = audio.ctx;
    const dist = worldPos.distanceTo(camera.position);
    const vol = 0.09 / (1 + dist / 600);
    if (vol < 0.002) return;
    const t0 = ctx.currentTime + dist / 343;
    const o = ctx.createOscillator(), o2 = ctx.createOscillator();
    o.type = 'sawtooth'; o2.type = 'square';
    o.frequency.setValueAtTime(180, t0);
    o.frequency.exponentialRampToValueAtTime(620, t0 + dur * 0.35);
    o.frequency.setValueAtTime(620, t0 + dur * 0.6);
    o.frequency.exponentialRampToValueAtTime(160, t0 + dur);
    o2.frequency.setValueAtTime(181, t0);
    o2.frequency.exponentialRampToValueAtTime(624, t0 + dur * 0.35);
    o2.frequency.setValueAtTime(624, t0 + dur * 0.6);
    o2.frequency.exponentialRampToValueAtTime(161, t0 + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400 / (1 + dist / 1500);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.8);
    g.gain.setValueAtTime(vol, t0 + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    o.connect(lp); o2.connect(g2).connect(lp);
    lp.connect(g).connect(audio.master);
    o.start(t0); o2.start(t0);
    o.stop(t0 + dur + 0.1); o2.stop(t0 + dur + 0.1);
}

// Light AA reports (kind 40 = Bofors, 20 = Oerlikon). Each round is layered: a deep thump that drops in pitch
// (the Bofors' "pom"), a sharp supersonic crack, the broadband muzzle blast, and close to the gun the clank of
// the breech and the next clip; each burst ends in a rumbling tail rolling off over the open sea. Air soaks
// up the highs with distance, and sound arrives late. n rounds `gap` seconds apart.
function playAutoGun(worldPos, n, gap, loudness, kind) {
    if (!audio.ctx || n <= 0) return;
    const ctx = audio.ctx;
    const dist = worldPos.distanceTo(camera.position);
    const vol = loudness / (1 + dist / 260);
    if (vol < 0.002) return;
    const big = kind === 40;
    const t0 = ctx.currentTime + dist / 343;
    const air = ctx.createBiquadFilter();
    air.type = 'lowpass';
    air.frequency.value = (big ? 6000 : 8500) / (1 + dist / 800);
    air.connect(audio.master);
    const noise = (ts, dur, type, freq, q, gain) => {
        const src = ctx.createBufferSource();
        src.buffer = audio.noise;
        const f = ctx.createBiquadFilter();
        f.type = type; f.frequency.value = freq; f.Q.value = q;
        const g = ctx.createGain();
        g.gain.setValueAtTime(gain, ts);
        g.gain.exponentialRampToValueAtTime(0.0003, ts + dur);
        src.connect(f).connect(g).connect(air);
        src.start(ts, Math.random() * 2.5);
        src.stop(ts + dur + 0.02);
    };
    const tone = (ts, f0, f1, dur, type, gain) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(f0, ts);
        o.frequency.exponentialRampToValueAtTime(f1, ts + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(gain, ts);
        g.gain.exponentialRampToValueAtTime(0.0003, ts + dur);
        o.connect(g).connect(air);
        o.start(ts);
        o.stop(ts + dur + 0.02);
    };
    for (let i = 0; i < n; i++) {
        const ts = t0 + i * gap * (0.92 + Math.random() * 0.16);
        const v = vol * rnd(0.85, 1.1);
        if (big) {
            tone(ts, 125 * rnd(0.94, 1.06), 38, 0.24, 'sine', v * 1.6);            // the "pom"
            tone(ts, 260, 90, 0.07, 'triangle', v * 0.5);
            noise(ts, 0.045, 'bandpass', 1500, 0.9, v * 1.2);                       // crack
            noise(ts, 0.2, 'lowpass', 700, 0.7, v * 0.9);                           // muzzle blast
            if (dist < 80) {                                                         // breech, recoil, clips
                tone(ts + 0.07, 2400, 2100, 0.05, 'square', v * 0.03);
                noise(ts + 0.09, 0.05, 'bandpass', 3800, 4, v * 0.12);
            }
        } else {
            tone(ts, 210 * rnd(0.94, 1.06), 75, 0.09, 'sine', v * 0.9);
            noise(ts, 0.03, 'highpass', 1800, 0.7, v * 1.3);                         // sharp bark
            noise(ts, 0.09, 'bandpass', 900, 0.8, v * 0.8);
            if (dist < 60) noise(ts + 0.05, 0.03, 'bandpass', 4500, 5, v * 0.1);     // bolt
        }
    }
    // Tail: the reports rolling away over the water
    const len = n * gap + (big ? 0.9 : 0.6);
    const src = ctx.createBufferSource();
    src.buffer = audio.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = big ? 320 : 480;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0003, t0);
    g.gain.linearRampToValueAtTime(vol * (big ? 0.55 : 0.35), t0 + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0003, t0 + len);
    src.connect(f).connect(g).connect(air);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + len + 0.05);
}

// Gun drives: the electric-hydraulic training and elevating gear of the 5"/38 mounts (a mains hum, a motor whine
// that climbs with the slewing speed, gear grind and hydraulic hiss), the Bofors' power drive (a higher, thinner
// whine) and the hand-trained Oerlikons (a creak of the pedestal). One voice per kind of gun, as loud as all its
// mounts slewing together, each weighted by how near it is; a clunk as a mount starts or stops.
// Mounts add() what they did each frame; frame() applies it (nothing added = silence, e.g. while paused).
const GunDrive = (() => {
    const CFG = {
        main: { hum: 120, w0: 170, w1: 340, lp: 1300, grind: 320, hiss: 0.16, max: 0.12 },
        b40: { hum: 0, w0: 290, w1: 680, lp: 2600, grind: 650, hiss: 0.08, max: 0.09 },
        o20: { hum: 0, w0: 0, w1: 0, lp: 3000, grind: 1500, hiss: 0, max: 0.05 }
    };
    const voices = {}, acc = {};
    function voice(kind) {
        if (voices[kind]) return voices[kind];
        const ctx = audio.ctx, c = CFG[kind];
        const out = ctx.createGain();
        out.gain.value = 0;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = c.lp;
        out.connect(lp).connect(audio.master);
        const v = { out, oscs: [], c };
        if (c.hum) {
            const h = ctx.createOscillator(); h.type = 'sine'; h.frequency.value = c.hum;
            const hg = ctx.createGain(); hg.gain.value = 0.35;
            h.connect(hg).connect(out); h.start(); v.oscs.push(h);
        }
        if (c.w0) {
            v.w = ctx.createOscillator(); v.w.type = 'sawtooth'; v.w.frequency.value = c.w0;
            v.w2 = ctx.createOscillator(); v.w2.type = 'triangle'; v.w2.frequency.value = c.w0 * 2.01;
            const wg = ctx.createGain(); wg.gain.value = 0.22;
            const w2g = ctx.createGain(); w2g.gain.value = 0.12;
            v.w.connect(wg).connect(out); v.w2.connect(w2g).connect(out);
            v.w.start(); v.w2.start(); v.oscs.push(v.w, v.w2);
        }
        // Gear grind (and the Oerlikon's creak): band-passed noise, wobbling
        const n = ctx.createBufferSource(); n.buffer = audio.noise; n.loop = true;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = c.grind; bp.Q.value = kind === 'o20' ? 5 : 2.5;
        const ng = ctx.createGain(); ng.gain.value = kind === 'o20' ? 1.2 : 0.55;
        const lfo = ctx.createOscillator(); lfo.frequency.value = kind === 'o20' ? 3.1 : 11;
        const lg = ctx.createGain(); lg.gain.value = 0.35;
        lfo.connect(lg).connect(ng.gain);
        n.connect(bp).connect(ng).connect(out);
        n.start(); lfo.start(); v.oscs.push(lfo);
        if (c.hiss) {
            const hs = ctx.createBufferSource(); hs.buffer = audio.noise; hs.loop = true;
            const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2800;
            const hsg = ctx.createGain(); hsg.gain.value = c.hiss;
            hs.connect(hp).connect(hsg).connect(out); hs.start(0, 1.3);
        }
        voices[kind] = v;
        return v;
    }
    // level: 0..1 for one mount slewing flat out right beside you; speed: 0..1 fraction of its top rate
    function add(kind, level, speed) {
        const a = acc[kind] || (acc[kind] = { level: 0, speed: 0 });
        a.level += level;
        a.speed = Math.max(a.speed, speed);
    }
    function frame() {
        if (!audio.ctx) return;
        const t = audio.ctx.currentTime;
        Object.keys(CFG).forEach(kind => {
            const a = acc[kind];
            const level = a ? Math.min(1, a.level) : 0;
            if (!voices[kind] && level < 0.01) return;
            const v = voice(kind);
            v.out.gain.setTargetAtTime(level * v.c.max, t, 0.06);
            if (v.w && a) {
                const f = lerp(v.c.w0, v.c.w1, clamp01(a.speed));
                v.w.frequency.setTargetAtTime(f, t, 0.1);
                v.w2.frequency.setTargetAtTime(f * 2.01, t, 0.1);
            }
            if (a) { a.level = 0; a.speed = 0; }
        });
    }
    // A mount taking up or coming to rest: the drive engaging, a thud through the deck
    function clunk(worldPos, big) {
        if (!audio.ctx) return;
        const ctx = audio.ctx, dist = worldPos.distanceTo(camera.position);
        const vol = (big ? 0.12 : 0.06) / (1 + dist / 25);
        if (vol < 0.003) return;
        const t0 = ctx.currentTime + dist / 343;
        const o = ctx.createOscillator(); o.type = 'triangle';
        o.frequency.setValueAtTime(big ? 95 : 160, t0); o.frequency.exponentialRampToValueAtTime(big ? 45 : 80, t0 + 0.12);
        const g = ctx.createGain(); g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0003, t0 + 0.16);
        o.connect(g).connect(audio.master); o.start(t0); o.stop(t0 + 0.2);
    }
    return { add, frame, clunk };
})();
