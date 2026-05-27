/* KEY·WIDGET — 2-key USB fidget visualizer
   Reads only this tab's keyboard events. preventDefault is applied ONLY to the
   two bound key codes, so your Apple keyboard & mouse are never intercepted. */

"use strict";

// ---------- config + persistence ----------
const DEFAULTS = {
  codeA: null, codeB: null,
  colA: "#21e6c1", colB: "#ff2d95", bg: "#070710",
  scene: "ripple",
  intensity: 1, afterglow: 0.12,
  shake: true, bloom: true, sound: false, cycleHue: false,
  anyKey: false,
};
const LS_KEY = "keywidget.config.v1";
let cfg = load();

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    const merged = { ...DEFAULTS, ...saved };
    if (!merged.codeA && !merged.codeB && saved.anyKey === undefined) merged.anyKey = true; // first run: react to anything
    return merged;
  } catch { return { ...DEFAULTS, anyKey: true }; }
}
function save() { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); }

// ---------- dom ----------
const $ = (id) => document.getElementById(id);
const canvas = $("viz"), ctx = canvas.getContext("2d");
const flashEl = $("flash"), hintEl = $("hint");
const padEl = { A: $("padA"), B: $("padB") };
const codeEl = { A: $("codeA"), B: $("codeB") };
const countEl = { A: $("countA"), B: $("countB") };

// ---------- canvas sizing ----------
let W = 0, H = 0, dpr = 1;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + "px"; canvas.style.height = H + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = cfg.bg; ctx.fillRect(0, 0, W, H);
}
window.addEventListener("resize", resize);

// ---------- color helpers ----------
function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0, s = 0, l = (mx + mn) / 2;
  if (d) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}
function hsl(h, s, l, a = 1) { return `hsla(${h % 360},${s * 100}%,${l * 100}%,${a})`; }
let hueShift = 0;
// returns hsla string for a key's color, with optional alpha + hue shift applied
function keyColor(key, a = 1, lAdd = 0) {
  const base = rgbToHsl(hexToRgb(key === "A" ? cfg.colA : cfg.colB));
  const h = base.h + (cfg.cycleHue ? hueShift : 0);
  return hsl(h, Math.min(1, base.s + 0.05), Math.min(0.85, base.l + lAdd), a);
}

// ---------- shared state ----------
let combo = 0, hits = 0, count = { A: 0, B: 0 };
let lastHit = 0, hitTimes = [], bpm = 0;
let shakeAmt = 0;
const energy = { A: 0, B: 0 };
const held = { A: false, B: false };
let lastT = performance.now();

// ---------- audio ----------
let actx = null;
function blip(key) {
  if (!cfg.sound) return;
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === "suspended") actx.resume();
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = "triangle";
  o.frequency.value = key === "A" ? 220 + Math.random() * 40 : 392 + Math.random() * 60;
  const t = actx.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.18, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  o.connect(g).connect(actx.destination);
  o.start(t); o.stop(t + 0.24);
}

// ---------- pad geometry ----------
function padCenter(key) {
  const r = padEl[key].getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// ============================================================
//                       SCENES
// ============================================================
const ripples = [], particles = [], drops = [], strings = [];
let bars = [];
function clearFx() { ripples.length = particles.length = drops.length = strings.length = 0; bars = []; }

function spawnRipple(c, color) {
  ripples.push({ x: c.x, y: c.y, r: 8, vr: 320 + 260 * cfg.intensity, life: 1, color });
  ripples.push({ x: c.x, y: c.y, r: 4, vr: 200 + 180 * cfg.intensity, life: 1, color });
}
function spawnParticles(c, color, key) {
  const n = Math.round((26 + Math.random() * 12) * cfg.intensity);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = (60 + Math.random() * 320) * cfg.intensity;
    particles.push({ x: c.x, y: c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
      r: 1.5 + Math.random() * 3.5, life: 1, decay: 0.5 + Math.random() * 0.7, color });
  }
}
function spawnDrops(c, color) {
  const n = Math.round(40 * cfg.intensity);
  for (let i = 0; i < n; i++)
    drops.push({ x: c.x + (Math.random() - 0.5) * 220, y: c.y - Math.random() * 120,
      vy: 240 + Math.random() * 520, len: 14 + Math.random() * 40, life: 1, color, bright: true });
}
function ensureBars() {
  if (bars.length) return;
  const n = 56;
  for (let i = 0; i < n; i++) bars.push({ v: 0, seed: Math.random() * 1000 });
}
function ensureStrings() {
  if (strings.length) return;
  const n = 7;
  for (let i = 0; i < n; i++) strings.push({ amp: 0, phase: Math.random() * 6, freq: 0.012 + i * 0.002, key: i < n / 2 ? "A" : "B" });
}
function ensureRain() {
  if (drops.length > 30) return;
  for (let i = 0; i < 70; i++)
    drops.push({ x: Math.random() * W, y: Math.random() * H, vy: 60 + Math.random() * 120,
      len: 8 + Math.random() * 26, life: 1, color: null, bright: false });
}

