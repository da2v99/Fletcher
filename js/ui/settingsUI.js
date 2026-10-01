// The settings panel: Graphics, Controls, Sea & Weather and Sound tabs, built from small specs. Every change
// applies live and is saved in this browser.

const settingsPanes = [];

// Build one pane from a list of items; returns a refresh function that pushes current values into the widgets
function buildPane(box, items) {
    const rows = [];
    items.forEach(c => {
        if (c.section) {
            const h = document.createElement('h3');
            h.textContent = c.section;
            box.appendChild(h);
            return;
        }
        const row = document.createElement('div');
        row.className = 'ctl ' + (c.type || 'range');
        const id = 'set_' + Math.random().toString(36).slice(2, 9);
        if (c.type === 'check') {
            row.innerHTML = `<label for="${id}">${c.label}</label><input id="${id}" type="checkbox">`;
        } else if (c.type === 'color') {
            row.innerHTML = `<label for="${id}">${c.label}</label><input id="${id}" type="color">`;
        } else if (c.type === 'select') {
            row.innerHTML = `<label for="${id}">${c.label}</label><select id="${id}">${c.options.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`;
        } else if (c.type === 'button') {
            row.innerHTML = `<button id="${id}" class="btn ghost small">${c.label}</button>`;
        } else {
            row.innerHTML = `<label for="${id}">${c.label} <b></b></label><input id="${id}" type="range" min="${c.min}" max="${c.max}" step="${c.step}">`;
        }
        if (c.hint) {
            const h = document.createElement('div');
            h.className = 'hint';
            h.textContent = c.hint;
            row.appendChild(h);
        }
        box.appendChild(row);
        const el = row.querySelector('input, select, button');
        const out = row.querySelector('label b');
        if (c.type === 'button') el.addEventListener('click', () => { c.action(); refreshSettingsUI(); });
        else {
            if (el.tagName === 'INPUT') el.addEventListener('keydown', e => e.preventDefault());   // keep the keyboard for the ship
            el.addEventListener(c.type === 'select' || c.type === 'check' ? 'change' : 'input', () => {
                const v = c.type === 'check' ? el.checked : c.type === 'color' || c.type === 'select' ? (c.numeric ? parseFloat(el.value) : el.value) : parseFloat(el.value);
                c.set(v);
                Settings.save();
                refreshSettingsUI();
            });
        }
        rows.push({ c, el, out, row });
    });
    const refresh = () => rows.forEach(({ c, el, out, row }) => {
        if (c.type !== 'button') {
            const v = c.get();
            if (c.type === 'check') el.checked = !!v;
            else if (document.activeElement !== el || c.type === 'select') el.value = v;
            if (out && c.fmt) out.textContent = c.fmt(v);
        }
        const off = c.disabled ? c.disabled() : false;
        el.disabled = off;
        row.classList.toggle('off', off);
        if (c.hidden) row.style.display = c.hidden() ? 'none' : '';
    });
    settingsPanes.push(refresh);
    return refresh;
}

function refreshSettingsUI() { settingsPanes.forEach(r => r()); }

// Any single graphics change turns the preset into "Custom"
const gfxSet = (key, after) => v => {
    Settings.gfx[key] = v;
    Settings.gfx.preset = 'custom';
    Gfx.apply();
    if (after) after(v);
};
const pct = v => Math.round(v * 100) + '%';

