// city.js — generates Palm Cove: the road grid, city blocks, buildings,
// landmarks (casino, hospital, police station, Sol's garage, the marina and
// the park hideout), the beach and the ocean. The layout is built from a
// fixed seed so the city is identical on every visit.

import { mulberry32, pick } from './util.js';

export const WORLD_W = 3200;
export const WORLD_H = 2400;
export const ROAD_W = 100;
export const LANE_OFF = 25;

/** Centre lines of the vertical (north-south) avenues. */
export const V_ROADS = [240, 640, 1040, 1440, 1840, 2240, 2640];
/** Centre lines of the horizontal (east-west) streets. */
export const H_ROADS = [240, 640, 1040, 1440, 1840];

export const SAND_X = 2840; // beach starts here
export const SEA_X = 3020; // open water starts here

const ROOF_PASTELS = ['#f6d8a8', '#f2b8c6', '#bfe3dd', '#f9e29c', '#d9c7e7', '#ffd9b0', '#c3e2f2', '#f6c6a5'];
const BODY_PASTELS = ['#fdf3e3', '#fde8ec', '#e6f4f1', '#fdf6d8', '#efe9f7', '#ffedd9', '#e8f3fb', '#fdeee2'];

// Block ranges of the main grid (between the avenues and streets).
const MAIN_COLS = [[290, 590], [690, 990], [1090, 1390], [1490, 1790], [1890, 2190], [2290, 2590]];
const MAIN_ROWS = [[290, 590], [690, 990], [1090, 1390], [1490, 1790], [1890, 2190]];
// Extra strips: the north edge, the south edge and the west edge of town.
const STRIP_COLS = [[30, 190], [290, 590], [690, 990], [1090, 1390], [1490, 1790], [1890, 2190], [2290, 2590]];
const NORTH_ROW = [30, 190];
const SOUTH_ROW = [1940, 2330];

/** Keyed by "col,row" on the main grid: blocks with a scripted purpose. */
const SPECIAL_BLOCKS = {
  '1,2': 'park', // the park with Sol's hideout
  '4,0': 'casino',
  '0,1': 'hospital',
  '3,3': 'police',
  '2,3': 'garage', // Sol's chop shop and the delivery drop-off
};

/**
 * Build the whole city. Returns everything the game needs: drawable geometry,
 * building colliders, landmark points and road-network helpers' raw data.
 */
