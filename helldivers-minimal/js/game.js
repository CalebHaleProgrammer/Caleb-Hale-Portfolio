// Core game loop, rendering, state
const Game = {
  canvas: null,
  ctx: null,
  width: 0,
  height: 0,
  mapW: 2400,
  mapH: 2400,
  camX: 0,
  camY: 0,
  players: new Map(),
  localPlayerId: null,
  enemies: [],
  projectiles: [],
  effects: [],
  wave: 1,
  waveTimer: 0,
  enemiesToSpawn: 8,
  spawnCooldown: 0,
  state: 'menu', // menu | playing | paused | extract | ended
  extractTimer: 0,
  extractZone: { x: 1200, y: 1200, r: 120 },
  missionTime: 0,
  kills: 0,
  isHost: true,
  lastStateSend: 0,
  keys: {},
  mouse: { x: 0, y: 0, down: false },
  ctrlHeld: false,
  stratBuffer: [],
  stratUITimer: 0,
  activeStratagems: {}, // name -> cooldown remaining
  showFps: false,
  fps: 60,
  lastFrame: 0,
  reduceMotion: false,

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    // Defer real size until the game screen is shown (hidden elements report 0)
    this.width = 0;
    this.height = 0;
    window.addEventListener('resize', () => {
      if (this.state === 'playing' || this.state === 'extract' || this.state === 'paused') this.resize();
    });
    this._bindInput();
  },

  resize() {
    // Prefer parent (#game) size; fall back to window
    const parent = this.canvas.parentElement;
    let w = parent ? parent.clientWidth : 0;
    let h = parent ? parent.clientHeight : 0;
    if (w < 100 || h < 100) {
      w = window.innerWidth || 800;
      h = window.innerHeight || 600;
    }
    this.width = w;
    this.height = h;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  },

  startSolo(name) {
    this.reset();
    this.isHost = true;
    this.localPlayerId = 'local';
    const p = new Entities.Player('local', name, this.mapW / 2, this.mapH / 2, '#ffe800');
    this.players.set('local', p);
    this.state = 'playing';
    // Critical: size the canvas now that #game is visible
    this.resize();
    this.camX = p.x - this.width / 2;
    this.camY = p.y - this.height / 2;
    this._spawnWave();
  },

  startMulti(localId, isHost, roster, name) {
    this.reset();
    this.isHost = isHost;
    this.localPlayerId = localId;
    const colors = ['#ffe800', '#33aaff', '#ff66aa', '#66ff99', '#ff9944', '#cc66ff', '#66ffff', '#ff6666'];
    let i = 0;
    const entries = roster instanceof Map ? [...roster.entries()] : Object.entries(roster || {});
    for (const [id, info] of entries) {
      const angle = (i / Math.max(1, entries.length)) * Math.PI * 2;
      const px = this.mapW / 2 + Math.cos(angle) * 60;
      const py = this.mapH / 2 + Math.sin(angle) * 60;
      const p = new Entities.Player(id, (info && info.name) || 'Diver', px, py, colors[i % colors.length]);
      this.players.set(id, p);
      i++;
    }
    if (!this.players.has(localId)) {
      const p = new Entities.Player(localId, name, this.mapW / 2, this.mapH / 2, '#ffe800');
      this.players.set(localId, p);
    }
    this.state = 'playing';
    this.resize();
    const lp = this.players.get(localId);
    if (lp) {
      this.camX = lp.x - this.width / 2;
      this.camY = lp.y - this.height / 2;
    }
    if (this.isHost) this._spawnWave();
  },

  reset() {
    this.players.clear();
    this.enemies = [];
    this.projectiles = [];
    this.effects = [];
    this.wave = 1;
    this.waveTimer = 0;
    this.enemiesToSpawn = 8;
    this.spawnCooldown = 0;
    this.extractTimer = 0;
    this.missionTime = 0;
    this.kills = 0;
    this.stratBuffer = [];
    this.activeStratagems = {};
    this.state = 'menu';
  },

  _bindInput() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'ControlLeft' || e.code === 'ControlRight') this.ctrlHeld = true;
      if (this.state === 'playing' && this.ctrlHeld) {
        const dir = { KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' }[e.code];
        if (dir) {
          this.stratBuffer.push(dir);
          if (this.stratBuffer.length > 8) this.stratBuffer.shift();
          AudioSys.stratagem();
          this.stratUITimer = 2;
          const match = Stratagems.match(this.stratBuffer);
          if (match && (!this.activeStratagems[match.name] || this.activeStratagems[match.name] <= 0)) {
            this._activateStratagem(match);
            this.stratBuffer = [];
          }
        }
      }
      if (e.code === 'Escape' && this.state === 'playing') {
        this.state = 'paused';
      } else if (e.code === 'Escape' && this.state === 'paused') {
        this.state = 'playing';
      }
      if (e.code === 'KeyR') {
        const lp = this.players.get(this.localPlayerId);
        if (lp) lp.input.reload = true;
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
        this.ctrlHeld = false;
        this.stratBuffer = [];
      }
      if (e.code === 'KeyR') {
        const lp = this.players.get(this.localPlayerId);
        if (lp) lp.input.reload = false;
      }
    });
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - rect.left;
      this.mouse.y = e.clientY - rect.top;
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouse.down = true;
    });
    this.canvas.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.down = false;
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  },

  _getLocalInput() {
    const worldMx = this.mouse.x + this.camX;
    const worldMy = this.mouse.y + this.camY;
    return {
      up: !!this.keys['KeyW'],
      down: !!this.keys['KeyS'],
      left: !!this.keys['KeyA'],
      right: !!this.keys['KeyD'],
      shoot: this.mouse.down,
      sprint: !!this.keys['ShiftLeft'] || !!this.keys['ShiftRight'],
      reload: !!this.keys['KeyR'],
      aimX: worldMx,
      aimY: worldMy
    };
  },

  _activateStratagem(s) {
    this.activeStratagems[s.name] = s.cooldown;
    AudioSys.stratagemReady();
    const lp = this.players.get(this.localPlayerId);
    if (!lp) return;
    if (s.name === 'Resupply') {
      lp.ammo = lp.maxAmmo;
      lp.hp = Math.min(lp.maxHp, lp.hp + 40);
      this.effects.push(new Entities.Effect(lp.x, lp.y, 'strat', 0.8));
    } else if (s.name === 'Orbital Strike' || s.name === 'Eagle Strafing') {
      // Call at aim point
      const ax = lp.input.aimX;
      const ay = lp.input.aimY;
      this.effects.push(new Entities.Effect(ax, ay, 'explosion', 0.6));
      // Damage enemies in radius
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (Math.hypot(e.x - ax, e.y - ay) < 90) {
          if (e.takeDamage(80)) {
            this.kills++;
            lp.kills++;
          }
        }
      }
    } else if (s.name === 'Reinforce') {
      // Revive local if dead, or heal
      if (!lp.alive) {
        lp.alive = true;
        lp.hp = lp.maxHp * 0.6;
        lp.invuln = 2;
      } else {
        lp.hp = lp.maxHp;
      }
      this.effects.push(new Entities.Effect(lp.x, lp.y, 'strat', 1));
    }
  },

  _spawnWave() {
    this.enemiesToSpawn = 6 + this.wave * 3;
    this.spawnCooldown = 0.5;
  },

  _spawnEnemy() {
    const side = Math.floor(Math.random() * 4);
    let x, y;
    if (side === 0) { x = Math.random() * this.mapW; y = -20; }
    else if (side === 1) { x = this.mapW + 20; y = Math.random() * this.mapH; }
    else if (side === 2) { x = Math.random() * this.mapW; y = this.mapH + 20; }
    else { x = -20; y = Math.random() * this.mapH; }
    const type = Math.random() < 0.12 ? 'charger' : 'bug';
    this.enemies.push(new Entities.Enemy(x, y, type));
  },

  update(dt) {
    if (this.state !== 'playing' && this.state !== 'extract') return;

    this.missionTime += dt;

    // Local input
    const lp = this.players.get(this.localPlayerId);
    if (lp) {
      lp.input = this._getLocalInput();
      if (!this.isHost) {
        Network.sendInput(lp.input);
      }
    }

    // Stratagem cooldowns
    for (const k in this.activeStratagems) {
      if (this.activeStratagems[k] > 0) this.activeStratagems[k] -= dt;
    }
    if (this.stratUITimer > 0) this.stratUITimer -= dt;

    if (this.isHost) {
      // Update all players
      for (const p of this.players.values()) {
        p.update(dt, this.mapW, this.mapH);
        if (p.input.shoot) p.tryShoot(this.projectiles);
      }

      // Enemies
      for (const e of this.enemies) {
        e.update(dt, this.players, this.mapW, this.mapH);
      }
      this.enemies = this.enemies.filter(e => e.alive || (e._fade = (e._fade || 0.4) - dt) > 0);

      // Spawn
      if (this.enemiesToSpawn > 0) {
        this.spawnCooldown -= dt;
        if (this.spawnCooldown <= 0) {
          this._spawnEnemy();
          this.enemiesToSpawn--;
          this.spawnCooldown = 0.6 + Math.random() * 0.4;
        }
      } else if (this.enemies.filter(e => e.alive).length === 0) {
        this.wave++;
        this._spawnWave();
      }

      // Projectiles
      for (const pr of this.projectiles) {
        pr.x += pr.vx * dt;
        pr.y += pr.vy * dt;
        pr.life -= dt;
        // Hit enemies
        for (const e of this.enemies) {
          if (!e.alive) continue;
          if (Math.hypot(e.x - pr.x, e.y - pr.y) < e.radius + pr.radius) {
            const owner = this.players.get(pr.owner);
            if (e.takeDamage(pr.damage)) {
              this.kills++;
              if (owner) owner.kills++;
            }
            pr.life = 0;
            break;
          }
        }
      }
      this.projectiles = this.projectiles.filter(p => p.life > 0);

      // Effects
      for (const ef of this.effects) ef.life -= dt;
      this.effects = this.effects.filter(e => e.life > 0);

      // Extract check
      const living = [...this.players.values()].filter(p => p.alive);
      if (living.length > 0) {
        const inZone = living.every(p => Math.hypot(p.x - this.extractZone.x, p.y - this.extractZone.y) < this.extractZone.r);
        if (inZone && this.wave >= 3) {
          if (this.state !== 'extract') {
            this.state = 'extract';
            this.extractTimer = 25;
            AudioSys.extract();
          } else {
            this.extractTimer -= dt;
            if (this.extractTimer <= 0) {
              this._endMission(true);
            }
          }
        } else if (this.state === 'extract') {
          this.state = 'playing';
          this.extractTimer = 0;
        }
      }

      // All dead?
      if (living.length === 0) {
        this._endMission(false);
      }

      // Broadcast state ~20 Hz
      this.lastStateSend += dt;
      if (this.lastStateSend > 0.05) {
        this.lastStateSend = 0;
        Network.sendState(this._serializeState());
      }
    } else {
      // Client: only update local prediction lightly + apply received state
      if (lp) {
        lp.update(dt, this.mapW, this.mapH);
        // Local shoot is cosmetic; real projectiles come from host state
      }
    }

    // Camera follow local
    if (lp) {
      const targetX = lp.x - this.width / 2;
      const targetY = lp.y - this.height / 2;
      const lerp = this.reduceMotion ? 1 : 0.12;
      this.camX += (targetX - this.camX) * lerp;
      this.camY += (targetY - this.camY) * lerp;
      this.camX = Math.max(0, Math.min(this.mapW - this.width, this.camX));
      this.camY = Math.max(0, Math.min(this.mapH - this.height, this.camY));
    }
  },

  applyState(state) {
    // Host state applied on clients
    this.wave = state.wave;
    this.kills = state.kills;
    this.extractTimer = state.extractTimer;
    this.state = state.state;
    // Players
    for (const ps of state.players) {
      let p = this.players.get(ps.id);
      if (!p) {
        p = new Entities.Player(ps.id, ps.name, ps.x, ps.y, ps.color);
        this.players.set(ps.id, p);
      }
      if (ps.id !== this.localPlayerId) {
        p.x = ps.x; p.y = ps.y; p.angle = ps.angle;
      }
      p.hp = ps.hp; p.ammo = ps.ammo; p.alive = ps.alive; p.kills = ps.kills;
    }
    // Enemies (simple replace for minimal)
    this.enemies = state.enemies.map(e => {
      const en = new Entities.Enemy(e.x, e.y, e.type);
      en.hp = e.hp; en.alive = e.alive;
      return en;
    });
    this.projectiles = state.projectiles || [];
  },

  applyInput(fromId, input) {
    const p = this.players.get(fromId);
    if (p) p.input = input;
  },

  _serializeState() {
    return {
      wave: this.wave,
      kills: this.kills,
      extractTimer: this.extractTimer,
      state: this.state,
      players: [...this.players.values()].map(p => p.serialize()),
      enemies: this.enemies.filter(e => e.alive).map(e => ({
        x: e.x, y: e.y, type: e.type, hp: e.hp, alive: e.alive
      })),
      projectiles: this.projectiles.map(p => ({
        x: p.x, y: p.y, vx: p.vx, vy: p.vy, life: p.life, radius: p.radius
      }))
    };
  },

  _endMission(success) {
    this.state = 'ended';
    const stats = {
      kills: this.kills,
      wave: this.wave,
      time: Math.floor(this.missionTime),
      success
    };
    Storage.addStats({
      missions: 1,
      kills: this.kills,
      deaths: success ? 0 : 1,
      extracts: success ? 1 : 0,
      playTime: Math.floor(this.missionTime)
    });
    // UI handled externally
    if (this.onMissionEnd) this.onMissionEnd(stats);
  },

  draw() {
    const ctx = this.ctx;
    ctx.fillStyle = '#0d1210';
    ctx.fillRect(0, 0, this.width, this.height);

    // Grid
    ctx.save();
    ctx.translate(-this.camX, -this.camY);
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    const grid = 80;
    const startX = Math.floor(this.camX / grid) * grid;
    const startY = Math.floor(this.camY / grid) * grid;
    for (let x = startX; x < this.camX + this.width + grid; x += grid) {
      ctx.beginPath(); ctx.moveTo(x, this.camY); ctx.lineTo(x, this.camY + this.height); ctx.stroke();
    }
    for (let y = startY; y < this.camY + this.height + grid; y += grid) {
      ctx.beginPath(); ctx.moveTo(this.camX, y); ctx.lineTo(this.camX + this.width, y); ctx.stroke();
    }

    // Extract zone
    ctx.beginPath();
    ctx.arc(this.extractZone.x, this.extractZone.y, this.extractZone.r, 0, Math.PI * 2);
    ctx.strokeStyle = this.state === 'extract' ? 'rgba(255,232,0,0.6)' : 'rgba(0,200,255,0.3)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = this.state === 'extract' ? 'rgba(255,232,0,0.08)' : 'rgba(0,200,255,0.05)';
    ctx.fill();
    ctx.fillStyle = '#8af';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('EXTRACT', this.extractZone.x, this.extractZone.y - this.extractZone.r - 8);

    // Effects
    for (const ef of this.effects) {
      const a = ef.life / ef.maxLife;
      if (ef.type === 'explosion') {
        ctx.beginPath();
        ctx.arc(ef.x, ef.y, ef.radius * (1.2 - a), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,120,20,${a * 0.7})`;
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(ef.x, ef.y, 20 * a, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,232,0,${a})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // Enemies
    for (const e of this.enemies) {
      if (!e.alive && !e._fade) continue;
      const alpha = e.alive ? 1 : (e._fade || 0);
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
      ctx.fillStyle = e.color;
      ctx.fill();
      // HP bar for chargers
      if (e.type === 'charger' && e.alive) {
        ctx.fillStyle = '#333';
        ctx.fillRect(e.x - 16, e.y - e.radius - 10, 32, 4);
        ctx.fillStyle = '#f44';
        ctx.fillRect(e.x - 16, e.y - e.radius - 10, 32 * (e.hp / e.maxHp), 4);
      }
      ctx.globalAlpha = 1;
    }

    // Projectiles
    ctx.fillStyle = '#ffe8a0';
    for (const pr of this.projectiles) {
      ctx.beginPath();
      ctx.arc(pr.x, pr.y, pr.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Players
    for (const p of this.players.values()) {
      if (!p.alive) {
        // Ghost
        ctx.globalAlpha = 0.35;
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      // Body
      ctx.beginPath();
      ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      // Direction indicator
      ctx.fillStyle = '#111';
      ctx.fillRect(4, -3, 12, 6);
      ctx.restore();
      // Name
      ctx.fillStyle = '#ccc';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.name, p.x, p.y - p.radius - 8);
      // Local HP already in HUD
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    // Stratagem buffer UI
    if (this.stratUITimer > 0 && this.stratBuffer.length) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(this.width / 2 - 80, this.height - 100, 160, 28);
      ctx.fillStyle = '#ffe800';
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(this.stratBuffer.map(d => ({up:'↑',down:'↓',left:'←',right:'→'})[d]).join(' '), this.width / 2, this.height - 82);
    }
  },

  loop(ts) {
    if (!this._looping) return;
    if (!this.lastFrame) this.lastFrame = ts;
    let dt = (ts - this.lastFrame) / 1000;
    if (dt > 0.1) dt = 0.05; // catch-up / tab-switch guard
    this.lastFrame = ts;
    this.fps = dt > 0 ? Math.round(1 / dt) : 60;

    if (this.width < 50) this.resize(); // safety

    if (this.state === 'playing' || this.state === 'extract') {
      this.update(dt);
    }
    this.draw();
    requestAnimationFrame((t) => this.loop(t));
  }
};
