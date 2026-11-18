// vehicles.js — the cars of Palm Cove: their types, the arcade driving
// physics, the traffic AI that follows the road grid in the right-hand lane,
// collision handling, and the top-down car renderer.

import { clamp, dist, angleDiff, turnToward, pick, resolveCircleRect, clamp as _c } from './util.js';
import { V_ROADS, H_ROADS, LANE_OFF, clampToWorld } from './city.js';

export const CAR_TYPES = {
  compact: { name: 'Pigeon Compact', length: 42, width: 22, topSpeed: 235, accel: 250, hp: 80, value: 150 },
  sedan: { name: 'Meridian Sedan', length: 48, width: 24, topSpeed: 265, accel: 255, hp: 100, value: 260 },
  taxi: { name: 'Cove Cab', length: 48, width: 24, topSpeed: 255, accel: 250, hp: 100, value: 240 },
  sports: { name: 'Aurelion GT', length: 50, width: 25, topSpeed: 345, accel: 330, hp: 90, value: 900 },
  van: { name: 'Trust Cash Van', length: 56, width: 27, topSpeed: 205, accel: 200, hp: 220, value: 1500 },
  police: { name: 'PCPD Interceptor', length: 50, width: 25, topSpeed: 325, accel: 315, hp: 140, value: 0 },
};

const TRAFFIC_COLORS = ['#e74c3c', '#3498db', '#f1c40f', '#2ecc71', '#e67e22', '#9b59b6', '#ecf0f1', '#1abc9c', '#fd79a8', '#95a5a6'];

/** Create a car. driver: 'parked' | 'traffic' | 'police' | 'player'. */
export function createCar(type, x, y, angle, opts) {
  const spec = CAR_TYPES[type];
  const o = opts || {};
  return {
    type,
    spec,
    x, y,
    angle: angle || 0,
    speed: 0,
    steerVis: 0,
    color: o.color || (type === 'police' ? '#f7f9fa' : type === 'taxi' ? '#f5b041' : type === 'van' ? '#5d6d7e' : type === 'sports' ? '#f39c12' : pick(TRAFFIC_COLORS)),
    driver: o.driver || 'parked',
    hp: spec.hp,
    maxHp: spec.hp,
    wrecked: false,
    cruise: 120 + Math.random() * 60,
    junction: null, // traffic AI: the intersection it is heading for
    stopTimer: 0,
    honk: 0,
    id: Math.random().toString(36).slice(2),
  };
}

export function carRadius(car) {
  return car.spec.length * 0.46;
}

/** The unit vector a car faces. */
export function facing(car) {
  return { x: Math.cos(car.angle), y: Math.sin(car.angle) };
}

/** Right-hand lane offset vector for a heading (screen coords, y down). */
export function laneOffset(hx, hy) {
  return { x: -hy * LANE_OFF, y: hx * LANE_OFF };
}

/** Find the next intersection centre ahead of (x, y) along a heading. */
export function nextJunctionAhead(x, y, hx, hy) {
  let best = null;
  let bestD = Infinity;
  for (const vx of V_ROADS) {
    for (const hyy of H_ROADS) {
      const dx = vx - x;
      const dy = hyy - y;
      const along = dx * hx + dy * hy;
      if (along < 30) continue;
      const side = Math.abs(dx * -hy + dy * hx);
      if (side > 60) continue;
      if (along < bestD) {
        bestD = along;
        best = { x: vx, y: hyy };
      }
    }
  }
  return best;
}

/** Steer and accelerate a car toward a world point (shared by AI drivers). */
export function steerCarToward(car, tx, ty, dt, targetSpeed) {
  const want = Math.atan2(ty - car.y, tx - car.x);
  const diff = angleDiff(car.angle, want);
  const speedFactor = clamp(Math.abs(car.speed) / 130, 0.25, 1);
  car.angle = turnToward(car.angle, want, 2.4 * speedFactor * dt);
  car.steerVis = clamp(diff * 1.6, -1, 1);
  const aligned = Math.abs(diff) < 1.15;
  if (aligned && car.speed < targetSpeed) {
    car.speed = Math.min(targetSpeed, car.speed + car.spec.accel * dt);
  } else if (car.speed > targetSpeed) {
    car.speed = Math.max(targetSpeed, car.speed - 300 * dt);
  }
  if (!aligned && car.speed > 60) car.speed = Math.max(60, car.speed - 200 * dt);
  integrateCar(car, dt);
}

