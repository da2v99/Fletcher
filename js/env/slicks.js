// Oil and fuel on the sea: a ship holed at the waterline bleeds a slick, a sinking one leaves a spreading
// black stain over the spot, and a burst fuel bunker can set the water itself alight for a while. The ocean
// shader draws them (OCEAN_SHADE_GLSL): a dark film with a rainbow sheen at its thin, ragged edges, glassy
// where it smooths the ripples. They spread, drift downwind and thin out over a few minutes.
const SLICK_N = 16;
const SLICK_U = { uSlick: { value: Array.from({ length: SLICK_N }, () => new THREE.Vector4(0, 0, 0, 0)) } };

const Slicks = (() => {
    const list = [], _v = new THREE.Vector3();

    // r: how far it will have spread in the first minute or so (m). opts.burn: seconds the fuel on it burns;
    // opts.grow: how much further it creeps out after that; opts.amount: how black it is (0..1)
    function spill(x, z, r, opts = {}) {
        // Close to a slick already there: feed that one instead of stacking another on top
        const near = list.find(s => Math.hypot(s.x - x, s.z - z) < radius(s) * 0.6);
        if (near) {
            near.r = Math.max(near.r, Math.hypot(near.r, r));
            near.amt = Math.min(1, near.amt + 0.15);
            near.age = Math.min(near.age, near.life * 0.3);
            near.burn = Math.max(near.burn, opts.burn || 0);
            return;
        }
        if (list.length >= 40) { list.sort((a, b) => a.amt - b.amt); list.shift(); }
        list.push({ x, z, r, grow: opts.grow || 1.8, age: 0, life: opts.life || rnd(240, 420), amt: opts.amount || rnd(0.75, 1), burn: opts.burn || 0, acc: 0 });
    }
    const radius = s => s.r * (0.3 + (s.grow - 0.3) * (1 - Math.exp(-s.age / 70)));
    const strength = s => s.amt * Math.min(1, s.age * 1.5) * (1 - smooth(s.life * 0.55, s.life, s.age));

    function update(dt, t) {
        const wx = Sea.wind.x * 0.45, wz = Sea.wind.y * 0.45, cam = camera.position;
        for (let i = list.length - 1; i >= 0; i--) {
            const s = list[i];
            s.age += dt;
            s.x += wx * dt; s.z += wz * dt;
            if (s.age > s.life) { list.splice(i, 1); continue; }
            // Burning fuel: flames and black smoke spread over the middle of the slick, dying down at the end
            if (s.burn > 0 && dt > 0) {
                s.burn -= dt;
                const R = radius(s), d2 = (s.x - cam.x) ** 2 + (s.z - cam.z) ** 2;
                if (d2 > 4000 * 4000) continue;
                s.acc += dt * Math.min(22, 5 + R * 0.25) * Gfx.particleKeep;
                while (s.acc > 1) {
                    s.acc -= 1;
                    const a = Math.random() * 6.283, rr = Math.sqrt(Math.random()) * R * 0.65;
                    const x = s.x + Math.cos(a) * rr, z = s.z + Math.sin(a) * rr;
                    FX.burn(_v.set(x, waterHeight(x, z, t) + 0.2, z), 0.45 + 0.55 * Math.min(1, s.burn / 12));
                }
            }
        }
        // The nearest ones go to the sea shader
        const U = SLICK_U.uSlick.value;
        const by = list.map(s => [s, (s.x - cam.x) ** 2 + (s.z - cam.z) ** 2]).sort((a, b) => a[1] - b[1]);
        for (let i = 0; i < SLICK_N; i++) {
            const e = by[i];
            if (e) U[i].set(e[0].x, e[0].z, radius(e[0]), strength(e[0])); else U[i].set(0, 0, 0, 0);
        }
    }

    function clear() { list.length = 0; SLICK_U.uSlick.value.forEach(v => v.set(0, 0, 0, 0)); }

    return { spill, update, clear, get count() { return list.length; } };
})();
