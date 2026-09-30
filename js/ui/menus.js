// Menu screens (main, pause, settings, game over), the engagement banner, and settings wiring.
// The settings panel exposes every wave parameter of the sea model live.

const SCREENS = ['mainMenu', 'pauseMenu', 'settingsMenu', 'gameOver'];
let settingsReturn = 'mainMenu';

function showScreen(id) {
    SCREENS.forEach(s => $(s).classList.toggle('show', s === id));
    document.body.classList.toggle('menu-open', !!id);
}

function showBanner(title, sub) {
    const b = $('banner');
    $('bannerTitle').textContent = title;
    $('bannerSub').textContent = sub;
    b.classList.remove('show');
    void b.offsetWidth;   // restart the animation
    b.classList.add('show');
}

function openSettings(from) {
    settingsReturn = from;
    refreshSeaControls();
    showScreen('settingsMenu');
}

function seaStateName(hs) {
    return [[0.1, 'Calm'], [0.5, 'Smooth'], [1.25, 'Slight'], [2.5, 'Moderate'], [4, 'Rough'], [6, 'Very rough'], [9, 'High'], [99, 'Very high']].find(([lim]) => hs <= lim)[1];
}
const compassName = deg => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((deg % 360) + 360) % 360 / 45) % 8];

// Every sea parameter, grouped as in the "Waves and Clouds" example panel plus the world mapping
const SEA_CONTROLS = [
    { section: 'Sea' },
    { key: 'hs', label: 'Wave height (Hs)', min: 0, max: 9, step: 0.05, fmt: v => `${v.toFixed(1)} m · ${seaStateName(v)}` },
    { key: 'autoScale', label: 'Wavelength follows height', type: 'check' },
    { key: 'scale', label: 'Wave scale', min: 0.02, max: 0.8, step: 0.005, fmt: v => `${Math.round(v * SeaParams.medWavelength)} m peak wavelength`, disabledBy: 'autoScale' },
    { key: 'speed', label: 'Speed', min: 0, max: 10, step: 0.1, fmt: v => v.toFixed(1) + (Math.abs(v - 5) < 0.05 ? ' (real)' : '') },
    // Waves travel toward windDir in the XZ plane; the label gives the compass bearing the wind blows from
    { key: 'windDir', label: 'Wind direction', min: 0, max: 360, step: 1, fmt: v => {
        const from = (compassDeg(Math.cos(v * DEG), Math.sin(v * DEG)) + 180) % 360;
        return `from ${compassName(from)} (${fmt3(from)}°)`;
    } },
    { section: 'Gerstner swell' },
    { key: 'spread', label: 'Wave spread', min: 0, max: 0.3, step: 0.005, fmt: v => v.toFixed(3) },
    { key: 'steepness', label: 'Steepness (Q)', min: 0, max: 2, step: 0.01, fmt: v => v.toFixed(2) },
    { key: 'medAmplitude', label: 'Swell vs detail', min: 1, max: 15, step: 0.5, fmt: v => v.toFixed(1) },
    { key: 'medWavelength', label: 'Med wavelength', min: 20, max: 760, step: 10, fmt: v => `${v} units` },
    { section: 'Detail & chop' },
    { key: 'sharp', label: 'Sharpness', min: 0, max: 1.6, step: 0.05, fmt: v => v.toFixed(2) },
    { key: 'chop', label: 'Chop', min: 0, max: 4, step: 0.1, fmt: v => v.toFixed(1) },
    { key: 'ripple', label: 'Ripple', min: -10, max: 10, step: 0.5, fmt: v => v.toFixed(1) },
    { key: 'asym', label: 'Asymmetry', min: 0, max: 2, step: 0.01, fmt: v => v.toFixed(2) },
    { section: 'Macro swell' },
    { key: 'macroOn', label: 'Macro variation', type: 'check' },
    { key: 'macroHeight', label: 'Macro height', min: 0, max: 500, step: 1, fmt: v => `${v}`, disabledBy: '!macroOn' },
    { key: 'macroSize', label: 'Macro size', min: 0, max: 0.4, step: 0.01, fmt: v => v.toFixed(2), disabledBy: '!macroOn' },
    { section: 'Ship motion' },
    { key: 'massPos', label: 'Ship mass', min: 0, max: 1, step: 0.001, fmt: shipMassLabel },
    { section: 'Colour' },
    { key: 'deep', label: 'Ocean deep', type: 'color' },
    { key: 'peak', label: 'Ocean peak', type: 'color' },
    { key: 'foam', label: 'Foam threshold', min: 0, max: 0.52, step: 0.01, fmt: v => v.toFixed(2) },
    { key: 'colorSpan', label: 'Colour span', min: 0.1, max: 1.5, step: 0.01, fmt: v => v.toFixed(2) },
    { key: 'depthBias', label: 'Depth bias', min: 0.5, max: 4, step: 0.1, fmt: v => v.toFixed(1) }
];

