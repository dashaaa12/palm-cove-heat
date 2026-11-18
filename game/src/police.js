// police.js — the Palm Cove PD: the wanted-level system (heat, stars, being
// seen, cooling off) and the officers who respond — interceptor drivers who
// hunt the player across the road grid and foot officers who chase, shoot
// at three stars and up, and fill the bust meter when they get close.

import { clamp, dist, randRange } from './util.js';
import { createCar, steerCarToward, integrateCar, collideCarWorld } from './vehicles.js';
import { randomRoadPoint, intersections, V_ROADS, H_ROADS } from './city.js';
import { scarePedestrian } from './pedestrians.js';

const STAR_THRESHOLDS = [0, 15, 40, 80, 140, 220];
export const CRIME_HEAT = {
  theft: 26,
  pedHit: 30,
  pedDown: 22,
  crash: 9,
  shot: 10,
  policeHit: 38,
  officerDown: 65,
  mission: 30,
};

export class WantedSystem {
  constructor() {
    this.heat = 0;
    this.seenNow = false;
    this.lastSeenPos = { x: 0, y: 0 };
    this.unseenTime = 0;
  }

  get stars() {
    let s = 0;
    for (let i = 0; i < STAR_THRESHOLDS.length; i++) {
      if (this.heat >= STAR_THRESHOLDS[i]) s = i;
    }
    return s;
  }

  addCrime(kind, witnessed) {
    const base = CRIME_HEAT[kind] || 8;
    let gain = witnessed ? base : Math.ceil(base * 0.4);
    // A stolen car always makes noise — alarms and marina cameras mean a
    // theft is never completely free, even with nobody standing there.
    if (kind === 'theft' && !witnessed) gain = Math.max(gain, 16);
    this.heat = Math.min(320, this.heat + gain);
    // A fresh crime restarts the search clock: the cooling-off grace period
    // runs from the last crime or the last sighting, whichever is later.
    this.unseenTime = 0;
  }

  /** Heat cools only while nobody can see the player, after a grace delay. */
  update(dt) {
    if (this.seenNow) {
      this.unseenTime = 0;
    } else if (this.heat > 0) {
      this.unseenTime += dt;
      const delay = 4.5;
      if (this.unseenTime > delay) {
        this.heat = Math.max(0, this.heat - (7 + this.stars * 2.5) * dt);
      }
    }
  }

  clear() {
    this.heat = 0;
    this.unseenTime = 0;
  }
}

export class PoliceManager {
  constructor() {
    this.officers = []; // foot officers: {x, y, hp, state, shootCd, carId}
    this.spawnCd = 0;
  }

  policeCars(game) {
    return game.cars.filter((c) => c.driver === 'police');
  }

  desiredCars(stars) {
    if (stars <= 0) return 0;
    return Math.min(1 + stars, 6);
  }

  /** Spawn and despawn interceptors to match the wanted level. */
  maintain(game, dt) {
    this.spawnCd -= dt;
    const stars = game.wanted.stars;
    const cars = this.policeCars(game);
    const p = game.player;
    if (cars.length < this.desiredCars(stars) && this.spawnCd <= 0) {
      this.spawnCd = 1.1;
      // Try a few spawn points per tick so units arrive promptly: they must
      // appear off-screen (past 640px) but close enough to join the hunt.
      for (let tries = 0; tries < 5; tries++) {
        const pt = randomRoadPoint();
        const d = dist(pt.x, pt.y, p.x, p.y);
        if (d > 640 && d < 1500) {
          const car = createCar('police', pt.x, pt.y, Math.random() * Math.PI * 2, { driver: 'police' });
          car.officersOut = false;
          game.cars.push(car);
          break;
        }
      }
    }
    // Retire units that are far away once the heat is off or dropping.
    for (const car of cars) {
      const far = dist(car.x, car.y, p.x, p.y) > 1350;
      if ((stars === 0 && far) || dist(car.x, car.y, p.x, p.y) > 1900) {
        car.retire = true;
        this.officers = this.officers.filter((o) => o.carId !== car.id);
      }
    }
    game.cars = game.cars.filter((c) => !c.retire);
    if (stars === 0 && this.officers.length) {
      // Stand down: officers walk back to their cars and vanish with them.
      for (const o of this.officers) o.state = 'retreat';
    }
  }

