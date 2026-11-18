// main.js — Palm Cove Heat's entry point and game core: state, input, the
// player (on foot and behind the wheel), combat, collisions, crime
// reporting, the camera, the world renderer and the main loop. The other
// modules own their systems; this file wires them together.

import { clamp, dist, randRange, pick, segmentHitsRect, resolveCircleRect, mulberry32 } from './util.js';
import { buildCity, WORLD_W, WORLD_H, clampToWorld } from './city.js';
import { SoundFX } from './audio.js';
import {
  createCar, updateTrafficCar, drivePlayerCar, collideCarWorld, collideCarPair,
  drawCar, carRadius,
} from './vehicles.js';
import {
  createPedestrian, maintainCrowd, updatePedestrian, drawPedestrian, knockDown, scarePedestrian,
} from './pedestrians.js';
import { WantedSystem, PoliceManager, drawOfficer } from './police.js';
import { MissionManager } from './missions.js';
import { drawHUD, drawTitleScreen, drawPauseScreen, drawEndScreen } from './hud.js';

const SAVE_KEY = 'palmcoveheat.save.v1';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

class Game {
  constructor() {
    this.city = buildCity();
    this.sfx = new SoundFX();
    this.state = 'title'; // title | playing | paused | busted | wasted
    this.time = 0;
    this.playTime = 0;
    this.cash = 250;
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, down: false };
    this.buttons = [];
    this.showHelp = false;
    this.cam = { x: 1400, y: 1100 };
    this.shake = 0;
    this.damageFlash = 0;
    this.bust = 0;
    this.endFine = 0;
    this.phoneMsg = null;
    this.tracers = [];
    this.particles = [];
    this.skids = [];
    this.crimeCd = 0;
    this.regenDelay = 0;

