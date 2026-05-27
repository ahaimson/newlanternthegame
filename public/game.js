/* NEW LANTERN — X-RAY RUNNER
   An 8-bit radiology auto-runner. Two controls only:
     BRAKE  — slows the runner (timing tool)
     JUMP   — leap up through the floating scanners to X-ray yourself for points
   Reads only this tab's keyboard events; preventDefault is applied solely to the
   bound control codes, so an Apple keyboard / mouse / USB 2-key pad all coexist. */

"use strict";

// ============================================================
//  CONFIG + PERSISTENCE
// ============================================================
const LS_CFG = "newlantern.cfg.v1";
const LS_BEST = "newlantern.best.v1";
const LS_SCORES = "newlantern.scores.v1";
const LS_NAME = "newlantern.name.v1";
const MAX_SCORES = 8;

const DEFAULT_BRAKE = ["KeyA", "ArrowDown", "ArrowLeft", "KeyZ", "KeyJ", "KeyS"];
const DEFAULT_JUMP  = ["Space", "ArrowUp", "ArrowRight", "KeyB", "KeyX", "KeyK", "KeyW", "Enter"];

const DEFAULTS = {
  char: "curie",
  diff: "normal",
  brakeCode: null,   // null = use DEFAULT_BRAKE set
  jumpCode: null,    // null = use DEFAULT_JUMP set
  mute: false,
};
let cfg = loadCfg();
let best = +(localStorage.getItem(LS_BEST) || 0);
let scores = loadScores();   // [{ name, score }] sorted high→low

function loadCfg() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(LS_CFG) || "{}") }; }
  catch { return { ...DEFAULTS }; }
}
function saveCfg() { localStorage.setItem(LS_CFG, JSON.stringify(cfg)); }

function loadScores() {
  try {
    const a = JSON.parse(localStorage.getItem(LS_SCORES) || "[]");
    return Array.isArray(a) ? a.filter((e) => e && typeof e.score === "number")
      .sort((x, y) => y.score - x.score).slice(0, MAX_SCORES) : [];
  } catch { return []; }
}
function saveScores() { localStorage.setItem(LS_SCORES, JSON.stringify(scores)); }
function scoreQualifies(s) { return s > 0 && (scores.length < MAX_SCORES || s > scores[scores.length - 1].score); }
function provisionalRank(s) { return 1 + scores.filter((e) => e.score > s).length; }
function addHighScore(name, s) {
  const entry = { name, score: s };
  scores.push(entry);
  scores.sort((x, y) => y.score - x.score);
  scores = scores.slice(0, MAX_SCORES);
  saveScores();
  return scores.indexOf(entry);   // rank index (0-based)
}

const DIFF = {
  easy:   { base: 62,  ramp: 0.9, max: 150, drain: 11, gapMin: 110, gapMax: 175, name: "EASY" },
  normal: { base: 82,  ramp: 1.7, max: 195, drain: 16, gapMin: 96,  gapMax: 152, name: "NORMAL" },
  hard:   { base: 108, ramp: 2.7, max: 245, drain: 22, gapMin: 84,  gapMax: 132, name: "HARD" },
};

// ============================================================
//  PALETTE
// ============================================================
const C = {
  sky0: "#0a0a20", sky1: "#06060f",
  purple: "#8b5cf6", purpleLt: "#c4b5fd", purpleDk: "#5b21b6", violet: "#7c3aed", lilac: "#a78bfa",
  cyan: "#67e8f9", xray: "#7dd3fc", bone: "#eaf6ff", boneDk: "#9fc6e8",
  green: "#86efac", amber: "#fbbf24", red: "#f87171",
  coat: "#eef2ff", coatSh: "#aebbe0", seam: "#c7d2e8",
  skin: "#f0c088",
  bld: "#15173a", bldLt: "#20245a", win: "#3ad0e6", winDim: "#1c5a66",
  floor: "#0b0d24", floorLine: "#1f2a66", railGlow: "#36e0ff",
};

// ============================================================
//  CANVAS
// ============================================================
const VW = 320, VH = 180;
const cv = document.getElementById("game");
let g = cv.getContext("2d");   // mutable: temporarily swapped when rendering menu avatars
g.imageSmoothingEnabled = false;

function fitCanvas() {
  const pad = 24;
  const sc = Math.max(1, Math.floor(Math.min(
    (window.innerWidth - pad) / VW,
    (window.innerHeight - pad) / VH
  )));
  cv.style.width = VW * sc + "px";
  cv.style.height = VH * sc + "px";
}
window.addEventListener("resize", fitCanvas);
fitCanvas();

// pixel helpers
function rect(x, y, w, h, col) { g.fillStyle = col; g.fillRect(x | 0, y | 0, Math.max(1, w | 0), Math.max(1, h | 0)); }
function text(str, x, y, col, size, align) {
  g.font = `${size || 8}px "Press Start 2P", monospace`;
  g.textBaseline = "top"; g.textAlign = align || "left"; g.fillStyle = col;
  g.fillText(str, x, y);
}
function lerp(a, b, t) { return a + (b - a) * t; }
function rnd(a, b) { return a + Math.random() * (b - a); }

