# Iron Line — design spec

An original 3-mission raycaster FPS for `/arcade/iron-line/`. Code goes in `src/components/ironLine.ts` and
`src/pages/arcade/iron-line.astro`. It must be fast, phone-playable, have tiny JS and download nothing (all art is
procedural). Original names and art only; no copyrighted assets.

## Reuse (already built, uncommitted)

- `src/lib/canvasLoop.ts`: `startCanvasLoop(canvas, {maxDPR, targetFPS, mobileFPS, essential, onFrame(ctx,{dt,time,width,height}), onResize, onPauseChange})`
  returns `{stop()}`. dt is in ms. The context is `alpha:false` and you draw in CSS px.
- `src/lib/gameShell.ts`:
  - `createShell(root, {onMain, onPause})` returns `{show({kicker,title,msg,label,share}), hide(), say(), setRunning(), destroy()}`
  - `holdButtons(root, keys, onPress)` returns an off function
  - also exports `onSwipe`, `rng(seed)` (mulberry32) and `buzz(ms)`
- `src/lib/sfx.ts`: `tone(freq,dur,type,vol,slideTo?)`, `noise(dur<=0.45,vol,freq,q)`, `unlockAudio()`, `setMuted()`.
- `src/lib/clientState.ts`: `STORAGE_KEYS.ironLineBest`, `STORAGE_KEYS.ironLineMission`, `readNumber`, `writeNumber`.
- `src/components/CanvasGame.astro`: the shared frame. It has a touch slot (`.tgrp` / `.tbtn` / `.tbtn--big` with
  `data-key`).
- **Copy the patterns** of `src/components/monolith.ts` and `src/pages/arcade/monolith.astro`:
  - mount preamble, state machine (menu/run/paused/won/over), start/pause/resume/lose
  - mode buttons locked while running, the 700 ms delayed death overlay
  - key handling ignores modifier keys
  - destroy removes every listener

## Pure exports (unit-tested; no DOM at import time)

- `type MissionKind = "intel"|"uplink"|"hold"`
- `interface Mission {name, kind, brief, sky, par, fog:RGB, fogDist, skyTop?, skyHz?, hill?, sun?:[angle,elev], floor:"dirt"|"tiles"|"asphalt", rows}`
- `MISSIONS`
- `parseGrid(rows)` returns `{w,h,cells:Uint8Array}`. `WALLS="#BC"`, and each cell is `WALLS.indexOf(ch)+1`.
- `mapProblems(rows, kind)` returns `string[]`. It checks:
  - the map is at least 8×8 and every row has the same length
  - only the characters `#BC.PEHOARSX` appear
  - the border is all walls
  - there is exactly one P and exactly one X
  - the O count is 1 for intel, 2 for uplink and 0 for hold
  - a 4-neighbour BFS from P (blocked by walls and R) reaches every open tile
- `validMap(rows, kind)`.
- `castRay(g, ox, oy, dx, dy)` returns `{dist, side, tile, wallX, mx, my}`:
  - Lode-style DDA, at most 256 steps; out of bounds counts as tile 1
  - `ddx = dx===0 ? 1e30 : |1/dx|`
  - `dist = side0 ? sdx-ddx : sdy-ddy`
  - `wallX` is the fractional part only
- `missionScore(kills, heads, time, par) = kills*100 + heads*50 + max(0, round((par-time)*10))`. Veteran multiplies it
  by 1.25 inside mount.

**Legend:**

| Character | Meaning |
| --- | --- |
| `#` | concrete wall |
| `B` | brick wall |
| `C` | crate wall |
| `E` | soldier |
| `H` | heavy |
| `O` | objective |
| `A` | ammo |
| `R` | barrel |
| `S` | hidden spawn |
| `X` | extraction |
| `P` | player |

## Maps (row lengths verified)

**M1 Breach** (intel)
- Sky and a dirt floor.
- fog [214,168,140], fogDist 18.
- skyTop [58,72,110], skyHz [236,170,128], hill [96,84,96].
- par 150, sun [-0.6, 0.12].
- Brief: "Dawn raid on a hillside compound. Push through the yard, take the intel from the command hut and get out to the
  extraction flare."

```
##########################
#.......#.....#....R...X.#
#..E....#..E..#..........#
#.......C.....#...E..CC..#
#..CC.......H.......C....#
#..CC...#.....#..........#
####.####BB.BBB####.######
#.......B.......B........#
#...E...B...O...B....E...#
#.......B.......B..CC....#
#..R.......E.............#
#.......BB...BBBB....R...#
#..A.................A...#
###.#####...E....#####.###
#.......#.......C#.......#
#..P....#..CC...C#...E...#
#............R...........#
##########################
```