const SCENES = {
  ripple: {
    onHit(c, color) { spawnRipple(c, color); },
    draw() {
      ctx.globalCompositeOperation = "lighter";
      for (let i = ripples.length - 1; i >= 0; i--) {
        const p = ripples[i];
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7);
        ctx.strokeStyle = p.color(p.life * 0.9); ctx.lineWidth = 2 + p.life * 2.5; ctx.stroke();
      }
    },
  },
  burst: {
    onHit(c, color, key) { spawnParticles(c, color, key); spawnRipple(c, color); },
    draw() {
      ctx.globalCompositeOperation = "lighter";
      for (const p of particles) {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * p.life, 0, 7);
        ctx.fillStyle = p.color(p.life); ctx.fill();
      }
      for (const p of ripples) {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7);
        ctx.strokeStyle = p.color(p.life * 0.5); ctx.lineWidth = 1.5; ctx.stroke();
      }
    },
  },
  bars: {
    onHit(c, color, key) { energy[key] = 1; },
    draw(dt, t) {
      ensureBars();
      ctx.globalCompositeOperation = "lighter";
      const n = bars.length, bw = W / n, base = H * 0.5;
      for (let i = 0; i < n; i++) {
        const x = i * bw, frac = i / (n - 1);
        const wA = Math.max(0, 1 - frac * 1.6), wB = Math.max(0, (frac - 0.375) * 1.6);
        const shimmer = 0.18 + 0.16 * (Math.sin(t * 0.004 + bars[i].seed) * 0.5 + 0.5);
        const e = wA * energy.A + wB * energy.B + 0.04;
        const h = (shimmer + e * 0.9) * H * 0.46 * cfg.intensity;
        const hue = rgbToHsl(hexToRgb(frac < 0.5 ? cfg.colA : cfg.colB));
        const grad = ctx.createLinearGradient(0, base - h, 0, base + h);
        const col = hsl(hue.h + (cfg.cycleHue ? hueShift : 0), 0.9, 0.6, 0.85);
        grad.addColorStop(0, hsl(hue.h + (cfg.cycleHue ? hueShift : 0), 0.9, 0.65, 0));
        grad.addColorStop(0.5, col);
        grad.addColorStop(1, hsl(hue.h + (cfg.cycleHue ? hueShift : 0), 0.9, 0.65, 0));
        ctx.fillStyle = grad;
        ctx.fillRect(x + bw * 0.18, base - h, bw * 0.64, h * 2);
      }
    },
  },
  orb: {
    onHit(c, color, key) { energy[key] = 1; spawnRipple({ x: W / 2, y: H / 2 }, color); },
    draw(dt, t) {
      const cx = W / 2, cy = H / 2;
      const e = (energy.A + energy.B) * 0.5;
      const breathe = Math.sin(t * 0.0016) * 0.06 + 1;
      const R = Math.min(W, H) * (0.12 + e * 0.12) * breathe * cfg.intensity;
      ctx.globalCompositeOperation = "lighter";
      // core glow — blend of both key colors weighted by their energy
      const total = energy.A + energy.B + 0.001;
      const ha = rgbToHsl(hexToRgb(cfg.colA)).h + (cfg.cycleHue ? hueShift : 0);
      const hb = rgbToHsl(hexToRgb(cfg.colB)).h + (cfg.cycleHue ? hueShift : 0);
      const mixH = (ha * (energy.A + 0.5) + hb * (energy.B + 0.5)) / (total + 1);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 2.4);
      g.addColorStop(0, hsl(mixH, 0.9, 0.7, 0.9));
      g.addColorStop(0.4, hsl(mixH, 0.9, 0.55, 0.4));
      g.addColorStop(1, hsl(mixH, 0.9, 0.5, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 2.4, 0, 7); ctx.fill();
      // orbiting satellites
      const sats = 5;
      for (let i = 0; i < sats; i++) {
        const ang = t * 0.0012 * (i % 2 ? 1 : -1) + (i / sats) * 6.283;
        const rr = R * (1.5 + 0.4 * Math.sin(t * 0.002 + i));
        const sx = cx + Math.cos(ang) * rr, sy = cy + Math.sin(ang) * rr;
        ctx.beginPath(); ctx.arc(sx, sy, 3 + e * 6, 0, 7);
        ctx.fillStyle = hsl(i % 2 ? ha : hb, 0.9, 0.65, 0.8); ctx.fill();
      }
      for (const p of ripples) {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7);
        ctx.strokeStyle = p.color(p.life * 0.6); ctx.lineWidth = 2; ctx.stroke();
      }
    },
  },
  strings: {
    onHit(c, color, key) {
      ensureStrings();
      for (const s of strings) if (s.key === key) s.amp = Math.min(80, s.amp + 46 * cfg.intensity);
    },
    draw(dt, t) {
      ensureStrings();
      ctx.globalCompositeOperation = "lighter";
      const n = strings.length;
      for (let i = 0; i < n; i++) {
        const s = strings[i]; s.phase += dt * 9; s.amp *= 0.95;
        const baseY = H * (0.18 + (i / (n - 1)) * 0.64);
        const idle = 2 + 3 * Math.sin(t * 0.001 + i);
        const A = s.amp + idle;
        ctx.beginPath();
        for (let x = 0; x <= W; x += 10) {
          const env = Math.sin((x / W) * Math.PI);
          const y = baseY + Math.sin(x * s.freq + s.phase) * A * env;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = keyColor(s.key, 0.35 + Math.min(0.5, s.amp / 80));
        ctx.lineWidth = 1.5 + Math.min(2.5, s.amp / 30); ctx.stroke();
      }
    },
  },
  rain: {
    onHit(c, color, key) { spawnDrops(c, color); },
    draw(dt) {
      ensureRain();
      ctx.globalCompositeOperation = "lighter";
      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i]; d.y += d.vy * dt;
        const col = d.color ? d.color(d.bright ? 0.9 : 0.18) : "hsla(220,40%,60%,0.12)";
        ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x, d.y - d.len);
        ctx.strokeStyle = col; ctx.lineWidth = d.bright ? 2 : 1; ctx.stroke();
        if (d.y - d.len > H) {
          if (d.bright) drops.splice(i, 1);
          else { d.y = -d.len; d.x = Math.random() * W; }
        }
      }
    },
  },
};