/** Move a car along its heading and apply rolling drag. */
export function integrateCar(car, dt) {
  const f = facing(car);
  car.x += f.x * car.speed * dt;
  car.y += f.y * car.speed * dt;
  car.speed *= Math.max(0, 1 - 0.35 * dt);
  if (Math.abs(car.speed) < 1.5) car.speed = 0;
}

/** Traffic AI: follow the grid, keep the right lane, turn at junctions. */
export function updateTrafficCar(car, dt, game) {
  if (car.wrecked) return;
  if (car.stopTimer > 0) {
    car.stopTimer -= dt;
    car.speed = Math.max(0, car.speed - 320 * dt);
    integrateCar(car, dt);
    collideCarWorld(car, game);
    return;
  }
  const f = facing(car);
  if (!car.junction) car.junction = nextJunctionAhead(car.x, car.y, f.x, f.y);
  if (!car.junction) {
    // Nowhere to go (facing a boundary): turn around gently.
    car.angle += 1.2 * dt;
    car.speed = Math.min(car.speed + car.spec.accel * dt, 80);
    integrateCar(car, dt);
    collideCarWorld(car, game);
    return;
  }
  const off = laneOffset(f.x, f.y);
  const tx = car.junction.x + off.x;
  const ty = car.junction.y + off.y;
  let targetSpeed = car.cruise;
  // Slow for a car ahead in the same lane.
  for (const other of game.cars) {
    if (other === car) continue;
    const dx = other.x - car.x;
    const dy = other.y - car.y;
    const ahead = dx * f.x + dy * f.y;
    const side = Math.abs(dx * -f.y + dy * f.x);
    if (ahead > 0 && ahead < 74 && side < 20) {
      targetSpeed = Math.min(targetSpeed, Math.max(0, (ahead - 44) * 3));
    }
  }
  // Slow on the approach to a junction.
  const dJunction = dist(car.x, car.y, tx, ty);
  if (dJunction < 90) targetSpeed = Math.min(targetSpeed, 95);
  steerCarToward(car, tx, ty, dt, targetSpeed);
  if (dJunction < 42) {
    chooseNextJunction(car);
  }
  collideCarWorld(car, game);
}

/** At a junction, pick the next one: mostly straight on, sometimes a turn. */
function chooseNextJunction(car) {
  const f = facing(car);
  const here = car.junction;
  const straight = nextJunctionAhead(here.x + f.x * 40, here.y + f.y * 40, f.x, f.y);
  const leftH = { x: f.y, y: -f.x };
  const rightH = { x: -f.y, y: f.x };
  const left = nextJunctionAhead(here.x + leftH.x * 40, here.y + leftH.y * 40, leftH.x, leftH.y);
  const right = nextJunctionAhead(here.x + rightH.x * 40, here.y + rightH.y * 40, rightH.x, rightH.y);
  const options = [];
  if (straight) options.push({ j: straight, h: f, w: 5 });
  if (left) options.push({ j: left, h: leftH, w: 2 });
  if (right) options.push({ j: right, h: rightH, w: 2 });
  if (!options.length) {
    // Dead end of the grid: U-turn back the way we came.
    const back = { x: -f.x, y: -f.y };
    car.junction = nextJunctionAhead(here.x + back.x * 40, here.y + back.y * 40, back.x, back.y);
    car.uTurn = true;
    return;
  }
  let total = 0;
  for (const o of options) total += o.w;
  let roll = Math.random() * total;
  let chosen = options[0];
  for (const o of options) {
    roll -= o.w;
    if (roll <= 0) { chosen = o; break; }
  }
  car.junction = chosen.j;
  car.turnHeading = chosen.h;
}