**M2 Uplink** (uplink)
- No sky (cast a ceiling texture instead) and a tile floor.
- fog [8,11,20], fogDist 11.
- par 200.
- Brief: "Night, inside the relay station. Plant both uplink relays (stand on each for a moment), then reach extraction
  before the timer runs out. Reinforcements are coming."

```
############################
#P....#........#.....S.....#
#.....#...E....#...........#
#.....B........B...E...CC..#
#..A.......CC..............#
#.....B........B.....O.....#
###.#####B..BBBB#####..#####
#.......#......#...........#
#..E....#..H...#...E....R..#
#.......C......C...........#
#..R...........#....CC.....#
#.......#..O...#...........#
##.##########.######.####.##
#.......S....#.......#.....#
#..E.........#...E...#..E..#
#.......CC.......A.........#
#.X..........#.......S.....#
############################
```

**M3 Last Stand** (hold)
- Sky and an asphalt floor.
- skyTop [40,30,60], skyHz [214,110,80], hill [60,40,52].
- fog [150,84,74], fogDist 17.
- par 160, sun [2.4, 0.06].
- Brief: "Dusk at the crossroads. Hold the square until the helicopter is inbound, then run for the landing zone. Ammo
  crates refill."

```
##############################
#S...........S..............S#
#............................#
#...CC.....R.......R.....CC..#
#...CC.........E.........CC..#
#........BBB......BBB........#
#..E.....B..........B.....E..#
#........B....A.....B........#
#.....R.......CC.......R.....#
#.............CC.............#
#........B....P.....B........#
#........B..........B........#
#..A.....BBB......BBB.....A..#
#............................#
#...CC.......X...........CC..#
#...CC...................CC..#
#.....R.................R....#
#S............S.............S#
##############################
```

## Rendering

**Framebuffer**
- `RW = clamp(round(w/2.5), 240, 400)`, `RH = round(RW*h/w)`.
- Render into an offscreen canvas through ImageData with a Uint32 view (ABGR).
- Each frame, `putImageData` it, set `imageSmoothingEnabled=false`, then draw it scaled up with a 6 px margin, offset
  by screen shake.
- The HUD and the gun are drawn at full resolution on top.

**Camera**
- `pl = 0.70 - 0.25*adsT`.
- `plane = (-dirY, dirX)*pl`.
- `proj = (RW/2)/pl`.
- `hz = RH/2 + (pitch+recoilP)*RH`, with pitch clamped to ±0.35.

**Drawing order**

1. **Sky.**
   - A gradient LUT, plus the sun with a glow.
   - Two mountain ridges with height `mh=(0.07+0.03sin(3a+1.3)+0.018sin(7a+0.4)+0.008sin(17a))*proj`, where
     `a = pa+atan(camX*pl)`. Mix the far ridge 70% toward skyHz.
   - With no sky, cast the ceiling instead.
2. **Floor.** `rowD = 0.5*proj/|y+0.5-hz|`, with per-row fog.
3. **Walls.**
   - Run the DDA per column and store `zbuf[x]=max(dist,0.05)`; `lh = proj/perp`.
   - Flip texX when `(side0&&rdx>0)||(side1&&rdy<0)`.
   - Darken y-side walls with `mul*205>>8`.
4. **Sprites, far to near.**
   - Placement:
     - `depth = dx*dirX+dy*dirY`; skip the sprite when depth < 0.15
     - `lat = dirX*dy-dirY*dx`
     - `sx = RW/2+lat/depth*proj`
     - `size = worldSize*proj/depth`
     - `yBot = hz+(0.5-z)*proj/depth`
   - Z-test per column and skip texels that are 0.
   - Record `{kind, ref, left, top, size, depth, tex}` for hit tests.
5. **Particles.** A pool of 160, z-tested.

**Fog**
- `k = clamp((d-1.5)/(fd-1.5),0,1)*235`, `mul = 256-k`, then add `fog*k>>8`.
- `fd = fogDist*(1+0.35*flash)`.
- The hit flash is `shade(c,128,110,110,110)`.

**Textures**
- `paint(draw, seed, grain)` draws on a 64×64 canvas (willReadFrequently). Alpha below 128 becomes 0; everything else
  becomes opaque with ±grain noise.
