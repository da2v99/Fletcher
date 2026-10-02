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
    refreshSettingsUI();
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

// The sea tab: every SEA_CONTROLS entry edits SeaParams live
function seaItems() {
    return SEA_CONTROLS.map(c => c.section ? c : Object.assign({}, c, {
        get: () => SeaParams[c.key],
        set: v => { SeaParams[c.key] = v; buildSea(); },
        disabled: c.disabledBy ? () => {
            const neg = c.disabledBy.startsWith('!');
            const flag = SeaParams[c.disabledBy.replace('!', '')];
            return neg ? !flag : flag;
        } : undefined
    }));
}
// Kept for callers that changed SeaParams directly (weather slider, reset)
function refreshSeaControls() { refreshSettingsUI(); }

function initMenus() {
    $('btnPatrol').onclick = () => { goFullscreenLandscape(); Game.start('patrol'); };
    $('btnCruise').onclick = () => { goFullscreenLandscape(); Game.start('cruise'); };
    $('btnSettings').onclick = () => openSettings('mainMenu');
    $('btnResume').onclick = () => Game.setPaused(false);
    $('btnPauseSettings').onclick = () => openSettings('pauseMenu');
    $('btnQuit').onclick = () => Game.toMenu();
    $('btnSettingsBack').onclick = () => showScreen(settingsReturn);
    $('btnRetry').onclick = () => Game.start(Game.mode === 'menu' ? 'patrol' : Game.mode);
    $('btnGoMenu').onclick = () => Game.toMenu();
    $('btnSwim').onclick = () => { showScreen(null); Person.abandon(); };
    $('btnSeaReset').onclick = () => {
        const { hs, massPos } = SeaParams;
        Object.assign(SeaParams, SEA_DEFAULTS, { hs, massPos });
        buildSea();
        Settings.save();
        refreshSettingsUI();
    };

    buildPane($('seaControls'), seaItems());
    initSettingsUI();
    // Restore the weather the player left
    if (Settings.weather) {
        $('setTime').value = Settings.weather.hour;
        $('setWeather').value = Settings.weather.storm;
    }
    $('setVolume').value = Settings.audio.volume;

    const bind = (id, labelId, fn, fmt) => {
        const el = $(id);
        const apply = () => { const v = parseFloat(el.value); fn(v); $(labelId).textContent = fmt(v); };
        el.addEventListener('input', () => { apply(); Settings.save(); });
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
    bind('setVolume', 'setVolumeVal', v => { setVolume(v); Settings.audio.volume = v; }, v => Math.round(v * 100) + '%');
    refreshSettingsUI();
}