/** Drive the player's car from keyboard input. Returns nothing. */
export function drivePlayerCar(car, input, dt) {
  const spec = car.spec;
  const up = input.up;
  const down = input.down;
  if (up) {
    car.speed += spec.accel * dt * (car.speed < 0 ? 2.2 : 1);
  } else if (down) {
    car.speed -= (car.speed > 10 ? 430 : spec.accel * 0.62) * dt;
  }
  const maxRev = -95;
  car.speed = clamp(car.speed, maxRev, spec.topSpeed);
  const steerIn = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  car.steerVis = steerIn;
  if (steerIn !== 0 && car.speed !== 0) {
    const dir = car.speed >= 0 ? 1 : -1;
    const grip = clamp(Math.abs(car.speed) / 110, 0, 1);
    car.angle += steerIn * dir * (0.6 + 1.55 * grip) * dt * (input.handbrake ? 1.5 : 1);
    if (input.handbrake) car.speed *= Math.max(0, 1 - 1.1 * dt);
  }
  integrateCar(car, dt);
}

/**
 * Collide a car with the building AABBs and the world edge.
 * Returns the impact speed (0 when there was no hard hit) so callers can
 * score crimes, play sounds and apply damage.
 */
export function collideCarWorld(car, game) {
  let impact = 0;
  const r = carRadius(car);
  for (const b of game.city.colliders) {
    const before = car.speed;
    const [nx, ny] = resolveCircleRect(car.x, car.y, r, b);
    if (nx !== car.x || ny !== car.y) {
      const moved = dist(car.x, car.y, nx, ny);
      if (moved > 1.2 && Math.abs(before) > 60) impact = Math.max(impact, Math.abs(before));
      car.x = nx;
      car.y = ny;
      if (Math.abs(before) > 60) {
        car.speed = -before * 0.22;
        damageCar(car, Math.abs(before) * 0.05);
      } else {
        car.speed *= 0.4;
      }
    }
  }
  const p = clampToWorld({ x: car.x, y: car.y }, 10);
  car.x = p.x;
  car.y = p.y;
  return impact;
}

/** Car-to-car collision: push apart, share the pain. Returns impact speed. */
export function collideCarPair(a, b) {
  const ra = carRadius(a);
  const rb = carRadius(b);
  const d = dist(a.x, a.y, b.x, b.y);
  const min = ra + rb - 6;
  if (d >= min || d === 0) return 0;
  const nx = (b.x - a.x) / d;
  const ny = (b.y - a.y) / d;
  const overlap = (min - d) / 2;
  const impact = Math.abs(a.speed - b.speed);
  if (a.driver !== 'parked') { a.x -= nx * overlap; a.y -= ny * overlap; }
  if (b.driver !== 'parked') { b.x += nx * overlap; b.y += ny * overlap; }
  if (a.driver === 'parked') { b.speed *= 0.55; }
  if (b.driver === 'parked') { a.speed *= 0.55; }
  if (impact > 90) {
    damageCar(a, impact * 0.045);
    damageCar(b, impact * 0.045);
  }
  return impact;
}

export function damageCar(car, amount) {
  if (car.wrecked) return;
  car.hp -= amount;
  if (car.hp <= 0) {
    car.hp = 0;
    car.wrecked = true;
    car.speed = 0;
  }
}

