/*
 * Нүүрний 3D шугам: 110 кВ-ын нэг хэлхээт сараалжин тулгуур, утас нь
 * катенараар (y = a·ch(x/a)) унжина. Canvas 2D дээр өөрийн проекц —
 * гадны сан ашиглахгүй. Ажиллахгүй бол HTML дахь SVG хэвээр харагдана.
 */
(() => {
  const host = document.querySelector('.hero-3d');
  if (!host) return;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) return;

  const svg = host.querySelector('svg');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', svg?.getAttribute('aria-label') || 'Агаарын шугамын 3D дүрслэл');
  host.append(canvas);
  host.classList.add('is-3d');
  svg?.setAttribute('aria-hidden', 'true');

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ---- Загвар (метрээр) ----------------------------------------------------
  const route = [
    { x: -135, z: 10, g: 3 },
    { x: -45, z: -7, g: 8 },
    { x: 45, z: 8, g: 0 },
    { x: 135, z: -5, g: 6 },
  ];
  const groundAt = (x) => {
    for (let i = 0; i < route.length - 1; i += 1) {
      const a = route[i];
      const b = route[i + 1];
      if (x <= b.x || i === route.length - 2) {
        const t = Math.min(1, Math.max(0, (x - a.x) / (b.x - a.x)));
        return a.g + (b.g - a.g) * t - Math.sin(t * Math.PI) * 4;
      }
    }
    return 0;
  };
  const zAt = (x) => {
    for (let i = 0; i < route.length - 1; i += 1) {
      const a = route[i];
      const b = route[i + 1];
      if (x <= b.x || i === route.length - 2) {
        const t = Math.min(1, Math.max(0, (x - a.x) / (b.x - a.x)));
        return a.z + (b.z - a.z) * t;
      }
    }
    return 0;
  };

  const LEVELS = [0, 9, 17, 24, 30, 36];
  const halfWidth = (y) => (y <= 30 ? 4.2 - (2.9 * y) / 30 : 1.3 - (0.35 * (y - 30)) / 6);

  const towers = route.map((p, i) => {
    const prev = route[Math.max(0, i - 1)];
    const next = route[Math.min(route.length - 1, i + 1)];
    let ux = next.x - prev.x;
    let uz = next.z - prev.z;
    const n = Math.hypot(ux, uz) || 1;
    ux /= n;
    uz /= n;
    const vx = -uz;
    const vz = ux;
    const at = (u, v, y) => [p.x + ux * u + vx * v, p.g + y, p.z + uz * u + vz * v];

    const segs = [];
    const corners = (y) => {
      const h = halfWidth(y);
      return [at(-h, -h, y), at(h, -h, y), at(h, h, y), at(-h, h, y)];
    };
    const rings = LEVELS.map(corners);
    rings.forEach((ring, k) => {
      for (let c = 0; c < 4; c += 1) {
        segs.push([ring[c], ring[(c + 1) % 4]]);
        if (k > 0) {
          const low = rings[k - 1];
          segs.push([low[c], ring[c]]);
          segs.push([low[c], ring[(c + 1) % 4], 0.55]);
          segs.push([low[(c + 1) % 4], ring[c], 0.55]);
        }
      }
    });
    const peak = at(0, 0, 42);
    rings[rings.length - 1].forEach((c) => segs.push([c, peak]));

    const lowTipL = at(0, -9.5, 30);
    const lowTipR = at(0, 9.5, 30);
    const upTip = at(0, 7, 36);
    const r30 = rings[4];
    const r36 = rings[5];
    segs.push([r30[0], lowTipL], [r30[1], lowTipL], [at(0, -1.2, 34), lowTipL, 0.7]);
    segs.push([r30[2], lowTipR], [r30[3], lowTipR], [at(0, 1.2, 34), lowTipR, 0.7]);
    segs.push([r36[2], upTip], [r36[3], upTip], [at(0, 1, 40), upTip, 0.7]);

    const hang = (tip) => [tip[0], tip[1] - 2.6, tip[2]];
    const phases = [hang(lowTipL), hang(lowTipR), hang(upTip)];
    phases.forEach((ph, k) => segs.push([[lowTipL, lowTipR, upTip][k], ph, 0.9]));

    return { segs, phases, earth: peak, delay: i * 0.18 };
  });

  // Катенар: тулах цэгүүдийн шулуунаас доош f(s) = a·(ch(L/2a) − ch((s − L/2)/a)).
  const catenary = (A, B, a, n = 36) => {
    const L = Math.hypot(B[0] - A[0], B[2] - A[2]);
    const top = a * Math.cosh(L / (2 * a));
    const pts = [];
    for (let i = 0; i <= n; i += 1) {
      const t = i / n;
      const s = t * L;
      const sag = top - a * Math.cosh((s - L / 2) / a);
      pts.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t - sag, A[2] + (B[2] - A[2]) * t]);
    }
    return pts;
  };

  const wires = [];
  for (let i = 0; i < towers.length - 1; i += 1) {
    for (let k = 0; k < 3; k += 1) {
      wires.push({ pts: catenary(towers[i].phases[k], towers[i + 1].phases[k], 170), kind: 'phase', span: i });
    }
    wires.push({ pts: catenary(towers[i].earth, towers[i + 1].earth, 230), kind: 'earth', span: i });
  }

  // Дунд алсалтын хамгийн доод фазын газраас өндөр — габарит.
  let clearance = null;
  wires.filter((w) => w.kind === 'phase' && w.span === 1).forEach((w) => {
    w.pts.forEach((p) => {
      const gap = p[1] - groundAt(p[0]);
      if (!clearance || gap < clearance.gap) clearance = { gap, top: p, bottom: [p[0], groundAt(p[0]), p[2]] };
    });
  });

  const terrain = [];
  for (let x = -175; x <= 175; x += 5) terrain.push([x, groundAt(x), zAt(Math.max(-135, Math.min(135, x)))]);

  const grid = [];
  for (let x = -180; x <= 180; x += 30) grid.push([[x, -2, -60], [x, -2, 60]]);
  for (let z = -60; z <= 60; z += 30) grid.push([[-180, -2, z], [180, -2, z]]);

  // ---- Камер ба проекц -------------------------------------------------------
  const target = [-22, 18, 0];
  const dist = 330;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let F = 1;
  let CX = 0;
  let CY = 0;
  let cam = { pos: [0, 0, 0], r: [1, 0, 0], u: [0, 1, 0], f: [0, 0, 1] };

  const setCamera = (yaw, pitch) => {
    const pos = [
      target[0] + dist * Math.sin(yaw) * Math.cos(pitch),
      target[1] + dist * Math.sin(pitch),
      target[2] + dist * Math.cos(yaw) * Math.cos(pitch),
    ];
    const f = norm(sub(target, pos));
    const r = norm(cross(f, [0, 1, 0]));
    const u = cross(r, f);
    cam = { pos, r, u, f };
  };

  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

  const project = (p) => {
    const d = sub(p, cam.pos);
    const z = dot(d, cam.f);
    return [CX + (dot(d, cam.r) * F) / z, CY - (dot(d, cam.u) * F) / z, z];
  };
  const depthAlpha = (z) => Math.min(1, Math.max(0.35, 1.45 - z / dist));

  // ---- Зурах ---------------------------------------------------------------------
  const css = getComputedStyle(document.documentElement);
  const SUN = css.getPropertyValue('--sun').trim() || '#f2c744';
  const FONT = getComputedStyle(document.body).fontFamily;

  const line = (a, b, color, width, alpha) => {
    const p = project(a);
    const q = project(b);
    ctx.globalAlpha = alpha * depthAlpha((p[2] + q[2]) / 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(q[0], q[1]);
    ctx.stroke();
  };

  const poly = (pts, color, width, alpha, upto = 1) => {
    const n = Math.max(1, Math.floor((pts.length - 1) * upto));
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    let zSum = 0;
    for (let i = 0; i <= n; i += 1) {
      const p = project(pts[i]);
      zSum += p[2];
      if (i === 0) ctx.moveTo(p[0], p[1]);
      else ctx.lineTo(p[0], p[1]);
    }
    ctx.globalAlpha = alpha * depthAlpha(zSum / (n + 1));
    ctx.stroke();
  };

  const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - (1 - t) ** 3);

  const draw = (time) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const ground = ease(time / 0.8);
    grid.forEach(([a, b]) => line(a, b, '#ffffff', 1, 0.06 * ground));
    poly(terrain, '#aab4c6', 1.6, 0.75 * ground);

    towers.forEach((t) => {
      const k = ease((time - 0.2 - t.delay) / 1);
      if (k <= 0) return;
      t.segs.forEach(([a, b, w = 1]) => line(a, b, '#ffffff', w > 0.8 ? 1.15 : 0.7, 0.8 * k * w));
    });

    const grow = ease((time - 1.1) / 1.6);
    if (grow > 0) {
      wires.forEach((w) => {
        if (w.kind === 'earth') poly(w.pts, '#c9d2df', 1, 0.55, grow);
        else poly(w.pts, SUN, 1.8, 0.95, grow);
      });
    }

    const dim = ease((time - 2.6) / 0.6);
    if (dim > 0 && clearance) {
      const a = project(clearance.top);
      const b = project(clearance.bottom);
      ctx.globalAlpha = dim;
      ctx.strokeStyle = '#aab4c6';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(a[0] - 5, a[1]);
      ctx.lineTo(a[0] + 5, a[1]);
      ctx.moveTo(b[0] - 5, b[1]);
      ctx.lineTo(b[0] + 5, b[1]);
      ctx.stroke();
      ctx.fillStyle = SUN;
      ctx.beginPath();
      ctx.arc(a[0], a[1], 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#c3cbd8';
      ctx.font = `500 12px ${FONT}`;
      ctx.fillText('габарит', a[0] + 9, (a[1] + b[1]) / 2 + 4);
    }
    ctx.globalAlpha = 1;
  };

  // ---- Хэмжээ, хөдөлгөөн ------------------------------------------------------------
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, rect.width);
    H = Math.max(1, rect.height);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    fit();
  };

  // Найгалт ба хулганы бүх өнцөгт тулгуур, утас хүрээнээс гарахгүй хамгийн том масштаб.
  const fitPoints = [];
  towers.forEach((t) => t.segs.forEach(([a, b]) => fitPoints.push(a, b)));
  wires.forEach((w) => fitPoints.push(...w.pts));

  function fit() {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i <= 8; i += 1) {
      for (let j = -1; j <= 1; j += 1) {
        setCamera(BASE_YAW + (i / 4 - 1) * SWAY, BASE_PITCH + j * TILT);
        fitPoints.forEach((p) => {
          const d = sub(p, cam.pos);
          const z = dot(d, cam.f);
          const x = dot(d, cam.r) / z;
          const y = dot(d, cam.u) / z;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        });
      }
    }
    const margin = 0.04;
    F = Math.min((W * (1 - 2 * margin)) / (maxX - minX), (H * (1 - 2 * margin)) / (maxY - minY));
    CX = W / 2 - (F * (minX + maxX)) / 2;
    CY = H / 2 + (F * (minY + maxY)) / 2;
  }

  let mouseX = 0;
  let mouseY = 0;
  let aimX = 0;
  let aimY = 0;
  host.closest('.hero')?.addEventListener('pointermove', (e) => {
    const r = host.getBoundingClientRect();
    aimX = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2));
    aimY = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - 0.5) * 2));
  });

  const BASE_YAW = -0.68;
  const BASE_PITCH = 0.24;
  const SWAY = 0.36;
  const TILT = 0.07;
  let start = 0;
  let raf = 0;
  let visible = true;

  const still = () => {
    setCamera(BASE_YAW, BASE_PITCH);
    draw(99);
  };

  const frame = (now) => {
    raf = 0;
    if (!start) start = now;
    const t = (now - start) / 1000;
    mouseX += (aimX - mouseX) * 0.05;
    mouseY += (aimY - mouseY) * 0.05;
    setCamera(BASE_YAW + Math.sin(t * 0.18) * 0.2 + mouseX * 0.16, BASE_PITCH + mouseY * TILT);
    draw(t);
    if (visible && !document.hidden) raf = requestAnimationFrame(frame);
  };

  const run = () => {
    if (reduced.matches) {
      still();
      return;
    }
    if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame);
  };

  resize();
  run();
  if (reduced.matches) still();

  window.addEventListener('resize', () => {
    resize();
    if (reduced.matches || !raf) still();
    run();
  });
  document.addEventListener('visibilitychange', run);
  reduced.addEventListener?.('change', () => {
    cancelAnimationFrame(raf);
    raf = 0;
    run();
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
      run();
    }).observe(canvas);
  }
})();