  /** Work out whether any unit can currently see the player. */
  computeVisibility(game) {
    const p = game.player;
    let seen = false;
    const look = (x, y, range) => {
      if (dist(x, y, p.x, p.y) > range) return false;
      if (dist(x, y, p.x, p.y) < 190) return true; // too close to miss
      return game.hasLineOfSight(x, y, p.x, p.y);
    };
    for (const car of this.policeCars(game)) {
      if (look(car.x, car.y, 580)) { seen = true; break; }
    }
    if (!seen) {
      for (const o of this.officers) {
        if (look(o.x, o.y, 460)) { seen = true; break; }
      }
    }
    game.wanted.seenNow = seen;
    if (seen) {
      game.wanted.lastSeenPos.x = p.x;
      game.wanted.lastSeenPos.y = p.y;
    }
  }

  /**
   * The next road-grid waypoint for a hunting interceptor: drive to the
   * nearest intersection, then step along avenues and streets toward the
   * target until the final charge takes over.
   */
  gridWaypoint(car, tx, ty) {
    if (car.wp && dist(car.x, car.y, car.wp.x, car.wp.y) > 46) return car.wp;
    let here = null;
    let hd = Infinity;
    for (const pt of intersections()) {
      const dd = dist(car.x, car.y, pt.x, pt.y);
      if (dd < hd) { hd = dd; here = pt; }
    }
    if (!here) return { x: tx, y: ty };
    if (hd > 46) {
      car.wp = here;
      return here;
    }
    let nx = here.x;
    let ny = here.y;
    if (Math.abs(tx - here.x) > 40) {
      const dir = Math.sign(tx - here.x);
      const options = V_ROADS.filter((vx) => (dir > 0 ? vx > here.x + 10 : vx < here.x - 10));
      if (options.length) nx = dir > 0 ? Math.min(...options) : Math.max(...options);
    } else if (Math.abs(ty - here.y) > 40) {
      const dir = Math.sign(ty - here.y);
      const options = H_ROADS.filter((hy) => (dir > 0 ? hy > here.y + 10 : hy < here.y - 10));
      if (options.length) ny = dir > 0 ? Math.min(...options) : Math.max(...options);
    }
    car.wp = { x: nx, y: ny };
    return car.wp;
  }

