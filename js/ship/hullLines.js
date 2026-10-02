// Hull form of the Fletcher class: sheer, keel, sections, stem/stern, and the hull/deck meshes.

// --- Hull lines ---

// Main deck height (sheer) — rises strongly toward the bow, lowest point just aft of midships
function sheerY(z) {
    const zl = -14;
    if (z >= zl) { const t = (z - zl) / (HALF_L - zl); return 3.4 + 2.9 * t * t; }
    const t = (zl - z) / (HALF_L + zl);
    return 3.4 + 0.35 * t * t;
}
const lvl1 = z => sheerY(z) + LVL1_H;

// Keel line — flat, rising aft into the run over the propellers
function keelY(z) {
    if (z >= -28) return KEEL_Y;
    const u = clamp01((-28 - z) / (HALF_L - 28));
    return KEEL_Y + 3.7 * u * u;
}

// Deck-edge half-breadth as a fraction of the max beam
function deckPlan(z) {
    if (z > 5) {
        const u = clamp01((z - 5) / (HALF_L - 5));
        return 1 - Math.pow(u, 2.2);
    }
    if (z < -20) {
        const u = clamp01((-20 - z) / (HALF_L - 20));
        if (u < 0.88) return 1 - 0.3 * Math.pow(u / 0.88, 2);
        const k = (u - 0.88) / 0.12;
        return 0.7 * Math.sqrt(Math.max(0, 1 - k * k));   // rounded stern
    }
    return 1;
}

// Half-breadth of a hull section at station z, height fraction t (0 = keel, 1 = deck edge)
function sectionX(zs, t) {
    const Wd = HALF_B * deckPlan(zs);
    const b = smooth(8, 54, zs);      // bow-ness
    const a = smooth(-24, -54, zs);   // stern-ness
    const n = lerp(lerp(4.0, 1.35, b), 2.6, a);      // bilge fullness (high = boxy, low = V)
    const tb = lerp(lerp(0.3, 0.72, b), 0.4, a);     // top of the bilge curve
    const flare = lerp(1.0, 0.62, Math.pow(b, 1.3)) * lerp(1, 0.94, a);
    const Wl = Wd * flare;
    if (t < tb) {
        const k = 1 - t / tb;
        return Wl * Math.pow(1 - Math.pow(k, n), 1 / n);
    }
    const k = (t - tb) / (1 - tb);
    return Wl + (Wd - Wl) * Math.pow(k, 1.5);
}

// Raked stem with a rounded forefoot, and a slightly raked rounded stern
function stemZ(y) {
    const top = sheerY(HALF_L);
    if (y >= 0) return HALF_L - (top - y) * 0.36;
    const k = clamp01(y / KEEL_Y);
    const zWl = HALF_L - top * 0.36;
    return 46 + (zWl - 46) * Math.sqrt(1 - k * k);
}
function sternZ(y) { return -HALF_L + (sheerY(-HALF_L) - y) * 0.3; }

// Station z -> actual vertex z (bends the ends into stem / stern profiles)
function warpZ(zs, y) {
    let z = zs;
    if (zs > 30) {
        const w = Math.pow((zs - 30) / (HALF_L - 30), 1.3);
        z += (stemZ(y) - stemZ(sheerY(zs))) * w;
    }
    if (zs < -45) {
        const w = Math.pow((-45 - zs) / (HALF_L - 45), 1.3);
        z += (sternZ(y) - sternZ(sheerY(zs))) * w;
    }
    return z;
}

// Hull surface half-width at a given station / absolute height (for placing fittings)
function hullX(zs, y) {
    const bot = keelY(zs), top = sheerY(zs);
    return sectionX(zs, clamp01((y - bot) / (top - bot)));
}
const deckHalfWidth = z => HALF_B * deckPlan(z);

