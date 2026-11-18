// missions.js — Sol Ferrer's three-job story chain for Danny Solano, plus
// the free-roam car-fencing loop that keeps paying after the story ends.
// Each mission is a small state machine: a phone briefing from Sol, an
// objective with a world marker, a payoff, and a restart if the target is
// destroyed or the clock runs out.

import { dist, pointInRect } from './util.js';
import { createCar } from './vehicles.js';

export const MISSION_DEFS = [
  {
    title: 'Lift the Aurelion',
    pay: 1200,
    brief: 'Danny. A collector wants the gold Aurelion GT parked up at the marina. Lift it and bring it to my garage. Quiet-ish, yeah?',
  },
  {
    title: 'Hot Package',
    pay: 1800,
    brief: 'The casino is holding a package for me. Pick it up at their back door and get it to the beach house on the promenade. The clock is ticking — and they WILL call it in.',
  },
  {
    title: 'Casino Cream',
    pay: 3000,
    brief: 'Big one, Danny. The Palm Trust cash van leaves my casino loaded tonight. Take it, lose the heat, then park it in the park hideout. Do not scratch it.',
  },
];

export class MissionManager {
  constructor(game) {
    this.game = game;
    this.index = 0; // next mission to run (0..3); 3 means the story is done
    this.active = null; // { def, step, timer, targetCar }
    this.cooldown = 2.5; // grace period before the first briefing
    this.fenceCooldown = 0;
    this.marker = null; // {x, y, label}
    this.objectiveText = 'Wait for Sol to call…';
  }

  /** Begin the next story mission, or settle into free-roam fencing. */
  startNext() {
    const game = this.game;
    if (this.index >= MISSION_DEFS.length) {
      this.active = null;
      this.marker = null;
      this.objectiveText = 'Free roam — fence any car at Sol\u2019s drop-off, or just enjoy Palm Cove.';
      return;
    }
    const def = MISSION_DEFS[this.index];
    this.active = { def, step: 'intro', timer: 0, targetCar: null };
    game.showPhone('SOL', def.brief, 7);
    game.sfx.phone();
    if (this.index === 0) this.setupLiftTheAurelion();
    else if (this.index === 1) this.setupHotPackage();
    else this.setupCasinoCream();
  }

  setupLiftTheAurelion() {
    const game = this.game;
    const spot = game.city.landmarks.marina.carSpawn;
    const car = createCar('sports', spot.x, spot.y, spot.angle, { driver: 'parked', color: '#ffd21f' });
    car.missionTarget = true;
    game.cars.push(car);
    this.active.targetCar = car;
    this.active.step = 'steal';
    this.marker = { x: car.x, y: car.y, label: 'AURELION GT' };
    this.objectiveText = 'Steal the gold Aurelion GT at the marina.';
  }

  setupHotPackage() {
    const door = this.game.city.landmarks.casino.door;
    this.active.step = 'pickup';
    this.active.timer = 0;
    this.marker = { x: door.x, y: door.y, label: 'PACKAGE' };
    this.objectiveText = 'Pick up the package at the casino\u2019s back door.';
  }

  setupCasinoCream() {
    const game = this.game;
    const spot = game.city.landmarks.casino.vanSpawn;
    const van = createCar('van', spot.x, spot.y, spot.angle, { driver: 'parked' });
    van.missionTarget = true;
    game.cars.push(van);
    this.active.targetCar = van;
    this.active.step = 'steal';
    this.marker = { x: van.x, y: van.y, label: 'CASH VAN' };
    this.objectiveText = 'Steal the Palm Trust cash van at the casino.';
  }

  fail(reason) {
    const game = this.game;
    game.showPhone('SOL', reason, 5.5);
    game.sfx.fail();
    this.active = null;
    this.marker = null;
    this.cooldown = 5;
    this.objectiveText = 'Job blown. Sol will call with another try…';
  }

  complete() {
    const game = this.game;
    const def = this.active.def;
    game.addCash(def.pay);
    game.sfx.cash();
    game.showPhone('SOL', `Done and dusted. $${def.pay.toLocaleString()} wired to you, Danny.`, 5.5);
    this.index++;
    this.active = null;
    this.marker = null;
    this.cooldown = 6;
    this.objectiveText = 'Nice work. Wait for Sol\u2019s next call…';
    game.saveProgress();
  }

