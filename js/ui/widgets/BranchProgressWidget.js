// 树枝进度条 — 小虫沿不规则弯曲树枝移动表示关卡进度
// BranchProgressWidget：纯展示组件，进度由 PlayingEngine 推猪/结算时驱动
//
// 设计（用户确认 2026-07-15）：
//  - 背景框 image_718 已由 PlayingEngine 绘制于 (10,61,279,85)，本组件只画「轨迹 + 小虫 + 调试曲线」
//  - 路径：9 个控制点（相对框左上，279×85 坐标系）→ Catmull-Rom 加密 → 弧长参数化保证匀速
//  - 进度：分母 = totalScore（测试写死 30），分子 = 已获积分（推猪 +1、结算剩余步数转化 +1）
//  - 小虫：头朝右；静态图（动画未制作，不加 sin 摆动），位置走 lerp 缓动「爬」过去
//  - 越界保护：overflow = max(0, currentScore - totalScore)，每溢出 1 步小虫顺时针 +30°
//  - 已走过的路：绿色轨迹覆盖树枝
//  - 调试：SHOW_DEBUG=true 时画出 Catmull-Rom 曲线 + 控制点（测试期核对路径）

var UIComponent = require('../base/UIComponent.js');
var AssetPreloader = require('../AssetPreloader.js');

// 调试开关（测试期画曲线+控制点核对路径；上线前改 false）
var SHOW_DEBUG = false;

// 控制点（相对框左上角，279×85 坐标系；用户给定）
var CTRL = [
  { x: 19,  y: 26 }, // P1
  { x: 88,  y: 31 }, // P2
  { x: 167, y: 19 }, // P3
  { x: 206, y: 19 }, // P4
  { x: 236, y: 27 }, // P5
  { x: 259, y: 21 }, // P6
  { x: 256, y: 8  }, // P7
  { x: 244, y: 4  }, // P8
  { x: 236, y: 5  }, // P9
];

var WORM_W = 42;
var WORM_H = 23;
var TRAIL_W = 12;             // 绿色轨迹线宽
var OVERFLOW_STEP_DEG = 30;   // 每溢出 1 步顺时针旋转角度
var LERP = 0.15;              // 每帧缓动系数（约 60fps）
var BRANCH_TOP_PAD = 18;      // 树枝图在背景框 image_718 内的顶部留白（PNG 内容区 y≈20），曲线整体下移对齐