// ============================================================
//  AUDIO (retro SFX)
// ============================================================
let actx = null;
function ensureAudio() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === "suspended") actx.resume();
}
function tone(f0, f1, dur, type, vol) {
  if (cfg.mute || !actx) return;
  const o = actx.createOscillator(), gn = actx.createGain();
  o.type = type || "square";
  const t = actx.currentTime;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  gn.gain.setValueAtTime(0.0001, t);
  gn.gain.exponentialRampToValueAtTime(vol || 0.16, t + 0.008);
  gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(gn).connect(actx.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
const SFX = {
  jump()  { tone(300, 540, 0.13, "square", 0.13); },
  land()  { tone(180, 120, 0.06, "triangle", 0.07); },
  xray(combo) {
    const base = 660 + Math.min(8, combo) * 60;
    tone(base, base * 2, 0.10, "square", 0.12);
    setTimeout(() => tone(base * 1.5, base * 2.4, 0.14, "triangle", 0.10), 40);
  },
  miss()  { tone(200, 70, 0.26, "sawtooth", 0.16); },
  brakeEmpty() { tone(170, 64, 0.2, "sawtooth", 0.11); },
  crash() { tone(150, 48, 0.18, "sawtooth", 0.18); setTimeout(() => tone(90, 40, 0.12, "square", 0.12), 30); },
  shieldOn() { [523, 659, 880, 1175].forEach((f, i) => setTimeout(() => tone(f, f * 1.5, 0.1, "square", 0.11), i * 45)); },
  shieldBreak() { tone(900, 200, 0.22, "triangle", 0.13); setTimeout(() => tone(300, 120, 0.14, "sawtooth", 0.1), 40); },
  over()  { [0, 120, 240, 380].forEach((d, i) => setTimeout(() => tone(420 - i * 90, 200 - i * 50, 0.18, "square", 0.14), d)); },
  select(){ tone(520, 660, 0.05, "square", 0.08); },
};

// ============================================================
//  CHARACTERS  (procedural pixel sprites)
// ============================================================
const CHARS = {
  curie: {
    label: "DR. CURIE", sex: "F",
    pants: "#2b3358", shoe: "#171c38", badge: C.green,
    hair: "#3a2a1a", hairLt: "#5a4326",
    head(cx, fy) {
      rect(cx - 3, fy - 24, 6, 2, this.hair);          // crown
      rect(cx - 4, fy - 23, 1, 5, this.hair);          // left side
      rect(cx + 3, fy - 23, 1, 5, this.hair);          // right side
      rect(cx - 6, fy - 24, 2, 4, this.hair);          // bun (back of head)
      rect(cx - 6, fy - 25, 2, 1, this.hairLt);
    },
  },
  rontgen: {
    label: "DR. RÖNTGEN", sex: "M",
    pants: "#3a2f25", shoe: "#241c14", badge: C.amber,
    hair: "#5a4a3a", hairLt: "#6f5c47",
    head(cx, fy) {
      rect(cx - 3, fy - 24, 6, 1, this.hair);          // thin top hair
      rect(cx - 4, fy - 22, 1, 4, this.hair);          // sideburn L
      rect(cx + 3, fy - 22, 1, 4, this.hair);          // sideburn R
      rect(cx - 2, fy - 19, 5, 1, this.hairLt);        // mustache
      rect(cx - 2, fy - 18, 4, 1, this.hair);          // beard
    },
  },
};

// draw a runner; cx = center x, fy = feet y (bottom)
function drawRunner(cx, fy, o) {
  const P = CHARS[o.type];
  const air = o.airborne;
  const frame = air ? -1 : (Math.floor(o.phase / Math.PI) % 2);
  const skin = C.skin, coat = C.coat, sh = C.coatSh;

  // ----- legs -----
  if (air) {
    rect(cx - 4, fy - 9, 3, 5, P.pants);   rect(cx - 5, fy - 4, 4, 2, P.shoe);   // trailing
    rect(cx + 1, fy - 9, 3, 4, P.pants);   rect(cx + 3, fy - 7, 3, 3, P.pants);  // tucked knee
    rect(cx + 4, fy - 7, 4, 2, P.shoe);
  } else if (frame === 0) {
    rect(cx - 5, fy - 8, 3, 6, P.pants);   rect(cx - 6, fy - 2, 4, 2, P.shoe);   // back
    rect(cx + 2, fy - 8, 3, 6, P.pants);   rect(cx + 3, fy - 2, 4, 2, P.shoe);   // front
  } else {
    rect(cx - 3, fy - 8, 3, 6, P.pants);   rect(cx - 4, fy - 2, 4, 2, P.shoe);
    rect(cx,     fy - 8, 3, 6, P.pants);   rect(cx + 1, fy - 2, 4, 2, P.shoe);
  }

  // ----- torso / lab coat -----
  rect(cx - 4, fy - 17, 8, 10, coat);
  rect(cx - 4, fy - 17, 2, 10, sh);          // left shadow
  rect(cx + 3, fy - 7,  1, 1, sh);
  rect(cx,     fy - 16, 1, 9, C.seam);       // center seam
  rect(cx - 4, fy - 7,  8, 1, sh);           // hem
  rect(cx + 1, fy - 14, 2, 2, P.badge);      // ID badge / radiation pin

  // ----- arms -----
  if (air) {
    rect(cx + 3, fy - 17, 2, 5, coat); rect(cx + 4, fy - 19, 2, 3, skin);   // front arm up
    rect(cx - 5, fy - 16, 2, 4, coat); rect(cx - 6, fy - 13, 2, 2, skin);   // back arm out
  } else if (frame === 0) {
    rect(cx + 3, fy - 16, 2, 5, coat); rect(cx + 4, fy - 12, 2, 2, skin);   // front forward
    rect(cx - 5, fy - 16, 2, 5, coat); rect(cx - 6, fy - 12, 2, 2, skin);   // back back
  } else {
    rect(cx + 3, fy - 16, 2, 6, coat); rect(cx + 3, fy - 11, 2, 2, skin);
    rect(cx - 5, fy - 16, 2, 6, coat); rect(cx - 5, fy - 11, 2, 2, skin);
  }

  // ----- head -----
  rect(cx - 3, fy - 24, 6, 7, skin);
  rect(cx - 3, fy - 24, 1, 7, "#d8a86e");   // cheek shadow
  rect(cx + 1, fy - 21, 1, 1, "#26201a");   // eye (looking ahead)
  P.head(cx, fy);
}

// X-ray skeleton overlay (alpha 0..1) + scan sweep at scanY
function drawSkeleton(cx, fy, a, scanY) {
  g.save();
  g.globalAlpha = Math.min(1, a);
  // film: darken the body so bones glow
  g.fillStyle = "rgba(8,18,38,0.82)";
  g.fillRect((cx - 7) | 0, (fy - 25) | 0, 14, 26);
  const b = C.bone, d = "#14233f";
  // skull
  rect(cx - 3, fy - 24, 6, 5, b);
  rect(cx - 2, fy - 19, 4, 1, b);            // jaw
  rect(cx - 2, fy - 22, 1, 2, d);            // eye sockets
  rect(cx + 1, fy - 22, 1, 2, d);
  rect(cx, fy - 20, 1, 1, d);                // nasal
  // spine
  rect(cx, fy - 17, 1, 9, b);
  // ribs
  for (let i = 0; i < 3; i++) { rect(cx - 3, fy - 16 + i * 2, 3, 1, b); rect(cx + 1, fy - 16 + i * 2, 3, 1, b); }
  // pelvis
  rect(cx - 3, fy - 8, 6, 1, b);
  // leg bones
  rect(cx - 2, fy - 8, 1, 7, b); rect(cx + 1, fy - 8, 1, 7, b);
  rect(cx - 3, fy - 2, 3, 1, b); rect(cx + 1, fy - 2, 3, 1, b); // feet
  // arm bones
  rect(cx - 5, fy - 16, 1, 6, b); rect(cx + 4, fy - 16, 1, 6, b);
  g.restore();

  // scan sweep line
  if (scanY != null) {
    g.save(); g.globalAlpha = Math.min(1, a * 1.4);
    rect(cx - 8, scanY, 16, 1, "#dffaff");
    g.globalAlpha = a * 0.5; rect(cx - 8, scanY - 1, 16, 1, C.cyan); rect(cx - 8, scanY + 1, 16, 1, C.cyan);
    g.restore();
  }
}

// build menu avatar data-urls by rendering the sprite to an offscreen canvas.
// All drawing helpers reference the module-level `g`, so we temporarily swap it.
function buildAvatars() {
  const main = g;
  for (const key of ["curie", "rontgen"]) {
    const oc = document.createElement("canvas");
    oc.width = 18; oc.height = 26;
    g = oc.getContext("2d");
    g.imageSmoothingEnabled = false;
    drawRunner(9, 25, { type: key, phase: 0, airborne: false });
    document.querySelector(`.av[data-av="${key}"]`).style.backgroundImage = `url(${oc.toDataURL()})`;
  }
  g = main;
}

// ============================================================
//  PARALLAX BACKGROUND
// ============================================================
const GROUND_Y = 150;
let bgFar = 0, bgMid = 0, bgNear = 0, bgFloor = 0;
const SKYLINE_W = 520;
let skyline = [];
let motes = [];     // drifting radiation atoms
let stars = [];

function buildWorld() {
  skyline = [];
  let x = 0;
  while (x < SKYLINE_W) {
    const w = (8 + Math.floor(rnd(0, 5))) * 3;
    const h = 18 + Math.floor(rnd(0, 46));
    const gantry = Math.random() < 0.18;     // CT-gantry style ring
    skyline.push({ x, w, h, gantry, seed: Math.random() });
    x += w + Math.floor(rnd(4, 14));
  }
  motes = [];
  for (let i = 0; i < 7; i++) motes.push({ x: rnd(0, VW), y: rnd(20, 120), r: rnd(2, 4), ph: rnd(0, 6.28), sp: rnd(0.3, 0.7) });
  stars = [];
  for (let i = 0; i < 46; i++) stars.push({ x: rnd(0, VW), y: rnd(0, 120), b: rnd(0.2, 0.9) });
}

function drawBackground(t) {
  // sky gradient
  const grd = g.createLinearGradient(0, 0, 0, GROUND_Y);
  grd.addColorStop(0, C.sky0); grd.addColorStop(1, C.sky1);
  g.fillStyle = grd; g.fillRect(0, 0, VW, GROUND_Y);

  // lantern glow (brand light, top right) — pulsing radial
  const pulse = 0.5 + 0.5 * Math.sin(t * 0.0015);
  const lg = g.createRadialGradient(264, 30, 2, 264, 30, 70 + pulse * 14);
  lg.addColorStop(0, "rgba(196,181,253,0.55)");
  lg.addColorStop(0.4, "rgba(139,92,246,0.20)");
  lg.addColorStop(1, "rgba(139,92,246,0)");
  g.fillStyle = lg; g.fillRect(160, 0, 160, 120);
  drawMiniFlame(264, 30, t);

  // stars / specks
  for (const s of stars) { g.globalAlpha = s.b * (0.5 + 0.5 * Math.sin(t * 0.002 + s.x)); rect(s.x, s.y, 1, 1, "#cdd6ff"); }
  g.globalAlpha = 1;

  // far skyline (slow parallax)
  drawSkyline(bgFar * 0.25, 1, "#0f1130", "#161a44");
  // mid skyline (faster, taller, with windows)
  drawSkyline(bgMid * 0.55, 0, C.bld, C.bldLt);

  // drifting radiation atoms (mid-near)
  for (const m of motes) {
    const x = ((m.x - bgNear * 0.6) % (VW + 40) + VW + 40) % (VW + 40) - 20;
    const y = m.y + Math.sin(t * 0.002 + m.ph) * 4;
    drawAtom(x, y, m.r, t + m.ph * 100);
  }

  // floor
  drawFloor(t);
}

function drawSkyline(off, far, body, edge) {
  const o = ((off % SKYLINE_W) + SKYLINE_W) % SKYLINE_W;
  for (let pass = 0; pass < 2; pass++) {
    const base = -o + pass * SKYLINE_W;
    for (const b of skyline) {
      const x = base + b.x;
      if (x > VW || x + b.w < 0) continue;
      const top = GROUND_Y - b.h;
      rect(x, top, b.w, b.h, body);
      rect(x, top, b.w, 1, edge);
      if (!far && b.gantry) {
        // CT-gantry ring on the rooftop
        ringOutline(x + b.w / 2, top - 6, 6, C.purpleLt);
        rect(x + b.w / 2 - 1, top - 6, 2, 2, C.cyan);
      } else if (!far) {
        // lit windows
        for (let wy = top + 4; wy < GROUND_Y - 3; wy += 5)
          for (let wx = x + 2; wx < x + b.w - 2; wx += 5) {
            const lit = ((wx * 13 + wy * 7 + (b.seed * 100 | 0)) % 5) < 2;
            rect(wx, wy, 2, 2, lit ? C.win : C.winDim);
          }
      }
    }
  }
}

function ringOutline(cx, cy, r, col) {
  g.strokeStyle = col; g.lineWidth = 1;
  g.beginPath(); g.arc(cx | 0, cy | 0, r, 0, 7); g.stroke();
}

function drawAtom(x, y, r, t) {
  rect(x, y, 2, 2, C.cyan);                 // nucleus
  for (let i = 0; i < 3; i++) {
    const a = t * 0.05 + i * 2.094;
    const ex = x + Math.cos(a) * (r + 2), ey = y + Math.sin(a) * (r + 1) * 0.6;
    rect(ex, ey, 1, 1, C.purpleLt);
  }
}

function drawFloor(t) {
  // glowing rail line
  rect(0, GROUND_Y, VW, 1, C.railGlow);
  g.globalAlpha = 0.4; rect(0, GROUND_Y + 1, VW, 1, C.cyan); g.globalAlpha = 1;
  // floor body
  rect(0, GROUND_Y + 1, VW, VH - GROUND_Y - 1, C.floor);
  // scrolling perspective ticks (film-strip light table)
  const o = bgFloor % 16;
  for (let i = -1; i < VW / 16 + 1; i++) {
    const x = i * 16 - o;
    rect(x, GROUND_Y + 2, 1, VH - GROUND_Y - 2, C.floorLine);
  }
  // a couple of receding horizontal lines for depth
  rect(0, GROUND_Y + 8, VW, 1, "#11163a");
  rect(0, GROUND_Y + 18, VW, 1, "#0d1130");
}

// ============================================================
//  LANTERN FLAME + LOGO
// ============================================================
function drawMiniFlame(cx, cy, t) {
  const breathe = Math.sin(t * 0.006);   // slow, smooth — no jitter
  const rows = [
    [10, C.purpleDk], [12, C.violet], [12, C.purple], [10, C.purple],
    [8, C.lilac], [6, C.lilac], [5, C.purpleLt], [3, "#ede9fe"],
  ];
  let y = cy + 14;
  rows.forEach((r, i) => {
    const w = i >= rows.length - 2 ? Math.max(2, r[0] + breathe) : r[0];
    rect(cx - w / 2, y - (i + 1) * 3, w, 3, r[1]);
  });
  rect(cx - 1, cy + 2, 2, 6, "#f5f3ff");   // inner highlight
}

// a flame contained within a height H, base at baseY, centered on cx.
// Slow vertical "breathing" only — no horizontal jitter (keeps the menu calm).
function drawFlame(cx, baseY, H, t) {
  const breathe = Math.sin(t * 0.006);   // slow, smooth
  const prof = [   // [normalized width 0..1 (bottom->top), color]
    [0.50, C.purpleDk], [0.82, C.violet], [0.98, C.violet], [1.00, C.purple],
    [0.96, C.purple], [0.86, C.purple], [0.74, C.lilac], [0.60, C.lilac],
    [0.46, C.purpleLt], [0.32, "#ddd6fe"], [0.18, "#f1ecff"], [0.08, "#ffffff"],
  ];
  const rows = prof.length, rowH = H / rows, maxW = H * 0.6;
  for (let i = 0; i < rows; i++) {
    let w = Math.max(2, prof[i][0] * maxW);
    if (i >= rows - 3) w = Math.max(2, w + breathe * 1.2);   // gentle tip flicker
    rect(cx - w / 2, baseY - (i + 1) * rowH, w, Math.ceil(rowH) + 1, prof[i][1]);
  }
  // lighter inner "leaf" swirl, like the brand mark
  rect(cx - 1, baseY - H * 0.18, 2, H * 0.18, "#9b7ff0");
  rect(cx,     baseY - H * 0.34, 2, H * 0.22, "#cbb6ff");
  rect(cx + 1, baseY - H * 0.50, 2, H * 0.16, "#efe7ff");
}

// glassy rounded-square frame with the flame inside (the New Lantern app icon)
function drawLanternMark(mx, my, s, t) {
  const edge = C.purpleLt, edgeHi = "#ece6ff";
  // interior panel (two-band gradient)
  rect(mx + 2, my + 2, s - 4, s - 4, "#1a1240");
  rect(mx + 2, my + s / 2, s - 4, s / 2 - 2, "#0f0a28");
  // rounded outer border
  rect(mx + 3, my, s - 6, 2, edge);
  rect(mx + 3, my + s - 2, s - 6, 2, edge);
  rect(mx, my + 3, 2, s - 6, edge);
  rect(mx + s - 2, my + 3, 2, s - 6, edge);
  rect(mx + 1, my + 1, 2, 2, edge); rect(mx + s - 3, my + 1, 2, 2, edge);
  rect(mx + 1, my + s - 3, 2, 2, edge); rect(mx + s - 3, my + s - 3, 2, 2, edge);
  // glass highlight along top + left
  rect(mx + 3, my + 2, s - 8, 1, edgeHi);
  rect(mx + 2, my + 3, 1, s - 9, edgeHi);
  // contained flame
  drawFlame(mx + s / 2, my + s - 7, s - 15, t + 200);
}

function drawLogo(t) {
  const s = 46, gap = 12, wordW = 7 * 16;     // "LANTERN" ≈ 7 chars @16px
  const startX = Math.round((VW - (s + gap + wordW)) / 2);
  const my = 16;
  drawLanternMark(startX, my, s, t);
  const tx = startX + s + gap;
  text("NEW", tx, my + 5, C.purpleLt, 16, "left");
  text("LANTERN", tx, my + 25, "#ffffff", 16, "left");
  text("X - R A Y   R U N N E R", VW / 2, my + s + 6, C.cyan, 8, "center");
}

// ============================================================
//  GAME STATE
// ============================================================
let state = "title";   // title | cal | playing | paused | gameover
const game = {
  score: 0, xrays: 0, combo: 0, bestCombo: 0, signal: 100,
  tSec: 0, curSpeed: 0, effSpeed: 0, braking: false,
  brakeEnergy: 100, brakeBlocked: false,
  auraActive: false,
  distAccum: 0, nextGap: 130,
  obsAccum: 0, obsGap: 320,
};
const char = { x: 58, feetY: GROUND_Y, vy: 0, onGround: true, phase: 0, xray: 0, scan: 0, skid: 0 };
let boxes = [], parts = [], floats = [], obstacles = [];
let flash = { a: 0, col: C.cyan }, shake = 0, introMsg = 0;

const GRAVITY = 720, JUMP_V = 250;
const LAND_TOL = 4;   // how far above an obstacle top still counts as landing on it
const AURA_THRESHOLD = 8;   // every Nth combo grants the Lantern Aura shield
// brake is a finite, self-recharging resource. Drain scales with how fast you're
// going, so the harder/faster the run gets, the quicker the brake burns out.
const BRAKE_MAX = 100, BRAKE_DRAIN_BASE = 33, BRAKE_RECHARGE = 30, BRAKE_FACTOR = 0.42;

function resetGame() {
  const d = DIFF[cfg.diff];
  game.score = 0; game.xrays = 0; game.combo = 0; game.bestCombo = 0; game.signal = 100;
  game.tSec = 0; game.curSpeed = d.base; game.braking = false;
  game.brakeEnergy = BRAKE_MAX; game.brakeBlocked = false; game.auraActive = false;
  game.distAccum = 0; game.nextGap = rnd(d.gapMin, d.gapMax) + 40;
  game.obsAccum = 0; game.obsGap = obstacleGap(d) + 120;   // delay the first obstacle a touch
  char.feetY = GROUND_Y; char.vy = 0; char.onGround = true; char.phase = 0;
  char.xray = 0; char.scan = 0; char.skid = 0;
  boxes = []; parts = []; floats = []; obstacles = [];
  flash.a = 0; shake = 0; introMsg = 3.2;
  held.brake = false; held.jump = false;
}

function startGame() {
  if (state !== "title" && state !== "gameover") return;
  resetGame();
  setState("playing");
}
function gameOver() {
  if (game.score > best) { best = game.score; localStorage.setItem(LS_BEST, best); }
  SFX.over();
  if (scoreQualifies(game.score)) openNameEntry();
  else showGameOver(-1);
}

function openNameEntry() {
  el("enterRank").textContent = "NEW HIGH SCORE  —  #" + provisionalRank(game.score);
  el("enterScore").textContent = game.score.toLocaleString();
  const input = el("nameInput");
  input.value = localStorage.getItem(LS_NAME) || "";
  setState("enter");
  setTimeout(() => { input.focus(); input.select(); }, 60);
}

function submitName() {
  if (state !== "enter") return;
  const raw = (el("nameInput").value || "").trim().toUpperCase().replace(/\s+/g, " ").slice(0, 12);
  const name = raw || "PLAYER";
  localStorage.setItem(LS_NAME, name);
  const rank = addHighScore(name, game.score);
  showGameOver(rank);
}

function showGameOver(highlightRank) {
  el("goScore").textContent = game.score.toLocaleString();
  el("goXrays").textContent = game.xrays;
  el("goBest").textContent = best.toLocaleString();
  renderHiTable(highlightRank);
  setState("gameover");
}

function openScores() { renderHiTable(-1, "hiTableMenu"); setState("scores"); }

function renderHiTable(highlight, targetId) {
  const ol = el(targetId || "hiTable");
  ol.innerHTML = "";
  if (!scores.length) { ol.innerHTML = '<li class="empty">No scores yet — be the first!</li>'; return; }
  scores.forEach((e, i) => {
    const li = document.createElement("li");
    if (i === highlight) li.classList.add("you");
    const rk = document.createElement("span"); rk.className = "rk"; rk.textContent = (i + 1) + ".";
    const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = e.name;       // textContent = safe
    const sc = document.createElement("span"); sc.className = "sc"; sc.textContent = e.score.toLocaleString();
    li.append(rk, nm, sc);
    ol.appendChild(li);
  });
}

// ============================================================
//  INPUT
// ============================================================
const held = { brake: false, jump: false };

function classifyKey(code) {
  const b = cfg.brakeCode ? [cfg.brakeCode] : DEFAULT_BRAKE;
  const j = cfg.jumpCode  ? [cfg.jumpCode]  : DEFAULT_JUMP;
  if (b.includes(code)) return "brake";
  if (j.includes(code)) return "jump";
  return null;
}

function doJump() {
  if (char.onGround) {
    char.vy = -JUMP_V; char.onGround = false; SFX.jump();
    char.skid = 0;
    for (let i = 0; i < 6; i++) parts.push({ x: char.x + rnd(-4, 4), y: GROUND_Y, vx: rnd(-30, 30), vy: rnd(-10, -50), life: 0.4, col: "#5b639c", g: 200 });
  }
}

window.addEventListener("keydown", (e) => {
  ensureAudio();

  // ---- calibration capture ----
  if (state === "cal") { e.preventDefault(); captureBinding(e.code); return; }

  // ---- name entry: let the text field type; ENTER / Space / bound-jump saves ----
  if (state === "enter") {
    const saveCodes = ["Enter", "NumpadEnter", cfg.jumpCode || "Space"];
    if (saveCodes.includes(e.code)) { e.preventDefault(); submitName(); }
    return;   // everything else goes to the focused input
  }

  // ---- high-scores viewer: any key returns to the menu ----
  if (state === "scores") { e.preventDefault(); SFX.select(); setState("title"); return; }

  // 'H' opens the high scores from the title (keyboard convenience)
  if (state === "title" && e.code === "KeyH") { e.preventDefault(); SFX.select(); openScores(); return; }

  // let system shortcuts pass
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  const k = classifyKey(e.code);
  if (!k) return;
  e.preventDefault();   // suppress only bound control codes

  if (state === "title") {
    if (k === "jump") startGame();
    else { cycleChar(); SFX.select(); }
    return;
  }
  if (state === "gameover") {
    if (k === "jump") startGame();
    else setState("title");
    return;
  }
  if (state === "paused") { if (k === "jump") setState("playing"); return; }
  if (state === "playing") {
    if (k === "brake") held.brake = true;
    if (k === "jump") { held.jump = true; if (!e.repeat) doJump(); }
  }
});

window.addEventListener("keyup", (e) => {
  if (state === "cal") return;
  const k = classifyKey(e.code);
  if (!k) return;
  if (k === "brake") held.brake = false;
  if (k === "jump") held.jump = false;
});

// pause on focus loss
window.addEventListener("blur", () => { if (state === "playing") { held.brake = held.jump = false; setState("paused"); } });
cv.addEventListener("click", () => { if (state === "paused") setState("playing"); });

// ============================================================
//  CALIBRATION
// ============================================================
let calStage = 0, calLock = false;
function openCal() { calStage = 0; calLock = false; setState("cal"); showCalStep(); }
function showCalStep() {
  document.getElementById("calWhich").textContent = calStage === 0 ? "PRESS YOUR BRAKE KEY" : "PRESS YOUR JUMP KEY";
  document.getElementById("calDetected").textContent = "waiting…";
}
function captureBinding(code) {
  if (calLock) return;
  calLock = true;
  document.getElementById("calDetected").textContent = "detected: " + prettyCode(code);
  SFX.select();
  if (calStage === 0) {
    cfg.brakeCode = code;
    setTimeout(() => { calStage = 1; showCalStep(); calLock = false; }, 480);
  } else {
    cfg.jumpCode = code; saveCfg(); refreshLabels();
    setTimeout(() => setState("title"), 480);
  }
}
function prettyCode(code) {
  return code.replace(/^Key/, "").replace(/^Digit/, "").replace(/^Arrow/, "").replace("Space", "SPACE").toUpperCase();
}

// ============================================================
//  STATE / DOM WIRING
// ============================================================
const screens = { title: el("title"), cal: el("cal"), paused: el("pause"), enter: el("enter"), gameover: el("gameover"), scores: el("scores") };
function el(id) { return document.getElementById(id); }
function setState(s) {
  state = s;
  for (const key in screens) screens[key].classList.toggle("open", key === s);
  if (s === "title") el("bestTitle").textContent = scores.length ? `${scores[0].name} ${scores[0].score.toLocaleString()}` : best.toLocaleString();
}

function cycleChar() { cfg.char = cfg.char === "curie" ? "rontgen" : "curie"; saveCfg(); refreshSelections(); }
function refreshSelections() {
  document.querySelectorAll(".char").forEach((b) => b.classList.toggle("sel", b.dataset.char === cfg.char));
  document.querySelectorAll("#diffSeg button").forEach((b) => b.classList.toggle("sel", b.dataset.diff === cfg.diff));
}
function refreshLabels() {
  const b = cfg.brakeCode ? prettyCode(cfg.brakeCode) : "A";
  const j = cfg.jumpCode ? prettyCode(cfg.jumpCode) : "SPACE";
  el("lblBrake").textContent = b; el("lblJump").textContent = j;
  el("lblBrake2").textContent = b; el("lblJump2").textContent = j;
}

document.querySelectorAll(".char").forEach((btn) => btn.addEventListener("click", () => { cfg.char = btn.dataset.char; saveCfg(); refreshSelections(); SFX.select(); btn.blur(); }));
document.querySelectorAll("#diffSeg button").forEach((btn) => btn.addEventListener("click", () => { cfg.diff = btn.dataset.diff; saveCfg(); refreshSelections(); SFX.select(); btn.blur(); }));
el("startBtn").addEventListener("click", (e) => { e.currentTarget.blur(); startGame(); });
el("scoresBtn").addEventListener("click", (e) => { e.currentTarget.blur(); openScores(); });
el("scoresBack").addEventListener("click", (e) => { e.currentTarget.blur(); setState("title"); });
el("bindBtn").addEventListener("click", (e) => { e.currentTarget.blur(); openCal(); });
el("calSkip").addEventListener("click", () => { if (calStage === 0) { calStage = 1; showCalStep(); calLock = false; } else setState("title"); });
el("calCancel").addEventListener("click", () => setState("title"));
el("goReplay").addEventListener("click", (e) => { e.currentTarget.blur(); startGame(); });
el("goMenu").addEventListener("click", (e) => { e.currentTarget.blur(); setState("title"); });
el("saveScore").addEventListener("click", () => submitName());

// ============================================================
//  UPDATE
// ============================================================
function update(dt) {
  if (state !== "playing") return;
  const d = DIFF[cfg.diff];
  game.tSec += dt;
  game.curSpeed = Math.min(d.max, d.base + d.ramp * game.tSec);

  // brake meter: drains while held, recharges when released.
  // Running it dry forces a full release before it can be used again (no stutter).
  if (!held.brake) game.brakeBlocked = false;
  game.braking = held.brake && game.brakeEnergy > 0 && !game.brakeBlocked;
  if (game.braking) {
    const drain = BRAKE_DRAIN_BASE * (game.curSpeed / d.base);   // faster run = faster burn
    game.brakeEnergy -= drain * dt;
    if (game.brakeEnergy <= 0) { game.brakeEnergy = 0; game.brakeBlocked = true; game.braking = false; SFX.brakeEmpty(); }
  } else {
    game.brakeEnergy = Math.min(BRAKE_MAX, game.brakeEnergy + BRAKE_RECHARGE * dt);
  }
  game.effSpeed = game.curSpeed * (game.braking ? BRAKE_FACTOR : 1);
  if (introMsg > 0) introMsg -= dt;

  // parallax
  bgFar += game.effSpeed * dt; bgMid += game.effSpeed * dt; bgNear += game.effSpeed * dt; bgFloor += game.effSpeed * dt;

  // run animation (legs cycle faster with speed)
  if (char.onGround) char.phase += game.effSpeed * dt * 0.2;

  // brake skid dust
  if (game.braking && char.onGround) {
    char.skid += dt;
    if (char.skid > 0.05) { char.skid = 0; parts.push({ x: char.x - 6, y: GROUND_Y, vx: rnd(-50, -20), vy: rnd(-30, -5), life: 0.35, col: C.cyan, g: 160 }); }
  }

  // spawn + move ground obstacles
  game.obsAccum += game.effSpeed * dt;
  if (game.obsAccum >= game.obsGap) { game.obsAccum -= game.obsGap; spawnObstacle(); game.obsGap = obstacleGap(d); }
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const o = obstacles[i];
    o.x -= game.effSpeed * dt;
    if (o.crashed || o.x + o.w < -2) obstacles.splice(i, 1);
  }

  // runner physics: gravity + landing on the ground OR on top of an obstacle,
  // with side-collision (crash) when you run into one without clearing it.
  const oxL = char.x - 6, oxR = char.x + 6;
  let supportY = GROUND_Y;
  for (const o of obstacles) {
    if (oxR > o.x && oxL < o.x + o.w) {
      const top = GROUND_Y - o.h;
      if (char.feetY <= top + LAND_TOL) supportY = Math.min(supportY, top);   // standing on / dropping onto it
      else if (!o.crashed) { if (game.auraActive) consumeAura(o); else crashObstacle(o); }  // side hit
    }
  }
  char.vy += GRAVITY * dt;
  char.feetY += char.vy * dt;
  if (char.feetY >= supportY) {
    if (!char.onGround && char.vy > 40) SFX.land();
    char.feetY = supportY; char.vy = 0; char.onGround = true;
  } else {
    char.onGround = false;     // airborne: jumping, or walked off an obstacle edge
  }

  // spawn scanners by distance
  game.distAccum += game.effSpeed * dt;
  if (game.distAccum >= game.nextGap) {
    game.distAccum -= game.nextGap;
    const size = 16 + Math.floor(rnd(0, 4)) * 2;     // 16..22 even
    boxes.push({ x: VW + 14, cy: rnd(86, 112), size, hit: false, diss: 0, ph: rnd(0, 6.28) });
    game.nextGap = rnd(d.gapMin, d.gapMax);
  }

  // boxes move + collide + miss
  const cl = char.x - 6, cr = char.x + 6, ctp = char.feetY - 24, cbt = char.feetY;
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i];
    b.x -= game.effSpeed * dt; b.ph += dt * 6;
    const half = b.size / 2;
    if (!b.hit) {
      const overlap = cr > b.x - half && cl < b.x + half && cbt > b.cy - half && ctp < b.cy + half;
      if (overlap) hitBox(b);
    } else {
      b.diss += dt * 3.5;
    }
    if (b.diss >= 1) { boxes.splice(i, 1); continue; }
    if (b.x + half < -2) {
      boxes.splice(i, 1);
      if (!b.hit) missBox(b);
    }
  }

  // xray + scan decay
  if (char.xray > 0) char.xray = Math.max(0, char.xray - dt * 2.2);
  if (char.scan > 0) char.scan = Math.max(0, char.scan - dt * 2.6);

  // particles
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.g || 0) * dt; p.life -= dt;
    if (p.life <= 0) parts.splice(i, 1);
  }
  // floating texts
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i]; f.y -= 18 * dt; f.life -= dt;
    if (f.life <= 0) floats.splice(i, 1);
  }

  if (flash.a > 0) flash.a = Math.max(0, flash.a - dt * 3);
  if (shake > 0) shake = Math.max(0, shake - dt * 4);
}