const GFX_ITEMS = [
    { section: 'Quality' },
    { label: 'Preset', type: 'select', options: Object.entries(Object.assign({ custom: 'Custom' }, PRESET_NAMES)).map(([k, l]) => [k, l]),
      get: () => Settings.gfx.preset, set: v => { if (v !== 'custom') { Settings.applyPreset(v); Gfx.apply(); } },
      hint: 'Auto picks for this device. Phones start on Low or Medium.' },
    { label: 'Render resolution', min: 0.4, max: 1, step: 0.05, fmt: pct, get: () => Settings.gfx.renderScale, set: gfxSet('renderScale') },
    { label: 'Dynamic resolution', type: 'check', get: () => Settings.gfx.dynamicRes, set: gfxSet('dynamicRes'),
      hint: 'Lowers the resolution for a moment when the frame rate drops.' },
    { label: 'Target frame rate', type: 'select', numeric: true, options: [[30, '30 fps (battery)'], [60, '60 fps'], [90, '90 fps'], [120, '120 fps']],
      get: () => Settings.gfx.targetFps, set: gfxSet('targetFps'), disabled: () => !Settings.gfx.dynamicRes },
    { label: 'Max pixel density', type: 'select', numeric: true, options: [[1, '1x'], [1.5, '1.5x'], [2, '2x'], [3, '3x (sharpest)']],
      get: () => Settings.gfx.maxDpr, set: gfxSet('maxDpr') },
    { section: 'World' },
    { label: 'Ocean detail', type: 'select', numeric: true, options: [[0, 'Low (phones)'], [1, 'Medium'], [2, 'High (per pixel)']],
      get: () => Settings.gfx.ocean, set: gfxSet('ocean') },
    { label: 'Islands', type: 'select', numeric: true, options: [[0, 'Low (phones)'], [1, 'Medium'], [2, 'High (dense jungle)']],
      get: () => Settings.gfx.terrain, set: gfxSet('terrain') },
    { label: 'Clouds', type: 'select', numeric: true, options: [[0, 'Painted'], [1, 'Volumetric low'], [2, 'Volumetric'], [3, 'Volumetric high']],
      get: () => Settings.gfx.clouds, set: gfxSet('clouds') },
    { label: 'Shadows', type: 'select', numeric: true, options: [[0, 'Off'], [1, 'Low'], [2, 'Medium'], [3, 'High']],
      get: () => Settings.gfx.shadows, set: gfxSet('shadows') },
    { label: 'Effects density', min: 0.3, max: 1, step: 0.05, fmt: pct, get: () => Settings.gfx.particles, set: gfxSet('particles') },
    { section: 'Cinematic' },
    { label: 'Post-processing', type: 'check', get: () => Settings.gfx.post, set: gfxSet('post') },
    { label: 'Anti-aliasing', type: 'select', options: [['off', 'Off'], ['fxaa', 'FXAA (fast)'], ['msaa', 'MSAA 4x (sharp)']],
      get: () => Settings.gfx.aa, set: gfxSet('aa'), disabled: () => !Settings.gfx.post },
    { label: 'Colour grade', type: 'select', options: [['natural', 'Natural'], ['cinematic', 'Cinematic (teal & orange)'], ['filmic', 'Filmic']],
      get: () => Settings.gfx.grade, set: gfxSet('grade'), disabled: () => !Settings.gfx.post },
    { label: 'Bloom', min: 0, max: 1.2, step: 0.05, fmt: v => v.toFixed(2), get: () => Settings.gfx.bloom, set: gfxSet('bloom'), disabled: () => !Settings.gfx.post },
    { label: 'Light shafts', type: 'check', get: () => Settings.gfx.shafts, set: gfxSet('shafts'), disabled: () => !Settings.gfx.post },
    { label: 'Sun flare', type: 'check', get: () => Settings.gfx.flare, set: gfxSet('flare'), disabled: () => !Settings.gfx.post },
    { label: 'Vignette', min: 0, max: 1, step: 0.05, fmt: pct, get: () => Settings.gfx.vignette, set: gfxSet('vignette'), disabled: () => !Settings.gfx.post },
    { label: 'Film grain', min: 0, max: 0.12, step: 0.005, fmt: v => Math.round(v / 0.12 * 100) + '%', get: () => Settings.gfx.grain, set: gfxSet('grain'), disabled: () => !Settings.gfx.post },
    { label: 'Letterbox (2.39:1)', type: 'check', get: () => Settings.gfx.letterbox, set: gfxSet('letterbox'), disabled: () => !Settings.gfx.post },
    { section: 'Display' },
    { label: 'Show frame rate', type: 'check', get: () => Settings.gfx.fps, set: v => { Settings.gfx.fps = v; Gfx.apply(); } },
    { label: 'Low-latency canvas', type: 'check', get: () => Settings.gfx.lowLatency, set: v => { Settings.gfx.lowLatency = v; },
      hint: 'Draws straight to the screen to cut input lag. Applies after a reload.' }
];