/** Draw one car, top-down, rotated to its heading. time drives police lights. */
export function drawCar(ctx, car, time) {
  const spec = car.spec;
  const L = spec.length;
  const W = spec.width;
  ctx.save();
  ctx.translate(car.x, car.y);
  // Soft shadow.
  ctx.fillStyle = 'rgba(30, 30, 40, 0.25)';
  ctx.beginPath();
  ctx.ellipse(3, 5, L * 0.55, W * 0.62, car.angle, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(car.angle);
  // Wheels.
  ctx.fillStyle = '#1b1b20';
  const wy = W / 2 - 2;
  const wx = L / 2 - 11;
  ctx.fillRect(-wx - 4, -wy - 2, 9, 5);
  ctx.fillRect(wx - 4, -wy - 2, 9, 5);
  ctx.fillRect(-wx - 4, wy - 3, 9, 5);
  ctx.fillRect(wx - 4, wy - 3, 9, 5);
  // Body.
  ctx.fillStyle = car.wrecked ? '#3a3a40' : car.color;
  roundRect(ctx, -L / 2, -W / 2, L, W, 7);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  if (car.type === 'police') {
    ctx.fillStyle = '#20242c';
    roundRect(ctx, -L * 0.16, -W / 2, L * 0.34, W, 5);
    ctx.fill();
    // Light bar: red and blue halves alternate.
    const phase = Math.floor(time * 5) % 2 === 0;
    ctx.fillStyle = phase ? '#ff3b30' : '#5a0f0c';
    ctx.fillRect(-7, -W / 2 + 3, 6, W / 2 - 3);
    ctx.fillStyle = phase ? '#10305e' : '#2e7bff';
    ctx.fillRect(1, -W / 2 + 3, 6, W / 2 - 3);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 7px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PCPD', 0, W + 9);
  } else if (car.type === 'van') {
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    roundRect(ctx, -L * 0.28, -W / 2 + 3, L * 0.5, W - 6, 3);
    ctx.fill();
    ctx.fillStyle = '#33404f';
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PALM TRUST', 0, 3);
  } else if (car.type === 'taxi') {
    ctx.fillStyle = '#20242c';
    ctx.fillRect(-6, -5, 12, 10);
    ctx.fillStyle = '#fff8d6';
    ctx.font = 'bold 6px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('CAB', 0, 2);
  } else if (car.type === 'sports') {
    ctx.fillStyle = '#8a5a00';
    ctx.fillRect(-L / 2 + 2, -W / 2 + 2, 5, W - 4); // rear spoiler
    // Twin racing stripes, nose to tail: a sports car reads at a glance.
    ctx.fillStyle = 'rgba(20, 20, 26, 0.85)';
    ctx.fillRect(-L / 2 + 4, -4.6, L - 8, 3.4);
    ctx.fillRect(-L / 2 + 4, 1.2, L - 8, 3.4);
  }
  // Cabin: windshield, roof, rear window.
  ctx.fillStyle = 'rgba(24, 34, 48, 0.92)';
  roundRect(ctx, L * 0.08, -W / 2 + 3.5, L * 0.16, W - 7, 3);
  ctx.fill();
  ctx.fillStyle = car.wrecked ? '#2c2c31' : shade(car.color, -18);
  roundRect(ctx, -L * 0.18, -W / 2 + 4, L * 0.24, W - 8, 3);
  ctx.fill();
  ctx.fillStyle = 'rgba(24, 34, 48, 0.85)';
  roundRect(ctx, -L * 0.3, -W / 2 + 4.5, L * 0.09, W - 9, 3);
  ctx.fill();
  // Headlights and tail lights.
  ctx.fillStyle = '#fff6bf';
  ctx.fillRect(L / 2 - 2.5, -W / 2 + 3, 2.5, 4.5);
  ctx.fillRect(L / 2 - 2.5, W / 2 - 7.5, 2.5, 4.5);
  ctx.fillStyle = '#e74c3c';
  ctx.fillRect(-L / 2, -W / 2 + 3, 2.5, 4.5);
  ctx.fillRect(-L / 2, W / 2 - 7.5, 2.5, 4.5);
  if (car.wrecked) {
    ctx.fillStyle = 'rgba(12,12,14,0.5)';
    roundRect(ctx, -L / 2, -W / 2, L, W, 7);
    ctx.fill();
  }
  ctx.restore();
}

/** Rounded-rectangle path helper shared by the renderers. */
export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Darken or lighten a #rrggbb colour by amt (-100..100). */
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) + amt;
  let g = ((n >> 8) & 0xff) + amt;
  let b = (n & 0xff) + amt;
  r = _c(r, 0, 255);
  g = _c(g, 0, 255);
  b = _c(b, 0, 255);
  return `rgb(${r},${g},${b})`;
}