export function buildCity() {
  const rng = mulberry32(20261119);
  const buildings = [];
  const parkingLots = [];
  const trees = [];

  function addBuilding(x, y, w, h, label) {
    const i = Math.floor(rng() * ROOF_PASTELS.length);
    buildings.push({
      x, y, w, h,
      body: BODY_PASTELS[i],
      roof: ROOF_PASTELS[i],
      label: label || null,
      seed: rng(),
    });
  }

  /** Fill one block with a 2x2 cluster of buildings, leaving lanes between. */
  function fillBlock(x0, x1, y0, y1) {
    const midX = (x0 + x1) / 2;
    const midY = (y0 + y1) / 2;
    const gap = 26;
    // Each quad is [x, y, width, height] of one quadrant of the block.
    const quads = [
      [x0 + 8, y0 + 8, midX - gap / 2 - (x0 + 8), midY - gap / 2 - (y0 + 8)],
      [midX + gap / 2, y0 + 8, x1 - 8 - (midX + gap / 2), midY - gap / 2 - (y0 + 8)],
      [x0 + 8, midY + gap / 2, midX - gap / 2 - (x0 + 8), y1 - 8 - (midY + gap / 2)],
      [midX + gap / 2, midY + gap / 2, x1 - 8 - (midX + gap / 2), y1 - 8 - (midY + gap / 2)],
    ];
    for (const [qx, qy, qw, qh] of quads) {
      if (rng() < 0.12) continue; // the odd empty corner lot
      addBuilding(qx, qy, qw - 16, qh - 16);
    }
  }

  // Main grid blocks.
  for (let c = 0; c < MAIN_COLS.length; c++) {
    for (let r = 0; r < MAIN_ROWS.length; r++) {
      const [x0, x1] = MAIN_COLS[c];
      const [y0, y1] = MAIN_ROWS[r];
      const kind = SPECIAL_BLOCKS[`${c},${r}`];
      if (kind === 'park') {
        // No buildings: grass, trees and the hideout clearing (added below).
        for (let i = 0; i < 16; i++) {
          trees.push({ x: x0 + 30 + rng() * (x1 - x0 - 60), y: y0 + 30 + rng() * (y1 - y0 - 60), r: 13 + rng() * 9 });
        }
        continue;
      }
      if (kind === 'casino') {
        addBuilding(x0 + 20, y0 + 16, x1 - x0 - 40, 168, 'PALM CASINO');
        parkingLots.push({ x: x0 + 20, y: y0 + 208, w: x1 - x0 - 40, h: 76 });
        continue;
      }
      if (kind === 'hospital') {
        addBuilding(x0 + 30, y0 + 40, x1 - x0 - 60, 190, 'PALM COVE GENERAL');
        continue;
      }
      if (kind === 'police') {
        addBuilding(x0 + 30, y0 + 30, x1 - x0 - 60, 170, 'PALM COVE PD');
        parkingLots.push({ x: x0 + 30, y: y0 + 224, w: x1 - x0 - 60, h: 60 });
        continue;
      }
      if (kind === 'garage') {
        addBuilding(x0 + 40, y0 + 90, x1 - x0 - 80, 130, "SOL'S MOTORS");
        continue;
      }
      if (rng() < 0.22) {
        parkingLots.push({ x: x0 + 10, y: y0 + 10, w: x1 - x0 - 20, h: y1 - y0 - 20 });
        continue;
      }
      fillBlock(x0, x1, y0, y1);
    }
  }

  // North and south strips: a single row of buildings per cell.
  for (const [x0, x1] of STRIP_COLS) {
    addBuilding(x0 + 10, NORTH_ROW[0] + 14, x1 - x0 - 20, NORTH_ROW[1] - NORTH_ROW[0] - 28);
    const sw = (x1 - x0 - 46) / 2;
    addBuilding(x0 + 10, SOUTH_ROW[0] + 16, sw, 150);
    addBuilding(x0 + 26 + sw, SOUTH_ROW[0] + 16, sw, 150);
    addBuilding(x0 + 10, SOUTH_ROW[0] + 196, sw, 150);
    addBuilding(x0 + 26 + sw, SOUTH_ROW[0] + 196, sw, 150);
  }
  // West edge strip.
  for (const [y0, y1] of MAIN_ROWS) {
    addBuilding(38, y0 + 10, 140, y1 - y0 - 20);
  }

  // Promenade palms along the beach and around the park.
  for (let y = 120; y < WORLD_H - 80; y += 130) {
    trees.push({ x: 2760 + (rng() - 0.5) * 26, y, r: 12 + rng() * 6 });
  }

  const casinoBlock = MAIN_COLS[4];
  const casinoRow = MAIN_ROWS[0];
  const hospitalBlock = MAIN_COLS[0];
  const hospitalRow = MAIN_ROWS[1];
  const policeBlock = MAIN_COLS[3];
  const policeRow = MAIN_ROWS[3];
  const garageBlock = MAIN_COLS[2];
  const garageRow = MAIN_ROWS[3];
  const parkBlock = MAIN_COLS[1];
  const parkRow = MAIN_ROWS[2];

  const landmarks = {
    casino: {
      rect: { x: casinoBlock[0] + 20, y: casinoRow[0] + 16, w: casinoBlock[1] - casinoBlock[0] - 40, h: 168 },
      door: { x: (casinoBlock[0] + casinoBlock[1]) / 2, y: casinoRow[1] + 26 },
      vanSpawn: { x: casinoBlock[0] + 70, y: casinoRow[1] + 30, angle: 0 },
    },
    hospital: {
      rect: { x: hospitalBlock[0] + 30, y: hospitalRow[0] + 40, w: hospitalBlock[1] - hospitalBlock[0] - 60, h: 190 },
      respawn: { x: 240, y: hospitalRow[0] + 130 },
    },
    policeStation: {
      rect: { x: policeBlock[0] + 30, y: policeRow[0] + 30, w: policeBlock[1] - policeBlock[0] - 60, h: 170 },
      respawn: { x: 1640, y: 1890 },
      lot: { x: policeBlock[0] + 30, y: policeRow[1] + 224 - 300, w: policeBlock[1] - policeBlock[0] - 60, h: 60 },
    },
    garage: {
      rect: { x: garageBlock[0] + 40, y: garageRow[0] + 90, w: garageBlock[1] - garageBlock[0] - 80, h: 130 },
      dropoff: { x: garageBlock[0] + 55, y: garageRow[0] + 236, w: garageBlock[1] - garageBlock[0] - 110, h: 52 },
    },
    hideout: {
      x: (parkBlock[0] + parkBlock[1]) / 2,
      y: (parkRow[0] + parkRow[1]) / 2,
      radius: 90,
      parkRect: { x: parkBlock[0], y: parkRow[0], w: parkBlock[1] - parkBlock[0], h: parkRow[1] - parkRow[0] },
    },
    marina: {
      lot: { x: 2700, y: 1130, w: 130, h: 220 },
      carSpawn: { x: 2765, y: 1180, angle: Math.PI },
      pier: { x: SEA_X, y: 1180, w: 150, h: 26 },
    },
    playerStart: { x: 1240, y: 1440 },
    beachHouse: { x: 2765, y: 2050 },
  };

  return {
    buildings,
    parkingLots,
    trees,
    landmarks,
    sand: { x: SAND_X, y: 0, w: SEA_X - SAND_X, h: WORLD_H },
    sea: { x: SEA_X, y: 0, w: WORLD_W - SEA_X, h: WORLD_H },
    colliders: buildings,
  };
}

/** Is the point on any road (avenue, street or intersection)? */
export function isOnRoad(x, y) {
  const half = ROAD_W / 2;
  for (const vx of V_ROADS) if (Math.abs(x - vx) <= half) return true;
  for (const hy of H_ROADS) if (Math.abs(y - hy) <= half) return true;
  return false;
}

/** All intersection centre points of the road grid. */
export function intersections() {
  const pts = [];
  for (const vx of V_ROADS) for (const hy of H_ROADS) pts.push({ x: vx, y: hy });
  return pts;
}

/** A random point on a random road, for spawning traffic away from the player. */
export function randomRoadPoint(rng) {
  const r = rng || Math.random;
  if (r() < 0.5) {
    const vx = pick(V_ROADS, r);
    return { x: vx, y: 60 + r() * (WORLD_H - 120), axis: 'v', index: V_ROADS.indexOf(vx) };
  }
  const hy = pick(H_ROADS, r);
  return { x: 60 + r() * (2640 - 60), y: hy, axis: 'h', index: H_ROADS.indexOf(hy) };
}

/** Clamp a position inside the playable world (the sea is not playable). */
export function clampToWorld(p, margin) {
  const m = margin || 0;
  p.x = Math.max(m, Math.min(SEA_X - 6 - m, p.x));
  p.y = Math.max(m, Math.min(WORLD_H - m, p.y));
  return p;
}
