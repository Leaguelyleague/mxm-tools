// =============================================================================
// btn-anims.js — Entrance animations for the floating buttons.
//
// Contract: each animation is fn(items) with items = [{ el }] in stacking order
// (index 0 = bottom button). The FINAL position (stack or dragged btnPos) is
// already applied in left/top/right/bottom: here we only animate
// transform/opacity toward the natural state with the Web Animations API.
// Budget: ≤5s total; most last much less.
//
// The choice (none | random | name) lives in storage.local "btnAnimation" and
// is configured in options.html (Advanced section). mxm-buttons.playIntro()
// fires them when entering the editor.
// =============================================================================

(function () {
  "use strict";
  if (window.MXMBtnAnims) return;

  const EASE_OUT = "cubic-bezier(.22,1,.36,1)";

  function run(el, keyframes, options) {
    try { el.animate(keyframes, { fill: "backwards", ...options }); } catch (_) {}
  }

  // Fall from above with a ball bounce.
  function drop(items) {
    items.forEach(({ el }, i) => {
      run(el, [
        { transform: "translateY(-110vh)", opacity: 1, offset: 0 },
        { transform: "translateY(0)", offset: 0.55 },
        { transform: "translateY(-16px)", offset: 0.72 },
        { transform: "translateY(0)", offset: 0.84 },
        { transform: "translateY(-6px)", offset: 0.92 },
        { transform: "translateY(0)", opacity: 1, offset: 1 },
      ], { duration: 950, delay: i * 90, easing: "linear" });
    });
  }

  // Matrix: they "materialize" from top to bottom with a flicker.
  function matrix(items) {
    [...items].reverse().forEach(({ el }, i) => {
      run(el, [
        { opacity: 0, transform: "translateY(-18px)", filter: "brightness(3) saturate(0)", offset: 0 },
        { opacity: 1, offset: 0.25 },
        { opacity: 0.25, offset: 0.45 },
        { opacity: 1, filter: "brightness(2) saturate(.3)", offset: 0.7 },
        { opacity: 1, transform: "translateY(0)", filter: "none", offset: 1 },
      ], { duration: 620, delay: i * 110, easing: "ease-out" });
    });
  }

  // From the right side, with a slight overshoot.
  function side(items) {
    items.forEach(({ el }, i) => {
      run(el, [
        { transform: "translateX(140px)", opacity: 0, offset: 0 },
        { transform: "translateX(-8px)", opacity: 1, offset: 0.7 },
        { transform: "translateX(0)", offset: 1 },
      ], { duration: 520, delay: i * 70, easing: EASE_OUT });
    });
  }

  // One button appears and the others are "born" from it.
  function spawn(items) {
    if (!items.length) return;
    const first = items[0].el.getBoundingClientRect();
    items.forEach(({ el }, i) => {
      if (i === 0) {
        run(el, [
          { transform: "scale(0)", opacity: 0 },
          { transform: "scale(1.2)", opacity: 1, offset: 0.6 },
          { transform: "scale(1)" },
        ], { duration: 450, easing: EASE_OUT });
        return;
      }
      const r = el.getBoundingClientRect();
      const dx = first.left - r.left;
      const dy = first.top - r.top;
      run(el, [
        { transform: `translate(${dx}px, ${dy}px) scale(.25)`, opacity: 0, offset: 0 },
        { opacity: 1, offset: 0.3 },
        { transform: "translate(0, 0) scale(1)", offset: 1 },
      ], { duration: 620, delay: 250 + i * 80, easing: EASE_OUT });
    });
  }

  // Solar-system orbit: they revolve around the stack's center and settle
  // into place one by one (a closing spiral).
  function orbit(items) {
    if (!items.length) return;
    const rects = items.map(({ el }) => el.getBoundingClientRect());
    const cx = rects.reduce((s, r) => s + r.left, 0) / rects.length - 160;
    const cy = rects.reduce((s, r) => s + r.top, 0) / rects.length;
    items.forEach(({ el }, i) => {
      const r0 = rects[i];
      const radius = 120 + i * 14;
      const a0 = (i / items.length) * Math.PI * 2;
      const frames = [];
      const STEPS = 22;
      for (let s = 0; s <= STEPS; s++) {
        const p = s / STEPS;
        const ang = a0 + p * Math.PI * 2.5;
        const rad = radius * (1 - p);
        const x = cx + Math.cos(ang) * rad - r0.left;
        const y = cy + Math.sin(ang) * rad * 0.6 - r0.top;
        frames.push({
          transform: `translate(${x * (1 - p)}px, ${y * (1 - p)}px)`,
          opacity: s === 0 ? 0 : 1,
          offset: p,
        });
      }
      run(el, frames, { duration: 1900, delay: i * 130, easing: "ease-in-out" });
    });
  }

  // Portal: they spin in from a point, as if coming out of a vortex.
  function portal(items) {
    items.forEach(({ el }, i) => {
      run(el, [
        { transform: "scale(0) rotate(540deg)", opacity: 0, filter: "blur(6px)", offset: 0 },
        { opacity: 1, offset: 0.4 },
        { transform: "scale(1.1) rotate(-20deg)", filter: "blur(0)", offset: 0.75 },
        { transform: "scale(1) rotate(0)", offset: 1 },
      ], { duration: 700, delay: i * 100, easing: EASE_OUT });
    });
  }

  // They grow from an invisible dot to full size, one by one.
  function grow(items) {
    items.forEach(({ el }, i) => {
      run(el, [
        { transform: "scale(.001)", opacity: 0, offset: 0 },
        { opacity: 1, offset: 0.35 },
        { transform: "scale(1.18)", offset: 0.7 },
        { transform: "scale(.94)", offset: 0.86 },
        { transform: "scale(1)", offset: 1 },
      ], { duration: 480, delay: i * 120, easing: "ease-out" });
    });
  }

  // They rise from below the viewport.
  function rise(items) {
    items.forEach(({ el }, i) => {
      run(el, [
        { transform: "translateY(60vh)", opacity: 0, offset: 0 },
        { opacity: 1, offset: 0.35 },
        { transform: "translateY(-10px)", offset: 0.8 },
        { transform: "translateY(0)", offset: 1 },
      ], { duration: 750, delay: i * 90, easing: EASE_OUT });
    });
  }

  // Balloons carried by the wind: they float up, swaying side to side.
  function balloons(items) {
    items.forEach(({ el }, i) => {
      const sway = 18 + (i % 3) * 8;
      run(el, [
        { transform: `translate(${-sway}px, 70vh)`, opacity: 0, offset: 0 },
        { opacity: 1, offset: 0.2 },
        { transform: `translate(${sway}px, 45vh)`, offset: 0.35 },
        { transform: `translate(${-sway * 0.7}px, 22vh)`, offset: 0.6 },
        { transform: `translate(${sway * 0.5}px, 8vh)`, offset: 0.82 },
        { transform: "translate(0, 0)", offset: 1 },
      ], { duration: 1700, delay: i * 140, easing: "ease-in-out" });
    });
  }

  // Little train: they enter in a row from the left (at the first button's height)
  // and each car goes up/down to its place.
  function train(items) {
    if (!items.length) return;
    const lead = items[0].el.getBoundingClientRect();
    items.forEach(({ el }, i) => {
      const r = el.getBoundingClientRect();
      const dy = lead.top - r.top;
      run(el, [
        { transform: `translate(-100vw, ${dy}px)`, opacity: 1, offset: 0 },
        { transform: `translate(0, ${dy}px)`, offset: 0.65 },
        { transform: "translate(0, 0)", offset: 1 },
      ], { duration: 1100, delay: i * 150, easing: "ease-in-out" });
    });
  }

  // ── Varied themes — cosmic, physics, retro, nature, magic, mechanics, ──────
  // sports, dance. Same contract.

  // Meteor shower: they fall diagonally to random points, impact with a
  // flash, and all rush to their place (chaos → order).
  function meteorShower(items) {
    items.forEach(({ el }, i) => {
      const r = el.getBoundingClientRect();
      const lx = (Math.random() * 0.7 + 0.15) * innerWidth - (r.left + 21);
      const ly = (Math.random() * 0.6 + 0.20) * innerHeight - (r.top + 21);
      const sx = lx + 260, sy = ly - (innerHeight + 150);
      run(el, [
        { transform: `translate(${sx}px,${sy}px) scale(.5)`, opacity: 0, filter: "brightness(2.5) blur(4px)", offset: 0 },
        { transform: `translate(${lx}px,${ly}px) scale(1.15)`, opacity: 1, filter: "brightness(2.5) blur(0)", offset: 0.38, easing: "cubic-bezier(.55,0,1,.45)" },
        { transform: `translate(${lx}px,${ly}px) scale(.95)`, filter: "brightness(1)", offset: 0.55, easing: "ease-out" },
        { transform: "translate(0,0)", filter: "none", offset: 1 },
      ], { duration: 1700, delay: i * 70 + Math.random() * 120, easing: "cubic-bezier(.6,0,.2,1)" });
    });
  }

  // Pinball: launched from the left, bounces off the floor and rises in a
  // spinning carom.
  function pinballRicochet(items) {
    items.forEach(({ el }, i) => {
      const r = el.getBoundingClientRect();
      const dxIn = -(r.left + 60);
      const dyFloor = innerHeight - r.bottom;
      run(el, [
        { transform: `translate(${dxIn}px,${-r.top * 0.25}px) rotate(-220deg)`, opacity: 0, offset: 0 },
        { transform: `translate(${dxIn * 0.45}px,${dyFloor}px) rotate(-80deg) scale(1.1,.75)`, opacity: 1, offset: 0.45, easing: "cubic-bezier(.35,0,.85,1)" },
        { transform: `translate(${dxIn * 0.12}px,-30px) rotate(15deg)`, offset: 0.75, easing: "cubic-bezier(.2,0,.4,1)" },
        { transform: "none", offset: 1, easing: "ease-in-out" },
      ], { duration: 1150, delay: i * 80 });
    });
  }

  // Bouncy parade: three parabolic hops with squash & stretch, as if alive.
  function frogParade(items) {
    items.forEach(({ el }, i) => {
      const d = -(el.getBoundingClientRect().left + 50);
      const kf = [{ transform: `translate(${d}px,0) scale(1,.8)`, opacity: 0, offset: 0 }];
      [0, 1, 2].forEach((h) => {
        const a = h / 3, b = (h + 1) / 3;
        kf.push({ transform: `translate(${d * (1 - (a + b) / 2)}px,-48px) scale(.88,1.18)`, opacity: 1, offset: a + 0.14, easing: "cubic-bezier(.4,0,.9,1)" });
        kf.push({ transform: `translate(${d * (1 - b)}px,0) scale(1.22,.72)`, offset: b, easing: "cubic-bezier(.2,0,.5,1)" });
      });
      kf.push({ transform: "none", offset: 1 });
      run(el, kf, { duration: 1300, delay: i * 110, easing: "linear" });
    });
  }

  // Magic round: they form a giant circle, the round spins, and they fly to their place.
  function ringDance(items) {
    const cx = innerWidth / 2, cy = innerHeight / 2;
    const R = Math.min(cx, cy) * 0.55, n = items.length;
    items.forEach(({ el }, i) => {
      const r = el.getBoundingClientRect(), bx = r.left + 21, by = r.top + 21;
      const a0 = (i / n) * 2 * Math.PI - Math.PI / 2, a1 = a0 + 0.5;
      const P = (a) => `translate(${cx + R * Math.cos(a) - bx}px,${cy + R * Math.sin(a) - by}px)`;
      run(el, [
        { transform: P(a0) + " scale(0)", opacity: 0, offset: 0 },
        { transform: P(a0) + " scale(1)", opacity: 1, offset: 0.25, easing: "cubic-bezier(.2,.9,.3,1.4)" },
        { transform: P(a1), offset: 0.55, easing: "ease-in-out" },
        { transform: "none", offset: 1 },
      ], { duration: 2300, delay: i * 40, easing: "cubic-bezier(.65,0,.2,1)" });
    });
  }

  // V flock: they cross in formation (leader in front) and peel off.
  function geeseV(items) {
    const n = items.length;
    items.forEach(({ el }, i) => {
      const r = el.getBoundingClientRect(), rank = Math.abs(i - (n - 1) / 2);
      const vx = innerWidth * 0.45 - (r.left + 21) - rank * 56;
      const vy = innerHeight * 0.35 - (r.top + 21) + rank * 40;
      run(el, [
        { transform: `translate(${vx - innerWidth * 0.6}px,${vy + 40}px) rotate(9deg)`, opacity: 0, offset: 0 },
        { transform: `translate(${vx}px,${vy}px)`, opacity: 1, offset: 0.45, easing: "cubic-bezier(.3,0,.2,1)" },
        { transform: `translate(${vx * 0.25}px,${vy * 0.25}px) rotate(-6deg)`, offset: 0.75, easing: "ease-in-out" },
        { transform: "none", offset: 1, easing: "ease-out" },
      ], { duration: 1900, delay: rank * 60 });
    });
  }

  // VHS signal: broken tracking — skews in steps() and color shifts.
  function vhsGlitch(items) {
    items.forEach(({ el }, i) => {
      run(el, [
        { transform: "translateX(-14px) skewX(18deg) scaleY(.96)", opacity: 0, filter: "hue-rotate(90deg) saturate(3) contrast(1.6)", offset: 0 },
        { transform: "translateX(10px) skewX(-14deg)", opacity: 0.65, filter: "hue-rotate(-70deg) saturate(2.5)", offset: 0.2, easing: "steps(2,end)" },
        { transform: "translateX(-7px) skewX(9deg) scaleY(1.05)", opacity: 0.55, filter: "hue-rotate(45deg) brightness(1.6)", offset: 0.45, easing: "steps(2,end)" },
        { transform: "translateX(3px) skewX(-4deg)", opacity: 0.9, filter: "hue-rotate(-15deg)", offset: 0.72, easing: "steps(3,end)" },
        { transform: "none", opacity: 1, filter: "none", offset: 1 },
      ], { duration: 900, delay: i * 65, easing: "linear" });
    });
  }

  // 3D domino: they rise from flat in a cascade, with overshoot.
  function dominoFlip(items) {
    items.slice().reverse().forEach(({ el }, i) => {
      run(el, [
        { transform: "perspective(500px) rotateX(-95deg) translateY(-10px)", opacity: 0, offset: 0 },
        { transform: "perspective(500px) rotateX(18deg)", opacity: 1, offset: 0.6, easing: "cubic-bezier(.2,0,.3,1)" },
        { transform: "perspective(500px) rotateX(-7deg)", offset: 0.82, easing: "ease-in-out" },
        { transform: "none", offset: 1, easing: "ease-out" },
      ], { duration: 700, delay: i * 90 });
    });
  }

  // Freshly hung sign: damped pendulum-like oscillation.
  function pendulumSign(items) {
    items.forEach(({ el }, i) => {
      const sw = (a) => `translate(${a * 0.5}px,${Math.abs(a) * 0.18}px) rotate(${a}deg)`;
      run(el, [
        { transform: sw(70) + " scale(.6)", opacity: 0, offset: 0 },
        { transform: sw(70), opacity: 1, offset: 0.12, easing: "ease-out" },
        { transform: sw(-38), offset: 0.38, easing: "ease-in-out" },
        { transform: sw(18), offset: 0.6, easing: "ease-in-out" },
        { transform: sw(-7), offset: 0.8, easing: "ease-in-out" },
        { transform: "none", offset: 1, easing: "ease-in-out" },
      ], { duration: 1400, delay: i * 70 });
    });
  }

  // Popcorn: they pop in random order with a hop, spin and flash.
  function popcorn(items) {
    const order = items.map((_, i) => i).sort(() => Math.random() - 0.5);
    items.forEach(({ el }, i) => {
      const rot = Math.random() * 40 - 20;
      run(el, [
        { transform: "translateY(14px) scale(.2)", opacity: 0, offset: 0 },
        { transform: `translateY(-22px) scale(1.25) rotate(${rot}deg)`, opacity: 1, filter: "brightness(1.7)", offset: 0.45, easing: "cubic-bezier(.2,.9,.4,1)" },
        { transform: `translateY(4px) scale(.92) rotate(${-rot / 2}deg)`, filter: "brightness(1)", offset: 0.72, easing: "ease-in" },
        { transform: "none", filter: "none", offset: 1, easing: "cubic-bezier(.3,1.6,.5,1)" },
      ], { duration: 750, delay: order[i] * 90 + Math.random() * 60 });
    });
  }

  // Slot machine: vertical blurred reels that stop one by one. Clack!
  function slotReel(items) {
    items.forEach(({ el }, i) => {
      run(el, [
        { transform: "translateY(-90px) scaleY(1.6)", opacity: 0, filter: "blur(6px)", offset: 0 },
        { transform: "translateY(60px) scaleY(1.6)", opacity: 0.7, filter: "blur(6px)", offset: 0.3, easing: "linear" },
        { transform: "translateY(-70px) scaleY(1.5)", opacity: 0.85, filter: "blur(5px)", offset: 0.55, easing: "linear" },
        { transform: "translateY(26px) scaleY(1.1)", opacity: 1, filter: "blur(1px)", offset: 0.8, easing: "linear" },
        { transform: "translateY(-8px)", filter: "none", offset: 0.92, easing: "ease-out" },
        { transform: "none", offset: 1, easing: "ease-in-out" },
      ], { duration: 1000, delay: i * 130 });
    });
  }

  // Leaf in the wind: glides in a damped zigzag and lands softly (no bounce).
  function leafFall(items) {
    items.forEach(({ el }, i) => {
      const h = -(el.getBoundingClientRect().top + 60);
      run(el, [
        { transform: `translate(0,${h}px)`, opacity: 0, offset: 0 },
        { transform: `translate(-70px,${h * 0.72}px) rotate(-35deg)`, opacity: 1, offset: 0.22, easing: "ease-in-out" },
        { transform: `translate(55px,${h * 0.46}px) rotate(30deg)`, offset: 0.44, easing: "ease-in-out" },
        { transform: `translate(-38px,${h * 0.24}px) rotate(-22deg)`, offset: 0.64, easing: "ease-in-out" },
        { transform: `translate(20px,${h * 0.08}px) rotate(12deg)`, offset: 0.82, easing: "ease-in-out" },
        { transform: "none", offset: 1, easing: "ease-out" },
      ], { duration: 2100, delay: i * 90 });
    });
  }

  // Genie from the lamp: rises like a deformed wisp of smoke and condenses.
  function genieWisp(items) {
    items.forEach(({ el }, i) => {
      run(el, [
        { transform: "translateY(70px) scale(.15,1.8) skewX(24deg)", opacity: 0, filter: "blur(8px) saturate(.3)", offset: 0 },
        { transform: "translateY(34px) scale(.3,1.5) skewX(-20deg)", opacity: 0.55, filter: "blur(6px)", offset: 0.32, easing: "ease-in-out" },
        { transform: "translateY(10px) scale(.6,1.2) skewX(12deg)", opacity: 0.85, filter: "blur(3px) saturate(1.4)", offset: 0.6, easing: "ease-in-out" },
        { transform: "translateY(-6px) scale(1.12,.9) skewX(-4deg)", opacity: 1, filter: "blur(0) brightness(1.35)", offset: 0.82, easing: "ease-out" },
        { transform: "none", filter: "none", offset: 1 },
      ], { duration: 1200, delay: i * 80 });
    });
  }

  // Clockwork winding: ratchet rotation (steps) that grows in clicks.
  function clockworkWind(items) {
    items.forEach(({ el }, i) => {
      run(el, [
        { transform: "rotate(-540deg) scale(.2)", opacity: 0, offset: 0 },
        { transform: "rotate(-540deg) scale(.2)", opacity: 1, offset: 0.08 },
        { transform: "rotate(-360deg) scale(.45)", offset: 0.3, easing: "steps(3,end)" },
        { transform: "rotate(-180deg) scale(.7)", offset: 0.55, easing: "steps(3,end)" },
        { transform: "rotate(-30deg) scale(.95)", offset: 0.8, easing: "steps(3,end)" },
        { transform: "rotate(6deg) scale(1.05)", filter: "brightness(1.25)", offset: 0.92, easing: "ease-out" },
        { transform: "none", filter: "none", offset: 1 },
      ], { duration: 1300, delay: i * 75, easing: "linear" });
    });
  }

  // Cannonball: high arc from the bottom-left, lands with a heavy squash.
  function cannonball(items) {
    items.forEach(({ el }, i) => {
      const r = el.getBoundingClientRect();
      const dx = -(r.left + 80), dy = innerHeight - r.top + 40;
      run(el, [
        { transform: `translate(${dx}px,${dy}px) rotate(0deg) scale(.7)`, opacity: 0, offset: 0 },
        { transform: `translate(${dx * 0.55}px,${dy * 0.5 - innerHeight * 0.28}px) rotate(300deg)`, opacity: 1, filter: "blur(1.5px)", offset: 0.4, easing: "cubic-bezier(.2,.6,.5,1)" },
        { transform: "translate(0,0) rotate(680deg) scale(1.25,.7)", filter: "none", offset: 0.7, easing: "cubic-bezier(.5,0,.9,.4)" },
        { transform: "rotate(712deg) scale(.94,1.08)", offset: 0.85, easing: "ease-out" },
        { transform: "rotate(720deg)", offset: 1, easing: "ease-in-out" },
      ], { duration: 1250, delay: i * 100 });
    });
  }

  // Disco fever: quantized steps with hue-rotate lights, alternating sides.
  function discoBoogie(items) {
    items.forEach(({ el }, i) => {
      const s = i % 2 ? 1 : -1, beat = "steps(1,end)";
      run(el, [
        { transform: `translateX(${18 * s}px) rotate(${8 * s}deg) scale(.85)`, opacity: 0, filter: "hue-rotate(120deg)", offset: 0 },
        { transform: `translateX(${-14 * s}px) rotate(${-7 * s}deg)`, opacity: 0.6, filter: "hue-rotate(-90deg) brightness(1.3)", offset: 0.25, easing: beat },
        { transform: `translateX(${10 * s}px) rotate(${6 * s}deg) scale(1.06)`, opacity: 0.85, filter: "hue-rotate(60deg)", offset: 0.5, easing: beat },
        { transform: `translateX(${-6 * s}px) rotate(${-4 * s}deg)`, opacity: 1, filter: "hue-rotate(-30deg) brightness(1.15)", offset: 0.75, easing: beat },
        { transform: "none", filter: "none", offset: 1, easing: "ease-out" },
      ], { duration: 1400, delay: i * 60 });
    });
  }

  // Big Bang: born in the center and explode radially stretched (warp streak).
  function bigBangWarp(items) {
    const cx = innerWidth / 2, cy = innerHeight / 2;
    items.forEach(({ el }, i) => {
      const r = el.getBoundingClientRect();
      const dx = cx - (r.left + 21), dy = cy - (r.top + 21);
      const ang = Math.atan2(-dy, -dx) * 180 / Math.PI;
      run(el, [
        { transform: `translate(${dx}px,${dy}px) scale(.05)`, opacity: 0, filter: "brightness(3) blur(6px)", offset: 0 },
        { transform: `translate(${dx}px,${dy}px) scale(.3)`, opacity: 1, offset: 0.18, easing: "ease-in" },
        { transform: `translate(${dx * 0.3}px,${dy * 0.3}px) rotate(${ang}deg) scale(1.7,.6) rotate(${-ang}deg)`, filter: "brightness(1.8) blur(3px)", offset: 0.5, easing: "cubic-bezier(.7,0,.3,1)" },
        { transform: "none", filter: "none", offset: 1, easing: "cubic-bezier(.1,.8,.2,1)" },
      ], { duration: 1300, delay: 120 + i * 25 });
    });
  }

  // Four winds: they enter from the 4 corners in turns, each with its filter.
  function fourCorners(items) {
    const C = [[0, 0], [innerWidth, 0], [innerWidth, innerHeight], [0, innerHeight]];
    items.forEach(({ el }, i) => {
      const r = el.getBoundingClientRect(), [px, py] = C[i % 4];
      const dx = px - (r.left + 21), dy = py - (r.top + 21);
      const f = ["blur(5px)", "brightness(2.2)", "saturate(3)", "hue-rotate(70deg)"][i % 4];
      run(el, [
        { transform: `translate(${dx}px,${dy}px) rotate(${i % 2 ? 90 : -90}deg) scale(.4)`, opacity: 0, filter: f, offset: 0 },
        { transform: `translate(${dx * 0.35}px,${dy * 0.35}px) rotate(${i % 2 ? 25 : -25}deg) scale(.9)`, opacity: 1, filter: "none", offset: 0.55, easing: "cubic-bezier(.2,0,.2,1)" },
        { transform: `translate(${dx * -0.05}px,${dy * -0.05}px)`, offset: 0.85, easing: "ease-out" },
        { transform: "none", offset: 1 },
      ], { duration: 1200, delay: (i % 4) * 90 + Math.floor(i / 4) * 140 });
    });
  }

  // Magnet: they appear scattered, anticipate… and ALL snap into place at once.
  function magnetSnap(items) {
    items.forEach(({ el }) => {
      const a = Math.random() * 2 * Math.PI, d = 40 + Math.random() * 50;
      const sx = Math.cos(a) * d, sy = Math.sin(a) * d, rot = Math.random() * 50 - 25;
      run(el, [
        { transform: `translate(${sx}px,${sy}px) rotate(${rot}deg) scale(.9)`, opacity: 0, offset: 0 },
        { transform: `translate(${sx}px,${sy}px) rotate(${rot}deg) scale(.9)`, opacity: 0.75, offset: 0.3, easing: "ease-out" },
        { transform: `translate(${sx * 1.06}px,${sy * 1.06}px) rotate(${rot * 1.2}deg)`, opacity: 0.85, offset: 0.62, easing: "ease-in-out" },
        { transform: "translate(0,0) rotate(0) scale(1.08)", opacity: 1, filter: "brightness(1.35)", offset: 0.78, easing: "cubic-bezier(.8,0,.2,1)" },
        { transform: "none", filter: "none", offset: 1, easing: "ease-out" },
      ], { duration: 1500, delay: 0 });
    });
  }

  // Polaroid: zero movement — they develop from a blurry B&W ghost to full color.
  function polaroidDevelop(items) {
    items.forEach(({ el }, i) => {
      run(el, [
        { opacity: 0, filter: "blur(14px) saturate(0) brightness(2.2) contrast(.6)", offset: 0 },
        { opacity: 0.6, filter: "blur(8px) saturate(.2) brightness(1.7) contrast(.75)", offset: 0.35, easing: "ease-in-out" },
        { opacity: 0.9, filter: "blur(3px) saturate(.7) brightness(1.2)", offset: 0.7, easing: "ease-in-out" },
        { opacity: 1, filter: "blur(0) saturate(1.3) brightness(1.05)", offset: 0.9, easing: "ease-out" },
        { opacity: 1, filter: "none", offset: 1 },
      ], { duration: 1800, delay: i * 100, easing: "linear" });
    });
  }

  // Rubber stamp: falls along the Z axis (huge and ghostly) and stamps with a thump.
  function stampSlam(items) {
    items.forEach(({ el }, i) => {
      run(el, [
        { transform: "scale(3.2) rotate(-14deg)", opacity: 0, filter: "blur(4px)", offset: 0 },
        { transform: "scale(2.2) rotate(-8deg)", opacity: 0.35, filter: "blur(2px)", offset: 0.3, easing: "ease-in" },
        { transform: "scale(.92) rotate(2deg)", opacity: 1, filter: "blur(0) brightness(.9)", offset: 0.55, easing: "cubic-bezier(.7,0,1,1)" },
        { transform: "scale(1.06) rotate(-1deg)", filter: "brightness(1.15)", offset: 0.75, easing: "ease-out" },
        { transform: "none", filter: "none", offset: 1, easing: "ease-in-out" },
      ], { duration: 800, delay: i * 120 });
    });
  }

  window.MXMBtnAnims = {
    drop, matrix, side, spawn, orbit, portal, grow, rise, balloons, train,
    meteorShower, pinballRicochet, frogParade, ringDance, geeseV, vhsGlitch,
    dominoFlip, pendulumSign, popcorn, slotReel, leafFall, genieWisp,
    clockworkWind, cannonball, discoBoogie, bigBangWarp, fourCorners,
    magnetSnap, polaroidDevelop, stampSlam,
  };
})();
