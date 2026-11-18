// util.js — small math, geometry and seeded-random helpers shared by every
// other module of Palm Cove Heat. No game state lives here.

/** Clamp v into the closed interval [lo, hi]. */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Linear interpolation between a and b by t in [0, 1]. */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Squared distance between two points; cheaper than dist for comparisons. */
export function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** Euclidean distance between two points. */
export function dist(ax, ay, bx, by) {
  return Math.sqrt(dist2(ax, ay, bx, by));
}

/** Shortest signed difference between two angles, in (-PI, PI]. */
export function angleDiff(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Turn `angle` toward `target` by at most `maxStep` radians. */
export function turnToward(angle, target, maxStep) {
  const d = angleDiff(angle, target);
  if (Math.abs(d) <= maxStep) return target;
  return angle + Math.sign(d) * maxStep;
}

/**
 * mulberry32: a tiny deterministic PRNG. The city layout is generated from a
 * fixed seed so Palm Cove looks the same on every load and in every
 * screenshot, while ambient spawns may use Math.random freely.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick one element of arr using rng (defaults to Math.random). */
export function pick(arr, rng) {
  const r = rng || Math.random;
  return arr[Math.floor(r() * arr.length) % arr.length];
}

/** Random float in [lo, hi) using rng (defaults to Math.random). */
export function randRange(lo, hi, rng) {
  const r = rng || Math.random;
  return lo + r() * (hi - lo);
}

/** True when point (x, y) lies inside rect {x, y, w, h}. */
export function pointInRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

/**
 * Does the segment (x1,y1)-(x2,y2) cross the AABB rect? Used for line of
 * sight: buildings block the view between police and player.
 */
export function segmentHitsRect(x1, y1, x2, y2, rect) {
  if (pointInRect(x1, y1, rect) || pointInRect(x2, y2, rect)) return true;
  const rx2 = rect.x + rect.w;
  const ry2 = rect.y + rect.h;
  return (
    segmentsCross(x1, y1, x2, y2, rect.x, rect.y, rx2, rect.y) ||
    segmentsCross(x1, y1, x2, y2, rx2, rect.y, rx2, ry2) ||
    segmentsCross(x1, y1, x2, y2, rx2, ry2, rect.x, ry2) ||
    segmentsCross(x1, y1, x2, y2, rect.x, ry2, rect.x, rect.y)
  );
}

/** Segment-segment intersection test (proper crossing or touching). */
export function segmentsCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = direction(cx, cy, dx, dy, ax, ay);
  const d2 = direction(cx, cy, dx, dy, bx, by);
  const d3 = direction(ax, ay, bx, by, cx, cy);
  const d4 = direction(ax, ay, bx, by, dx, dy);
  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  );
}

function direction(ax, ay, bx, by, px, py) {
  return (px - bx) * (ay - by) - (ax - bx) * (py - by);
}

/**
 * Push a circle (x, y, r) out of an AABB rect if they overlap.
 * Returns the corrected [x, y]; the caller decides what happens to velocity.
 */
export function resolveCircleRect(x, y, r, rect) {
  const nx = clamp(x, rect.x, rect.x + rect.w);
  const ny = clamp(y, rect.y, rect.y + rect.h);
  let dx = x - nx;
  let dy = y - ny;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return [x, y];
  if (d2 > 0.0001) {
    const d = Math.sqrt(d2);
    return [nx + (dx / d) * r, ny + (dy / d) * r];
  }
  // Circle centre is inside the rect: push out along the smallest exit.
  const left = x - rect.x;
  const right = rect.x + rect.w - x;
  const top = y - rect.y;
  const bottom = rect.y + rect.h - y;
  const m = Math.min(left, right, top, bottom);
  if (m === left) return [rect.x - r, y];
  if (m === right) return [rect.x + rect.w + r, y];
  if (m === top) return [x, rect.y - r];
  return [x, rect.y + rect.h + r];
}

/** True when a circle overlaps an AABB rect at all. */
export function circleHitsRect(x, y, r, rect) {
  const nx = clamp(x, rect.x, rect.x + rect.w);
  const ny = clamp(y, rect.y, rect.y + rect.h);
  return dist2(x, y, nx, ny) < r * r;
}