function hitBox(b) {
  b.hit = true; b.diss = 0.001;
  game.combo++; game.xrays++;
  game.bestCombo = Math.max(game.bestCombo, game.combo);
  const mult = 1 + Math.min(6, Math.floor((game.combo - 1) / 3)) * 0.5;
  const pts = Math.round(100 * mult);
  game.score += pts;
  game.signal = Math.min(100, game.signal + 5);
  char.xray = 1; char.scan = 1;
  flash.col = C.cyan; flash.a = 0.5; shake = Math.min(1, shake + 0.4);
  SFX.xray(game.combo);
  floats.push({ x: b.x, y: b.cy - 6, txt: "+" + pts, col: mult > 1 ? C.amber : C.cyan, life: 0.8 });
  if (mult > 1) floats.push({ x: b.x, y: b.cy - 16, txt: "x" + mult.toFixed(1), col: C.green, life: 0.8 });
  // every Nth combo lights the Lantern Aura (one-hit invincibility to obstacles)
  if (!game.auraActive && game.combo % AURA_THRESHOLD === 0) {
    game.auraActive = true;
    floats.push({ x: char.x, y: char.feetY - 34, txt: "OVERDRIVE!", col: C.lilac, life: 1.1 });
    flash.col = C.purpleLt; flash.a = 0.5;
    SFX.shieldOn();
  }
  // burst particles
  for (let i = 0; i < 16; i++) {
    const a = rnd(0, 6.28), sp = rnd(30, 150);
    parts.push({ x: b.x, y: b.cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.3, 0.7), col: i % 2 ? C.bone : C.cyan, g: 60 });
  }
}