function catmullRomPoint(p0, p1, p2, p3, t) {
  var t2 = t * t, t3 = t2 * t;
  var x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t +
    (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
    (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
  var y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t +
    (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
    (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
  return { x: x, y: y };
}

// 把稀疏控制点加密成密集折线（曲线穿过每个控制点）
function buildDense(ctrl, samplesPerSeg) {
  var pts = ctrl;
  var n = pts.length;
  var dense = [];
  for (var i = 0; i < n - 1; i++) {
    var p0 = pts[i - 1] || pts[i];
    var p1 = pts[i];
    var p2 = pts[i + 1];
    var p3 = pts[i + 2] || p2;
    for (var j = 0; j < samplesPerSeg; j++) {
      var t = j / samplesPerSeg;
      dense.push(catmullRomPoint(p0, p1, p2, p3, t));
    }
  }
  dense.push({ x: pts[n - 1].x, y: pts[n - 1].y });
  return dense;
}

// 弧长表：cum[i] = 从起点到第 i 个密集点的累计长度；total = 曲线总长
function buildArc(dense) {
  var cum = [0];
  var total = 0;
  for (var i = 1; i < dense.length; i++) {
    var dx = dense[i].x - dense[i - 1].x;
    var dy = dense[i].y - dense[i - 1].y;
    total += Math.sqrt(dx * dx + dy * dy);
    cum.push(total);
  }
  return { cum: cum, total: total };
}

class BranchProgressWidget extends UIComponent {
  constructor(opts) {
    super({
      x: opts.x || 10,
      y: opts.y || 61,
      w: opts.w || 279,
      h: opts.h || 85,
      zIndex: opts.zIndex || 3,
    });

    this._dense = buildDense(CTRL, 12);
    this._arc = buildArc(this._dense);

    this._displayed = 0;         // 当前显示进度 0..1（lerp 逼近 _progress）
    this._progress = 0;          // 目标进度 0..1
    this._targetRotation = 0;    // 目标溢出旋转（弧度）
    this._displayedRotation = 0; // 当前显示旋转（lerp 逼近）
    this._overflow = 0;          // 当前溢出步数
    this._lastUpdate = 0;
  }

  /** 设置进度（由 PlayingEngine 推猪/结算时调用）
   * @param {number} current 当前积分（分子）
   * @param {number} total 总积分（分母）
   */
  setScore(current, total) {
    total = total || 1;
    var t = current / total;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    this._progress = t;
    this._overflow = Math.max(0, current - total);
    this._targetRotation = this._overflow * OVERFLOW_STEP_DEG * Math.PI / 180;
  }

  /** 返回小虫当前屏幕坐标（供飞行动画定位落点） */
  getWormScreenPos() {
    var pos = this._pointAt(this._displayed);
    return { x: this.x + pos.x, y: this.y + BRANCH_TOP_PAD + pos.y };
  }

  /** 二分 + 段内插值：给定进度 t(0..1) 返回曲线上点 { x, y, angle }（相对框） */
  _pointAt(t) {
    if (t <= 0) return { x: this._dense[0].x, y: this._dense[0].y, angle: 0 };
    var last = this._dense.length - 1;
    if (t >= 1) {
      var a = this._dense[last - 1], b = this._dense[last];
      return { x: b.x, y: b.y, angle: Math.atan2(b.y - a.y, b.x - a.x) };
    }
    var target = t * this._arc.total;
    var cum = this._arc.cum;
    var lo = 1, hi = cum.length - 1;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (cum[mid] < target) lo = mid + 1; else hi = mid;
    }
    var i = lo;
    var segLen = cum[i] - cum[i - 1];
    var localT = segLen > 0 ? (target - cum[i - 1]) / segLen : 0;
    var pa = this._dense[i - 1], pb = this._dense[i];
    var x = pa.x + (pb.x - pa.x) * localT;
    var y = pa.y + (pb.y - pa.y) * localT;
    var angle = Math.atan2(pb.y - pa.y, pb.x - pa.x);
    return { x: x, y: y, angle: angle };
  }

  update() {
    var now = Date.now();
    var dt = this._lastUpdate ? (now - this._lastUpdate) : 16;
    this._lastUpdate = now;
    // 帧率归一化的缓动系数
    var k = 1 - Math.pow(1 - LERP, dt / 16.67);
    if (k > 1) k = 1;
    if (k < 0) k = 0;
    this._displayed += (this._progress - this._displayed) * k;
    this._displayedRotation += (this._targetRotation - this._displayedRotation) * k;
    if (Math.abs(this._progress - this._displayed) < 0.0005) this._displayed = this._progress;
    if (Math.abs(this._targetRotation - this._displayedRotation) < 0.0005) this._displayedRotation = this._targetRotation;
  }

  render(ctx) {
    // 一次性诊断：确认本组件渲染管线已接入，并报告虫图资源就绪状态
    if (!this._diagDone) {
      this._diagDone = true;
      console.log('[BranchProgress] render 已接入 | level_worm就绪=' + AssetPreloader.isReady('level_worm') +
        ' | 初始进度=' + this._progress.toFixed(3) +
      ' | 虫图=' + (AssetPreloader.isReady('level_worm') ? 'OK' : '兜底自绘'));
    }
    // 整体下移 BRANCH_TOP_PAD，使虫路径对齐背景框内实际树枝图（树枝图内容区顶部留白≈18px）
    var ox = this.x, oy = this.y + BRANCH_TOP_PAD;
    // 轨迹与调试曲线不依赖虫图，始终绘制（便于在虫图缺失时仍能确认功能在跑）
    if (SHOW_DEBUG) this._renderDebug(ctx, ox, oy);
    this._renderTrail(ctx, ox, oy);
    this._renderWorm(ctx, ox, oy);
  }

  _renderDebug(ctx, ox, oy) {
    // Catmull-Rom 加密曲线（半透明青线）
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 200, 255, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(ox + this._dense[0].x, oy + this._dense[0].y);
    for (var i = 1; i < this._dense.length; i++) {
      ctx.lineTo(ox + this._dense[i].x, oy + this._dense[i].y);
    }
    ctx.stroke();
    // 控制点小圆
    ctx.fillStyle = 'rgba(255, 80, 80, 0.9)';
    for (var j = 0; j < CTRL.length; j++) {
      ctx.beginPath();
      ctx.arc(ox + CTRL[j].x, oy + CTRL[j].y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _renderTrail(ctx, ox, oy) {
    // 已走过的路：绿色轨迹（从起点到当前 worm 位置）
    var target = this._displayed * this._arc.total;
    var cum = this._arc.cum;
    ctx.save();
    ctx.strokeStyle = 'rgba(120, 200, 90, 0.9)';
    ctx.lineWidth = TRAIL_W;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(ox + this._dense[0].x, oy + this._dense[0].y);
    for (var i = 1; i < this._dense.length; i++) {
      if (cum[i] > target) {
        // 段内插值到精确位置
        var segLen = cum[i] - cum[i - 1];
        var localT = segLen > 0 ? (target - cum[i - 1]) / segLen : 0;
        var x = this._dense[i - 1].x + (this._dense[i].x - this._dense[i - 1].x) * localT;
        var y = this._dense[i - 1].y + (this._dense[i].y - this._dense[i - 1].y) * localT;
        ctx.lineTo(ox + x, oy + y);
        break;
      }
      ctx.lineTo(ox + this._dense[i].x, oy + this._dense[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  _renderWorm(ctx, ox, oy) {
    var pos = this._pointAt(this._displayed);
    var wx = ox + pos.x;
    var wy = oy + pos.y;
    var finalAngle = pos.angle + this._displayedRotation;
    ctx.save();
    ctx.translate(wx, wy);
    ctx.rotate(finalAngle);
    // 头朝右；朝左时上下翻转保持正立（叠加溢出旋转后近似判断）
    if (Math.cos(finalAngle) < 0) ctx.scale(1, -1);
    var img = AssetPreloader.get('level_worm');
    if (img) {
      ctx.drawImage(img, -WORM_W / 2, -WORM_H / 2, WORM_W, WORM_H);
    } else {
      // 虫图未注入（多为微信开发者工具未重新打包新增图片所致）→ 兜底自绘占位虫，确保功能可见
      this._drawFallbackWorm(ctx);
    }
    ctx.restore();
  }

  // 占位虫：虫图缺失时的兜底自绘（绿色椭圆身 + 头朝右 + 眼睛），尺寸对齐 WORM_W×WORM_H
  _drawFallbackWorm(ctx) {
    var bw = WORM_W, bh = WORM_H;
    // 身体椭圆
    ctx.fillStyle = '#7ac943';
    ctx.strokeStyle = 'rgba(40, 90, 20, 0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, bw / 2, bh / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // 头（右侧稍大圆）
    ctx.fillStyle = '#9be05a';
    ctx.beginPath();
    ctx.arc(bw / 2 - 5, 0, bh / 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // 眼睛
    ctx.fillStyle = '#222222';
    ctx.beginPath();
    ctx.arc(bw / 2 - 3, -3, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

module.exports = BranchProgressWidget;
