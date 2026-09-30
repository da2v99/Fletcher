// Volumetric sky: the raymarched "protean" clouds from Waves and Clouds/clouds.js, lit by our sun and
// thickened by the storm. They are rendered into a cube map one face per frame (a full refresh every six
// frames), which the sky dome displays and the ocean samples for its reflections, so both always match.

const Clouds = (() => {
    const SIZE = 320;
    let rt, cubeCam, skyScene, face = 0, dirty = true;

    const cloudU = Object.assign({}, WEATHER_U, { uFlash: { value: 0 }, uCover: { value: 0.6 } });   // flashes are added live, not baked

    const fragment = NOISE_GLSL + SKY_GLSL + `
        varying vec3 vDir;
        uniform float uCover;
        #define PHI 1.61803398875
        mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

        float cloudMap(vec3 p) {
            float y = p.y;
            p.xz *= 0.25;
            p.y *= 0.15;
            float wind = mix(0.02, 0.07, uStorm);
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
            d += uCover;                                      // coverage grows with the storm
            d -= abs(y - 7.0) * mix(0.2, 0.13, uStorm);       // and the cloud deck thickens
            return max(0.0, d);
        }

        void main() {
            vec3 rd = normalize(vDir);
            vec3 sky = skyColor(rd);
            if (rd.y < -0.02) { gl_FragColor = vec4(sky, 0.0); return; }

            float dawn = 1.0 - smoothstep(0.05, 0.45, uSunDir.y);
            float bright = mix(0.45, 1.0, smoothstep(-0.1, 0.3, uSunDir.y));
            float sd = max(dot(rd, uSunDir), 0.0);
            vec3 sunL = normalize(vec3(uSunDir.x, max(uSunDir.y, 0.05), uSunDir.z));
            vec3 litCol = mix(vec3(1.0, 0.99, 0.97), uSunCol * vec3(1.0, 0.86, 0.8), dawn * 0.7) * bright * (1.0 - 0.45 * uStorm);
            litCol += uSunCol * pow(sd, 6.0) * 0.4 * (1.0 - uStorm * 0.6);   // silver lining toward the sun
            vec3 shadowCol = mix(vec3(0.24, 0.29, 0.38), vec3(0.10, 0.11, 0.13), uStorm) * bright;

            vec3 ro = vec3(0.0, -1.0, 0.0);
            vec4 rez = vec4(0.0);
            float t = 1.0 + hash12(gl_FragCoord.xy) * 0.5;
            for (int i = 0; i < 110; i++) {
                if (rez.a > 0.99 || t > 70.0) break;
                vec3 pos = ro + t * rd;
                float m = cloudMap(pos);
                if (m > 0.01) {
                    float den = smoothstep(0.0, 1.0, m);
                    float dif = clamp((den - cloudMap(pos + sunL * 0.4)) / 0.8, 0.0, 1.0);
                    vec3 c = mix(shadowCol, litCol, clamp(dif * 1.5 + 0.1, 0.0, 1.0));
                    vec4 col = vec4(c, 0.08 * den * smoothstep(70.0, 35.0, t));
                    col.rgb *= col.a;
                    rez += col * (1.0 - rez.a);
                }
                t += 0.05 + t * 0.025;
            }
            // Aerial perspective: low clouds dissolve into the horizon haze
            float haze = (1.0 - smoothstep(0.0, 0.3, rd.y)) * 0.65;
            rez.rgb = mix(rez.rgb, sky * rez.a, haze);
            gl_FragColor = vec4(sky * (1.0 - rez.a) + rez.rgb, rez.a);
        }
    `;

    function init() {
        rt = new THREE.WebGLCubeRenderTarget(SIZE, {
            format: THREE.RGBAFormat, generateMipmaps: true,
            minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter
        });
        skyScene = new THREE.Scene();
        cubeCam = new THREE.CubeCamera(1, 100, rt);
        skyScene.add(cubeCam);
        const mat = new THREE.ShaderMaterial({
            uniforms: cloudU,
            vertexShader: `
                varying vec3 vDir;
                void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
            `,
            fragmentShader: fragment,
            side: THREE.BackSide, depthWrite: false, depthTest: false
        });
        skyScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), mat));
        cubeCam.updateMatrixWorld(true);
        return rt.texture;
    }

    // Render one cube face (or all six after the weather changes)
    function update(renderer) {
        const cams = cubeCam.children;
        const prev = renderer.getRenderTarget();
        const faces = dirty ? [0, 1, 2, 3, 4, 5] : [face];
        faces.forEach(f => {
            rt.texture.generateMipmaps = f === 5;
            renderer.setRenderTarget(rt, f);
            renderer.render(skyScene, cams[f]);
        });
        rt.texture.generateMipmaps = true;
        renderer.setRenderTarget(prev);
        face = (face + 1) % 6;
        dirty = false;
    }

    function invalidate() {
        cloudU.uCover.value = lerp(0.1, 1.9, weather.storm);   // fair-weather cumulus -> solid storm deck
        dirty = true;
    }

    // The visible sky: the cube map, plus the sun disc (hidden by cloud) and live lightning flashes
    function createSkyDome(cubeTex) {
        const mat = new THREE.ShaderMaterial({
            uniforms: Object.assign({ uSkyCube: { value: cubeTex } }, WEATHER_U),
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
                varying vec3 vDir;
                void main() {
                    vec3 d = normalize(vDir);
                    vec4 s = textureCube(uSkyCube, d);
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
        return dome;
    }

    return { init, update, invalidate, createSkyDome, uniforms: cloudU, get texture() { return rt.texture; } };
})();
