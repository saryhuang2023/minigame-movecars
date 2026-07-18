// 工具：将 LevelMapConfig 中已验证在路径上的关卡钮坐标，
// 按「世界间距」等比例放大（默认 50 -> 130，即 2.6x），重新等弧长采样。
// 仅重采样已有折线，不重新识别路径，保证新点仍落在原路径上。
//
// 用法: node tools/resample_road.js [factor]   (factor 默认 130/50=2.6)

const path = require('path');
const cfg = require('../js/define/LevelMapConfig.js');

const factor = parseFloat(process.argv[2]) || (130 / 50);

function resample(points, f) {
  if (points.length < 2) return points.slice();
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    cum.push(cum[i - 1] + Math.hypot(dx, dy));
  }
  const total = cum[cum.length - 1];
  const oldAvg = total / (points.length - 1);
  const step = oldAvg * f;

  const out = [];
  let target = 0;
  let seg = 0;
  while (target <= total + 1e-6) {
    while (seg < points.length - 1 && cum[seg + 1] < target) seg++;
    if (seg >= points.length - 1) break;
    const denom = cum[seg + 1] - cum[seg];
    const t = denom > 0 ? (target - cum[seg]) / denom : 0;
    out.push({
      x: Math.round(points[seg].x + (points[seg + 1].x - points[seg].x) * t),
      y: Math.round(points[seg].y + (points[seg + 1].y - points[seg].y) * t),
    });
    target += step;
  }
  // 强制包含终点
  const last = points[points.length - 1];
  const ol = out[out.length - 1];
  if (!ol || Math.hypot(ol.x - last.x, ol.y - last.y) > step * 0.5) {
    out.push({ x: Math.round(last.x), y: Math.round(last.y) });
  }
  return out;
}

const keys = ['road_0', 'road_1', 'road_2'];
const result = {};
for (const k of keys) {
  const src = cfg.roadButtons[k];
  const r = resample(src, factor);
  result[k] = r;
  console.log(`${k}: ${src.length} -> ${r.length}  (factor ${factor})`);
}

console.log('\n=====JSON=====');
console.log(JSON.stringify(result, null, 2));