  /** Move every police unit for this frame; returns nothing. */
  update(game, dt) {
    const p = game.player;
    const stars = game.wanted.stars;
    let bustPressure = 0;

    for (const car of this.policeCars(game)) {
      if (car.wrecked) continue;
      const d = dist(car.x, car.y, p.x, p.y);
      const playerDriving = !!p.car;
      if (!playerDriving && d < 170 && !car.officersOut && stars > 0) {
        // Pull up and put two officers on the street.
        car.officersOut = true;
        for (let i = 0; i < 2; i++) {
          this.officers.push({
            x: car.x + randRange(-24, 24),
            y: car.y + randRange(-24, 24),
            hp: 34,
            state: 'chase',
            shootCd: randRange(0.4, 1.2),
            carId: car.id,
            walkPhase: Math.random() * 6,
          });
        }
      }
      if (car.officersOut && (playerDriving || d > 320)) {
        // The suspect is mobile again: everyone back in the car.
        this.officers = this.officers.filter((o) => o.carId !== car.id);
        car.officersOut = false;
      }
      if (car.officersOut) {
        car.speed = Math.max(0, car.speed - 380 * dt);
        integrateCar(car, dt);
        collideCarWorld(car, game);
        continue;
      }
      // Hunt: aim at the player, or at the last place they were seen; on
      // reaching a cold trail, sweep the blocks around it.
      let tx = game.wanted.seenNow ? p.x : game.wanted.lastSeenPos.x;
      let ty = game.wanted.seenNow ? p.y : game.wanted.lastSeenPos.y;
      if (!game.wanted.seenNow && stars > 0) {
        if (!car.searchPt || dist(car.x, car.y, car.searchPt.x, car.searchPt.y) < 70) {
          if (dist(car.x, car.y, tx, ty) < 90 || car.searchPt) {
            car.searchPt = {
              x: tx + randRange(-320, 320),
              y: ty + randRange(-320, 320),
            };
          }
        }
        if (car.searchPt && dist(car.x, car.y, tx, ty) < 90) {
          tx = car.searchPt.x;
          ty = car.searchPt.y;
        }
      } else {
        car.searchPt = null;
      }
      // From a distance the PD drives the road grid — charging cross-country
      // just wedges interceptors against buildings. Up close, they charge.
      if (d > 250 && stars > 0) {
        const wp = this.gridWaypoint(car, tx, ty);
        tx = wp.x;
        ty = wp.y;
      }
      const huntSpeed = car.spec.topSpeed * (d > 620 ? 1.0 : 0.9);
      steerCarToward(car, tx, ty, dt, stars > 0 ? huntSpeed : 120);
      // Backstop: a unit wedged against a building for a while rejoins the
      // hunt from the nearest intersection.
      if (stars > 0 && Math.abs(car.speed) < 22 && d > 300) {
        car.stuckT = (car.stuckT || 0) + dt;
        if (car.stuckT > 3) {
          car.stuckT = 0;
          let best = null;
          let bd = Infinity;
          for (const pt of intersections()) {
            const dd = dist(car.x, car.y, pt.x, pt.y);
            if (dd < bd) { bd = dd; best = pt; }
          }
          if (best) {
            car.x = best.x;
            car.y = best.y;
            car.wp = null;
          }
        }
      } else {
        car.stuckT = 0;
      }
      collideCarWorld(car, game);
      if (!playerDriving && d < 78) bustPressure = Math.max(bustPressure, 0.55);
      if (playerDriving && d < 66 && Math.abs(p.car.speed) < 26) bustPressure = Math.max(bustPressure, 0.7);
    }

    // Foot officers.
    const survivors = [];
    for (const o of this.officers) {
      if (o.hp <= 0) {
        game.onOfficerDown(o);
        continue;
      }
      const car = game.cars.find((c) => c.id === o.carId);
      if (o.state === 'retreat') {
        if (!car) continue;
        const d = dist(o.x, o.y, car.x, car.y);
        if (d < 26) continue; // climbed back in
        moveOfficer(o, car.x, car.y, 120, dt);
        survivors.push(o);
        continue;
      }
      const d = dist(o.x, o.y, p.x, p.y);
      moveOfficer(o, p.x, p.y, d > 40 ? 121 : 40, dt);
      o.walkPhase += dt * 10;
      if (d < 47 && !p.car) bustPressure = Math.max(bustPressure, 1);
      // Shooting at three stars and up, with line of sight.
      if (stars >= 3 && !p.car && d < 310 && d > 30) {
        o.shootCd -= dt;
        if (o.shootCd <= 0 && game.hasLineOfSight(o.x, o.y, p.x, p.y)) {
          o.shootCd = randRange(0.9, 1.6);
          game.policeShootAt(o, d);
        }
      }
      // Nearby civilians get out of the way of a chase.
      if (Math.random() < dt * 2) {
        for (const ped of game.peds) {
          if (dist(ped.x, ped.y, o.x, o.y) < 60) scarePedestrian(ped, o.x, o.y, 1.2);
        }
      }
      survivors.push(o);
    }
    this.officers = survivors;

    // The bust meter itself: fills under pressure, drains when clear.
    if (bustPressure > 0 && stars > 0) {
      game.bust = clamp(game.bust + bustPressure * 0.5 * dt, 0, 1);
    } else {
      game.bust = clamp(game.bust - 0.55 * dt, 0, 1);
    }
    if (game.bust >= 1) game.onBusted();
  }
}

function moveOfficer(o, tx, ty, speed, dt) {
  const d = dist(o.x, o.y, tx, ty);
  if (d < 4) return;
  o.x += ((tx - o.x) / d) * speed * dt;
  o.y += ((ty - o.y) / d) * speed * dt;
  o.angle = Math.atan2(ty - o.y, tx - o.x);
}

/** Draw one foot officer: navy uniform, cap, purposeful stride. */
export function drawOfficer(ctx, o) {
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.fillStyle = 'rgba(30,30,40,0.25)';
  ctx.beginPath();
  ctx.ellipse(1, 2, 8.5, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1f3a93';
  ctx.beginPath();
  ctx.arc(0, 0, 7.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f1c27d';
  ctx.beginPath();
  ctx.arc(0, 0, 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#14275e';
  ctx.beginPath();
  ctx.arc(0, -1.5, 4.6, 0, Math.PI);
  ctx.fill();
  ctx.restore();
}