const CTL_ITEMS = [
    { section: 'Touch' },
    { label: 'Touch controls', type: 'select', options: [['auto', 'Auto (touch screens)'], ['on', 'Always on'], ['off', 'Off']],
      get: () => Settings.ctl.touchUI, set: v => { Settings.ctl.touchUI = v; if (typeof TouchUI !== 'undefined') TouchUI.apply(); } },
    { label: 'Steering', type: 'select', options: [['slider', 'Rudder slider'], ['wheel', 'Ship’s wheel'], ['gyro', 'Tilt the phone (gyro)']],
      get: () => Settings.ctl.steering, set: v => { Settings.ctl.steering = v; if (typeof TouchUI !== 'undefined') TouchUI.apply(); } },
    { label: 'Rudder slider stays put', type: 'check', get: () => Settings.ctl.stickyRudder, set: v => { Settings.ctl.stickyRudder = v; },
      disabled: () => Settings.ctl.steering !== 'slider' },
    { label: 'Gyro aim (captain & AA views)', type: 'check', get: () => Settings.ctl.aimGyro, set: v => { Settings.ctl.aimGyro = v; if (v && typeof Gyro !== 'undefined') Gyro.request(); } },
    { label: 'Gyro sensitivity', min: 0.3, max: 2.5, step: 0.05, fmt: v => v.toFixed(2) + 'x', get: () => Settings.ctl.gyroSens, set: v => { Settings.ctl.gyroSens = v; },
      disabled: () => Settings.ctl.steering !== 'gyro' && !Settings.ctl.aimGyro },
    { label: 'Recentre gyro', type: 'button', action: () => { if (typeof Gyro !== 'undefined') Gyro.calibrate(); },
      hidden: () => Settings.ctl.steering !== 'gyro' && !Settings.ctl.aimGyro },
    { label: 'Left-handed (throttle on the right)', type: 'check', get: () => Settings.ctl.leftHanded, set: v => { Settings.ctl.leftHanded = v; if (typeof TouchUI !== 'undefined') TouchUI.apply(); } },
    { label: 'Button size', min: 0.7, max: 1.5, step: 0.05, fmt: pct, get: () => Settings.ctl.btnScale, set: v => { Settings.ctl.btnScale = v; if (typeof TouchUI !== 'undefined') TouchUI.apply(); } },
    { label: 'Vibration', type: 'check', get: () => Settings.ctl.haptics, set: v => { Settings.ctl.haptics = v; } },
    { section: 'Aiming & camera' },
    { label: 'Look / aim sensitivity', min: 0.3, max: 2.5, step: 0.05, fmt: v => v.toFixed(2) + 'x', get: () => Settings.ctl.lookSens, set: v => { Settings.ctl.lookSens = v; } },
    { section: 'Ship' },
    { label: 'AI gunners on the 40 mm / 20 mm', type: 'check', get: () => Settings.ctl.aaAuto, set: v => { Settings.ctl.aaAuto = v; },
      hint: 'They engage aircraft on their own while you are not on a gun.' },
    { label: 'Air raids', type: 'select', options: [['off', 'Off'], ['occasional', 'Now and then'], ['frequent', 'Frequent']],
      get: () => Settings.ctl.airRaids, set: v => { Settings.ctl.airRaids = v; if (typeof Air !== 'undefined' && v === 'frequent') Air.raidIn = Math.min(Air.raidIn, 45); } },
    { label: 'Engine-order telegraph bell', type: 'check', get: () => Settings.ctl.bell, set: v => { Settings.ctl.bell = v; } }
];

function initSettingsUI() {
    buildPane($('tab_gfx'), GFX_ITEMS);
    buildPane($('tab_ctl'), CTL_ITEMS);
    document.querySelectorAll('#settingsMenu .tab').forEach(b => b.addEventListener('click', () => {
        document.querySelectorAll('#settingsMenu .tab').forEach(x => x.classList.toggle('on', x === b));
        document.querySelectorAll('#settingsMenu .tabpane').forEach(x => x.classList.toggle('on', x.id === 'tab_' + b.dataset.tab));
    }));
    refreshSettingsUI();
}
