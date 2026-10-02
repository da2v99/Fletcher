// The night sky: every star its own point, drawn crisp at the screen's own resolution (not baked into the
// cloud cube, which is only a few hundred texels a face). About 14,000 stars: magnitudes follow the real counts
// (each magnitude fainter has roughly three times as many), colours run from blue-white to orange by
// temperature, and the Milky Way is a band of faint stars crowded along a tilted great circle, with a dark rift
// down its middle. They fade in as the sun goes down, twinkle near the horizon, dim in the horizon haze and
// hide behind the clouds (sampled from the same cloud cube the sky shows).

const Stars = (() => {
    let points = null;
    const U = { uPx: { value: 1 }, uVis: { value: 0 } };

    function build(cubeTex) {
        const N = 14000;
        const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), mag = new Float32Array(N), ph = new Float32Array(N);
        // Galactic plane: a great circle tilted ~60° to the celestial equator, as it rises in the tropics
        const gN = new THREE.Vector3(0.35, 0.5, 0.79).normalize();
        const gA = new THREE.Vector3().crossVectors(gN, new THREE.Vector3(0, 1, 0)).normalize();
        const gB = new THREE.Vector3().crossVectors(gN, gA);
        const v = new THREE.Vector3();
        const tint = t => {   // 0 hot blue-white .. 1 cool orange
            const c = new THREE.Color().setRGB(0.72 + 0.28 * t, 0.8 + 0.08 * Math.sin(t * 3), 1.0 - 0.45 * t);
            return c;
        };
        for (let i = 0; i < N; i++) {
            const band = i > N * 0.45;
            if (band) {
                // Milky Way: along the circle, gaussian across it, thinned along the dark rift
                const a = Math.random() * Math.PI * 2;
                let lat = randn() * 0.09;
                if (Math.abs(lat) < 0.025 && Math.sin(a * 2.0 + 0.6) > 0.1 && Math.random() < 0.7) lat += Math.sign(lat || 1) * 0.05;
                v.copy(gA).multiplyScalar(Math.cos(a)).addScaledVector(gB, Math.sin(a)).addScaledVector(gN, lat).normalize();
            } else {
                v.set(randn(), randn(), randn()).normalize();
            }
            if (v.y < -0.08) v.y = -v.y;   // keep them where they can be seen
            pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
            // Magnitude: inverse of N(<m) ~ 10^(0.47 m); the band is mostly faint background
            const u = Math.random();
            mag[i] = band ? 4.6 + u * 1.8 : Math.min(6.4, Math.log10(1 + u * 2600) / 0.47 - 0.6);
            const c = tint(Math.pow(Math.random(), 1.6));
            col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
            ph[i] = Math.random() * 100;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('scol', new THREE.BufferAttribute(col, 3));
        geo.setAttribute('smag', new THREE.BufferAttribute(mag, 1));
        geo.setAttribute('sph', new THREE.BufferAttribute(ph, 1));
        const mat = new THREE.ShaderMaterial({
            uniforms: Object.assign({ uSkyCube: { value: cubeTex } }, U, WEATHER_U),
            vertexShader: `
                attribute vec3 scol;
                attribute float smag;
                attribute float sph;
                uniform float uPx;
                uniform float uTime;
                varying vec3 vCol;
                varying vec3 vDir;
                varying float vB;
                void main() {
                    vDir = position;
                    // Brightness from magnitude (range compressed, as the eye does at night), a little scintillation
                    // that grows toward the horizon
                    float b = pow(2.512, (2.2 - smag) * 0.45);
                    float tw = 1.0 + (0.12 + 0.4 * (1.0 - smoothstep(0.0, 0.35, position.y))) * sin(uTime * (5.0 + fract(sph) * 9.0) + sph);
                    vB = b * tw;
                    vCol = scol;
                    // Bright stars get a slightly larger disc; the faint ones stay a pixel or two (enough to survive FXAA)
                    gl_PointSize = uPx * clamp(1.6 + 1.4 * sqrt(b), 1.6, 4.6);
                    vec4 mv = modelViewMatrix * vec4(position * 30000.0, 1.0);
                    gl_Position = projectionMatrix * mv;
                }`,
            fragmentShader: `
                uniform samplerCube uSkyCube;
                uniform float uVis;
                varying vec3 vCol;
                varying vec3 vDir;
                varying float vB;
                void main() {
                    vec2 q = gl_PointCoord * 2.0 - 1.0;
                    float r2 = dot(q, q);
                    if (r2 > 1.0) discard;
                    float core = exp(-r2 * 3.2);
                    vec3 d = normalize(vDir);
                    float cloud = smoothstep(0.12, 0.65, textureCube(uSkyCube, d).a);
                    float haze = smoothstep(-0.01, 0.2, d.y);
                    float a = core * min(vB * 1.35, 3.0) * uVis * (1.0 - cloud) * haze;
                    if (a < 0.004) discard;
                    gl_FragColor = vec4(vCol * a, 1.0);
                }`,
            transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false
        });
        points = new THREE.Points(geo, mat);
        points.frustumCulled = false;
        points.renderOrder = -0.5;
        return points;
    }

    function update() {
        if (!points) return;
        points.position.copy(camera.position);
        // Visible from late civil twilight; a storm deck hides them almost entirely
        U.uVis.value = smooth(0.0, -0.16, SUN_DIR.y) * (1 - 0.85 * weather.storm) * 0.95;
        points.visible = U.uVis.value > 0.003;
        U.uPx.value = Math.max(1, Math.min(Device.dpr, Settings.gfx.maxDpr) * Gfx.scale);   // device pixels per CSS pixel
    }

    return { build, update, get points() { return points; } };
})();