function createHullGeometry() {
    const NS = 240, NT = 32;
    const pos = [], idx = [];
    [1, -1].forEach((side, sIdx) => {
        const base = sIdx * (NS + 1) * (NT + 1);
        for (let i = 0; i <= NS; i++) {
            const zs = -HALF_L + SHIP_LENGTH * i / NS;
            const top = sheerY(zs), bot = keelY(zs);
            for (let j = 0; j <= NT; j++) {
                const t = j / NT;
                const y = bot + (top - bot) * t;
                pos.push(side * sectionX(zs, t), y, warpZ(zs, y));
            }
        }
        for (let i = 0; i < NS; i++) {
            for (let j = 0; j < NT; j++) {
                const a = base + i * (NT + 1) + j, b = a + NT + 1;
                if (side > 0) idx.push(a, b, b + 1, a, b + 1, a + 1);
                else idx.push(a, b + 1, b, a, a + 1, b + 1);
            }
        }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
}

function createDeckGeometry() {
    const NS = 240, NX = 12;
    const pos = [], idx = [];
    for (let i = 0; i <= NS; i++) {
        const zs = -HALF_L + SHIP_LENGTH * i / NS;
        const Wd = deckHalfWidth(zs), ys = sheerY(zs);
        for (let j = 0; j <= NX; j++) {
            const f = -1 + 2 * j / NX;
            pos.push(f * Wd, ys + 0.12 * (1 - f * f) * Math.min(1, Wd / 3), zs);   // deck camber
        }
    }
    for (let i = 0; i < NS; i++) {
        for (let j = 0; j < NX; j++) {
            const a = i * (NX + 1) + j, b = a + NX + 1;
            idx.push(a, b, b + 1, a, b + 1, a + 1);
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
}

// Hull number decal painted directly in the hull shader (no z-fighting on the flared bow)
function createHullNumberTexture() {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 180;
    const ctx = c.getContext('2d');
    ctx.font = 'bold 168px "Arial Narrow", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#111';
    ctx.fillText(HULL_NUMBER, 262, 98);
    ctx.fillStyle = '#e8e8e2';
    ctx.fillText(HULL_NUMBER, 254, 92);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    return tex;
}

function createHullMaterial() {
    const numberTex = createHullNumberTexture();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65, metalness: 0.1, side: THREE.DoubleSide });
    const glslSheer = `
        float hullSheer(float z) {
            float zl = -14.0;
            if (z >= zl) { float t = (z - zl) / (${HALF_L.toFixed(3)} - zl); return 3.4 + 2.9 * t * t; }
            float t = (zl - z) / (${HALF_L.toFixed(3)} + zl); return 3.4 + 0.35 * t * t;
        }`;
    mat.onBeforeCompile = (shader) => {
        shader.uniforms.hullNumberMap = { value: numberTex };
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            '#include <common>\nvarying vec3 vLocalPos;\n'
        ).replace(
            '#include <begin_vertex>',
            '#include <begin_vertex>\nvLocalPos = position;\n'
        );

        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            '#include <common>\nvarying vec3 vLocalPos;\nuniform sampler2D hullNumberMap;\n' + glslSheer
        ).replace(
            'vec4 diffuseColor = vec4( diffuse, opacity );',
            `
            float y = vLocalPos.y;
            float z = vLocalPos.z;
            vec3 hazeGray = ${glslColor(HAZE_GRAY)};
            vec3 navyBlue = ${glslColor(NAVY_BLUE)};
            vec3 customColor;

            // Measure 22: navy blue up to the lowest point of the sheer, haze gray above
            if (y < -0.08)      customColor = ${glslColor(HULL_RED)};   // anti-fouling red
            else if (y < 0.32)  customColor = vec3(0.05, 0.05, 0.055);  // boot topping
            else if (y < 3.38)  customColor = navyBlue;
            else                customColor = hazeGray;

            // Scuttles (portholes) along the crew spaces
            float py = hullSheer(z) - 0.95;
            if ((z > 8.0 && z < 40.0) || (z > -33.0 && z < -17.0)) {
                float c = mod(z, 1.6) - 0.8;
                float d = length(vec2(c, y - py));
                if (d < 0.13) customColor = vec3(0.02);
                else if (d < 0.17 && y > py) customColor *= 0.75;   // rigol / eyebrow shading
            }

            // Hull number on both bows, reading correctly from each side
            vec2 nuv = vec2((z - 41.5) / 6.0, (y - 2.3) / 2.1);
            if (vLocalPos.x > 0.0) nuv.x = 1.0 - nuv.x;
            if (nuv.x > 0.0 && nuv.x < 1.0 && nuv.y > 0.0 && nuv.y < 1.0) {
                vec4 tc = texture2D(hullNumberMap, nuv);
                customColor = mix(customColor, tc.rgb, tc.a);
            }

            vec4 diffuseColor = vec4( customColor, opacity );
            `
        );
    };
    return mat;
}