function missBox(b) {
  game.combo = 0;
  game.signal -= DIFF[cfg.diff].drain;
  flash.col = C.red; flash.a = 0.45; shake = Math.min(1, shake + 0.5);
  SFX.miss();
  floats.push({ x: char.x + 30, y: 70, txt: "MISS", col: C.red, life: 0.7 });
  if (game.signal <= 0) { game.signal = 0; gameOver(); }
}

// ----- ground obstacles (jump over, or land on top of) -----
// gap shrinks on harder difficulties so obstacles come more often
function obstacleGap(d) { return rnd(d.gapMin * 2.4, d.gapMax * 3.2); }

function spawnObstacle() {
  const r = Math.random();
  let o;
  if (r < 0.5)      o = { type: "cassette", w: 16, h: 10, col: C.boneDk };  // low film slab — hop over
  else if (r < 0.8) o = { type: "brick",    w: 15, h: 18, col: "#8a8f9e" }; // lead bricks — clear or stand on
  else              o = { type: "canister", w: 12, h: 22, col: C.amber };   // hot canister — land on for a boost
  o.x = VW + 16; o.crashed = false;
  obstacles.push(o);
}

// the Lantern Aura absorbs one obstacle: no penalty, combo survives, shield ends
function consumeAura(o) {
  o.crashed = true;
  game.auraActive = false;
  flash.col = C.lilac; flash.a = 0.55; shake = Math.min(1, shake + 0.4);
  SFX.shieldBreak();
  game.score += 50;
  floats.push({ x: char.x, y: char.feetY - 30, txt: "SHIELD!", col: C.lilac, life: 0.8 });
  const cy = GROUND_Y - o.h / 2;
  for (let i = 0; i < 20; i++) {
    const a = rnd(0, 6.28), sp = rnd(40, 170);
    parts.push({ x: o.x + o.w / 2, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.3, 0.7), col: i % 2 ? C.lilac : C.purpleLt, g: 120 });
  }
}

