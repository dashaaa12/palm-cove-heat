// hud.js — everything drawn over the world: the HUD (cash, health, wanted
// stars, speedometer, objective card), the live minimap, Sol's phone
// banners, the bust meter, and the full-screen menus (title, pause,
// BUSTED and WASTED). Buttons are registered on game.buttons for main.js
// to hit-test against mouse clicks.

import { clamp } from './util.js';
import { roundRect } from './vehicles.js';
import { WORLD_W, WORLD_H, V_ROADS, H_ROADS, SEA_X } from './city.js';

const FONT = "'Segoe UI', 'Trebuchet MS', Verdana, sans-serif";

/** Word-wrap text into lines that fit maxWidth in the current font. */
export function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const trial = line ? line + ' ' + word : word;
    if (ctx.measureText(trial).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = trial;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function panel(ctx, x, y, w, h, alpha) {
  ctx.fillStyle = `rgba(10, 16, 26, ${alpha === undefined ? 0.62 : alpha})`;
  roundRect(ctx, x, y, w, h, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Draw a menu button and register it for click handling. */
export function drawButton(ctx, game, x, y, w, h, label, action, enabled) {
  const hover = game.mouse && game.mouse.x >= x && game.mouse.x <= x + w && game.mouse.y >= y && game.mouse.y <= y + h;
  ctx.fillStyle = enabled === false ? 'rgba(70,80,95,0.85)' : hover ? '#ffb340' : 'rgba(16, 24, 38, 0.88)';
  roundRect(ctx, x, y, w, h, 10);
  ctx.fill();
  ctx.strokeStyle = enabled === false ? 'rgba(255,255,255,0.1)' : '#ffd88a';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = enabled === false ? '#8b98a8' : hover ? '#23180a' : '#ffe9bd';
  ctx.font = `bold 19px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  if (enabled !== false) game.buttons.push({ x, y, w, h, action });
}

function drawStar(ctx, x, y, r, filled, flash) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    if (i === 0) ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
    else ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fillStyle = filled ? (flash ? '#ffe066' : '#ffb400') : 'rgba(255,255,255,0.22)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

/** The in-play HUD. */
export function drawHUD(ctx, game, W, H) {
  const p = game.player;
  // Cash + health, top-left.
  panel(ctx, 14, 14, 218, 74);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#8be09a';
  ctx.font = `bold 25px ${FONT}`;
  ctx.fillText('$' + Math.floor(game.cash).toLocaleString(), 28, 46);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = `11px ${FONT}`;
  ctx.fillText('DANNY SOLANO — WHEELMAN', 28, 62);
  // Health bar.
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  roundRect(ctx, 122, 54, 96, 9, 4);
  ctx.fill();
  ctx.fillStyle = p.hp > 30 ? '#e74c3c' : '#ff2020';
  roundRect(ctx, 122, 54, Math.max(0.01, p.hp / p.maxHp) * 96, 9, 4);
  ctx.fill();

  // Wanted stars, top-right, flashing while the police can see the player.
  const stars = game.wanted.stars;
  if (stars > 0) {
    const flash = game.wanted.seenNow && Math.floor(game.time * 4) % 2 === 0;
    for (let i = 0; i < 5; i++) {
      drawStar(ctx, W - 34 - i * 34, 36, 14, i < stars, flash && i < stars);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = `bold 11px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(game.wanted.seenNow ? 'POLICE IN PURSUIT' : 'POLICE SEARCHING…', W - 20, 66);
  }

  drawMinimap(ctx, game, W - 196, 78, 182, 137);

  // Objective card, bottom-left.
  const objective = game.missions.objectiveText;
  ctx.font = `13.5px ${FONT}`;
  const lines = wrapText(ctx, objective, 300);
  const cardH = 34 + lines.length * 18;
  panel(ctx, 14, H - cardH - 14, 330, cardH);
  ctx.fillStyle = '#ffb340';
  ctx.font = `bold 11px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText('OBJECTIVE', 28, H - cardH + 8);
  ctx.fillStyle = '#ffffff';
  ctx.font = `13.5px ${FONT}`;
  lines.forEach((line, i) => ctx.fillText(line, 28, H - cardH + 28 + i * 18));

  // Speedometer + car condition, bottom-right, while driving.
  if (p.car) {
    panel(ctx, W - 196, H - 92, 182, 78);
    const mph = Math.round(Math.abs(p.car.speed) * 0.31);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 30px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(String(mph), W - 58, H - 48);
    ctx.font = `11px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('MPH', W - 24, H - 48);
    ctx.textAlign = 'left';
    ctx.font = `12px ${FONT}`;
    ctx.fillStyle = '#ffd88a';
    ctx.fillText(p.car.spec.name.toUpperCase(), W - 182, H - 48);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    roundRect(ctx, W - 182, H - 34, 160, 7, 3);
    ctx.fill();
    ctx.fillStyle = p.car.hp > p.car.maxHp * 0.35 ? '#7fd08b' : '#e74c3c';
    roundRect(ctx, W - 182, H - 34, Math.max(0.01, p.car.hp / p.car.maxHp) * 160, 7, 3);
    ctx.fill();
  } else {
    panel(ctx, W - 196, H - 58, 182, 44);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `12px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillText('ON FOOT — press E at a car', W - 182, H - 30);
  }

  // Bust meter, top-centre, while it is filling.
  if (game.bust > 0.02) {
    const w = 260;
    panel(ctx, W / 2 - w / 2, 16, w, 34);
    ctx.fillStyle = '#ff5a4d';
    roundRect(ctx, W / 2 - w / 2 + 8, 34, (w - 16) * clamp(game.bust, 0, 1), 8, 4);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 12px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('BUSTED', W / 2, 29);
  }

  drawPhone(ctx, game, W);

  // Damage vignette.
  if (game.damageFlash > 0) {
    const grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.36, W / 2, H / 2, H * 0.78);
    grad.addColorStop(0, 'rgba(200,0,0,0)');
    grad.addColorStop(1, `rgba(200,0,0,${0.45 * game.damageFlash})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  // Early-game controls hint.
  if (game.playTime < 14 && game.state === 'playing') {
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = `12.5px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('WASD drive / walk · E enter & exit car · Mouse aim, click to shoot · Shift run · P pause', W / 2, H - 12);
  }
}

/** The live minimap: roads, sea, park, police blips, player and objective. */
export function drawMinimap(ctx, game, x, y, w, h) {
  const sx = w / WORLD_W;
  const sy = h / WORLD_H;
  ctx.save();
  panel(ctx, x - 6, y - 6, w + 12, h + 12, 0.55);
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = '#274b63';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#3f7f5f';
  ctx.fillRect(x, y, (SEA_X - 240) * sx, h); // land mass
  ctx.fillStyle = '#57a773';
  const park = game.city.landmarks.hideout.parkRect;
  ctx.fillRect(x + park.x * sx, y + park.y * sy, park.w * sx, park.h * sy);
  ctx.fillStyle = '#e8d8a0';
  ctx.fillRect(x + 2840 * sx, y, (3020 - 2840) * sx, h); // beach
  ctx.strokeStyle = 'rgba(240,240,230,0.55)';
  ctx.lineWidth = 1;
  for (const vx of V_ROADS) {
    ctx.beginPath();
    ctx.moveTo(x + vx * sx, y);
    ctx.lineTo(x + vx * sx, y + h);
    ctx.stroke();
  }
  for (const hy of H_ROADS) {
    ctx.beginPath();
    ctx.moveTo(x, y + hy * sy);
    ctx.lineTo(x + 2640 * sx + 8, y + hy * sy);
    ctx.stroke();
  }
  // Police blips.
  for (const car of game.cars) {
    if (car.driver !== 'police') continue;
    ctx.fillStyle = Math.floor(game.time * 4) % 2 === 0 ? '#ff3b30' : '#2e7bff';
    ctx.fillRect(x + car.x * sx - 2, y + car.y * sy - 2, 4, 4);
  }
  for (const o of game.police.officers) {
    ctx.fillStyle = '#7fb2ff';
    ctx.fillRect(x + o.x * sx - 1.5, y + o.y * sy - 1.5, 3, 3);
  }
  // Garage drop-off.
  const d = game.city.landmarks.garage.dropoff;
  ctx.fillStyle = '#ff9f43';
  ctx.fillRect(x + (d.x + d.w / 2) * sx - 2, y + (d.y + d.h / 2) * sy - 2, 4, 4);
  // Mission marker.
  const m = game.missions.marker;
  if (m) {
    const pulse = 3 + Math.sin(game.time * 5) * 1.2;
    ctx.fillStyle = '#ffd32a';
    ctx.beginPath();
    ctx.arc(x + m.x * sx, y + m.y * sy, pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.stroke();
  }
  // Player arrow.
  const p = game.player;
  const ang = p.car ? p.car.angle : p.angle;
  ctx.save();
  ctx.translate(x + p.x * sx, y + p.y * sy);
  ctx.rotate(ang);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(6, 0);
  ctx.lineTo(-4, -3.6);
  ctx.lineTo(-4, 3.6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = `bold 10px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText('PALM COVE', x + 3, y + 13);
}

/** Sol's phone: a banner that slides in at the top centre of the screen. */
export function drawPhone(ctx, game, W) {
  const msg = game.phoneMsg;
  if (!msg || msg.t <= 0) return;
  const appear = clamp(msg.t / 0.4, 0, 1) * clamp((msg.total - msg.t) / 0.25 + 0.25, 0, 1);
  const w = 430;
  ctx.font = `13.5px ${FONT}`;
  const lines = wrapText(ctx, msg.text, w - 76);
  const h = 44 + lines.length * 18;
  const y = 14 - (1 - appear) * (h + 20);
  const x = W / 2 - w / 2;
  ctx.save();
  ctx.globalAlpha = clamp(appear + 0.15, 0, 1);
  ctx.fillStyle = 'rgba(14, 18, 26, 0.94)';
  roundRect(ctx, x, y, w, h, 14);
  ctx.fill();
  ctx.strokeStyle = '#3d5a80';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Avatar circle.
  ctx.fillStyle = '#ee6c4d';
  ctx.beginPath();
  ctx.arc(x + 27, y + 27, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `bold 13px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('S', x + 27, y + 32);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffd88a';
  ctx.font = `bold 12px ${FONT}`;
  ctx.fillText(msg.from + ' — TEXT MESSAGE', x + 52, y + 21);
  ctx.fillStyle = '#f4f6f8';
  ctx.font = `13.5px ${FONT}`;
  lines.forEach((line, i) => ctx.fillText(line, x + 52, y + 40 + i * 18));
  ctx.restore();
}

/** The title screen, drawn over the slowly panning live city. */
export function drawTitleScreen(ctx, game, W, H) {
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(12, 24, 44, 0.55)');
  grad.addColorStop(0.55, 'rgba(12, 24, 44, 0.25)');
  grad.addColorStop(1, 'rgba(12, 24, 44, 0.72)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd88a';
  ctx.font = `bold 21px ${FONT}`;
  ctx.fillText('M A K E   F U N   P R E S E N T S', W / 2, H * 0.16);
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 84px ${FONT}`;
  ctx.shadowColor = 'rgba(255, 140, 0, 0.55)';
  ctx.shadowBlur = 26;
  ctx.fillText('PALM COVE', W / 2, H * 0.30);
  ctx.fillStyle = '#ff9f43';
  ctx.fillText('HEAT', W / 2, H * 0.30 + 78);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = `16.5px ${FONT}`;
  const blurb = wrapText(ctx, 'Danny Solano is the best wheelman in Palm Cove — and fixer Marisol “Sol” Ferrer has three jobs that will prove it. Steal the cars, run the packages, out-drive the PCPD, and own the sun-soaked streets.', 640);
  blurb.forEach((line, i) => ctx.fillText(line, W / 2, H * 0.30 + 128 + i * 22));
  const bw = 280;
  const bx = W / 2 - bw / 2;
  let by = H * 0.66;
  drawButton(ctx, game, bx, by, bw, 52, 'NEW GAME', 'new', true);
  by += 64;
  drawButton(ctx, game, bx, by, bw, 52, game.saveExists ? 'CONTINUE' : 'CONTINUE (NO SAVE)', 'continue', game.saveExists);
  by += 64;
  drawButton(ctx, game, bx, by, bw, 52, game.showHelp ? 'HIDE CONTROLS' : 'HOW TO PLAY', 'help', true);
  if (game.showHelp) drawHelpPanel(ctx, game, W, H);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = `12px ${FONT}`;
  ctx.fillText('An original open-world crime game · keyboard & mouse · sound on for sirens', W / 2, H - 18);
}

function drawHelpPanel(ctx, game, W, H) {
  const w = 560;
  const h = 218;
  const x = W / 2 - w / 2;
  const y = H * 0.66 - h - 14;
  panel(ctx, x, y, w, h, 0.92);
  ctx.fillStyle = '#ffd88a';
  ctx.font = `bold 14px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText('CONTROLS', x + 22, y + 28);
  ctx.fillStyle = '#f4f6f8';
  ctx.font = `13.5px ${FONT}`;
  const rows = [
    'W A S D / Arrow keys — walk and drive',
    'SHIFT — run on foot · SPACE — handbrake in a car',
    'E — steal / enter a car, get out again',
    'MOUSE — aim on foot · CLICK — shoot',
    'Follow the gold marker: steal, deliver, escape. Stars mean the PCPD is coming.',
    'Lose the police by breaking line of sight until the stars fade.',
    'P — pause · M — mute · Progress saves automatically between jobs.',
  ];
  rows.forEach((row, i) => ctx.fillText(row, x + 22, y + 56 + i * 22));
}

/** Pause overlay. */
export function drawPauseScreen(ctx, game, W, H) {
  ctx.fillStyle = 'rgba(8, 12, 20, 0.66)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 52px ${FONT}`;
  ctx.fillText('PAUSED', W / 2, H * 0.3);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = `15px ${FONT}`;
  ctx.fillText(`Cash $${Math.floor(game.cash).toLocaleString()} · Jobs done ${game.missions.index} of 3`, W / 2, H * 0.3 + 34);
  const bw = 280;
  const bx = W / 2 - bw / 2;
  let by = H * 0.44;
  drawButton(ctx, game, bx, by, bw, 50, 'RESUME', 'resume', true);
  by += 62;
  drawButton(ctx, game, bx, by, bw, 50, 'RESTART STORY', 'restart', true);
  by += 62;
  drawButton(ctx, game, bx, by, bw, 50, 'QUIT TO TITLE', 'title', true);
}

/** BUSTED / WASTED end screens. */
export function drawEndScreen(ctx, game, W, H) {
  const busted = game.state === 'busted';
  ctx.fillStyle = busted ? 'rgba(10, 20, 60, 0.72)' : 'rgba(60, 8, 8, 0.72)';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = busted ? '#7fb2ff' : '#ff6b5e';
  ctx.font = `900 76px ${FONT}`;
  ctx.fillText(busted ? 'BUSTED' : 'WASTED', W / 2, H * 0.36);
  ctx.fillStyle = '#ffffff';
  ctx.font = `17px ${FONT}`;
  const lines = busted
    ? ['The PCPD finally boxed Danny in.', `Fine paid: $${game.endFine.toLocaleString()} — released outside Palm Cove PD.`]
    : ['Danny woke up on a gurney at Palm Cove General.', `Medical bill: $${game.endFine.toLocaleString()} — the streets are still out there.`];
  lines.forEach((line, i) => ctx.fillText(line, W / 2, H * 0.36 + 44 + i * 24));
  drawButton(ctx, game, W / 2 - 140, H * 0.58, 280, 52, 'BACK TO THE STREETS', 'respawn', true);
}
