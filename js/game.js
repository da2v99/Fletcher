// Game flow: menu, Patrol (escalating engagements against IJN forces), Free Cruise (sandbox with unarmed
// transports to shoot at), scoring, replenishment between engagements, and game over.

const Game = {
    mode: 'menu',          // 'menu' | 'patrol' | 'cruise'
    running: false,        // player has the conn
    paused: false,
    hostile: false,        // do enemies shoot back?
    over: false,
    wave: 0, score: 0,
    stats: { rounds: 0, torps: 0, hits: 0, hitsTaken: 0, sunk: 0, shore: 0, troops: 0, planes: 0 },
    phase: 'idle', phaseT: 0,
    objective: null,       // shore bombardment: the base whose battery must be silenced

    resetWorld() {
        clearEnemies();
        clearShells();
        clearTorpedoes();
        Tracers.clear();
        Islands.reset();
        if (typeof Air !== 'undefined') Air.reset();
        this.objective = null;
        smokeFx.clear();
        sprayFx.clear();
        fireFx.clear();
        resetPhysics();
        resetPlayerDamage();
        resetPlayerWeapons();
        resetDirector();
        resetWake();
        this.wave = 0;
        this.score = 0;
        this.stats = { rounds: 0, torps: 0, hits: 0, hitsTaken: 0, sunk: 0, shore: 0, troops: 0, planes: 0 };
        this.over = false;
        this.paused = false;
    },

    start(mode) {
        ensureAudio();
        this.resetWorld();
        this.mode = mode;
        this.running = true;
        this.hostile = mode === 'patrol';
        drive.order = 6;   // get under way at standard speed
        phys.vel.set(0, 0, 11);
        showScreen(null);
        document.body.classList.add('playing');
        setCameraMode('chase');
        if (mode === 'patrol') {
            this.phase = 'transit';
            this.phaseT = 6;
            hudMessage('USS Fletcher on patrol, the Slot, Solomon Islands. Radar is searching.', 'info');
        } else {
            this.phase = 'cruise';
            for (let i = 0; i < 4; i++) this.spawnTransport(rnd(3000, 9000), rnd(-1.4, 1.4));
            hudMessage('Free cruise: unarmed transports in the area for gunnery practice.', 'info');
        }
    },

    toMenu() {
        this.running = false;
        this.mode = 'menu';
        this.resetWorld();
        if (captain.active) setCaptain(false);
        document.body.classList.remove('playing');
        setCameraMode('cinematic');
        showScreen('mainMenu');
    },

    setPaused(p) {
        if (!this.running || this.over) return;
        this.paused = p;
        if (p && document.pointerLockElement) document.exitPointerLock();
        showScreen(p ? 'pauseMenu' : null);
    },

    spawnTransport(dist, relBrg) {
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(phys.quat);
        const a = Math.atan2(fwd.x, fwd.z) + relBrg;
        spawnEnemy('maru', phys.pos.x + Math.sin(a) * dist, phys.pos.z + Math.cos(a) * dist, Math.random() * Math.PI * 2);
    },

    // Every third engagement is a shore bombardment, if there's a garrison within reach: silence its battery
    spawnBombardment(n) {
        const base = Islands.bases.filter(b => !b.destroyed && b.guns.some(g => g.alive))
            .map(b => ({ b, d: Math.hypot(b.x - phys.pos.x, b.z - phys.pos.z) })).filter(o => o.d < 20000).sort((a, c) => a.d - c.d)[0];
        if (!base) return false;
        const b = base.b;
        this.objective = b;
        b.alert = true;
        // A destroyer guards the approaches to the island
        const gx = b.x + b.fx * 3500, gz = b.z + b.fz * 3500;
        spawnEnemy('destroyer', gx, gz, Math.atan2(phys.pos.x - gx, phys.pos.z - gz));
        hudMessage(`ENGAGEMENT ${n}: shore bombardment — silence the coastal battery on ${b.name}, bearing ${fmt3(compassDeg(b.x - phys.pos.x, b.z - phys.pos.z))}, ${Math.round(base.d * 1.0936).toLocaleString()} yds. A destroyer guards the approach.`, 'alert');
        playAlarm();
        showBanner(`Engagement ${n}`, `Shore bombardment · ${b.name}`);
        return true;
    },

    // Each engagement: a convoy crossing ahead of us, screened by warships that come out to fight
    spawnWave(n) {
        if (n % 3 === 0 && this.spawnBombardment(n)) return;
        n -= Math.floor(n / 3);   // convoys keep growing at the same pace with bombardments in between
        const comp = n === 1 ? ['destroyer', 'maru', 'maru']
            : n === 2 ? ['destroyer', 'destroyer', 'maru', 'maru']
            : n === 3 ? ['cruiser', 'destroyer', 'maru', 'maru', 'maru']
            : ['cruiser', ...Array(Math.min(4, n - 2)).fill('destroyer'), 'maru', 'maru', 'maru'];
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(phys.quat);
        const brg = Math.atan2(fwd.x, fwd.z) + rnd(-1.0, 1.0);
        const dist = rnd(12500, 15000);
        const cx = phys.pos.x + Math.sin(brg) * dist, cz = phys.pos.z + Math.cos(brg) * dist;
        const course = brg + Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1) + rnd(-0.3, 0.3);   // crossing our bow
        let mi = 0, wi = 0;
        comp.forEach(type => {
            if (type === 'maru') {
                const off = (mi++ - 1) * 700;   // transports in column
                spawnEnemy('maru', cx - Math.sin(course) * off, cz - Math.cos(course) * off, course);
            } else {
                const side = wi % 2 ? 1 : -1, row = Math.floor(wi++ / 2);
                // Screen on the side facing us
                const sx = cx - Math.sin(brg) * (1500 + row * 900) + Math.cos(course) * side * 900;
                const sz = cz - Math.cos(brg) * (1500 + row * 900) - Math.sin(course) * side * 900;
                spawnEnemy(type, sx, sz, course);
            }
        });
        const warships = comp.filter(t => t !== 'maru').length;
        hudMessage(`ENGAGEMENT ${this.wave}: convoy bearing ${fmt3(compassDeg(Math.sin(brg), Math.cos(brg)))}, ${Math.round(dist * 1.0936 / 1000)}k yds — ${warships} warship${warships > 1 ? 's' : ''} in the screen. General quarters!`, 'alert');
        playAlarm();
        showBanner(`Engagement ${this.wave}`, `${comp.filter(t => t === 'maru').length} transports · ${warships} escort${warships > 1 ? 's' : ''}`);
    },

    update(dt) {
        if (!this.running) return;
        this.phaseT -= dt;
        if (this.mode === 'patrol') {
            if (this.phase === 'transit' && this.phaseT <= 0) {
                this.wave++;
                this.spawnWave(this.wave);
                this.phase = 'battle';
            } else if (this.phase === 'battle' && !playerDmg.sinking && this.engagementWon()) {
                this.phase = 'cleared';
                this.objective = null;
                this.phaseT = 10;
                const bonus = 250 * this.wave;
                this.score += bonus;
                hudMessage(`Engagement ${this.wave} won! +${bonus}. Damage control and replenishment under way.`, 'good');
                showBanner('Engagement won', `+${bonus} points`);
            } else if (this.phase === 'cleared' && this.phaseT <= 0) {
                // Replenish between engagements
                playerDmg.hull = Math.min(100, playerDmg.hull + 35);
                playerDmg.fires.length = 0;
                phys.flood = 0;
                phys.engine = Math.min(1, phys.engine + 0.3);
                guns.forEach(g => { g.disabled = false; });
                torpMounts.forEach(m => { m.left = 5; });
                hudMessage('Repairs made, torpedoes reloaded. Next contact expected shortly.', 'good');
                this.phase = 'transit';
                this.phaseT = 25;
            }
        } else if (this.mode === 'cruise' && enemies.filter(e => !e.sinking && !e.island).length < 4) {
            this.spawnTransport(rnd(5000, 10000), rnd(-1.4, 1.4));
        }
        if (playerDmg.sinking && !this.over && playerDmg.sinkT > 9) this.gameOver();
    },

    engagementWon() {
        const ships = enemies.every(e => e.sinking || e.island);
        const b = this.objective;
        if (!b) return ships;
        if (!b.isl.ready) return true;   // sailed away from it: the engagement is called off
        return ships && b.guns.every(g => !g.alive);
    },

    // Something ashore destroyed (st = null: troops)
    onShoreTarget(st, score, kills = 0) {
        this.score += score;
        if (st) {
            this.stats.shore++;
            hudMessage(`${st.type.name} on ${st.base.name} destroyed! +${score}`, 'good');
            if (st.kind === 'gun' && this.objective === st.base && st.base.guns.every(g => !g.alive)) {
                hudMessage(`The battery on ${st.base.name} is silenced!`, 'good');
                showBanner('Battery silenced', st.base.name);
            }
        } else if (kills) {
            this.stats.troops += kills;
            if (kills >= 3) hudMessage(`Direct hit on troops ashore +${score}`, 'good');
        }
    },

    onBaseDestroyed(b) {
        const bonus = 500;
        this.score += bonus;
        hudMessage(`The base on ${b.name} is wrecked! +${bonus}`, 'good');
        showBanner('Base destroyed', `${b.name} · +${bonus}`);
    },

    onHit(e) {
        this.stats.hits++;
        this.score += 10;
    },

    onEnemySunk(e) {
        this.stats.sunk++;
        this.score += e.type.score;
        hudMessage(`${e.type.name} sunk! +${e.type.score}`, 'good');
        if (director.lock === e) director.lock = null;
    },

    onPlayerSinking() {
        this.running = false;
        drive.order = STOP_IDX;
        if (captain.active) setCaptain(false);
        setCameraMode('cinematic');
        cine.radius = 130; cine.height = 22;
    },

    gameOver() {
        this.over = true;
        $('goStats').innerHTML = `
            <div><span>Engagements fought</span><b>${this.wave}</b></div>
            <div><span>Enemy ships sunk</span><b>${this.stats.sunk}</b></div>
            <div><span>Rounds fired</span><b>${this.stats.rounds}</b></div>
            <div><span>Hits scored</span><b>${this.stats.hits}</b></div>
            <div><span>Torpedoes fired</span><b>${this.stats.torps}</b></div>
            <div><span>Shore targets destroyed</span><b>${this.stats.shore}</b></div>
            <div><span>Aircraft shot down</span><b>${this.stats.planes}</b></div>
            <div><span>Hits taken</span><b>${this.stats.hitsTaken}</b></div>
            <div class="total"><span>Final score</span><b>${this.score.toLocaleString()}</b></div>`;
        showScreen('gameOver');
    }
};