function crashObstacle(o) {
  o.crashed = true;
  game.combo = 0;
  game.signal -= Math.round(DIFF[cfg.diff].drain * 0.7);
  flash.col = C.red; flash.a = 0.5; shake = Math.min(1, shake + 0.7);
  SFX.crash();
  floats.push({ x: char.x, y: char.feetY - 30, txt: "OOF", col: C.red, life: 0.7 });
  const cy = GROUND_Y - o.h / 2;
  for (let i = 0; i < 16; i++) {
    const a = rnd(-Math.PI, 0), sp = rnd(40, 150);
    parts.push({ x: o.x + o.w / 2, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.3, 0.6), col: i % 2 ? o.col : C.red, g: 320 });
  }
  if (game.signal <= 0) { game.signal = 0; gameOver(); }
}

function drawObstacle(o) {
  const x = o.x, top = GROUND_Y - o.h;
  g.globalAlpha = 0.3; rect(x, GROUND_Y - 1, o.w, 2, "#000"); g.globalAlpha = 1;
  if (o.type === "cassette") {
    rect(x, top, o.w, o.h, "#16233f");
    rect(x, top, o.w, 2, C.boneDk);
    rect(x + 2, top + 2, o.w - 4, 1, "#33507a");
    rect(x + 2, GROUND_Y - 3, o.w - 4, 1, C.cyan);     // film light stripe
  } else if (o.type === "brick") {
    for (let yy = top; yy < GROUND_Y; yy += 4)
      for (let xx = x; xx < x + o.w; xx += 8) { rect(xx, yy, 7, 3, "#6b7280"); rect(xx, yy, 7, 1, "#9aa3b2"); }
    rect(x, top, o.w, 1, "#aeb6c4");
  } else { // canister — radioactive
    rect(x, top, o.w, o.h, "#caa11a");
    rect(x, top, o.w, 2, "#fde68a");
    rect(x, GROUND_Y - 2, o.w, 2, "#7a5e0a");
    for (let yy = top + 4; yy < GROUND_Y - 3; yy += 5) rect(x + 1, yy, o.w - 2, 2, "#141414");
    rect(x + o.w / 2 - 1, top + o.h / 2 - 1, 2, 2, "#141414");   // trefoil hub
  }
}

