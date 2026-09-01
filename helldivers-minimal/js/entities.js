// Game entities: Player, Enemy, Projectile, Stratagem effects
const Entities = {
  Player: class {
    constructor(id, name, x, y, color) {
      this.id = id;
      this.name = name;
      this.x = x;
      this.y = y;
      this.vx = 0;
      this.vy = 0;
      this.angle = 0;
      this.radius = 14;
      this.speed = 160;
      this.sprintMul = 1.55;
      this.hp = 100;
      this.maxHp = 100;
      this.ammo = 30;
      this.maxAmmo = 30;
      this.reloadTime = 0;
      this.fireCooldown = 0;
      this.color = color || '#ffe800';
      this.alive = true;
      this.kills = 0;
      this.input = { up: false, down: false, left: false, right: false, shoot: false, sprint: false, reload: false, aimX: 0, aimY: 0 };
      this.stratagemBuffer = [];
      this.stratagemTimer = 0;
      this.invuln = 0;
    }

    update(dt, mapW, mapH) {
      if (!this.alive) return;
      if (this.invuln > 0) this.invuln -= dt;
      if (this.reloadTime > 0) {
        this.reloadTime -= dt;
        if (this.reloadTime <= 0) {
          this.ammo = this.maxAmmo;
          AudioSys.reload();
        }
      }
      if (this.fireCooldown > 0) this.fireCooldown -= dt;

      const inp = this.input;
      let mx = 0, my = 0;
      if (inp.up) my -= 1;
      if (inp.down) my += 1;
      if (inp.left) mx -= 1;
      if (inp.right) mx += 1;
      if (mx || my) {
        const len = Math.hypot(mx, my);
        mx /= len; my /= len;
        const spd = this.speed * (inp.sprint ? this.sprintMul : 1);
        this.vx = mx * spd;
        this.vy = my * spd;
      } else {
        this.vx *= 0.8;
        this.vy *= 0.8;
      }
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.x = Math.max(this.radius, Math.min(mapW - this.radius, this.x));
      this.y = Math.max(this.radius, Math.min(mapH - this.radius, this.y));

      // Aim
      this.angle = Math.atan2(inp.aimY - this.y, inp.aimX - this.x);

      if (inp.reload && this.reloadTime <= 0 && this.ammo < this.maxAmmo) {
        this.reloadTime = 1.4;
      }
    }

    tryShoot(projectiles) {
      if (!this.alive || this.fireCooldown > 0 || this.reloadTime > 0 || this.ammo <= 0) return;
      this.ammo--;
      this.fireCooldown = 0.12;
      const speed = 520;
      const spread = (Math.random() - 0.5) * 0.06;
      const a = this.angle + spread;
      projectiles.push({
        x: this.x + Math.cos(a) * (this.radius + 6),
        y: this.y + Math.sin(a) * (this.radius + 6),
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: 1.2,
        owner: this.id,
        damage: 18,
        radius: 3
      });
      AudioSys.shoot();
    }

    takeDamage(amount) {
      if (!this.alive || this.invuln > 0) return;
      this.hp -= amount;
      this.invuln = 0.35;
      AudioSys.hit();
      if (this.hp <= 0) {
        this.hp = 0;
        this.alive = false;
        AudioSys.death();
      }
    }

    serialize() {
      return {
        id: this.id, name: this.name, x: this.x, y: this.y, angle: this.angle,
        hp: this.hp, ammo: this.ammo, alive: this.alive, color: this.color, kills: this.kills
      };
    }
  },

  Enemy: class {
    constructor(x, y, type = 'bug') {
      this.x = x;
      this.y = y;
      this.type = type;
      this.radius = type === 'charger' ? 22 : 12;
      this.hp = type === 'charger' ? 120 : 35;
      this.maxHp = this.hp;
      this.speed = type === 'charger' ? 90 : 70 + Math.random() * 30;
      this.damage = type === 'charger' ? 25 : 12;
      this.attackCd = 0;
      this.alive = true;
      this.color = type === 'charger' ? '#aa4422' : '#66aa33';
    }

    update(dt, players, mapW, mapH) {
      if (!this.alive) return;
      // Find nearest living player
      let nearest = null, best = Infinity;
      for (const p of players.values()) {
        if (!p.alive) continue;
        const d = Math.hypot(p.x - this.x, p.y - this.y);
        if (d < best) { best = d; nearest = p; }
      }
      if (nearest) {
        const dx = nearest.x - this.x;
        const dy = nearest.y - this.y;
        const dist = Math.hypot(dx, dy) || 1;
        this.x += (dx / dist) * this.speed * dt;
        this.y += (dy / dist) * this.speed * dt;
        if (dist < this.radius + nearest.radius + 2 && this.attackCd <= 0) {
          nearest.takeDamage(this.damage);
          this.attackCd = 0.8;
        }
      }
      if (this.attackCd > 0) this.attackCd -= dt;
      this.x = Math.max(this.radius, Math.min(mapW - this.radius, this.x));
      this.y = Math.max(this.radius, Math.min(mapH - this.radius, this.y));
    }

    takeDamage(amount) {
      this.hp -= amount;
      if (this.hp <= 0) {
        this.alive = false;
        AudioSys.enemyDie();
        return true;
      }
      AudioSys.enemyHit();
      return false;
    }
  },

  // Simple particle / effect
  Effect: class {
    constructor(x, y, type, duration = 0.5) {
      this.x = x;
      this.y = y;
      this.type = type; // 'explosion', 'muzzle', 'strat'
      this.life = duration;
      this.maxLife = duration;
      this.radius = type === 'explosion' ? 40 : 8;
    }
  }
};

// Stratagem definitions (simplified directional codes using WASD while Ctrl held)
const Stratagems = {
  list: [
    { name: 'Resupply', code: ['down', 'down', 'up', 'right'], cooldown: 40, icon: '📦' },
    { name: 'Orbital Strike', code: ['right', 'right', 'up'], cooldown: 35, icon: '💥' },
    { name: 'Reinforce', code: ['up', 'down', 'right', 'left', 'up'], cooldown: 60, icon: '🪂' },
    { name: 'Eagle Strafing', code: ['up', 'right', 'right'], cooldown: 25, icon: '🦅' }
  ],

  match(buffer) {
    for (const s of this.list) {
      if (buffer.length < s.code.length) continue;
      const slice = buffer.slice(-s.code.length);
      if (slice.every((v, i) => v === s.code[i])) return s;
    }
    return null;
  }
};