  update(dt) {
    const game = this.game;
    const p = game.player;
    if (this.fenceCooldown > 0) this.fenceCooldown -= dt;
    if (!this.active) {
      if (this.index < MISSION_DEFS.length) {
        this.cooldown -= dt;
        if (this.cooldown <= 0) this.startNext();
      } else {
        this.updateFencing();
      }
      return;
    }
    const a = this.active;

    if (this.index === 0) {
      // Lift the Aurelion.
      if (a.targetCar.wrecked) return this.fail('The Aurelion is a write-off, Danny. The collector just hung up on me. Sit tight, I will find another.');
      if (a.step === 'steal') {
        this.marker.x = a.targetCar.x;
        this.marker.y = a.targetCar.y;
        if (p.car === a.targetCar) {
          a.step = 'deliver';
          const d = game.city.landmarks.garage.dropoff;
          this.marker = { x: d.x + d.w / 2, y: d.y + d.h / 2, label: 'DROP-OFF' };
          this.objectiveText = 'Deliver the Aurelion to Sol\u2019s garage drop-off.';
          game.showPhone('SOL', 'That\u2019s my girl singing. Bring her home, Danny.', 4.5);
        }
      } else if (a.step === 'deliver') {
        if (p.car === a.targetCar && pointInRect(p.car.x, p.car.y, game.city.landmarks.garage.dropoff)) {
          game.leaveCarInDropoff(a.targetCar);
          return this.complete();
        }
      }
    } else if (this.index === 1) {
      // Hot Package.
      if (a.step === 'pickup') {
        const door = game.city.landmarks.casino.door;
        if (!p.car && dist(p.x, p.y, door.x, door.y) < 30) {
          a.step = 'deliver';
          a.timer = 150;
          game.reportCrime('mission', door.x, door.y);
          const bh = game.city.landmarks.beachHouse;
          this.marker = { x: bh.x, y: bh.y, label: 'BEACH HOUSE' };
          this.objectiveText = 'Get the package to the beach house — 2:30 on the clock!';
          game.showPhone('SOL', 'You have it? Then MOVE. And Danny — the casino just called the PD.', 5);
        }
      } else if (a.step === 'deliver') {
        a.timer -= dt;
        this.objectiveText = `Get the package to the beach house — ${formatClock(a.timer)} left!`;
        if (a.timer <= 0) return this.fail('Too slow, Danny. The buyer walked. We go again when it cools down.');
        const bh = game.city.landmarks.beachHouse;
        if (dist(p.x, p.y, bh.x, bh.y) < 46) return this.complete();
      }
    } else if (this.index === 2) {
      // Casino Cream.
      if (a.targetCar.wrecked) return this.fail('You torched the cash van?! That money was OURS, Danny. Lie low, I will fix this.');
      if (a.step === 'steal') {
        this.marker.x = a.targetCar.x;
        this.marker.y = a.targetCar.y;
        if (p.car === a.targetCar) {
          a.step = 'escape';
          this.marker = null;
          this.objectiveText = 'Lose the heat — break line of sight and let the stars fade.';
          game.showPhone('SOL', 'You are in the van! Now shake the PD and park it at the park hideout.', 5.5);
        }
      } else if (a.step === 'escape') {
        if (p.car !== a.targetCar) {
          this.objectiveText = 'Get back in the cash van!';
          this.marker = { x: a.targetCar.x, y: a.targetCar.y, label: 'CASH VAN' };
        } else if (game.wanted.stars === 0) {
          a.step = 'deliver';
          const h = game.city.landmarks.hideout;
          this.marker = { x: h.x, y: h.y, label: 'HIDEOUT' };
          this.objectiveText = 'Heat is gone. Park the van at the park hideout.';
        } else {
          this.marker = null;
          this.objectiveText = 'Lose the heat — break line of sight and let the stars fade.';
        }
      } else if (a.step === 'deliver') {
        const h = game.city.landmarks.hideout;
        if (p.car === a.targetCar && dist(p.car.x, p.car.y, h.x, h.y) < h.radius) {
          game.leaveCarInDropoff(a.targetCar);
          return this.complete();
        }
      }
    }
  }

  /** After the story: any car delivered to the drop-off is fenced for cash. */
  updateFencing() {
    const game = this.game;
    const p = game.player;
    if (!p.car || this.fenceCooldown > 0) return;
    if (p.car.type === 'police' || p.car.missionTarget) return;
    const d = game.city.landmarks.garage.dropoff;
    if (pointInRect(p.car.x, p.car.y, d)) {
      const value = Math.round(p.car.spec.value * (0.4 + 0.6 * (p.car.hp / p.car.maxHp)));
      game.leaveCarInDropoff(p.car);
      game.addCash(value);
      game.sfx.cash();
      game.showPhone('SOL', `Fenced it for $${value.toLocaleString()}. Bring me another, Danny.`, 4);
      this.fenceCooldown = 2;
      game.saveProgress();
    }
  }
}

function formatClock(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