// ============================================================
//  RENDER
// ============================================================
function render(t) {
  // screen shake offset
  let ox = 0, oy = 0;
  if (shake > 0.01) { ox = (Math.random() - 0.5) * shake * 6; oy = (Math.random() - 0.5) * shake * 6; }
  g.setTransform(1, 0, 0, 1, ox | 0, oy | 0);

  drawBackground(t);

  if (state === "title") { drawTitleScene(t); drawScanlinesEdge(); g.setTransform(1, 0, 0, 1, 0, 0); return; }

  // ground obstacles (behind the runner)
  for (const o of obstacles) drawObstacle(o);

  // scanners
  for (const b of boxes) drawScanner(b, t);

  // character (with X-ray reveal)
  const air = !char.onGround;
  drawShadow(char.x, char.feetY);
  if (game.auraActive) drawAuraGlow(char.x, char.feetY - 11, t);
  drawRunner(char.x, char.feetY, { type: cfg.char, phase: char.phase, airborne: air });
  if (char.xray > 0) {
    const scanY = lerp(char.feetY - 25, char.feetY, 1 - char.scan);
    drawSkeleton(char.x, char.feetY, char.xray, char.scan > 0 ? scanY : null);
  }
  if (game.auraActive) drawAuraRing(char.x, char.feetY - 11, t);
  if (game.braking && char.onGround) drawBrakeAura(char.x, char.feetY, t);

  // particles
  for (const p of parts) { g.globalAlpha = Math.max(0, Math.min(1, p.life * 2)); rect(p.x, p.y, 2, 2, p.col); }
  g.globalAlpha = 1;

  // floating texts
  for (const f of floats) { g.globalAlpha = Math.max(0, Math.min(1, f.life * 2)); text(f.txt, f.x, f.y, f.col, 8, "center"); }
  g.globalAlpha = 1;

  drawHUD();

  // intro coaching
  if (introMsg > 0 && state === "playing") {
    g.globalAlpha = Math.min(1, introMsg);
    text("JUMP THROUGH THE SCANNERS", VW / 2, 112, C.bone, 8, "center");
    text("BRAKE TO TIME IT - IT REFILLS", VW / 2, 124, C.purpleLt, 8, "center");
    g.globalAlpha = 1;
  }

  // flash
  if (flash.a > 0) { g.globalAlpha = flash.a * 0.5; g.fillStyle = flash.col; g.fillRect(0, 0, VW, VH); g.globalAlpha = 1; }

  if (state === "paused") { g.globalAlpha = 0.55; g.fillStyle = "#05060f"; g.fillRect(0, 0, VW, VH); g.globalAlpha = 1; }

  g.setTransform(1, 0, 0, 1, 0, 0);
}