- Surfaces: concrete, brick, crate, dirt, tiles, asphalt, ceiling.
- Soldier frames: idle, walk1, walk2, fire, pain, dead.
  - Colours: helmet #1b1f25, red visor #ff4433 at y 10–12, torso #3a4250, vest #262b33, boots #111.
  - HEAD_LINE = 18 (rows above it count as head).
  - Soldier size 0.95.
- Heavy: wider, coloured #3b3330 / #57463c, carries an LMG, size 1.05.
- Props and their sizes:
  - barrel 0.62
  - ammo 0.5
  - intel laptop 0.5 (bobs)
  - relay 0.9, off and on frames
  - LZ sign 0.7
  - flare 1.0, 2 frames

## Player

**Health and ammo**
- hp 100. It regenerates 30/s after 4 s without damage (5 s on Veteran).
- Magazine 30, reserve 120 (max 240).

**Firing**
- Time between shots (FIRE_GAP) is 0.095 s. Damage 34; headshots do ×2.5.
- Reload takes 1.6 s, and the gun auto-reloads when the magazine is empty.
- Spread = `0.004+0.022*(1-adsT)+bloom+(moving?0.012*(1-0.7adsT):0)`. Bloom adds 0.006 per shot (cap 0.03) and decays
  at 0.08/s.
- Recoil: `recoilP += 0.012*(1-0.5adsT)`, decaying at about 6/s, plus a yaw jitter of ±0.003.

**Movement**
- Speed 3.2, or 1.8 while aiming. Radius 0.25.
- Collision is axis-separated; barrels count as circles of r 0.3.
- Initial facing is the longest of 8 rays.
- adsT eases over 0.18 s. Footsteps play on the bob.

## Controls

**Keyboard**
- w/s/ArrowUp/ArrowDown move forward and back.
- a/d strafe.
- ArrowLeft/ArrowRight/q/e turn at 2.4 rad/s.
- Space/j/f fire.
- Shift/k aim down sights.
- r reloads.

**Mouse (desktop)**
- Use pointer lock. Wrap the lock call in try/catch plus `.catch`.
- Lock on start, on resume and on canvas click. Losing the lock while running pauses the game, and `pause()` calls
  exitPointerLock.
- Look sensitivity is 0.0022 rad/px, ×0.6 while aiming. Fall back to drag-look when pointer lock isn't available.
- Mouse button 0 fires and button 2 aims. Prevent the context menu.

**Touch**
- The left 42% of the canvas is a dynamic move stick (r 48). The rest drag-looks at 0.0065 rad/px, and the fire button
  also drag-looks.
- Buttons:
  - Aim (`data-key="aim"`) toggles an ADS latch
  - Reload (`data-key="reload"`) reloads
  - Fire (`data-key="fire"`, `tbtn--big`) fires while held
- Aim magnetism of 0.9 rad/s within 14 framebuffer px, and ±2 px hit tolerance.

## Shooting and enemies

**Hit tests**
- Test sprite records near to far, checking texel alpha and depth against zbuf.
- A miss spawns sparks or dust.

**Barrels**
- hp 30.
- Blast radius 2.2, damage `150*(1-d/2.2)`. The player takes at most 60 from one blast.
- Chained barrels go off after a 0.15 s fuse.
- Gunfire alerts enemies within 10 tiles.

**Enemy types**
- Soldier: 100 hp, speed 1.6, fires 3-round bursts 0.12 s apart, then waits 1.0–1.8 s.
- Heavy: 250 hp, speed 1.1, fires 6-round bursts 0.09 s apart.

**Awareness**
- An enemy notices the player within 10 tiles (12 on Veteran) with line of sight.
- LOS is checked every 0.12 s.
- Reaction delay is 0.55 + d*0.03.

**Movement**
- Beyond 7.5 tiles, or without sight, enemies follow a flow-field BFS:
  - recomputed every 0.4 s
  - 8-neighbour
  - no corner cutting
- Otherwise they strafe at ×0.7 speed, flipping direction every 0.8–1.6 s, and back off when closer than 3.
- They keep 0.6 apart from each other.

**Their fire**
- Hit chance = `clamp(0.56-0.024d+(vet?0.1:0)-(moving?0.14:0), 0.1, 0.8)`.
- Damage 8–11 (heavy 7–10), ×1.4 on Veteran.
- A hit shows a damage arc; a miss plays a whizz.
- Gunfire volume is `clamp(1-d/20, 0.15, 1)`.
- Each kill has a 60% chance to drop ammo (+30).

