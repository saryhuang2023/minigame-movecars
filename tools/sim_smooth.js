// 模拟 LevelMap._buildLevels + Chaikin 倒角 + Catmull-Rom，验证圆角效果：
//   1) 路径无 NaN
//   2) 最小转弯半径（确认锐角已消除，符合「高速公路」平缓）
//   3) 关卡中心到路径最大偏移（确认钮仍落在路面上，路半宽 = 25*design px）
const cfg = require('../js/define/LevelMapConfig.js');
const SCREEN_WIDTH = 393;
const s = SCREEN_WIDTH / cfg.designWidth;
const k = cfg.roadTargetW / 845 * s;
const btns = cfg.roadButtons, roads = cfg.roads;

function build(N) {
  const r0cap = btns.road_0.length;
  const segs = [];
  if (N <= r0cap) segs.push({ rk: 'road_0', count: N });
  else {
    segs.push({ rk: 'road_0', count: r0cap });
    let rem = N - r0cap, fb = 1;
    while (rem > 0) {
      const rk = (fb % 2 === 1) ? 'road_1' : 'road_2';
      const c = Math.min(btns[rk].length, rem); if (c <= 0) break;
      segs.push({ rk, count: c }); rem -= c; fb++;
    }
  }
  const bo = segs.slice().reverse();
  const imgDist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const built = bo.map(e => {
    const ri = roads[e.rk];
    const arr = (e.count < btns[e.rk].length) ? btns[e.rk].slice(btns[e.rk].length - e.count) : btns[e.rk];
    const segW = ri.W * k, roadLeft = (SCREEN_WIDTH - segW) / 2;
    const gaps = [];
    for (let i = 0; i < e.count - 1; i++) gaps.push(imgDist(arr[i], arr[i + 1]));
    return { rk: e.rk, count: e.count, ri, arr, segW, roadLeft,
      lastGap: gaps.length ? gaps[gaps.length - 1] : 0, firstGap: gaps.length ? gaps[0] : 0 };
  });
  const segTops = []; let segY = 0;
  for (let i = 0; i < built.length; i++) {
    if (i > 0) {
      const p = built[i - 1], c = built[i];
      const targetImg = (p.lastGap + c.firstGap) / 2;
      const dxW = (c.roadLeft + c.arr[0].x * k) - (p.roadLeft + p.arr[p.count - 1].x * k);
      const dy0W = (p.ri.H + c.arr[0].y - p.arr[p.count - 1].y) * k;
      const tw = targetImg * k;
      const nd = Math.sqrt(Math.max(0, tw * tw - dxW * dxW)) - dy0W;
      segY += p.ri.H * k + Math.max(0, nd);
    }
    segTops.push(segY);
  }
  const levels = [];
  for (let si = 0; si < built.length; si++) {
    const b = built[si];
    for (let bi = 0; bi < b.count && levels.length < N; bi++) {
      const bb = b.arr[bi];
      levels.push({ x: b.roadLeft + bb.x * k, worldY: segTops[si] + bb.y * k });
    }
  }
  levels.reverse();
  for (let li = 0; li < levels.length; li++) levels[li].index = li;
  const TRAIL = cfg.trailBottom || 100;
  const minY = Math.min.apply(null, levels.map(l => l.worldY));
  const shift = TRAIL * s - minY;
  for (const l of levels) l.worldY += shift;
  return levels;
}

function chaikin(pts, iters) {
  let P = pts;
  for (let it = 0; it < iters; it++) {
    if (P.length < 3) break;
    const Q = [P[0]];
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1];
      Q.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      Q.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    Q.push(P[P.length - 1]);
    P = Q;
  }
  return P;
}

function catmull(P, stepPx) {
  const n = P.length;
  if (n < 3) return P.slice();
  const out = [{ x: P[0].x, y: P[0].y }];
  for (let i = 0; i < n - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[Math.min(n - 1, i + 1)], p3 = P[Math.min(n - 1, i + 2)];
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const steps = Math.max(1, Math.ceil(dist / stepPx));
    for (let st = 1; st <= steps; st++) {
      const t = st / steps, t2 = t * t, t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  return out;
}

function analyze(iters) {
  const levels = build(47);
  const pts = levels.map(l => ({ x: l.x, y: l.worldY }));
  const smooth = chaikin(pts, iters);
  const path = catmull(smooth, 18 * s);

  // 1) NaN
  const hasNaN = path.some(p => isNaN(p.x) || isNaN(p.y) || !isFinite(p.x) || !isFinite(p.y));

  // 2) min turning radius: 沿路径采样相邻夹角与段长
  let minR = Infinity, maxAngle = 0;
  for (let i = 1; i < path.length - 1; i++) {
    const a = path[i - 1], b = path[i], c = path[i + 1];
    const v1 = { x: b.x - a.x, y: b.y - a.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
    const l1 = Math.hypot(v1.x, v1.y), l2 = Math.hypot(v2.x, v2.y);
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    let cos = (v1.x * v2.x + v1.y * v2.y) / (l1 * l2);
    cos = Math.max(-1, Math.min(1, cos));
    const ang = Math.acos(cos);            // 0 = 直行, 越大越急
    maxAngle = Math.max(maxAngle, ang);
    // 转弯半径 R = L / (2 sin(θ/2)), 取两段平均长 L
    const L = (l1 + l2) / 2;
    const R = L / (2 * Math.sin(ang / 2));
    if (isFinite(R)) minR = Math.min(minR, R);
  }

  // 3) 关卡中心 → 最近路径点 最大偏移
  let maxOff = 0;
  for (const lv of levels) {
    let best = Infinity;
    for (const p of path) {
      const d = Math.hypot(lv.x - p.x, lv.worldY - p.y);
      if (d < best) best = d;
    }
    maxOff = Math.max(maxOff, best);
  }

  // 4) 最大相邻点间距
  let maxGap = 0;
  for (let i = 1; i < path.length; i++) maxGap = Math.max(maxGap, Math.hypot(path[i].x - path[i-1].x, path[i].y - path[i-1].y));

  console.log(`iters=${iters} | NaN=${hasNaN} | 最小转弯半径=${isFinite(minR)?minR.toFixed(1):'∞'}px | 最大转角=${(maxAngle*180/Math.PI).toFixed(1)}° | 关卡最大偏移=${maxOff.toFixed(1)}px | 路径点数=${path.length} | 最大步长=${maxGap.toFixed(1)}px`);
  console.log(`        路半宽=25*scale=${(25*s).toFixed(1)}px（偏移 < 此值即钮仍压在路面）`);
}

console.log('=== 圆角平滑验证 (N=47) ===');
analyze(0);   // 对照：无倒角（原版问题）
analyze(1);
analyze(2);
analyze(3);
