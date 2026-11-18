# palm-cove-heat

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/dashaaa12/palm-cove-heat/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/dashaaa12/palm-cove-heat/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**Palm Cove Heat** is an original top-down open-world crime game that runs
entirely in the browser from static files — no build step, no network, no
libraries. You are **Danny Solano**, the best wheelman in the sun-soaked
coastal city of Palm Cove, and fixer **Marisol "Sol" Ferrer** has three jobs
that will prove it.

**The story.** (1) *Lift the Aurelion* — steal the gold Aurelion GT parked at
the marina and deliver it to Sol's garage. (2) *Hot Package* — pick up a
package at the Palm Casino's back door and run it to the beach house against
the clock, with the casino calling it in. (3) *Casino Cream* — take the Palm
Trust cash van, lose the heat, and park it in the park hideout. After the
story, free-roam car fencing at Sol's drop-off keeps the money coming.

**What's in the world**

- A full city on foot and by car: a road grid with right-lane traffic AI,
  pedestrians who stroll, flee and get knocked down, parking lots full of
  stealable cars, a beach and marina, the Palm Casino, Palm Cove General
  hospital, the PCPD station and a park hideout.
- Steal and drive anything: arcade driving physics with acceleration,
  braking, handbrake slides, skid marks, collisions and car damage.
- A five-star wanted system: crimes raise heat when witnessed, PCPD
  interceptors hunt you across the grid and search the blocks around your
  last known position, foot officers deploy, chase, shoot at three stars
  and up, and fill a bust meter at close range. Break line of sight and let
  the stars fade to escape. Get caught and you're **BUSTED**; get shot down
  and you're **WASTED** — either way you pay and respawn.
- Combat: mouse-aim shooting on foot with tracers, damage and return fire.
- HUD with cash, health, wanted stars, an objective card, a speedometer
  and a live minimap (roads, police blips, objective marker).
- Title, pause, BUSTED and WASTED screens; progress (cash and jobs done)
  saves to localStorage between sessions.
- All sound is procedural WebAudio — engine hum, two-tone sirens, gunshots,
  cash jingles and phone blips. There are no audio files.

**Controls**

| Input | Action |
| --- | --- |
| W A S D / arrow keys | Walk and drive |
| Shift | Run on foot |
| Space | Handbrake in a car |
| E | Steal / enter a car, get out again |
| Mouse | Aim on foot |
| Mouse click (hold) | Shoot |
| P / Esc | Pause |
| M | Mute |

**Source layout** — `game/src/` is split into one file per job: `city.js`
(the Palm Cove generator), `vehicles.js` (cars, physics, traffic AI),
`pedestrians.js` (the crowd), `police.js` (wanted system and the PCPD),
`missions.js` (Sol's three jobs and fencing), `hud.js` (HUD, minimap,
menus), `audio.js` (the WebAudio synth) and `main.js` (state, player,
combat, rendering, the loop).

## Run it

```sh
# Assemble the make.fun hand-in (copies game/ + screenshots/, writes dossier.json):
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

# Play the game: serve game/ with any static server, e.g.
node -e "require('http').createServer((q,s)=>{const fs=require('fs'),p=require('path');const f=p.join('game',q.url==='/'?'index.html':q.url);fs.readFile(f,(e,d)=>{if(e){s.writeHead(404);s.end()}else{s.writeHead(200,{'Content-Type':f.endsWith('.js')?'text/javascript':'text/html'});s.end(d)}})}).listen(8080)"
# then open http://localhost:8080 in desktop Chrome.
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=y1enas6g&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
