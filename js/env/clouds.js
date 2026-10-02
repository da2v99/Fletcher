// Volumetric sky: the raymarched "protean" clouds from Waves and Clouds/clouds.js, lit by our sun and
// thickened by the storm. They are rendered into a cube map one face at a time, which the sky dome displays
// and the ocean samples for its reflections, so both always match.
// Quality (Settings.gfx.clouds): 0 a painted cloud layer, 1-3 raymarched with more steps and resolution.
// Lighter levels also refresh the cube more slowly and never render all six faces in one frame, which is
// what trips phone GPU watchdogs.
const CLOUD_Q = [
    { size: 128, steps: 0, light: 0, every: 8 },
    { size: 192, steps: 40, light: 2, every: 2 },
    { size: 384, steps: 68, light: 3, every: 1 },
    { size: 576, steps: 92, light: 4, every: 2 }
];

const Clouds = (() => {
    let q = Settings.gfx.clouds, SIZE = CLOUD_Q[q].size;
    let rt, cubeCam, skyScene, skyMesh, face = 0, dirtyFaces = 6, frame = 0, domeMat = null;

    const cloudU = Object.assign({}, WEATHER_U, { uFlash: { value: 0 }, uCover: { value: 0.6 } });   // flashes are added live, not baked

    const fragment = () => `#define STEPS ${CLOUD_Q[q].steps}
#define LSTEPS ${Math.max(1, CLOUD_Q[q].light)}
` + NOISE_GLSL + SKY_GLSL + `
        varying vec3 vDir;
        uniform float uCover;
        #define PHI 1.61803398875
        mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

        float cloudMap(vec3 p) {
            float y = p.y;
            float wind = mix(0.02, 0.07, uStorm);
            // Weather systems: a slow, large field that gathers the clouds into clusters and lanes with clear sky
            // between, so the sin-sum below never shows its pattern repeating across the sky
            vec2 w = p.xz + vec2(uTime * wind * 0.4, uTime * wind);
            float n1 = vnoise(w * 0.035 + 11.7), n2 = vnoise(w * 0.09 - 3.1);
            float field = n1 * 0.65 + n2 * 0.35;
            p.xz *= 0.4;                                      // smaller clouds, so their detail reads
            p.y *= 0.17;
            p.xz += (vec2(n1, n2) - 0.5) * 2.4;               // and no two alike
            p.z += uTime * wind;
            p.x += uTime * wind * 0.4;
            float d = 0.0, amp = 1.0;
            for (int i = 0; i < 5; i++) {
                p.xy *= rot(PHI + float(i));
                p.yz *= rot(PHI * 0.5);
                float n = dot(sin(p), cos(p.yzx));
                d += i == 0 ? n * amp : (abs(n) - 1.2) * amp * 0.4;
                amp *= 0.618;
                p *= 1.618;
            }
            d += uCover + (field - 0.5) * mix(1.6, 0.5, uStorm);   // coverage grows with the storm, in patches
            d -= abs(y - 7.0) * mix(0.2, 0.13, uStorm);       // and the cloud deck thickens
            return max(0.0, d);
        }

        // Henyey-Greenstein phase, scaled so isotropic scattering is 1
        float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * c, 1.5); }

        void main() {
            vec3 rd = normalize(vDir);
            vec3 sky = skyColor(rd);
            if (rd.y < -0.02) { gl_FragColor = vec4(sky, 0.0); return; }
#if STEPS == 0
            // Painted cloud layer: fbm on a plane overhead, thicker with the storm
            vec2 uv = rd.xz / max(rd.y, 0.04) * 2.6 + vec2(uTime * 0.01, uTime * 0.004);
            float n = fbm3(uv) * 0.65 + fbm3(uv * 2.7 + 3.1) * 0.35;
            float cov = smoothstep(0.62 - uCover * 0.22, 0.95 - uCover * 0.2, n) * smoothstep(0.0, 0.12, rd.y);
            float dawn0 = 1.0 - smoothstep(0.05, 0.45, uSunDir.y);
            float bright0 = mix(0.45, 1.0, smoothstep(-0.1, 0.3, uSunDir.y)) * (1.0 - 0.85 * nightF());
            vec3 cc = mix(vec3(1.0, 0.98, 0.95), uSunCol * vec3(1.0, 0.86, 0.8), dawn0 * 0.7) * bright0 * (1.0 - 0.45 * uStorm);
            float gold0 = goldenF() * (1.0 - uStorm * 0.6);
            cc = mix(cc, vec3(1.0, 0.55, 0.32) * bright0 * 1.2, gold0 * 0.7);
            cc = mix(cc, mix(mix(vec3(0.24, 0.29, 0.38), vec3(0.34, 0.27, 0.44), gold0), vec3(0.10, 0.11, 0.13), uStorm) * bright0, smoothstep(0.7, 1.0, n));
            float haze0 = (1.0 - smoothstep(0.0, 0.3, rd.y)) * 0.65 + (1.0 - smoothstep(0.0, 0.05, rd.y)) * 0.35;
            cc = mix(cc, sky, haze0);
            gl_FragColor = vec4(mix(sky, cc, cov * 0.9), cov);
#else

            // Physically based single + multiple scattering, after the "protean clouds" lighting:
            //  - sunlight reaching each sample is marched toward the sun at doubling steps (Beer-Lambert), so
            //    clouds shade themselves and each other
            //  - a dual-lobe Henyey-Greenstein phase: a strong forward lobe (the silver lining round the sun) and a
            //    weak back lobe
            //  - a second, softer octave for multiple scattering, so thick cloud glows instead of going black
            //  - the "powder" darkening at thin edges facing the light
            //  - ambient from the real sky above and the sea's bounce below, and energy-conserving integration
            // The sun's own colour, the sunset tint, the storm and the night all come from the game's sky.
            float gold = goldenF() * (1.0 - uStorm * 0.6);
            vec3 sunL = normalize(vec3(uSunDir.x, max(uSunDir.y, 0.04), uSunDir.z));
            float cosT = dot(rd, sunL);
            float phase = min(mix(hg(cosT, 0.72), hg(cosT, -0.2), 0.4), 2.6);
            float phaseMS = mix(hg(cosT, 0.35), hg(cosT, -0.1), 0.5);
            vec3 sunC = uSunCol * (1.0 + 0.25 * gold) * smoothstep(-0.12, 0.05, uSunDir.y) * (1.0 - 0.8 * uStorm) * 1.25;
            vec3 zen = skyColor(vec3(0.0, 1.0, 0.0));
            vec3 skyUp = mix(vec3(dot(zen, vec3(0.3, 0.5, 0.2))), zen, 0.45) * 1.5 + 0.035 * (1.0 - nightF());   // sky light, scattered from every side so less blue
            vec2 sh = normalize(sunL.xz + 1e-4);   // bounce from the whole horizon, not just the bright patch under the sun
            vec3 skyLow = (skyColor(vec3(sh.x, 0.04, sh.y)) + skyColor(vec3(-sh.x, 0.04, -sh.y)) + skyColor(vec3(sh.y, 0.04, -sh.x)) + skyColor(vec3(-sh.y, 0.04, sh.x))) * 0.15 + 0.015;
            const float EXT = 0.21, EXT_L = 1.6;

            vec3 ro = vec3(0.0, -1.0, 0.0);
            float T = 1.0;
            vec3 Lsum = vec3(0.0);
            float t = 1.0 + fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 0.5;
            float stride = 110.0 / float(STEPS);
            for (int i = 0; i < STEPS; i++) {
                if (T < 0.01 || t > 70.0) break;
                vec3 pos = ro + t * rd;
                float m = cloudMap(pos);
                float dt = (0.05 + t * 0.025) * stride;
                if (m > 0.01) {
                    float den = smoothstep(0.0, 1.0, m) * smoothstep(70.0, 35.0, t);
                    // Light march toward the sun
                    float ld = 0.0, ls = 4.0 / (exp2(float(LSTEPS)) - 1.0);   // the same 4 units toward the sun at every quality
                    vec3 lp = pos;
                    for (int j = 0; j < LSTEPS; j++) { lp += sunL * ls; ld += cloudMap(lp) * ls; ls *= 2.0; }
                    float beer = exp(-ld * EXT_L), beerMS = exp(-ld * EXT_L * 0.15);
                    float powder = 1.0 - exp(-den * 3.0);
                    vec3 amb = mix(skyLow, skyUp, smoothstep(1.0, 12.0, pos.y));
                    vec3 S = sunC * (beer * phase * mix(1.0, powder * 1.7, 0.45) + beerMS * phaseMS * 0.4) + amb * (0.42 + 0.5 * powder);
                    float stepT = exp(-den * EXT * dt / max(stride, 0.5) * 1.6);
                    Lsum += S * (1.0 - stepT) * T;
                    T *= stepT;
                }
                t += dt;
            }
            Lsum = Lsum / (1.0 + 0.25 * Lsum);
            vec4 rez = vec4(Lsum, 1.0 - T);
            // Aerial perspective: low clouds dissolve into the horizon haze
            float haze = (1.0 - smoothstep(0.0, 0.3, rd.y)) * 0.65 + (1.0 - smoothstep(0.0, 0.05, rd.y)) * 0.35;
            rez.rgb = mix(rez.rgb, sky * rez.a, haze);
            gl_FragColor = vec4(sky * (1.0 - rez.a) + rez.rgb, rez.a);
#endif
        }
    `;

    const makeMaterial = () => new THREE.ShaderMaterial({
        uniforms: cloudU,
        vertexShader: `
            varying vec3 vDir;
            void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: fragment(),
        side: THREE.BackSide, depthWrite: false, depthTest: false
    });

    function init() {
        rt = new THREE.WebGLCubeRenderTarget(SIZE, {
            format: THREE.RGBAFormat, generateMipmaps: true,
            minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter
        });
        skyScene = new THREE.Scene();
        cubeCam = new THREE.CubeCamera(1, 100, rt);
        skyScene.add(cubeCam);
        skyMesh = new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), makeMaterial());
        skyScene.add(skyMesh);
        cubeCam.updateMatrixWorld(true);
        return rt.texture;
    }

    // Change quality: new shader and cube resolution (the texture object is kept, so materials sampling
    // it don't need rebuilding)
    function setQuality(nq) {
        if (nq === q || !rt) return;
        q = nq;
        skyMesh.material.dispose();
        skyMesh.material = makeMaterial();
        if (CLOUD_Q[q].size !== SIZE) {
            SIZE = CLOUD_Q[q].size;
            rt.setSize(SIZE, SIZE);
            if (domeMat) domeMat.uniforms.uTexelAng.value = Math.PI / 2 / SIZE;
        }
        dirtyFaces = 6;
    }

    // Render cube faces round-robin: a few per frame after the weather changes, then one every few frames
    function update(renderer, force) {
        frame++;
        const cfg = CLOUD_Q[q];
        let n = 0;
        if (force) n = 6;
        else if (dirtyFaces > 0) n = q >= 2 ? Math.min(dirtyFaces, q === 3 ? 2 : 3) : 1;
        else if (frame % cfg.every === 0) n = 1;
        if (!n) return;
        const cams = cubeCam.children;
        const prev = renderer.getRenderTarget();
        for (let i = 0; i < n; i++) {
            rt.texture.generateMipmaps = face === 5;
            renderer.setRenderTarget(rt, face);
            renderer.render(skyScene, cams[face]);
            face = (face + 1) % 6;
            if (dirtyFaces > 0) dirtyFaces--;
        }
        rt.texture.generateMipmaps = true;
        renderer.setRenderTarget(prev);
    }

    function invalidate() {
        cloudU.uCover.value = lerp(0.1, 1.9, weather.storm);   // fair-weather cumulus -> solid storm deck
        dirtyFaces = 6;
    }

    // The visible sky: the cube map, plus the sun disc (hidden by cloud) and live lightning flashes
    function createSkyDome(cubeTex) {
        const mat = new THREE.ShaderMaterial({
            uniforms: Object.assign({ uSkyCube: { value: cubeTex }, uTexelAng: { value: Math.PI / 2 / SIZE } }, WEATHER_U),
            vertexShader: `
                varying vec3 vDir;
                void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
            `,
            fragmentShader: `
                uniform samplerCube uSkyCube;
                uniform vec3 uSunDir;
                uniform vec3 uSunCol;
                uniform float uStorm;
                uniform float uFlash;
                uniform float uTexelAng;
                varying vec3 vDir;
                void main() {
                    vec3 d = normalize(vDir);
                    // The cube is a few hundred texels a face and the view magnifies it: a small rotated tent
                    // filter hides its texels and the raymarch's dither, so cloud edges stay soft, not blocky
                    vec3 ta = normalize(cross(d, abs(d.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
                    vec3 tb = cross(d, ta);
                    float r = uTexelAng * 0.85;
                    vec4 s = textureCube(uSkyCube, d) * 0.28
                        + textureCube(uSkyCube, normalize(d + (ta * 0.95 + tb * 0.31) * r)) * 0.18
                        + textureCube(uSkyCube, normalize(d + (-ta * 0.31 + tb * 0.95) * r)) * 0.18
                        + textureCube(uSkyCube, normalize(d + (-ta * 0.95 - tb * 0.31) * r)) * 0.18
                        + textureCube(uSkyCube, normalize(d + (ta * 0.31 - tb * 0.95) * r)) * 0.18;
                    float sd = dot(d, uSunDir);
                    vec3 col = s.rgb + uSunCol * smoothstep(0.9994, 0.9997, sd) * 4.0 * (1.0 - uStorm * 0.95) * (1.0 - s.a) * step(0.0, d.y);
                    col += vec3(0.75, 0.8, 1.0) * uFlash * (0.4 + 0.6 * smoothstep(0.0, 0.3, d.y)) * (0.5 + s.a);
                    gl_FragColor = vec4(col, 1.0);
                }
            `,
            side: THREE.BackSide, depthWrite: false, fog: false
        });
        const dome = new THREE.Mesh(new THREE.SphereGeometry(40000, 48, 24), mat);
        dome.frustumCulled = false;
        dome.renderOrder = -1;
        domeMat = mat;
        return dome;
    }

    return { init, update, invalidate, setQuality, createSkyDome, uniforms: cloudU, get texture() { return rt.texture; } };
})();
