// Rendering setup: the WebGL context, render resolution (scaled on the fly to hold the frame rate), shadows,
// and the cinematic post-processing chain: bloom, light shafts, sun flare, filmic colour grade, vignette,
// film grain, letterbox and FXAA. Everything follows Settings.gfx and can change while playing.

const Gfx = (() => {
    let post = null;                                    // post-processing resources, null when off
    const dyn = { scale: 1, avg: 1000 / 60, t: 0, good: 0 };
    let fpsEl = null, fpsT = 0, fpsN = 0, fpsVal = 0;
    let lost = false;

    // --- Context: low-latency hint, WebGL2 when available, and a graceful exit if the GPU resets ---
    function createRenderer() {
        const canvas = document.createElement('canvas');
        const attrs = {
            alpha: false, antialias: true, depth: true, stencil: false, premultipliedAlpha: true,
            preserveDrawingBuffer: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false,
            desynchronized: !!Settings.gfx.lowLatency
        };
        let gl = null;
        try { gl = canvas.getContext('webgl2', attrs); } catch (e) { gl = null; }
        if (!gl) gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
        const r = new THREE.WebGLRenderer({ canvas, context: gl || undefined, antialias: true, powerPreference: 'high-performance' });
        canvas.addEventListener('webglcontextlost', e => {
            e.preventDefault();
            lost = true;
            // A phone GPU watchdog usually means the settings were too heavy: drop a preset level and reload
            const order = ['low', 'medium', 'high', 'ultra', 'cinematic'];
            const cur = order.indexOf(Settings.gfx.preset === 'auto' ? autoPreset() : Settings.gfx.preset);
            if (cur > 0) { Settings.applyPreset(order[cur - 1]); Settings.save(); }
            const el = document.getElementById('gfxReset');
            if (el) el.classList.add('show');
        });
        canvas.addEventListener('webglcontextrestored', () => setTimeout(() => location.reload(), 300));
        return r;
    }

    const VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
    const mat = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });

    function makePost() {
        const p = {};
        const isGL2 = renderer.capabilities.isWebGL2;
        const opts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: true, stencilBuffer: false };
        if (Settings.gfx.aa === 'msaa' && isGL2 && THREE.WebGLMultisampleRenderTarget) {
            p.scene = new THREE.WebGLMultisampleRenderTarget(4, 4, opts);
            p.scene.samples = 4;
        } else p.scene = new THREE.WebGLRenderTarget(4, 4, opts);
        const small = Object.assign({}, opts, { depthBuffer: false });
        p.lv = [0, 1, 2].map(() => [new THREE.WebGLRenderTarget(4, 4, small), new THREE.WebGLRenderTarget(4, 4, small)]);
        p.shaft = new THREE.WebGLRenderTarget(4, 4, small);
        p.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        p.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
        p.quad.frustumCulled = false;
        p.scn = new THREE.Scene();
        p.scn.add(p.quad);

        p.bright = mat(`
            uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold;
            varying vec2 vUv;
            void main() {
                vec3 c = (texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb +
                          texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb) * 0.25;
                float l = max(c.r, max(c.g, c.b));
                gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold + 0.3, l), 1.0);
            }`, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0.72 } });
        p.blur = mat(`
            uniform sampler2D tSrc; uniform vec2 uDir;
            varying vec2 vUv;
            void main() {
                vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270270;
                c += (texture2D(tSrc, vUv + uDir * 1.3846153846).rgb + texture2D(tSrc, vUv - uDir * 1.3846153846).rgb) * 0.3162162162;
                c += (texture2D(tSrc, vUv + uDir * 3.2307692308).rgb + texture2D(tSrc, vUv - uDir * 3.2307692308).rgb) * 0.0702702703;
                gl_FragColor = vec4(c, 1.0);
            }`, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
        p.down = mat(`
            uniform sampler2D tSrc; uniform vec2 uTexel;
            varying vec2 vUv;
            void main() {
                gl_FragColor = vec4((texture2D(tSrc, vUv + uTexel * vec2(-0.5, -0.5)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.5, -0.5)).rgb +
                                     texture2D(tSrc, vUv + uTexel * vec2(-0.5, 0.5)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.5, 0.5)).rgb) * 0.25, 1.0);
            }`, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
        // Crepuscular rays: radial blur of the bright sky toward the sun's place on screen
        p.shafts = mat(`
            uniform sampler2D tSrc; uniform vec2 uSun; uniform float uLen;
            varying vec2 vUv;
            void main() {
                vec2 d = (vUv - uSun) * uLen / 28.0;
                vec2 uv = vUv;
                float w = 1.0;
                vec3 acc = vec3(0.0);
                for (int i = 0; i < 28; i++) {
                    uv -= d;
                    acc += texture2D(tSrc, uv).rgb * w;
                    w *= 0.95;
                }
                gl_FragColor = vec4(acc / 14.0, 1.0);
            }`, { tSrc: { value: null }, uSun: { value: new THREE.Vector2() }, uLen: { value: 0.75 } });
        p.comp = mat(`
            uniform sampler2D tScene, tB0, tB1, tB2, tShaft;
            uniform vec2 uTexel;
            uniform float uBloom, uShaft, uVig, uGrain, uTime, uBars, uFxaa, uAspect, uGrade, uFlare, uExposure;
            uniform vec2 uSun;
            uniform vec3 uSunCol;
            varying vec2 vUv;

            float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
            vec3 fxaa(vec2 uv) {
                vec3 rgbNW = texture2D(tScene, uv + vec2(-1.0, -1.0) * uTexel).rgb;
                vec3 rgbNE = texture2D(tScene, uv + vec2(1.0, -1.0) * uTexel).rgb;
                vec3 rgbSW = texture2D(tScene, uv + vec2(-1.0, 1.0) * uTexel).rgb;
                vec3 rgbSE = texture2D(tScene, uv + vec2(1.0, 1.0) * uTexel).rgb;
                vec3 rgbM = texture2D(tScene, uv).rgb;
                vec3 L = vec3(0.299, 0.587, 0.114);
                float lNW = dot(rgbNW, L), lNE = dot(rgbNE, L), lSW = dot(rgbSW, L), lSE = dot(rgbSE, L), lM = dot(rgbM, L);
                float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
                float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
                vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
                float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
                float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
                dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * uTexel;
                vec3 a = 0.5 * (texture2D(tScene, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tScene, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
                vec3 b = a * 0.5 + 0.25 * (texture2D(tScene, uv - dir * 0.5).rgb + texture2D(tScene, uv + dir * 0.5).rgb);
                float lB = dot(b, L);
                return (lB < lMin || lB > lMax) ? a : b;
            }
            vec3 softClip(vec3 c) {   // filmic shoulder: highlights roll off instead of clipping
                vec3 k = max(c - 0.78, 0.0);
                return min(c, 0.78) + 0.22 * (1.0 - exp(-k / 0.22));
            }
            vec3 grade(vec3 c) {
                float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
                if (uGrade < 0.5) {                       // natural: a gentle S-curve
                    c = mix(c, c * c * (3.0 - 2.0 * c), 0.25);
                    return mix(vec3(l), c, 1.06);
                }
                if (uGrade < 1.5) {                       // cinematic: teal shadows, warm highlights, more contrast
                    c = mix(c, c * c * (3.0 - 2.0 * c), 0.42);
                    float sh = 1.0 - smoothstep(0.0, 0.45, l), hi = smoothstep(0.45, 1.0, l);
                    c += vec3(-0.02, 0.012, 0.035) * sh + vec3(0.045, 0.02, -0.03) * hi;
                    return mix(vec3(l), c, 1.12);
                }
                // filmic: lifted blacks, muted shadows, warm golden highlights, strong curve
                c = mix(c, c * c * (3.0 - 2.0 * c), 0.55);
                float sh = 1.0 - smoothstep(0.0, 0.5, l), hi = smoothstep(0.5, 1.0, l);
                c = mix(c, vec3(l), sh * 0.25);
                c += vec3(-0.015, 0.01, 0.03) * sh + vec3(0.06, 0.03, -0.035) * hi;
                c = c * 0.94 + 0.03;
                return mix(vec3(l), c, 1.05);
            }
            void main() {
                vec2 uv = vUv;
                vec3 c = uFxaa > 0.5 ? fxaa(uv) : texture2D(tScene, uv).rgb;
                c *= uExposure;
                vec3 bloom = texture2D(tB0, uv).rgb * 0.45 + texture2D(tB1, uv).rgb * 0.7 + texture2D(tB2, uv).rgb * 0.9;
                c += bloom * uBloom;
                c += texture2D(tShaft, uv).rgb * uShaft * (0.6 + 0.4 * uSunCol);
                if (uFlare > 0.0) {   // anamorphic streak and ghosts from the sun
                    vec2 s = uSun;
                    vec2 d = uv - s; d.x *= uAspect;
                    float streak = exp(-abs(d.y) * 260.0) * exp(-abs(d.x) * 2.2);
                    float halo = exp(-length(d) * 9.0) * 0.6;
                    vec2 g1 = uv - (vec2(0.5) + (vec2(0.5) - s) * 0.6), g2 = uv - (vec2(0.5) + (vec2(0.5) - s) * 1.3);
                    g1.x *= uAspect; g2.x *= uAspect;
                    float ghosts = smoothstep(0.05, 0.0, length(g1)) * 0.25 + smoothstep(0.09, 0.03, length(g2)) * 0.12;
                    c += uSunCol * uFlare * (streak * 0.5 + halo * 0.35 + ghosts * vec3(0.6, 0.85, 1.0));
                }
                c = softClip(c);
                c = clamp(grade(c), 0.0, 1.0);
                vec2 q = uv - 0.5; q.x *= uAspect;
                c *= 1.0 - uVig * smoothstep(0.3, 1.05, length(q) * 1.1);
                c += (hash(uv * 1733.0 + fract(uTime * 7.31) * 91.0) - 0.5) * uGrain;
                if (uBars > 0.0 && abs(uv.y - 0.5) > 0.5 - uBars) c = vec3(0.0);
                gl_FragColor = vec4(c, 1.0);
            }`, {
            tScene: { value: null }, tB0: { value: null }, tB1: { value: null }, tB2: { value: null }, tShaft: { value: null },
            uTexel: { value: new THREE.Vector2() }, uBloom: { value: 0.5 }, uShaft: { value: 0 }, uVig: { value: 0.4 }, uGrain: { value: 0.03 },
            uTime: { value: 0 }, uBars: { value: 0 }, uFxaa: { value: 1 }, uAspect: { value: 1 }, uGrade: { value: 1 }, uFlare: { value: 0 },
            uExposure: { value: 1 }, uSun: { value: new THREE.Vector2(-9, -9) }, uSunCol: { value: new THREE.Color(1, 1, 1) }
        });
        return p;
    }

    function disposePost() {
        if (!post) return;
        post.scene.dispose();
        post.lv.forEach(l => l.forEach(t => t.dispose()));
        post.shaft.dispose();
        [post.bright, post.blur, post.down, post.shafts, post.comp].forEach(m => m.dispose());
        post.quad.geometry.dispose();
        post = null;
    }

    // Sizes for the current window, preset and dynamic scale
    function resize() {
        const g = Settings.gfx;
        const dpr = Math.min(Device.dpr, g.maxDpr);
        const s = g.renderScale * (g.dynamicRes ? dyn.scale : 1);
        const W = window.innerWidth, H = window.innerHeight;
        if (post) {
            renderer.setPixelRatio(dpr);
            renderer.setSize(W, H);
            const w = Math.max(64, Math.round(W * dpr * s)), h = Math.max(64, Math.round(H * dpr * s));
            post.scene.setSize(w, h);
            const l0 = [Math.max(8, w >> 2), Math.max(8, h >> 2)];
            post.lv.forEach((lv, i) => lv.forEach(t => t.setSize(Math.max(4, l0[0] >> i), Math.max(4, l0[1] >> i))));
            post.shaft.setSize(l0[0], l0[1]);
            post.w = w; post.h = h;
        } else {
            renderer.setPixelRatio(dpr * s);
            renderer.setSize(W, H);
        }
        camera.aspect = W / H;
        camera.updateProjectionMatrix();
    }

    // Push every graphics setting into the scene
    function apply() {
        const g = Settings.gfx;
        // Shadows
        const sz = [0, 1024, 2048, 4096][g.shadows] || 0;
        const wasOn = renderer.shadowMap.enabled;
        renderer.shadowMap.enabled = sz > 0;
        renderer.shadowMap.type = g.shadows >= 2 ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
        sunLight.castShadow = sz > 0;
        if (sz && sunLight.shadow.mapSize.x !== sz) {
            sunLight.shadow.mapSize.set(sz, sz);
            if (sunLight.shadow.map) { sunLight.shadow.map.dispose(); sunLight.shadow.map = null; }
        }
        if (wasOn !== renderer.shadowMap.enabled) scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; }); });
        // Sky, sea, particles
        Clouds.setQuality(g.clouds);
        if (ocean && ocean.userData.quality !== g.ocean) rebuildOcean(g.ocean);
        // Post-processing on/off, MSAA change needs new targets
        const wantPost = !!g.post;
        if (post && (!wantPost || (post.scene.isWebGLMultisampleRenderTarget ? 'msaa' : 'x') !== (g.aa === 'msaa' ? 'msaa' : 'x'))) disposePost();
        if (wantPost && !post) post = makePost();
        if (!g.dynamicRes) dyn.scale = 1;
        if (g.fps && !fpsEl) {
            fpsEl = document.createElement('div');
            fpsEl.id = 'fpsMeter';
            document.body.appendChild(fpsEl);
        }
        if (fpsEl) fpsEl.style.display = g.fps ? 'block' : 'none';
        document.body.classList.toggle('letterbox', !!g.letterbox && wantPost);
        resize();
    }

    // Dynamic resolution: lower the render scale when frames run long, creep back up when there's headroom
    function adapt(dtMs) {
        const g = Settings.gfx;
        dyn.avg += (Math.min(dtMs, 100) - dyn.avg) * 0.08;
        fpsN++; fpsT += dtMs;
        if (fpsT > 500) {
            fpsVal = fpsN * 1000 / fpsT;
            fpsN = 0; fpsT = 0;
            if (fpsEl && g.fps) {
                const s = g.renderScale * (g.dynamicRes ? dyn.scale : 1);
                fpsEl.textContent = `${Math.round(fpsVal)} fps · ${Math.round(s * 100)}% res${renderer.capabilities.isWebGL2 ? '' : ' · WebGL1'}`;
            }
        }
        if (!g.dynamicRes) return;
        dyn.t += dtMs;
        if (dyn.t < 600) return;
        dyn.t = 0;
        const target = 1000 / g.targetFps;
        let ns = dyn.scale;
        if (dyn.avg > target * 1.22) { ns = Math.max(0.5, dyn.scale * 0.88); dyn.good = 0; }
        else if (dyn.avg < target * 1.06) { if (++dyn.good >= 5 && dyn.scale < 1) { ns = Math.min(1, dyn.scale * 1.07); dyn.good = 0; } }
        else dyn.good = 0;
        if (Math.abs(ns - dyn.scale) > 0.01) { dyn.scale = ns; resize(); }
    }

    const _sun = new THREE.Vector3();
    function render(dtMs, t) {
        if (lost) return;
        adapt(dtMs);
        if (!post) { renderer.setRenderTarget(null); renderer.render(scene, camera); return; }
        const g = Settings.gfx, p = post;
        renderer.setRenderTarget(p.scene);
        renderer.render(scene, camera);

        const pass = (m, target) => { p.quad.material = m; renderer.setRenderTarget(target); renderer.render(p.scn, p.cam); };
        const useBloom = g.bloom > 0.01;
        // Where is the sun on screen, and is it in front of us?
        _sun.copy(camera.position).addScaledVector(SUN_DIR, 10000).project(camera);
        const sunOn = _sun.z < 1 && SUN_DIR.y > -0.02;
        const sunVis = sunOn ? smooth(1.3, 0.6, Math.max(Math.abs(_sun.x), Math.abs(_sun.y))) * (1 - weather.storm * 0.85) * smooth(-0.02, 0.08, SUN_DIR.y) : 0;
        const doShafts = g.shafts && sunVis > 0.02;
        if (useBloom || doShafts) {
            p.bright.uniforms.tSrc.value = p.scene.texture;
            p.bright.uniforms.uTexel.value.set(1 / p.w, 1 / p.h);
            pass(p.bright, p.lv[0][0]);
            if (doShafts) {
                p.shafts.uniforms.tSrc.value = p.lv[0][0].texture;
                p.shafts.uniforms.uSun.value.set(_sun.x * 0.5 + 0.5, _sun.y * 0.5 + 0.5);
                pass(p.shafts, p.shaft);
            }
            for (let i = 0; i < 3; i++) {
                const [a, b] = p.lv[i];
                if (i > 0) {
                    const src = p.lv[i - 1][0];
                    p.down.uniforms.tSrc.value = src.texture;
                    p.down.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
                    pass(p.down, a);
                }
                p.blur.uniforms.tSrc.value = a.texture;
                p.blur.uniforms.uDir.value.set(1 / a.width, 0);
                pass(p.blur, b);
                p.blur.uniforms.tSrc.value = b.texture;
                p.blur.uniforms.uDir.value.set(0, 1 / a.height);
                pass(p.blur, a);
            }
        }
        const U = p.comp.uniforms;
        U.tScene.value = p.scene.texture;
        U.tB0.value = p.lv[0][0].texture; U.tB1.value = p.lv[1][0].texture; U.tB2.value = p.lv[2][0].texture;
        U.tShaft.value = p.shaft.texture;
        U.uTexel.value.set(1 / p.w, 1 / p.h);
        U.uBloom.value = useBloom ? g.bloom : 0;
        U.uShaft.value = doShafts ? 0.55 * sunVis : 0;
        U.uFlare.value = g.flare ? 0.55 * sunVis : 0;
        U.uSun.value.set(_sun.x * 0.5 + 0.5, _sun.y * 0.5 + 0.5);
        U.uSunCol.value.copy(WEATHER_U.uSunCol.value);
        U.uVig.value = g.vignette;
        U.uGrain.value = g.grain;
        U.uTime.value = t;
        U.uFxaa.value = g.aa === 'fxaa' ? 1 : 0;
        U.uAspect.value = window.innerWidth / window.innerHeight;
        U.uGrade.value = { natural: 0, cinematic: 1, filmic: 2 }[g.grade] ?? 1;
        // 2.39:1 letterbox bars
        U.uBars.value = g.letterbox ? Math.max(0, 0.5 - (window.innerWidth / window.innerHeight) / 2.39 * 0.5) : 0;
        pass(p.comp, null);
    }

    // Did a material's shader fail to compile/link on this device?
    function failed(material) {
        const props = renderer.properties.get(material);
        const prog = props && props.program;
        if (!prog || !prog.program) return false;
        const gl = renderer.getContext();
        return !gl.getProgramParameter(prog.program, gl.LINK_STATUS);
    }

    return {
        createRenderer, apply, resize, render, failed,
        get fps() { return fpsVal; },
        get scale() { return Settings.gfx.renderScale * (Settings.gfx.dynamicRes ? dyn.scale : 1); },
        get particleKeep() { return Settings.gfx.particles; }
    };
})();