    this.player = {
      x: this.city.landmarks.playerStart.x,
      y: this.city.landmarks.playerStart.y + 70,
      angle: -Math.PI / 2,
      hp: 100,
      maxHp: 100,
      car: null,
      walkPhase: 0,
      shootCd: 0,
    };
    this.wanted = new WantedSystem();
    this.police = new PoliceManager();
    this.missions = new MissionManager(this);
    this.cars = [];
    this.peds = [];
    this.decor = this.makeDecor();
    this.spawnParkedCars();
    this.spawnTraffic(12);
    for (let i = 0; i < 30; i++) this.peds.push(createPedestrian());
    this.saveExists = !!this.readSave();
    this.bindInput();
  }

  // ---------- setup ----------

  makeDecor() {
    const rng = mulberry32(777);
    const decor = { umbrellas: [], boats: [] };
    for (let i = 0; i < 26; i++) {
      decor.umbrellas.push({
        x: 2870 + rng() * 120,
        y: 80 + rng() * (WORLD_H - 160),
        color: pick(['#ff6b6b', '#feca57', '#48dbfb', '#ff9ff3', '#1dd1a1'], rng),
      });
    }
    for (let i = 0; i < 7; i++) {
      decor.boats.push({ x: 3080 + rng() * 80, y: 200 + rng() * (WORLD_H - 400), angle: rng() * Math.PI, color: pick(['#ffffff', '#f6d8a8', '#bfe3dd'], rng) });
    }
    return decor;
  }

  spawnParkedCars() {
    const rng = mulberry32(4242);
    for (const lot of this.city.parkingLots) {
      const n = 3 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) {
        const x = lot.x + 26 + i * Math.max(30, (lot.w - 40) / n) + rng() * 6;
        const y = lot.y + lot.h / 2;
        if (x > lot.x + lot.w - 20) continue;
        const type = pick(['compact', 'sedan', 'sedan', 'taxi', 'sports'], rng);
        this.cars.push(createCar(type, x, y, Math.PI / 2, { driver: 'parked' }));
      }
    }
    // Parallel parking along the avenues.
    for (let i = 0; i < 16; i++) {
      const vx = pick([240, 640, 1040, 1440, 1840, 2240, 2640], rng);
      const y = 120 + rng() * (WORLD_H - 240);
      const side = rng() < 0.5 ? -1 : 1;
      const type = pick(['compact', 'sedan', 'taxi'], rng);
      this.cars.push(createCar(type, vx + side * 38, y, side > 0 ? Math.PI / 2 : -Math.PI / 2, { driver: 'parked' }));
    }
  }

  spawnTraffic(n) {
    for (let i = 0; i < n; i++) {
      const pt = this.randomTrafficPoint();
      if (!pt) continue;
      const type = pick(['compact', 'sedan', 'sedan', 'taxi', 'sports']);
      const car = createCar(type, pt.x, pt.y, pt.angle, { driver: 'traffic' });
      car.junction = pt.junction;
      this.cars.push(car);
    }
  }

  randomTrafficPoint() {
    // A point on a road, in a lane, at least 500px from the player.
    for (let tries = 0; tries < 12; tries++) {
      const vertical = Math.random() < 0.5;
      if (vertical) {
        const vx = pick([240, 640, 1040, 1440, 1840, 2240, 2640]);
        const y = randRange(80, WORLD_H - 80);
        const dir = Math.random() < 0.5 ? 1 : -1;
        const x = vx + (dir > 0 ? -25 : 25);
        if (dist(x, y, this.player.x, this.player.y) < 500) continue;
        const car = { x, y, angle: dir > 0 ? Math.PI / 2 : -Math.PI / 2 };
        car.junction = null;
        return car;
      }
      const hy = pick([240, 640, 1040, 1440, 1840]);
      const x = randRange(80, 2560);
      const dir = Math.random() < 0.5 ? 1 : -1;
      const y = hy + (dir > 0 ? 25 : -25);
      if (dist(x, y, this.player.x, this.player.y) < 500) continue;
      return { x, y, angle: dir > 0 ? 0 : Math.PI, junction: null };
    }
    return null;
  }

  // ---------- save ----------

  readSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  saveProgress() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ cash: Math.floor(this.cash), missionIndex: this.missions.index }));
      this.saveExists = true;
    } catch (e) { /* private mode: saving is best-effort */ }
  }

  // ---------- input ----------

  bindInput() {
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (e.repeat) return;
      if (e.code === 'KeyP' || e.code === 'Escape') {
        if (this.state === 'playing') this.state = 'paused';
        else if (this.state === 'paused') this.state = 'playing';
      }
      if (e.code === 'KeyM') this.sfx.setMuted(!this.sfx.muted);
      if (e.code === 'KeyE' && this.state === 'playing') this.toggleCar();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    canvas.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    });
    canvas.addEventListener('mousedown', (e) => {
      this.sfx.ensure();
      this.mouse.down = true;
      this.handleClick(e.clientX, e.clientY);
    });
    window.addEventListener('mouseup', () => {
      this.mouse.down = false;
    });
  }

  handleClick(x, y) {
    if (this.state === 'playing') return;
    for (const b of this.buttons) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        this.sfx.click();
        this.runAction(b.action);
        return;
      }
    }
  }

  runAction(action) {
    if (action === 'new') this.newGame();
    else if (action === 'continue') this.continueGame();
    else if (action === 'help') this.showHelp = !this.showHelp;
    else if (action === 'resume') this.state = 'playing';
    else if (action === 'restart') this.newGame();
    else if (action === 'title') this.state = 'title';
    else if (action === 'respawn') this.respawn();
  }

  inputVector() {
    const k = this.keys;
    return {
      up: k.has('KeyW') || k.has('ArrowUp'),
      down: k.has('KeyS') || k.has('ArrowDown'),
      left: k.has('KeyA') || k.has('ArrowLeft'),
      right: k.has('KeyD') || k.has('ArrowRight'),
      run: k.has('ShiftLeft') || k.has('ShiftRight'),
      handbrake: k.has('Space'),
    };
  }

  mouseWorld() {
    return { x: this.cam.x - canvas.width / 2 + this.mouse.x, y: this.cam.y - canvas.height / 2 + this.mouse.y };
  }

  // ---------- high-level state changes ----------

  newGame() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
    this.cash = 250;
    this.resetWorld();
    this.missions.index = 0;
    this.missions.active = null;
    this.missions.cooldown = 2.5;
    this.missions.objectiveText = 'Wait for Sol to call…';
    this.state = 'playing';
    this.playTime = 0;
  }

  continueGame() {
    const save = this.readSave();
    this.resetWorld();
    if (save) {
      this.cash = save.cash || 0;
      this.missions.index = clamp(save.missionIndex || 0, 0, 3);
    }
    this.missions.active = null;
    this.missions.cooldown = 1.5;
    this.state = 'playing';
  }

  resetWorld() {
    const start = this.city.landmarks.playerStart;
    this.player.x = start.x;
    this.player.y = start.y + 70;
    this.player.hp = this.player.maxHp;
    this.player.car = null;
    this.wanted.clear();
    this.bust = 0;
    this.police.officers = [];
    this.cars = this.cars.filter((c) => c.driver !== 'police');
    for (const c of this.cars) {
      if (c.missionTarget) c.dead = true;
    }
    this.cars = this.cars.filter((c) => !c.dead);
    this.tracers = [];
    this.particles = [];
    this.sfx.engineStop();
    this.sfx.sirenStop();
  }

  respawn() {
    const at = this.state === 'busted' ? this.city.landmarks.policeStation.respawn : this.city.landmarks.hospital.respawn;
    if (this.player.car) {
      this.player.car.driver = 'parked';
      this.player.car = null;
    }
    this.player.x = at.x;
    this.player.y = at.y;
    this.player.hp = this.player.maxHp;
    this.wanted.clear();
    this.bust = 0;
    this.police.officers = [];
    for (const c of this.cars) {
      if (c.driver === 'police') {
        c.driver = 'parked';
        c.speed = 0;
        c.officersOut = false;
      }
    }
    this.sfx.engineStop();
    this.sfx.sirenStop();
    this.state = 'playing';
  }

  onBusted() {
    if (this.state !== 'playing') return;
    const fine = Math.min(this.cash, 150 + this.wanted.stars * 120);
    this.cash -= fine;
    this.endFine = fine;
    this.state = 'busted';
    this.sfx.sting();
    this.sfx.engineStop();
    this.sfx.sirenStop();
    this.saveProgress();
  }

  onWasted() {
    if (this.state !== 'playing') return;
    const fine = Math.min(this.cash, 220);
    this.cash -= fine;
    this.endFine = fine;
    this.state = 'wasted';
    this.sfx.sting();
    this.sfx.engineStop();
    this.sfx.sirenStop();
    this.saveProgress();
  }

  // ---------- interactions the other modules call back into ----------

  showPhone(from, text, dur) {
    this.phoneMsg = { from, text, t: dur || 5, total: dur || 5 };
  }

  addCash(n) {
    this.cash += n;
  }

  isWitnessed(x, y) {
    for (const ped of this.peds) {
      if (ped.state !== 'down' && dist(ped.x, ped.y, x, y) < 300) return true;
    }
    for (const car of this.cars) {
      if (car.driver === 'police' && dist(car.x, car.y, x, y) < 680) return true;
    }
    for (const o of this.police.officers) {
      if (dist(o.x, o.y, x, y) < 500) return true;
    }
    return false;
  }

  reportCrime(kind, x, y) {
    const px = x === undefined ? this.player.x : x;
    const py = y === undefined ? this.player.y : y;
    this.wanted.addCrime(kind, this.isWitnessed(px, py));
    // The PD rolls to the scene of the latest reported crime: that is where
    // the hunt starts, until a unit lays eyes on the player.
    this.wanted.lastSeenPos.x = px;
    this.wanted.lastSeenPos.y = py;
  }

  hasLineOfSight(x1, y1, x2, y2) {
    for (const b of this.city.colliders) {
      if (segmentHitsRect(x1, y1, x2, y2, b)) return false;
    }
    return true;
  }

  onPedHit(ped) {
    if (ped.culprit === 'player') {
      this.reportCrime(ped.dead ? 'pedDown' : 'pedHit', ped.x, ped.y);
      this.shake = Math.min(6, this.shake + 2.5);
    }
    for (const other of this.peds) {
      if (other !== ped && dist(other.x, other.y, ped.x, ped.y) < 130) {
        scarePedestrian(other, ped.x, ped.y, 1.8);
      }
    }
    this.sfx.hit();
  }

  onOfficerDown(officer) {
    this.reportCrime('officerDown', officer.x, officer.y);
    this.burst(officer.x, officer.y, '#7fb2ff', 8);
  }

  policeShootAt(officer, distanceToPlayer) {
    const p = this.player;
    const hitChance = clamp(0.6 - distanceToPlayer / 620, 0.14, 0.58);
    const hit = Math.random() < hitChance;
    const tx = p.x + (hit ? 0 : randRange(-46, 46));
    const ty = p.y + (hit ? 0 : randRange(-46, 46));
    this.tracers.push({ x1: officer.x, y1: officer.y, x2: tx, y2: ty, t: 0.07, color: '#ffd0a0' });
    this.sfx.policeShot();
    if (hit) this.damagePlayer(randRange(5, 10));
  }

  damagePlayer(amount) {
    if (this.state !== 'playing') return;
    const p = this.player;
    p.hp -= amount;
    this.damageFlash = 1;
    this.regenDelay = 5;
    if (p.hp <= 0) {
      p.hp = 0;
      this.onWasted();
    }
  }

  burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = randRange(30, 130);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: randRange(0.25, 0.6), color, size: randRange(1.5, 3.5) });
    }
  }

  // ---------- cars & the player ----------

  toggleCar() {
    const p = this.player;
    if (p.car) {
      const car = p.car;
      car.driver = 'parked';
      car.speed = 0;
      p.car = null;
      p.x = car.x + Math.cos(car.angle - Math.PI / 2) * 30;
      p.y = car.y + Math.sin(car.angle - Math.PI / 2) * 30;
      const [nx, ny] = this.collideFoot(p.x, p.y);
      p.x = nx;
      p.y = ny;
      this.sfx.door();
      this.sfx.engineStop();
      return;
    }
    let best = null;
    let bestD = 56;
    for (const car of this.cars) {
      if (car.wrecked) continue;
      const d = dist(p.x, p.y, car.x, car.y);
      if (d < bestD) {
        bestD = d;
        best = car;
      }
    }
    if (!best) return;
    this.enterCar(best);
  }

  enterCar(car) {
    const p = this.player;
    const wasParked = car.driver === 'parked';
    const wasTraffic = car.driver === 'traffic';
    if (car.driver === 'police') {
      this.reportCrime('theft', car.x, car.y);
      this.reportCrime('policeHit', car.x, car.y);
    } else if (wasParked || wasTraffic) {
      this.reportCrime('theft', car.x, car.y);
    }
    if (wasTraffic) {
      // The driver bails out and runs.
      const ped = createPedestrian(car.x + 24, car.y + 10);
      ped.state = 'flee';
      ped.fleeX = 1;
      ped.fleeY = 0.3;
      ped.fleeTimer = 2.4;
      this.peds.push(ped);
    }
    for (const ped of this.peds) {
      if (dist(ped.x, ped.y, car.x, car.y) < 120) scarePedestrian(ped, car.x, car.y, 1.4);
    }
    car.driver = 'player';
    car.junction = null;
    p.car = car;
    this.sfx.door();
    this.sfx.engineStart();
  }

  leaveCarInDropoff(car) {
    const p = this.player;
    if (p.car === car) {
      p.car = null;
      p.x = car.x;
      p.y = car.y + 44;
      const [nx, ny] = this.collideFoot(p.x, p.y);
      p.x = nx;
      p.y = ny;
      this.sfx.engineStop();
      this.sfx.door();
    }
    this.cars = this.cars.filter((c) => c !== car);
  }

  collideFoot(x, y) {
    let nx = x;
    let ny = y;
    for (const b of this.city.colliders) {
      [nx, ny] = resolveCircleRect(nx, ny, 10, b);
    }
    const p = clampToWorld({ x: nx, y: ny }, 8);
    return [p.x, p.y];
  }

  // ---------- per-frame update ----------

  update(dt) {
    this.time += dt;
    if (this.phoneMsg) {
      this.phoneMsg.t -= dt;
      if (this.phoneMsg.t <= 0) this.phoneMsg = null;
    }
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.6);
    this.shake = Math.max(0, this.shake - dt * 14);
    if (this.crimeCd > 0) this.crimeCd -= dt;

    if (this.state === 'title') {
      this.updateAmbient(dt);
      return;
    }
    if (this.state !== 'playing') return;
    this.playTime += dt;
    const p = this.player;
    const input = this.inputVector();

    // Player: driving or on foot.
    if (p.car) {
      drivePlayerCar(p.car, input, dt);
      const impact = collideCarWorld(p.car, this);
      if (impact > 130) {
        this.sfx.crash(impact / 300);
        this.shake = Math.min(7, impact / 60);
        if (this.crimeCd <= 0) {
          this.reportCrime('crash', p.car.x, p.car.y);
          this.crimeCd = 1.4;
        }
      }
      if ((input.handbrake && Math.abs(p.car.speed) > 120) || Math.abs(p.car.steerVis) > 0.7 && Math.abs(p.car.speed) > 200) {
        this.skids.push({ x: p.car.x, y: p.car.y, angle: p.car.angle, t: 0 });
        if (this.skids.length > 500) this.skids.shift();
      }
      p.x = p.car.x;
      p.y = p.car.y;
      this.sfx.engineUpdate(Math.abs(p.car.speed) / p.car.spec.topSpeed);
    } else {
      this.updateOnFoot(dt, input);
    }

    // Health regen after a quiet spell.
    if (this.regenDelay > 0) this.regenDelay -= dt;
    else if (p.hp > 0 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + 2.2 * dt);

    // Traffic and parked-car upkeep.
    for (const car of this.cars) {
      if (car.driver === 'traffic') updateTrafficCar(car, dt, this);
    }
    this.maintainTraffic();

    // Car versus car.
    for (let i = 0; i < this.cars.length; i++) {
      for (let j = i + 1; j < this.cars.length; j++) {
        const a = this.cars[i];
        const b = this.cars[j];
        if (Math.abs(a.x - b.x) > 70 || Math.abs(a.y - b.y) > 70) continue;
        const impact = collideCarPair(a, b);
        if (impact > 120) {
          if (a.driver === 'traffic') a.stopTimer = Math.max(a.stopTimer, 1.6);
          if (b.driver === 'traffic') b.stopTimer = Math.max(b.stopTimer, 1.6);
          if ((a === p.car || b === p.car) && this.crimeCd <= 0) {
            this.reportCrime('crash', p.x, p.y);
            this.crimeCd = 1.4;
            this.sfx.crash(impact / 300);
          }
        }
      }
    }

    // Cars versus pedestrians and officers.
    for (const car of this.cars) {
      if (Math.abs(car.speed) < 55) continue;
      const r = carRadius(car) + 4;
      for (const ped of this.peds) {
        if (ped.state === 'down') continue;
        if (dist(car.x, car.y, ped.x, ped.y) < r) {
          ped.culprit = car.driver === 'player' ? 'player' : 'traffic';
          knockDown(ped, this);
          if (car.driver !== 'player' && car.driver !== 'parked') car.stopTimer = Math.max(car.stopTimer, 2);
        }
      }
      if (car.driver === 'player') {
        for (const o of this.police.officers) {
          if (dist(car.x, car.y, o.x, o.y) < r) {
            o.hp -= 42;
            o.x += (o.x - car.x) * 0.4;
            o.y += (o.y - car.y) * 0.4;
            this.burst(o.x, o.y, '#7fb2ff', 6);
          }
        }
      }
    }

    // Traffic versus the player on foot.
    if (!p.car) {
      for (const car of this.cars) {
        if (car.driver !== 'traffic' || Math.abs(car.speed) < 60) continue;
        if (dist(car.x, car.y, p.x, p.y) < carRadius(car) + 8) {
          if (!car.hitPlayerCd || car.hitPlayerCd <= 0) {
            car.hitPlayerCd = 1.2;
            this.damagePlayer(11);
            this.burst(p.x, p.y, '#e74c3c', 6);
          }
        }
        if (car.hitPlayerCd > 0) car.hitPlayerCd -= dt;
      }
    }

    // Crowd.
    maintainCrowd(this);
    for (const ped of this.peds) updatePedestrian(ped, dt, this);

    // Police and the wanted level.
    this.police.maintain(this, dt);
    this.police.computeVisibility(this);
    this.wanted.update(dt);
    this.police.update(this, dt);
    this.updateSiren();

    // Missions.
    this.missions.update(dt);

    // Effects.
    for (const t of this.tracers) t.t -= dt;
    this.tracers = this.tracers.filter((t) => t.t > 0);
    for (const pt of this.particles) {
      pt.t += dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
    }
    this.particles = this.particles.filter((pt) => pt.t < pt.life);
    for (const s of this.skids) s.t += dt;
    this.skids = this.skids.filter((s) => s.t < 7);

    // Camera.
    const focus = p.car || p;
    const lookX = p.car ? Math.cos(p.car.angle) * p.car.speed * 0.34 : 0;
    const lookY = p.car ? Math.sin(p.car.angle) * p.car.speed * 0.34 : 0;
    this.cam.x += (focus.x + lookX - this.cam.x) * Math.min(1, dt * 5);
    this.cam.y += (focus.y + lookY - this.cam.y) * Math.min(1, dt * 5);
  }

  updateAmbient(dt) {
    // Title-screen backdrop: traffic flows, people stroll, the camera drifts.
    for (const car of this.cars) {
      if (car.driver === 'traffic') updateTrafficCar(car, dt, this);
    }
    for (const ped of this.peds) updatePedestrian(ped, dt, this);
    this.cam.x = 1400 + Math.cos(this.time * 0.05) * 330;
    this.cam.y = 1150 + Math.sin(this.time * 0.037) * 260;
  }

  maintainTraffic() {
    const p = this.player;
    let count = 0;
    for (const car of this.cars) {
      if (car.driver !== 'traffic') continue;
      if (dist(car.x, car.y, p.x, p.y) > 1650) car.dead = true;
      else count++;
    }
    if (this.cars.some((c) => c.dead)) this.cars = this.cars.filter((c) => !c.dead);
    if (count < 11) this.spawnTraffic(11 - count);
  }

  updateSiren() {
    let nearest = Infinity;
    for (const car of this.cars) {
      if (car.driver === 'police') nearest = Math.min(nearest, dist(car.x, car.y, this.player.x, this.player.y));
    }
    if (this.wanted.stars > 0 && nearest < 760) {
      this.sfx.sirenStart();
      this.sfx.sirenUpdate(0.16 * (1 - nearest / 800));
    } else {
      this.sfx.sirenStop();
    }
  }

  updateOnFoot(dt, input) {
    const p = this.player;
    let mx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    let my = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    const moving = mx !== 0 || my !== 0;
    if (moving) {
      const len = Math.hypot(mx, my);
      mx /= len;
      my /= len;
      const speed = input.run ? 168 : 102;
      p.x += mx * speed * dt;
      p.y += my * speed * dt;
      p.walkPhase += dt * (input.run ? 13 : 9);
      if (!this.mouse.down) p.angle = Math.atan2(my, mx);
    }
    const [nx, ny] = this.collideFoot(p.x, p.y);
    p.x = nx;
    p.y = ny;

    // Shooting: hold the mouse to fire toward the cursor.
    p.shootCd -= dt;
    if (this.mouse.down) {
      const mw = this.mouseWorld();
      p.angle = Math.atan2(mw.y - p.y, mw.x - p.x);
      if (p.shootCd <= 0) {
        p.shootCd = 0.17;
        this.shoot();
      }
    }
  }

  shoot() {
    const p = this.player;
    const angle = p.angle;
    const range = 430;
    let hitX = p.x + Math.cos(angle) * range;
    let hitY = p.y + Math.sin(angle) * range;
    let bestT = range;
    // Ray-march in small steps: cheap and robust for this scale of game.
    for (let t = 12; t < range; t += 7) {
      const x = p.x + Math.cos(angle) * t;
      const y = p.y + Math.sin(angle) * t;
      let hit = false;
      for (const b of this.city.colliders) {
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { hit = true; break; }
      }
      if (!hit) {
        for (const o of this.police.officers) {
          if (dist(x, y, o.x, o.y) < 11) {
            o.hp -= 34;
            this.burst(x, y, '#7fb2ff', 5);
            hit = true;
            break;
          }
        }
      }
      if (!hit) {
        for (const ped of this.peds) {
          if (ped.state !== 'down' && dist(x, y, ped.x, ped.y) < 10) {
            ped.hp -= 34;
            if (ped.hp <= 0) {
              ped.culprit = 'player';
              knockDown(ped, this);
            } else {
              scarePedestrian(ped, p.x, p.y, 2);
            }
            hit = true;
            break;
          }
        }
      }
      if (!hit) {
        for (const car of this.cars) {
          if (dist(x, y, car.x, car.y) < carRadius(car) * 0.85) {
            car.hp -= 9;
            if (car.hp <= 0 && !car.wrecked) {
              car.wrecked = true;
              car.speed = 0;
              this.burst(x, y, '#555', 10);
            }
            this.burst(x, y, '#ffd88a', 3);
            hit = true;
            break;
          }
        }
      }
      if (hit) {
        bestT = t;
        hitX = x;
        hitY = y;
        break;
      }
    }
    this.tracers.push({ x1: p.x + Math.cos(angle) * 14, y1: p.y + Math.sin(angle) * 14, x2: hitX, y2: hitY, t: 0.06, color: '#ffe9a0' });
    this.reportCrime('shot', p.x, p.y);
    for (const ped of this.peds) {
      if (dist(ped.x, ped.y, p.x, p.y) < 150) scarePedestrian(ped, p.x, p.y, 1.6);
    }
    this.sfx.shot();
    this.shake = Math.min(3, this.shake + 0.5);
  }

  // ---------- rendering ----------

  render() {
    const W = canvas.width;
    const H = canvas.height;
    this.buttons = [];
    ctx.save();
    const shX = this.shake ? randRange(-this.shake, this.shake) : 0;
    const shY = this.shake ? randRange(-this.shake, this.shake) : 0;
    ctx.translate(W / 2 - this.cam.x + shX, H / 2 - this.cam.y + shY);
    this.drawWorld();
    ctx.restore();

    if (this.state === 'title') drawTitleScreen(ctx, this, W, H);
    else if (this.state === 'paused') {
      drawHUD(ctx, this, W, H);
      drawPauseScreen(ctx, this, W, H);
    } else if (this.state === 'busted' || this.state === 'wasted') {
      drawHUD(ctx, this, W, H);
      drawEndScreen(ctx, this, W, H);
    } else {
      drawHUD(ctx, this, W, H);
      this.drawObjectiveArrow(W, H);
    }
  }

  drawObjectiveArrow(W, H) {
    const m = this.missions.marker;
    if (!m || this.state !== 'playing') return;
    const sx = m.x - this.cam.x + W / 2;
    const sy = m.y - this.cam.y + H / 2;
    if (sx > -20 && sx < W + 20 && sy > -20 && sy < H + 20) return; // beacon visible
    const cx = W / 2;
    const cy = H / 2;
    const ang = Math.atan2(sy - cy, sx - cx);
    const ex = clamp(cx + Math.cos(ang) * (W * 0.44), 30, W - 30);
    const ey = clamp(cy + Math.sin(ang) * (H * 0.42), 30, H - 30);
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(ang);
    ctx.fillStyle = '#ffd32a';
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-8, -9);
    ctx.lineTo(-8, 9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#ffd32a';
    ctx.font = "bold 12px 'Segoe UI', sans-serif";
    ctx.textAlign = 'center';
    const d = Math.round(dist(this.player.x, this.player.y, m.x, m.y));
    ctx.fillText(`${d}m`, ex, ey + 24);
  }

  drawWorld() {
    const city = this.city;
    // Base ground: pale coastal grass-concrete.
    ctx.fillStyle = '#a8c69f';
    ctx.fillRect(-200, -200, WORLD_W + 400, WORLD_H + 400);
    // Park.
    const park = city.landmarks.hideout.parkRect;
    ctx.fillStyle = '#79b657';
    ctx.fillRect(park.x, park.y, park.w, park.h);
    ctx.fillStyle = '#8fc977';
    ctx.fillRect(park.x + 60, park.y + 60, park.w - 120, park.h - 120);
    // Promenade + beach + sea.
    ctx.fillStyle = '#d9c9a8';
    ctx.fillRect(2690, 0, 150, WORLD_H);
    ctx.fillStyle = '#f2dfae';
    ctx.fillRect(city.sand.x, city.sand.y, city.sand.w, city.sand.h);
    const seaGrad = ctx.createLinearGradient(city.sea.x, 0, WORLD_W, 0);
    seaGrad.addColorStop(0, '#3d9db8');
    seaGrad.addColorStop(1, '#1d6f9f');
    ctx.fillStyle = seaGrad;
    ctx.fillRect(city.sea.x, city.sea.y, city.sea.w, city.sea.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 22; i++) {
      const y = 60 + i * 108;
      const off = Math.sin(this.time * 0.9 + i * 1.7) * 9;
      ctx.beginPath();
      ctx.moveTo(city.sea.x + 12 + off, y);
      ctx.lineTo(city.sea.x + 66 + off, y);
      ctx.stroke();
    }
    // Marina pier and boats.
    const pier = city.landmarks.marina.pier;
    ctx.fillStyle = '#9a7b52';
    ctx.fillRect(pier.x, pier.y, pier.w, pier.h);
    for (const boat of this.decor.boats) {
      ctx.save();
      ctx.translate(boat.x, boat.y);
      ctx.rotate(boat.angle);
      ctx.fillStyle = boat.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, 20, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#8a5a3b';
      ctx.fillRect(-2, -8, 4, 16);
      ctx.restore();
    }
    // Beach umbrellas.
    for (const u of this.decor.umbrellas) {
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.beginPath();
      ctx.arc(u.x + 3, u.y + 4, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = u.color;
      ctx.beginPath();
      ctx.arc(u.x, u.y, 9, 0, Math.PI * 2);
      ctx.fill();
    }

    this.drawRoads();
    // Parking lots.
    for (const lot of city.parkingLots) {
      ctx.fillStyle = '#565b63';
      ctx.fillRect(lot.x, lot.y, lot.w, lot.h);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1.5;
      for (let x = lot.x + 14; x < lot.x + lot.w - 8; x += 30) {
        ctx.beginPath();
        ctx.moveTo(x, lot.y + 5);
        ctx.lineTo(x, lot.y + lot.h - 5);
        ctx.stroke();
      }
    }
    // Drop-off zone.
    const drop = city.landmarks.garage.dropoff;
    ctx.fillStyle = 'rgba(255, 159, 67, 0.35)';
    ctx.fillRect(drop.x, drop.y, drop.w, drop.h);
    ctx.strokeStyle = '#ff9f43';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(drop.x, drop.y, drop.w, drop.h);
    ctx.fillStyle = '#a35b12';
    ctx.font = "bold 15px 'Segoe UI', sans-serif";
    ctx.textAlign = 'center';
    ctx.fillText('DROP-OFF', drop.x + drop.w / 2, drop.y + drop.h / 2 + 5);
    // Hideout clearing.
    const hide = city.landmarks.hideout;
    ctx.fillStyle = 'rgba(255, 244, 190, 0.5)';
    ctx.beginPath();
    ctx.arc(hide.x, hide.y, hide.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120, 90, 20, 0.5)';
    ctx.stroke();
    ctx.fillStyle = '#5c430d';
    ctx.font = "bold 13px 'Segoe UI', sans-serif";
    ctx.fillText("SOL'S HIDEOUT", hide.x, hide.y + 4);

    // Skid marks under everything mobile.
    ctx.fillStyle = 'rgba(25,25,30,0.35)';
    for (const s of this.skids) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.angle);
      ctx.globalAlpha = Math.max(0, 0.35 - s.t * 0.05);
      ctx.fillRect(-14, -11, 28, 4);
      ctx.fillRect(-14, 7, 28, 4);
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    // Buildings: shadow, walls, roof, details, landmark labels.
    for (const b of city.buildings) {
      ctx.fillStyle = 'rgba(40, 40, 50, 0.28)';
      ctx.fillRect(b.x + 9, b.y + 11, b.w, b.h);
      ctx.fillStyle = b.body;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = b.roof;
      ctx.fillRect(b.x + 7, b.y + 7, b.w - 14, b.h - 14);
      ctx.fillStyle = 'rgba(0,0,0,0.13)';
      const acx = b.x + 14 + b.seed * (b.w - 60);
      const acy = b.y + 14 + ((b.seed * 7) % 1) * (b.h - 60);
      ctx.fillRect(acx, acy, 22, 16);
      ctx.fillRect(b.x + b.w - 44, b.y + b.h - 40, 26, 20);
      if (b.label) {
        ctx.fillStyle = 'rgba(30, 30, 46, 0.85)';
        ctx.font = "bold 17px 'Segoe UI', sans-serif";
        ctx.textAlign = 'center';
        ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 6);
      }
    }
    // Trees.
    for (const t of city.trees) {
      ctx.fillStyle = 'rgba(30,60,30,0.3)';
      ctx.beginPath();
      ctx.arc(t.x + 3, t.y + 4, t.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3e9c4f';
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#57bb6a';
      ctx.beginPath();
      ctx.arc(t.x - t.r * 0.3, t.y - t.r * 0.3, t.r * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }

    // Mission beacon.
    const m = this.missions.marker;
    if (m && this.state !== 'title') {
      const pulse = 0.6 + Math.sin(this.time * 4) * 0.25;
      const grad = ctx.createLinearGradient(0, m.y - 190, 0, m.y);
      grad.addColorStop(0, 'rgba(255, 211, 42, 0)');
      grad.addColorStop(1, `rgba(255, 211, 42, ${0.5 * pulse})`);
      ctx.fillStyle = grad;
      ctx.fillRect(m.x - 13, m.y - 190, 26, 190);
      ctx.strokeStyle = `rgba(255, 211, 42, ${pulse})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(m.x, m.y, 26 + Math.sin(this.time * 4) * 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffd32a';
      ctx.font = "bold 14px 'Segoe UI', sans-serif";
      ctx.textAlign = 'center';
      ctx.fillText(m.label, m.x, m.y - 34);
    }

    // Entities.
    for (const ped of this.peds) drawPedestrian(ctx, ped);
    for (const car of this.cars) drawCar(ctx, car, this.time);
    for (const o of this.police.officers) drawOfficer(ctx, o);
    if (!this.player.car) this.drawPlayer();

    // Tracers and particles.
    for (const t of this.tracers) {
      ctx.strokeStyle = t.color;
      ctx.globalAlpha = clamp(t.t / 0.07, 0, 1) * 0.9;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(t.x1, t.y1);
      ctx.lineTo(t.x2, t.y2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const pt of this.particles) {
      ctx.globalAlpha = 1 - pt.t / pt.life;
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Bust ring around the player while the meter fills.
    if (this.bust > 0.03 && this.state === 'playing') {
      ctx.strokeStyle = 'rgba(255, 60, 40, 0.85)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(this.player.x, this.player.y, 30, -Math.PI / 2, -Math.PI / 2 + this.bust * Math.PI * 2);
      ctx.stroke();
    }
  }

  drawRoads() {
    ctx.fillStyle = '#4a4f57';
    for (const vx of [240, 640, 1040, 1440, 1840, 2240, 2640]) {
      ctx.fillRect(vx - 50, -100, 100, WORLD_H + 200);
    }
    for (const hy of [240, 640, 1040, 1440, 1840]) {
      ctx.fillRect(-100, hy - 50, 3120, 100);
    }
    // Edge lines.
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    for (const vx of [240, 640, 1040, 1440, 1840, 2240, 2640]) {
      ctx.beginPath();
      ctx.moveTo(vx - 48, 0);
      ctx.lineTo(vx - 48, WORLD_H);
      ctx.moveTo(vx + 48, 0);
      ctx.lineTo(vx + 48, WORLD_H);
      ctx.stroke();
    }
    for (const hy of [240, 640, 1040, 1440, 1840]) {
      ctx.beginPath();
      ctx.moveTo(0, hy - 48);
      ctx.lineTo(3020, hy - 48);
      ctx.moveTo(0, hy + 48);
      ctx.lineTo(3020, hy + 48);
      ctx.stroke();
    }
    // Dashed centre lines.
    ctx.strokeStyle = 'rgba(255, 214, 90, 0.75)';
    ctx.lineWidth = 3;
    ctx.setLineDash([26, 30]);
    for (const vx of [240, 640, 1040, 1440, 1840, 2240, 2640]) {
      ctx.beginPath();
      ctx.moveTo(vx, 0);
      ctx.lineTo(vx, WORLD_H);
      ctx.stroke();
    }
    for (const hy of [240, 640, 1040, 1440, 1840]) {
      ctx.beginPath();
      ctx.moveTo(0, hy);
      ctx.lineTo(3020, hy);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  drawPlayer() {
    const p = this.player;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = 'rgba(30,30,40,0.3)';
    ctx.beginPath();
    ctx.ellipse(1, 2, 9, 7.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(p.angle);
    // Gun arm when aiming or firing.
    if (this.mouse.down || p.shootCd > 0) {
      ctx.strokeStyle = '#2b2b30';
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.moveTo(4, 3);
      ctx.lineTo(17, 1);
      ctx.stroke();
      ctx.fillStyle = '#17171c';
      ctx.fillRect(14, -1.4, 8, 2.8);
    }
    ctx.fillStyle = '#0e7c86'; // Danny's teal jacket
    ctx.beginPath();
    ctx.arc(0, 0, 8.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f1c27d';
    ctx.beginPath();
    ctx.arc(0, 0, 4.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#26324a'; // cap
    ctx.beginPath();
    ctx.arc(0, 0, 4.8, Math.PI * 0.9, Math.PI * 2.05);
    ctx.fill();
    ctx.restore();
    // Name tag.
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = "bold 10px 'Segoe UI', sans-serif";
    ctx.textAlign = 'center';
    ctx.fillText('DANNY', p.x, p.y - 16);
  }
}

const game = new Game();

// A small, deliberate staging/inspection hook: the maker (and the automated
// play-test) uses it to set up screenshots and verify game state. It exposes
// no cheats a player would want — the title screen is one click away anyway.
window.PALM_COVE = {
  game,
  snapshot() {
    const p = game.player;
    return {
      state: game.state,
      cash: Math.floor(game.cash),
      stars: game.wanted.stars,
      heat: Math.round(game.wanted.heat),
      bust: Math.round(game.bust * 100) / 100,
      player: { x: Math.round(p.x), y: Math.round(p.y), hp: Math.round(p.hp), inCar: p.car ? p.car.type : null },
      missionIndex: game.missions.index,
      missionStep: game.missions.active ? game.missions.active.step : null,
      objective: game.missions.objectiveText,
      marker: game.missions.marker,
      cars: game.cars.length,
      peds: game.peds.length,
      officers: game.police.officers.length,
      phone: game.phoneMsg ? game.phoneMsg.text : null,
    };
  },
  newGame() { game.newGame(); },
  teleport(x, y) {
    const p = game.player;
    if (p.car) { p.car.x = x; p.car.y = y; p.car.speed = 0; }
    p.x = x;
    p.y = y;
    game.cam.x = x;
    game.cam.y = y;
  },
  setWanted(stars) {
    const table = [0, 15, 40, 80, 140, 220];
    game.wanted.heat = table[clamp(stars, 0, 5)];
    game.wanted.unseenTime = 0;
    game.wanted.lastSeenPos.x = game.player.x;
    game.wanted.lastSeenPos.y = game.player.y;
  },
  enterNearestCar() { game.toggleCar(); },
  startMission(i) {
    game.missions.index = i;
    game.missions.active = null;
    game.missions.cooldown = 0;
  },
};

let lastTs = 0;
function frame(ts) {
  const dt = Math.min(0.033, lastTs ? (ts - lastTs) / 1000 : 0.016);
  lastTs = ts;
  game.update(dt);
  game.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
