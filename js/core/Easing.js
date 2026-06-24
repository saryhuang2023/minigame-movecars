// 推猪消除 — 缓动函数库
// 所有动画的数学基础，统一复用

/**
 * 线性插值
 */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * 角度插值（处理 360° 回绕）
 */
function lerpAngle(a, b, t) {
  var d = b - a;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return a + d * t;
}

/**
 * Ease-out cubic — 快到慢，适合入场滑入
 */
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Ease-in cubic — 慢到快，适合退场滑出
 */
function easeInCubic(t) {
  return t * t * t;
}

/**
 * Ease-in-out cubic — 起停都缓
 */
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Ease-out back — 轻微回弹，适合"弹入"效果
 * @param {number} t — 0..1
 * @param {number} [amount=1.70158] — 回弹力度，越大越弹
 */
function easeOutBack(t, amount) {
  var c1 = (amount !== undefined ? amount : 1.70158);
  var c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/**
 * Spring 物理弹簧模拟
 * 模拟质量-弹簧-阻尼系统，产生真实的过冲和回弹
 *
 * @param {number} t — 归一化时间（0..4 左右，取决于 damping）
 * @param {number} [stiffness=200] — 弹簧刚度，越大越硬/越快
 * @param {number} [damping=12] — 阻尼系数，越小越弹
 * @returns {number} 0..1+overshoot
 */
function spring(t, stiffness, damping) {
  stiffness = stiffness || 200;
  damping = damping || 12;
  var w0 = Math.sqrt(stiffness);
  var zeta = damping / (2 * w0);

  if (zeta < 1) {
    // 欠阻尼 → 会振荡过冲
    var wd = w0 * Math.sqrt(1 - zeta * zeta);
    var env = Math.exp(-zeta * w0 * t);
    var cos = Math.cos(wd * t);
    var sin = Math.sin(wd * t);
    return 1 - env * (cos + (zeta * w0 / wd) * sin);
  } else {
    // 临界/过阻尼 → 无振荡
    return 1 - Math.exp(-w0 * t / zeta);
  }
}

/**
 * 平滑步进（smoothstep）— 用于颜色/透明度呼吸
 * @param {number} t — 归一化时间
 * @param {number} [edge0=0]
 * @param {number} [edge1=1]
 */
function smoothstep(t, edge0, edge1) {
  edge0 = edge0 || 0;
  edge1 = edge1 || 1;
  var x = Math.max(0, Math.min(1, (t - edge0) / (edge1 - edge0)));
  return x * x * (3 - 2 * x);
}

module.exports = {
  lerp, lerpAngle,
  easeOutCubic, easeInCubic, easeInOutCubic,
  easeOutBack, spring, smoothstep
};