function buildSeaControls() {
    const box = $('seaControls');
    box.innerHTML = '';
    SEA_CONTROLS.forEach(c => {
        if (c.section) {
            const h = document.createElement('h3');
            h.textContent = c.section;
            box.appendChild(h);
            return;
        }
        const row = document.createElement('div');
        row.className = 'ctl ' + (c.type || 'range');
        const id = 'sea_' + c.key;
        if (c.type === 'check') {
            row.innerHTML = `<label for="${id}">${c.label}</label><input id="${id}" type="checkbox">`;
        } else if (c.type === 'color') {
            row.innerHTML = `<label for="${id}">${c.label}</label><input id="${id}" type="color">`;
        } else {
            row.innerHTML = `<label for="${id}">${c.label} <b id="${id}_v"></b></label><input id="${id}" type="range" min="${c.min}" max="${c.max}" step="${c.step}">`;
        }
        box.appendChild(row);
        const el = row.querySelector('input');
        el.addEventListener('keydown', e => e.preventDefault());   // keep the keyboard for the ship
        el.addEventListener('input', () => {
            SeaParams[c.key] = c.type === 'check' ? el.checked : c.type === 'color' ? el.value : parseFloat(el.value);
            buildSea();
            refreshSeaControls();
        });
    });
}

// Push SeaParams back into the widgets (after weather changes, resets, or auto-scale updates)
function refreshSeaControls() {
    SEA_CONTROLS.forEach(c => {
        if (c.section) return;
        const el = $('sea_' + c.key);
        if (!el) return;
        const v = SeaParams[c.key];
        if (c.type === 'check') el.checked = v;
        else if (c.type === 'color') el.value = v;
        else {
            if (document.activeElement !== el) el.value = v;
            $('sea_' + c.key + '_v').textContent = c.fmt(v);
        }
        if (c.disabledBy) {
            const neg = c.disabledBy.startsWith('!');
            const flag = SeaParams[c.disabledBy.replace('!', '')];
            el.disabled = neg ? !flag : flag;
        }
    });
}

function initMenus() {
    $('btnPatrol').onclick = () => Game.start('patrol');
    $('btnCruise').onclick = () => Game.start('cruise');
    $('btnSettings').onclick = () => openSettings('mainMenu');
    $('btnResume').onclick = () => Game.setPaused(false);
    $('btnPauseSettings').onclick = () => openSettings('pauseMenu');
    $('btnQuit').onclick = () => Game.toMenu();
    $('btnSettingsBack').onclick = () => showScreen(settingsReturn);
    $('btnRetry').onclick = () => Game.start(Game.mode === 'menu' ? 'patrol' : Game.mode);
    $('btnGoMenu').onclick = () => Game.toMenu();
    $('btnSeaReset').onclick = () => {
        const { hs, massPos } = SeaParams;
        Object.assign(SeaParams, SEA_DEFAULTS, { hs, massPos });
        buildSea();
        refreshSeaControls();
    };

    buildSeaControls();

    const bind = (id, labelId, fn, fmt) => {
        const el = $(id);
        const apply = () => { const v = parseFloat(el.value); fn(v); $(labelId).textContent = fmt(v); };
        el.addEventListener('input', apply);
        el.addEventListener('keydown', e => e.preventDefault());
        apply();
    };
    bind('setTime', 'setTimeVal', v => { weather.hour = v; applyWeather(); }, timeLabel);
    let first = true;
    bind('setWeather', 'setWeatherVal', v => {
        weather.storm = v;
        if (!first) SeaParams.hs = seaHsForStorm(v);   // the sea builds with the weather
        first = false;
        buildSea();
        refreshSeaControls();
        applyWeather();
    }, weatherLabel);
    bind('setVolume', 'setVolumeVal', v => setVolume(v), v => Math.round(v * 100) + '%');
    refreshSeaControls();
}