// What you see through a hole in the hull: transverse frames every 1.2 m standing in from the plating, watertight
// bulkheads, and the platform deck over the machinery and magazines. Never seen otherwise (the hull hides it).
function createHullInterior() {
    const pos = [];
    const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    const NT = 14;
    for (let zs = -50; zs <= 52; zs += 1.2) {
        const bot = keelY(zs), top = sheerY(zs) - 0.1;
        if (top - bot < 1) continue;
        [1, -1].forEach(side => {
            for (let j = 0; j < NT; j++) {
                const t0 = 0.04 + 0.92 * j / NT, t1 = 0.04 + 0.92 * (j + 1) / NT;
                const y0 = bot + (top - bot) * t0, y1 = bot + (top - bot) * t1;
                const x0 = side * (sectionX(zs, t0) - 0.04), x1 = side * (sectionX(zs, t1) - 0.04);
                const w = 0.28;   // the frame's web, standing in from the plating
                quad([x0, y0, zs], [x1, y1, zs], [x1 - side * w, y1, zs], [x0 - side * w, y0, zs]);
            }
        });
    }
    // Watertight bulkheads
    [-40, -28, -14, -1, 12, 26, 38].forEach(zs => {
        const bot = keelY(zs) + 0.05, top = sheerY(zs) - 0.12;
        for (let j = 0; j < NT; j++) {
            const t0 = j / NT, t1 = (j + 1) / NT;
            const y0 = bot + (top - bot) * t0, y1 = bot + (top - bot) * t1;
            const w0 = hullX(zs, y0) - 0.05, w1 = hullX(zs, y1) - 0.05;
            quad([-w0, y0, zs], [w0, y0, zs], [w1, y1, zs], [-w1, y1, zs]);
        }
    });
    // Platform deck
    const yp = 0.9;
    for (let zs = -46; zs < 48; zs += 2) {
        const w0 = hullX(zs, yp) - 0.05, w1 = hullX(zs + 2, yp) - 0.05;
        quad([-w0, yp, zs], [w0, yp, zs], [w1, yp, zs + 2], [-w1, yp, zs + 2]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
}

// A simpler inside for the enemy hulls (box-section amidships, where the plating runs straight)
function createBoxInterior(len, beam, draft, deck) {
    const pos = [];
    const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    const zl = len * 0.29, hw = beam / 2 - 0.25, y0 = -draft + 0.3, y1 = deck - 0.2;
    for (let z = -zl; z <= zl; z += 1.3) {
        [1, -1].forEach(s => quad([s * hw, y0, z], [s * hw, y1, z], [s * (hw - 0.3), y1, z], [s * (hw - 0.3), y0, z]));
    }
    for (let z = -zl; z <= zl + 0.01; z += len / 7) quad([-hw, y0, z], [hw, y0, z], [hw, y1, z], [-hw, y1, z]);
    quad([-hw, 0.6, -zl], [hw, 0.6, -zl], [hw, 0.6, zl], [-hw, 0.6, zl]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
}