function drawShadow(cx, fy) {
  const h = (GROUND_Y - (fy - 24));    // how high (for jump shadow shrink)
  const w = char.onGround ? 14 : Math.max(6, 14 - (GROUND_Y - fy) * 0.2);
  g.globalAlpha = 0.35; rect(cx - w / 2, GROUND_Y - 1, w, 2, "#000"); g.globalAlpha = 1;
}

// Lantern Aura power-up — radial haze behind the runner...
function drawAuraGlow(cx, cy, t) {
  const R = 17 + Math.sin(t * 0.012) * 1.5;
  const gg = g.createRadialGradient(cx, cy, 2, cx, cy, R + 9);
  gg.addColorStop(0, "rgba(196,181,253,0.30)");
  gg.addColorStop(0.55, "rgba(139,92,246,0.20)");
  gg.addColorStop(1, "rgba(139,92,246,0)");
  g.fillStyle = gg; g.beginPath(); g.arc(cx, cy, R + 9, 0, 7); g.fill();
}
// ...and a flickering ring of lantern-flame tongues + sparks in front
function drawAuraRing(cx, cy, t) {
  const R = 16 + Math.sin(t * 0.012) * 1.5;
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = t * 0.04 + i * (6.283 / n);
    const fl = 1 + Math.sin(t * 0.05 + i * 1.7) * 0.35;
    const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R * 0.92;
    rect(x - 1, y - 3 * fl, 2, 4 * fl, i % 2 ? C.lilac : C.purpleLt);
    rect(x - 1, y - 3 * fl - 1, 1, 1, "#f5f3ff");
  }
  for (let i = 0; i < 3; i++) {
    const a = -t * 0.03 + i * 2.094;
    rect(cx + Math.cos(a) * (R + 4), cy + Math.sin(a) * (R + 3), 1, 1, "#ffffff");
  }
}