// ---------- physics step for transient fx ----------
function stepFx(dt) {
  for (let i = ripples.length - 1; i >= 0; i--) {
    const p = ripples[i]; p.r += p.vr * dt; p.life -= dt * 0.9;
    if (p.life <= 0) ripples.splice(i, 1);
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 520 * dt; p.vx *= 0.99;
    p.life -= dt * p.decay;
    if (p.life <= 0) particles.splice(i, 1);
  }
  energy.A *= Math.pow(0.12, dt); energy.B *= Math.pow(0.12, dt);
}

// ============================================================
//                       RENDER LOOP
// ============================================================
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;

  // fade previous frame (afterglow) instead of hard clear
  const clearA = Math.max(0.02, 0.45 - cfg.afterglow);
  const c = hexToRgb(cfg.bg);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${clearA})`;
  ctx.fillRect(0, 0, W, H);

  // shake
  let ox = 0, oy = 0;
  if (shakeAmt > 0.01) {
    const m = shakeAmt * 16;
    ox = (Math.random() - 0.5) * m; oy = (Math.random() - 0.5) * m;
    shakeAmt *= Math.pow(0.0001, dt);
    document.querySelector(".stage").style.transform = `translate(${ox * 0.6}px,${oy * 0.6}px)`;
  } else if (shakeAmt) { shakeAmt = 0; document.querySelector(".stage").style.transform = ""; }

  ctx.save();
  ctx.translate(ox, oy);
  stepFx(dt);
  (SCENES[cfg.scene] || SCENES.ripple).draw(dt, now);
  ctx.restore();
  ctx.globalCompositeOperation = "source-over";

  // combo timeout + bpm decay
  if (combo && now - lastHit > 1300) { combo = 0; $("tCombo").textContent = 0; }
  if (bpm && now - lastHit > 2500) { bpm = Math.max(0, bpm - 60 * dt); $("tBpm").textContent = Math.round(bpm); }

  requestAnimationFrame(frame);
}

// ============================================================
//                       INPUT
// ============================================================
let calMode = false, calStage = 0, rebindKey = null, calLock = false;

function triggerHit(key, isRepeat) {
  const c = padCenter(key);
  if (cfg.cycleHue) hueShift = (hueShift + 24) % 360;
  const color = (a) => keyColor(key, a);

  if (!isRepeat) {
    hits++; count[key]++; combo++;
    energy[key] = 1;
    countEl[key].textContent = count[key];
    $("tHits").textContent = hits;
    $("tCombo").textContent = combo;
    // bpm
    const now = performance.now();
    hitTimes.push(now); if (hitTimes.length > 10) hitTimes.shift();
    if (hitTimes.length > 1) {
      const span = hitTimes[hitTimes.length - 1] - hitTimes[0];
      bpm = Math.min(900, Math.round((hitTimes.length - 1) / (span / 60000)));
      $("tBpm").textContent = bpm;
    }
    lastHit = now;

    (SCENES[cfg.scene] || SCENES.ripple).onHit(c, color, key);
    blip(key);
    if (cfg.bloom) {
      flashEl.style.setProperty("--flashCol", key === "A" ? cfg.colA : cfg.colB);
      flashEl.style.opacity = String(0.28 * cfg.intensity);
      requestAnimationFrame(() => (flashEl.style.opacity = "0"));
    }
    if (cfg.shake) shakeAmt = Math.min(1, shakeAmt + 0.6);
    padEl[key].classList.add("hit");
    clearTimeout(padEl[key]._t);
    padEl[key]._t = setTimeout(() => padEl[key].classList.remove("hit"), 150);
    hideHint();
  }
  padEl[key].classList.add("held");
}

function resolveKey(code) {
  if (cfg.codeA && code === cfg.codeA) return "A";
  if (cfg.codeB && code === cfg.codeB) return "B";
  if (cfg.anyKey) {
    // deterministic split so each physical key maps consistently
    let s = 0; for (const ch of code) s += ch.charCodeAt(0);
    return s % 2 ? "B" : "A";
  }
  return null;
}

window.addEventListener("keydown", (e) => {
  // calibration / rebind capture
  if (calMode || rebindKey) {
    e.preventDefault();
    captureBinding(e.code);
    return;
  }
  // let browser/system shortcuts through
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  const key = resolveKey(e.code);
  if (!key) return;
  e.preventDefault(); // only the bound code is suppressed
  triggerHit(key, e.repeat);
});

window.addEventListener("keyup", (e) => {
  if (calMode || rebindKey) return;
  const key = resolveKey(e.code);
  if (!key) return;
  held[key] = false;
  padEl[key].classList.remove("held");
});

// ============================================================
//                  CALIBRATION / BINDING
// ============================================================
const calEl = $("cal");
function openCal() {
  calMode = true; calStage = 0; rebindKey = null; calLock = false;
  calEl.classList.add("open");
  showCalStep();
}
function showCalStep() {
  $("calStep").textContent = `STEP ${calStage + 1} / 2`;
  $("calWhich").textContent = calStage === 0 ? "PAD A" : "PAD B";
  $("calDetected").textContent = "waiting…";
}
function closeCal() { calMode = false; calEl.classList.remove("open"); }

function captureBinding(code) {
  if (rebindKey) {
    cfg[rebindKey === "A" ? "codeA" : "codeB"] = code;
    rebindKey = null; cfg.anyKey = false; save(); applyConfig();
    return;
  }
  // calibration flow — calLock ignores stray/extra presses during transitions
  if (calLock) return;
  calLock = true;
  $("calDetected").textContent = `detected: ${code}`;
  if (calStage === 0) {
    cfg.codeA = code;
    setTimeout(() => { calStage = 1; showCalStep(); calLock = false; }, 450);
  } else {
    cfg.codeB = code;
    cfg.anyKey = false; save(); applyConfig();
    calMode = false; // stop capturing immediately, even before the close animation
    setTimeout(closeCal, 450);
  }
}

$("calibrate").onclick = openCal;
$("calSkip").onclick = () => {
  if (calStage === 0) { calStage = 1; showCalStep(); }
  else { closeCal(); }
};
$("calCancel").onclick = closeCal;
$("rebindA").onclick = () => { rebindKey = "A"; armRebind("A"); };
$("rebindB").onclick = () => { rebindKey = "B"; armRebind("B"); };
function armRebind(key) {
  const btn = $(key === "A" ? "rebindA" : "rebindB");
  btn.classList.add("armed"); btn.textContent = "press…";
  const done = () => { btn.classList.remove("armed"); btn.textContent = "bind"; applyConfig(); };
  const iv = setInterval(() => { if (!rebindKey) { clearInterval(iv); done(); } }, 120);
}

// ============================================================
//                  SETTINGS WIRING
// ============================================================
const drawer = $("drawer"), scrim = $("scrim");
function openDrawer() { drawer.classList.add("open"); scrim.classList.add("open"); }
function closeDrawer() { drawer.classList.remove("open"); scrim.classList.remove("open"); }
$("gear").onclick = openDrawer;
$("closeDrawer").onclick = closeDrawer;
scrim.onclick = closeDrawer;

$("colA").oninput = (e) => { cfg.colA = e.target.value; save(); applyConfig(); };
$("colB").oninput = (e) => { cfg.colB = e.target.value; save(); applyConfig(); };
$("colBg").oninput = (e) => { cfg.bg = e.target.value; save(); applyConfig(); };
$("intensity").oninput = (e) => { cfg.intensity = +e.target.value; save(); };
$("afterglow").oninput = (e) => { cfg.afterglow = +e.target.value; save(); };
$("shake").onchange = (e) => { cfg.shake = e.target.checked; save(); };
$("bloom").onchange = (e) => { cfg.bloom = e.target.checked; save(); };
$("sound").onchange = (e) => { cfg.sound = e.target.checked; save(); };
$("cycleHue").onchange = (e) => { cfg.cycleHue = e.target.checked; save(); };
$("anyKey").onchange = (e) => { cfg.anyKey = e.target.checked; save(); };

document.querySelectorAll(".scene-btn").forEach((b) => {
  b.onclick = () => { cfg.scene = b.dataset.scene; clearFx(); save(); applyConfig(); };
});
$("reset").onclick = () => {
  cfg = { ...DEFAULTS, anyKey: true }; save(); clearFx(); applyConfig();
};

// ============================================================
//                  APPLY CONFIG -> UI
// ============================================================
function applyConfig() {
  const root = document.documentElement.style;
  root.setProperty("--colA", cfg.colA);
  root.setProperty("--colB", cfg.colB);
  root.setProperty("--bg", cfg.bg);

  $("colA").value = cfg.colA; $("colB").value = cfg.colB; $("colBg").value = cfg.bg;
  $("intensity").value = cfg.intensity; $("afterglow").value = cfg.afterglow;
  $("shake").checked = cfg.shake; $("bloom").checked = cfg.bloom;
  $("sound").checked = cfg.sound; $("cycleHue").checked = cfg.cycleHue;
  $("anyKey").checked = cfg.anyKey;

  const label = (c) => (c ? c.replace(/^Key/, "") : (cfg.anyKey ? "any key" : "unbound"));
  $("bindA").textContent = cfg.codeA || (cfg.anyKey ? "any key" : "unbound");
  $("bindB").textContent = cfg.codeB || (cfg.anyKey ? "any key" : "unbound");
  codeEl.A.textContent = cfg.codeA ? cfg.codeA.replace(/^Key/, "") : (cfg.anyKey ? "ANY" : "—");
  codeEl.B.textContent = cfg.codeB ? cfg.codeB.replace(/^Key/, "") : (cfg.anyKey ? "ANY" : "—");

  $("sceneTag").textContent = cfg.scene.toUpperCase();
  document.querySelectorAll(".scene-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.scene === cfg.scene));
}

function hideHint() { hintEl.classList.add("gone"); }

// ---------- boot ----------
resize();
applyConfig();
requestAnimationFrame(frame);
