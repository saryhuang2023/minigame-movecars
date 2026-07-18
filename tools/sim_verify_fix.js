// 验证脚本：用真实 LevelMapConfig + 修改后的 _buildLevels 逻辑，
// 检查 N=39 / 47 下 L26-L27、L39-L40 间距及最顶关卡上方留白。
const cfg = require('../js/define/LevelMapConfig.js');
const SCREEN_WIDTH = 393;

function build(N) {
  const s = SCREEN_WIDTH / cfg.designWidth;
  const k = cfg.roadTargetW / 845 * s;
  const btns = cfg.roadButtons;
  const roads = cfg.roads;
  const bgs = cfg.bgs;

  N = Math.max(N || 0, btns.road_0.length);
  const r0cap = btns.road_0.length;

  const segs = [];
  if (N <= r0cap) segs.push({ rk: 'road_0', count: N });
  else {
    segs.push({ rk: 'road_0', count: r0cap });
    let rem = N - r0cap, fb = 1;
    while (rem > 0 && segs.length < 1000) {
      const rk = (fb % 2 === 1) ? 'road_1' : 'road_2';
      const c = Math.min(btns[rk].length, rem);
      if (c <= 0) break;
      segs.push({ rk, count: c });
      rem -= c; fb++;
    }
  }
  const buildOrder = segs.slice().reverse();
  const totalSeg = buildOrder.length;

  function imgDist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  const built = buildOrder.map((entry) => {
    const ri = roads[entry.rk];
    const arr = (entry.count < btns[entry.rk].length)
      ? btns[entry.rk].slice(btns[entry.rk].length - entry.count)
      : btns[entry.rk];
    const segW = ri.W * k;
    const roadLeft = (SCREEN_WIDTH - segW) / 2;
    const gaps = [];
    for (let i = 0; i < entry.count - 1; i++) gaps.push(imgDist(arr[i], arr[i + 1]));
    return {
      rk: entry.rk, count: entry.count, ri, arr, segW, roadLeft,
      btnTopY: arr[0].y, btnBotY: arr[entry.count - 1].y,
      lastGap: gaps.length ? gaps[gaps.length - 1] : 0,
      firstGap: gaps.length ? gaps[0] : 0,
    };
  });

  const segTops = [];
  let segY = 0;
  for (let bIdx = 0; bIdx < built.length; bIdx++) {
    if (bIdx > 0) {
      const prevB = built[bIdx - 1], curB = built[bIdx];
      const targetImg = (prevB.lastGap + curB.firstGap) / 2;
      const dxWorld = (curB.roadLeft + curB.arr[0].x * k) - (prevB.roadLeft + prevB.arr[prevB.count - 1].x * k);
      const dy0World = (prevB.ri.H + curB.arr[0].y - prevB.arr[prevB.count - 1].y) * k;
      const targetWorld = targetImg * k;
      const needDy = Math.sqrt(Math.max(0, targetWorld * targetWorld - dxWorld * dxWorld)) - dy0World;
      const padWorld = Math.max(0, needDy);
      segY += prevB.ri.H * k + padWorld;
    }
    segTops.push(segY);
  }

  const levels = [];
  let globalBtnIdx = 0;
  for (let segIdx = 0; segIdx < built.length; segIdx++) {
    const b = built[segIdx], ri = b.ri, rbtns = b.arr, segTopY = segTops[segIdx];
    const segH = ri.H * k, segW = ri.W * k, roadLeft = (SCREEN_WIDTH - segW) / 2;
    const fromBottom = totalSeg - 1 - segIdx;
    const bgId = fromBottom % 3;
    for (let bi = 0; bi < b.count && globalBtnIdx < N; bi++) {
      const bb = rbtns[bi];
      levels.push({ index: globalBtnIdx, x: roadLeft + bb.x * k, worldY: 0, wy: segTopY + bb.y * k });
      globalBtnIdx++;
    }
  }
  segY = segTops[built.length - 1] + built[built.length - 1].ri.H * k;

  levels.reverse();
  for (let li = 0; li < levels.length; li++) levels[li].index = li;

  // trailing clamp
  const TRAIL = (cfg.trailBottom || 100);
  const minLevelY = Math.min.apply(null, levels.map(l => l.wy));
  const shiftWorld = TRAIL * s - minLevelY;
  for (const l of levels) l.wy += shiftWorld;

  function gap(a, b) { return Math.hypot(levels[a].x - levels[b].x, levels[a].wy - levels[b].wy); }
  const topIdx = N - 1;
  const topTrail = levels[topIdx].wy; // 最顶关卡距内容顶的 worldY = 上方留白
  const gap26_27 = N >= 27 ? gap(25, 26) : NaN;
  const gap39_40 = N >= 40 ? gap(38, 39) : NaN;
  return { N, gap26_27, gap39_40, topTrail, levels };
}

function fmt(v) { return isNaN(v) ? 'n/a' : v.toFixed(1) + 'px'; }
for (const N of [12, 39, 47]) {
  const r = build(N);
  const g1112 = N >= 12 ? r.levels[10] && r.levels[11] ? Math.hypot(r.levels[10].x - r.levels[11].x, r.levels[10].wy - r.levels[11].wy) : NaN : NaN;
  const g2526 = N >= 26 ? Math.hypot(r.levels[24].x - r.levels[25].x, r.levels[24].wy - r.levels[25].wy) : NaN;
  const g4647 = N >= 47 ? Math.hypot(r.levels[45].x - r.levels[46].x, r.levels[45].wy - r.levels[46].wy) : NaN;
  console.log(`N=${r.N} | L11-12=${fmt(g1112)}  L25-26=${fmt(g2526)}  L26-27=${fmt(r.gap26_27)}  L39-40=${fmt(r.gap39_40)}  L46-47=${fmt(g4647)}  | 顶留白=${r.topTrail.toFixed(1)}px`);
}