function drawScanner(b, t) {
  const half = b.size / 2;
  const x = b.x - half, y = b.cy - half;
  g.save();
  if (b.hit) g.globalAlpha = Math.max(0, 1 - b.diss);
  const pulse = 0.6 + 0.4 * Math.sin(b.ph);
  // glow backing
  g.globalAlpha *= 1;
  g.fillStyle = "rgba(103,232,249,0.10)"; g.fillRect((x - 2) | 0, (y - 2) | 0, b.size + 4, b.size + 4);
  // frame
  rect(x, y, b.size, b.size, "rgba(8,20,40,0.55)");
  // animated dashed-ish border
  const edge = b.hit ? C.bone : (pulse > 0.7 ? C.cyan : C.purpleLt);
  rect(x, y, b.size, 1, edge); rect(x, y + b.size - 1, b.size, 1, edge);
  rect(x, y, 1, b.size, edge); rect(x + b.size - 1, y, 1, b.size, edge);
  // corner ticks
  [[x, y], [x + b.size - 3, y], [x, y + b.size - 3], [x + b.size - 3, y + b.size - 3]].forEach(([cxx, cyy]) => {
    rect(cxx, cyy, 3, 1, C.cyan); rect(cxx, cyy, 1, 3, C.cyan);
  });
  // radiation trefoil mark
  const mx = b.x, my = b.cy;
  rect(mx - 1, my - 1, 2, 2, C.amber);
  for (let i = 0; i < 3; i++) {
    const a = b.ph * 0.4 + i * 2.094;
    rect(mx + Math.cos(a) * 4 - 1, my + Math.sin(a) * 4 - 1, 2, 2, C.amber);
  }
  // scan beam if hit
  if (b.hit) { g.globalAlpha = (1 - b.diss) * 0.6; rect(x, b.cy, b.size, 1, "#dffaff"); }
  g.restore();
}

function drawBrakeAura(cx, fy, t) {
  g.globalAlpha = 0.5 + 0.3 * Math.sin(t * 0.02);
  rect(cx - 9, fy - 26, 1, 26, C.cyan);
  rect(cx - 11, fy - 12, 2, 1, C.cyan);
  rect(cx - 11, fy - 18, 2, 1, C.cyan);
  g.globalAlpha = 1;
}

function drawHUD() {
  // top scrim
  g.globalAlpha = 0.45; g.fillStyle = "#05060f"; g.fillRect(0, 0, VW, 20); g.globalAlpha = 1;
  rect(0, 20, VW, 1, "rgba(139,92,246,0.5)");

  text("SCORE", 6, 3, "#7f88c0", 8, "left");
  text(String(game.score).padStart(6, "0"), 6, 11, C.bone, 8, "left");

  // combo center
  if (game.combo > 1) {
    const mult = 1 + Math.min(6, Math.floor((game.combo - 1) / 3)) * 0.5;
    text("COMBO " + game.combo + (mult > 1 ? "  x" + mult.toFixed(1) : ""), VW / 2, 7, C.amber, 8, "center");
  } else {
    text("X-RAYS " + game.xrays, VW / 2, 7, "#7f88c0", 8, "center");
  }

  // speed right
  const spd = Math.round(game.curSpeed);
  text("SPD " + spd, VW - 6, 3, "#7f88c0", 8, "right");
  const st = game.brakeBlocked ? ["EMPTY", C.red] : game.braking ? ["BRAKE", C.cyan] : ["RUN", C.green];
  text(st[0], VW - 6, 11, st[1], 8, "right");

  // signal bar (lower-left, themed health)
  const bw = 90, bx = 6, by = VH - 10;
  text("SIGNAL", bx, by - 9, "#7f88c0", 8, "left");
  rect(bx, by, bw, 5, "#0a0b1c");
  g.strokeStyle = "#2a2f63"; g.lineWidth = 1; g.strokeRect(bx + 0.5, by + 0.5, bw - 1, 4);
  const f = game.signal / 100;
  const col = game.signal > 55 ? C.green : game.signal > 28 ? C.amber : C.red;
  rect(bx + 1, by + 1, (bw - 2) * f, 3, col);

  // brake meter (lower-right) — finite, recharges when released
  const mw = 90, mx = VW - 6 - mw, my = VH - 10;
  text("BRAKE", VW - 6, my - 9, game.brakeBlocked ? C.red : "#7f88c0", 8, "right");
  rect(mx, my, mw, 5, "#0a0b1c");
  g.strokeStyle = "#2a2f63"; g.lineWidth = 1; g.strokeRect(mx + 0.5, my + 0.5, mw - 1, 4);
  const bef = game.brakeEnergy / BRAKE_MAX;
  const becol = game.brakeBlocked ? C.red : game.braking ? C.cyan : (bef > 0.3 ? C.purpleLt : C.amber);
  rect(mx + 1, my + 1, (mw - 2) * bef, 3, becol);

  // overdrive / lantern-aura status (center bottom, between the two meters)
  if (game.auraActive) {
    g.globalAlpha = 0.6 + 0.4 * Math.sin(performance.now() * 0.01);
    text("* OVERDRIVE *", VW / 2, VH - 9, C.lilac, 8, "center");
    g.globalAlpha = 1;
  }
}

function drawScanlinesEdge() { /* canvas-level grain handled by CSS overlay */ }

// ============================================================
//  TITLE SCENE
// ============================================================
let titleDemoXray = 0, titleTimer = 0;
function drawTitleScene(t) {
  drawLogo(t);
  // attract: a runner jogging in place near lower-left, periodically x-rayed
  titleTimer += 1 / 60;
  const demoPhase = t * 0.011;   // slower jog — less flicker on the menu
  const dx = 56, dfy = GROUND_Y;
  drawShadow(dx, dfy);
  drawRunner(dx, dfy, { type: cfg.char, phase: demoPhase, airborne: false });
  if (titleTimer % 3 < 0.5) titleDemoXray = Math.min(1, titleDemoXray + 0.08);
  else titleDemoXray = Math.max(0, titleDemoXray - 0.05);
  if (titleDemoXray > 0) drawSkeleton(dx, dfy, titleDemoXray, lerp(dfy - 25, dfy, (titleTimer % 3) / 0.5));
  // a couple of drifting scanners across the title
  for (let i = 0; i < 2; i++) {
    const bx = ((VW - (t * 0.03 + i * 160)) % (VW + 60) + VW + 60) % (VW + 60) - 30;
    drawScanner({ x: bx, cy: 96 + i * 4, size: 18, hit: false, diss: 0, ph: t * 0.01 + i }, t);
  }
}

// ============================================================
//  MAIN LOOP
// ============================================================
let lastT = performance.now();
function frame(now) {
  let dt = (now - lastT) / 1000; lastT = now;
  if (dt > 0.05) dt = 0.05;     // clamp after tab-out
  if (state === "title") { const s = 22 * dt; bgFar += s; bgMid += s; bgNear += s; bgFloor += s; }
  update(dt);
  render(now);
  requestAnimationFrame(frame);
}

// ============================================================
//  BOOT
// ============================================================
function boot() {
  buildWorld();
  refreshSelections();
  refreshLabels();
  el("bestTitle").textContent = best;
  buildAvatars();
  setState("title");
  requestAnimationFrame(frame);
}
if (document.fonts && document.fonts.load) {
  document.fonts.load('8px "Press Start 2P"').then(boot).catch(boot);
} else boot();
