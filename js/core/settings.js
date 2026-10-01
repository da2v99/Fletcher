// Player settings: graphics, controls and audio, plus the sea and weather the player has tuned. Saved in this
// browser (localStorage) so the game opens the way it was left. A graphics preset picks sensible values for the
// device (phones get lighter ones); every value can then be changed on its own in the settings menu.

const Device = (() => {
    const ua = navigator.userAgent || '';
    const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    const coarse = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
    const touch = coarse || 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const mobile = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua) || iPadOS;
    return {
        touch, mobile, coarse,
        ios: /iPhone|iPad|iPod/.test(ua) || iPadOS,
        android: /Android/i.test(ua),
        dpr: window.devicePixelRatio || 1,
        cores: navigator.hardwareConcurrency || 4,
        memory: navigator.deviceMemory || 4
    };
})();

// shadows: 0 off, 1 1024, 2 2048, 3 4096 · clouds: 0 painted sky, 1-3 raymarched, more steps and resolution
// ocean: 0 per-vertex lighting (phones), 1 per-vertex + pixel detail, 2 full per-pixel surface
const GFX_PRESETS = {
    low:       { renderScale: 1,    maxDpr: 1,    shadows: 0, clouds: 1, ocean: 0, post: false, bloom: 0,    aa: 'off',  grade: 'natural',   vignette: 0.25, grain: 0,    letterbox: false, shafts: false, flare: false, particles: 0.5 },
    medium:    { renderScale: 1,    maxDpr: 1.5,  shadows: 1, clouds: 1, ocean: 1, post: true,  bloom: 0.45, aa: 'fxaa', grade: 'cinematic', vignette: 0.35, grain: 0.03, letterbox: false, shafts: false, flare: true,  particles: 0.75 },
    high:      { renderScale: 1,    maxDpr: 2,    shadows: 2, clouds: 2, ocean: 2, post: true,  bloom: 0.55, aa: 'fxaa', grade: 'cinematic', vignette: 0.4,  grain: 0.035, letterbox: false, shafts: true,  flare: true,  particles: 1 },
    ultra:     { renderScale: 1,    maxDpr: 2,    shadows: 3, clouds: 3, ocean: 2, post: true,  bloom: 0.6,  aa: 'msaa', grade: 'cinematic', vignette: 0.45, grain: 0.04, letterbox: false, shafts: true,  flare: true,  particles: 1 },
    cinematic: { renderScale: 1,    maxDpr: 2,    shadows: 3, clouds: 3, ocean: 2, post: true,  bloom: 0.8,  aa: 'msaa', grade: 'filmic',    vignette: 0.6,  grain: 0.06, letterbox: true,  shafts: true,  flare: true,  particles: 1 }
};
const PRESET_NAMES = { auto: 'Auto (this device)', low: 'Low · phones, battery', medium: 'Medium · phones, laptops', high: 'High', ultra: 'Ultra', cinematic: 'Cinematic' };

function autoPreset() {
    if (Device.mobile) return Device.memory <= 2 || Device.cores <= 2 ? 'low' : 'medium';
    return Device.cores <= 2 ? 'medium' : 'high';
}

const SETTINGS_KEY = 'fletcher.settings.v1';
const Settings = {
    gfx: Object.assign({ preset: 'auto', dynamicRes: true, targetFps: 60, fps: false, lowLatency: true }, GFX_PRESETS.high),
    ctl: {
        touchUI: 'auto',        // auto | on | off
        steering: 'slider',     // slider | wheel | gyro
        stickyRudder: false,    // slider rudder stays where you leave it
        aimGyro: false,         // look / aim with the phone's gyro in the captain's and AA views
        gyroSens: 1,
        haptics: true,
        leftHanded: false,
        btnScale: 1,
        lookSens: 1,
        aaAuto: true,           // AI gunners man the 40 mm and 20 mm when you are not on a gun
        bell: true              // engine-order telegraph bell
    },
    audio: { volume: 0.8 },
    sea: null,                  // SeaParams snapshot
    weather: null,              // { hour, storm }

    load() {
        let s = null;
        try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); } catch (e) { s = null; }
        if (s) {
            Object.assign(this.gfx, s.gfx || {});
            Object.assign(this.ctl, s.ctl || {});
            Object.assign(this.audio, s.audio || {});
            this.sea = s.sea || null;
            this.weather = s.weather || null;
        }
        if (this.gfx.preset === 'auto' || !GFX_PRESETS[this.gfx.preset]) this.applyPreset('auto');
    },

    applyPreset(name) {
        const key = name === 'auto' ? autoPreset() : name;
        Object.assign(this.gfx, GFX_PRESETS[key], { preset: name });
        if (Device.mobile) this.gfx.targetFps = 60;
    },

    _t: 0,
    save() {
        clearTimeout(this._t);
        this._t = setTimeout(() => {
            try {
                localStorage.setItem(SETTINGS_KEY, JSON.stringify({
                    gfx: this.gfx, ctl: this.ctl, audio: this.audio,
                    sea: typeof SeaParams !== 'undefined' ? SeaParams : this.sea,
                    weather: typeof weather !== 'undefined' ? { hour: weather.hour, storm: weather.storm } : this.weather
                }));
            } catch (e) { /* private mode or storage full: settings just won't persist */ }
        }, 250);
    },

    // Touch controls show on touch devices unless switched off (or on for testing with a mouse)
    get touchUI() { return this.ctl.touchUI === 'on' || (this.ctl.touchUI === 'auto' && Device.touch); }
};
Settings.load();