## Objectives

**Intel**
- Reach O (within 0.7), then X (within 0.9).

**Uplink**
- Plant each relay by staying within 1.1 of it for 1.5 s. Progress decays at 0.5/s when you leave.
- After both are planted:
  - a 60 s timer starts (45 s on Veteran)
  - 4–6 reinforcements spawn at S tiles more than 5 away, then one every 8 s while fewer than 6 are alive
- Running out of time fails the mission with "Uplink traced".

**Hold**
- Survive 90 s (100 s on Veteran).
- Spawns:
  - one every `max(1.8, 4.2-0.025t)` seconds
  - at most 5 alive (7 on Veteran)
  - after 35 s, each spawn has a 20% chance to be a heavy
- When time is up, show "Helicopter inbound" and X becomes active.
- Ammo crates respawn after 20 s.

**Ammo pickup**
- Within 0.6, gives +60 (cap 240).

## Sound (sfx.ts)

| Event | Calls |
| --- | --- |
| Gunshot | `noise(0.09,0.35,900,0.7)` + `tone(140,0.08,"sawtooth",0.12,60)` |
| Whizz | `tone(2400,0.12,"sine",0.04,600)` |
| Hitmarker | `tone(1800,0.04,"square",0.05)` |
| Headshot | `tone(2400,.06,"triangle",.08)` |
| Explosion | `noise(0.45,0.6,300,0.5)` + `tone(60,0.5,"sine",0.4,30)` |
| Pickup | `tone(880,.08,"square",.08,1320)` |
| Hurt | `tone(180,.12,"sawtooth",.15,90)` + `buzz(40)` |
| Chime | `tone(660,.25,"triangle",.15,990)` |
| Empty click | `tone(300,.03,"square",.05)` |
| Footstep | `noise(0.04,0.06,500,1)` |
| Death | `tone(220,.25,"sawtooth",.08,80)` |

## HUD and gun

**HUD**
- Effects:
  - a cached vignette
  - a hurt flash, with a pulse when hp is below 35
  - damage arcs
- Crosshair:
  - gap is `spread*w/(2*pl)+4`
  - a red dot replaces it while aiming
  - hit and kill markers
- Objective:
  - a diamond marker with distance in metres (tiles×2)
  - objective text and timer at top centre
- Minimap: rotating, top-left, R 52, 4 px per cell.
- HP and ammo sit in the bottom corners on desktop and the top corners on coarse pointers.
- Also: popups, the relay progress ring, the stick visual and a reload bar.
- Shake and bob are off when `data-motion="reduced"`.
- HUD font: `600 Npx ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.

**Gun**
- Hip position: anchor (0.68w, h), rotation -0.32, scale h/330.
- ADS position: anchor (0.5w, 1.06h), rotation 0, scale h/196.4.
- Lerp between them by adsT.
- The optic lens is at (0,-110) and the muzzle flash at (0,-222).
- Animate kick, bob and a dip during reload.

## Flow and page

**States**
- menu (attract rotation), run, paused, won, over.
- `loadMission(i)`:
  - parses the map and collects entities
  - builds the minimap and flow field
  - resets stats

**Win overlay**
- Kicker: "Mission complete", or "Campaign complete" after the last mission.
- Message: score (+ "New best!"), kills, headshots, accuracy and time.
- Button label: "Next mission".
- Share text: `I cleared ${name} in Iron Line with ${score} points.`

**Death overlay**
- Shown after 700 ms: kicker "Killed in action", title "Mission failed", label "Retry".

**Storage**
- `ironLineBest` holds the best single-mission score.
- `ironLineMission` holds the number of missions cleared (0–3). The highest unlocked mission is min(cleared, 2).

**Side panel**
- Stats: `[data-score]`, `[data-best]`, `[data-cleared]`.
- Mission buttons `[data-mission="0..2"]`. Locked missions are disabled, and picking one shows its briefing overlay
  (kicker "Mission n of 3", label "Deploy").
- Mode buttons `[data-mode]`: regular or veteran.
- Both groups are disabled while running or paused.

**Page `iron-line.astro`**
- Copy `monolith.astro`.
- Root is `<div data-iron-line>`.
- Use `CanvasGame shape="wide" touchOver orient="landscape"`.
- Touch slot: an empty left `.tgrp`, then a right `.tgrp` with Aim, Reload and Fire.
- Side panel: stats, missions, modes, how-to and fine print. Classes use the `.il__` prefix.

`destroy()` exits pointer lock and removes all listeners.
