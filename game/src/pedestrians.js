// pedestrians.js — the people of Palm Cove. They stroll the sidewalks in
// both directions, cross at intersections, flee from danger and can be
// knocked down by careless driving (which the police take seriously).

import { clamp, dist, randRange, pick } from './util.js';
import { V_ROADS, H_ROADS, ROAD_W, WORLD_H, clampToWorld } from './city.js';

const SIDEWALK_OFF = ROAD_W / 2 + 13;
const SHIRT_COLORS = ['#ff6b6b', '#feca57', '#48dbfb', '#1dd1a1', '#f368e0', '#ff9f43', '#54a0ff', '#5f27cd', '#c8d6e5', '#ff9ff3'];

/** Sidewalk lines run parallel to every road, on both sides. */
function sidewalkSpawn() {
  if (Math.random() < 0.5) {
    const vx = pick(V_ROADS);
    const side = Math.random() < 0.5 ? -1 : 1;
    return { x: vx + side * SIDEWALK_OFF, y: randRange(60, WORLD_H - 60), axis: 'v' };
  }
  const hy = pick(H_ROADS);
  const side = Math.random() < 0.5 ? -1 : 1;
  return { x: randRange(60, 2620), y: hy + side * SIDEWALK_OFF, axis: 'h' };
}

export function createPedestrian(x, y) {
  const s = x === undefined ? sidewalkSpawn() : { x, y, axis: Math.random() < 0.5 ? 'v' : 'h' };
  return {
    x: s.x,
    y: s.y,
    axis: s.axis,
    dir: Math.random() < 0.5 ? -1 : 1,
    speed: randRange(26, 46),
    walkPhase: Math.random() * Math.PI * 2,
    shirt: pick(SHIRT_COLORS),
    skin: pick(['#f1c27d', '#e0ac69', '#8d5524', '#ffdbac', '#a9746e']),
    state: 'walk', // walk | flee | down
    fleeX: 0,
    fleeY: 0,
    fleeTimer: 0,
    downTimer: 0,
    hp: 20,
    dead: false,
  };
}

/** Keep a healthy crowd near the player and thin out the far side of town. */
export function maintainCrowd(game) {
  const p = game.player;
  game.peds = game.peds.filter((ped) => !ped.dead || ped.downTimer > -20);
  let near = 0;
  for (const ped of game.peds) {
    if (dist(ped.x, ped.y, p.x, p.y) < 900) near++;
  }
  while (near < 26 && game.peds.length < 60) {
    const ped = createPedestrian();
    if (dist(ped.x, ped.y, p.x, p.y) > 260) {
      game.peds.push(ped);
      near++;
    } else {
      break;
    }
  }
  game.peds = game.peds.filter((ped) => dist(ped.x, ped.y, p.x, p.y) < 1500);
}

export function scarePedestrian(ped, fromX, fromY, seconds) {
  if (ped.state === 'down') return;
  ped.state = 'flee';
  ped.fleeX = ped.x - fromX;
  ped.fleeY = ped.y - fromY;
  const d = Math.hypot(ped.fleeX, ped.fleeY) || 1;
  ped.fleeX /= d;
  ped.fleeY /= d;
  ped.fleeTimer = seconds || 1.6;
}

export function knockDown(ped, game) {
  if (ped.state === 'down') return;
  ped.state = 'down';
  ped.downTimer = 7;
  ped.hp -= 12;
  if (ped.hp <= 0) ped.dead = true;
  game.onPedHit(ped);
}

export function updatePedestrian(ped, dt, game) {
  if (ped.state === 'down') {
    ped.downTimer -= dt;
    if (ped.downTimer <= 0 && !ped.dead) {
      ped.state = 'flee';
      ped.fleeTimer = 2.2;
      const p = game.player;
      ped.fleeX = ped.x - p.x;
      ped.fleeY = ped.y - p.y;
      const d = Math.hypot(ped.fleeX, ped.fleeY) || 1;
      ped.fleeX /= d;
      ped.fleeY /= d;
    }
    return;
  }
  if (ped.state === 'flee') {
    ped.fleeTimer -= dt;
    ped.x += ped.fleeX * 118 * dt;
    ped.y += ped.fleeY * 118 * dt;
    ped.walkPhase += dt * 13;
    if (ped.fleeTimer <= 0) ped.state = 'walk';
    clampToWorld(ped, 6);
    return;
  }
  // Stroll along the sidewalk; at an intersection, sometimes turn the corner.
  ped.walkPhase += dt * (ped.speed * 0.16);
  if (ped.axis === 'v') {
    ped.y += ped.dir * ped.speed * dt;
    for (const hy of H_ROADS) {
      if (Math.abs(ped.y - hy) < 4 && Math.random() < 0.012) {
        ped.axis = 'h';
        ped.y = hy + (ped.y > hy ? SIDEWALK_OFF : -SIDEWALK_OFF) * Math.sign(ped.y - hy || 1);
        ped.dir = Math.random() < 0.5 ? -1 : 1;
      }
    }
    if (ped.y < 50 || ped.y > WORLD_H - 50) ped.dir *= -1;
  } else {
    ped.x += ped.dir * ped.speed * dt;
    for (const vx of V_ROADS) {
      if (Math.abs(ped.x - vx) < 4 && Math.random() < 0.012) {
        ped.axis = 'v';
        ped.x = vx + Math.sign(ped.x - vx || 1) * SIDEWALK_OFF;
        ped.dir = Math.random() < 0.5 ? -1 : 1;
      }
    }
    if (ped.x < 50 || ped.x > 2620) ped.dir *= -1;
  }
  clampToWorld(ped, 6);
}

/** Draw one pedestrian, top-down: shoulders, head and a walking bob. */
export function drawPedestrian(ctx, ped) {
  ctx.save();
  ctx.translate(ped.x, ped.y);
  if (ped.state === 'down') {
    ctx.rotate(1.2);
    ctx.fillStyle = 'rgba(30,30,40,0.22)';
    ctx.beginPath();
    ctx.ellipse(1, 2, 13, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ped.shirt;
    ctx.beginPath();
    ctx.ellipse(0, 0, 12, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ped.skin;
    ctx.beginPath();
    ctx.arc(13, 0, 4.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  const bob = Math.sin(ped.walkPhase) * 1.1;
  ctx.fillStyle = 'rgba(30,30,40,0.25)';
  ctx.beginPath();
  ctx.ellipse(1, 2, 8.5, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ped.shirt;
  ctx.beginPath();
  ctx.arc(0, bob * 0.3, 7.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ped.skin;
  ctx.beginPath();
  ctx.arc(0, bob * 0.3, 4.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export { SIDEWALK_OFF };
