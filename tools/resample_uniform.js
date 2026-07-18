// 工具：把每条路径的钮坐标按「等弧长」重新均匀分布（保持点数不变），
// 使得段内相邻钮间距一致（修复 L26-L27 之类段内过近）。
// 仅重采样已有折线，不重新识别路径，保证新点落在原路径上。

const path = require('path');
const cfg = require('../js/define/LevelMapConfig.js');

// 等弧长重采样：保持首末点，中间点按弧长均匀插入，点数 = points.length
function uniformResample(points) {
  if (points.length < 2) return points.slice();
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  const total = cum[cum.length - 1];
  const n = points.length;
  const step = total / (n - 1);
  const out = [points[0]];
  let seg = 0;
  for (let t = 1; t < n - 1; t++) {
    const target = t * step;
    while (seg < points.length - 1 && cum[seg + 1] < target) seg++;
    if (seg >= points.length - 1) seg = points.length - 2;
    const denom = cum[seg + 1] - cum[seg] || 1;
    const f = (target - cum[seg]) / denom;
    out.push({
      x: Math.round(points[seg].x + (points[seg + 1].x - points[seg].x) * f),
      y: Math.round(points[seg].y + (points[seg + 1].y - points[seg].y) * f),
    });
  }
  out.push(points[points.length - 1]);
  return out;
}

const keys = ['road_0', 'road_1', 'road_2'];
const result = {};
for (const k of keys) {
  const src = cfg.roadButtons[k];
  const r = uniformResample(src);
  result[k] = r;
  // 校验：相邻 2D 间距（图像 px）
  const gaps = [];
  for (let i = 1; i < r.length; i++) gaps.push(Math.hypot(r[i].x - r[i-1].x, r[i].y - r[i-1].y));
  const min = Math.min(...gaps), max = Math.max(...gaps);
  console.log(`${k}: ${src.length} -> ${r.length}  段内间距[图像px] min=${min.toFixed(0)} max=${max.toFixed(0)} (均匀化)`);
}

console.log('\n=====JSON=====');
console.log(JSON.stringify(result, null, 2));
