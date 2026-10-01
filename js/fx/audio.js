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
