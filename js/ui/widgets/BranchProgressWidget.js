// 树枝进度条 — 小虫沿不规则弯曲树枝移动表示关卡进度
// BranchProgressWidget：纯展示组件，进度由 PlayingEngine 推猪/结算时驱动
//
// 设计（用户确认 2026-07-15）：
//  - 背景框 image_718 已由 PlayingEngine 绘制于 (10,61,279,85)，本组件只画「轨迹 + 小虫 + 调试曲线 + 花朵」
//  - 路径：9 个控制点（相对框左上，279×85 坐标系）→ Catmull-Rom 加密 → 弧长参数化保证匀速
//  - 进度：分母 = 4 星积分门槛（starScores[3]），分子 = 已获积分（推猪 +1、结算剩余步数转化 +2）
//  - 小虫：头朝右；静态图（动画未制作，不加 sin 摆动），位置走 lerp 缓动「爬」过去
//  - 越界（积分超上限）：小虫已到终点、不再前进，也不旋转；保持终点姿态（无"到顶后打转"）
//  - 已走过的路：用 image_719（与 image_718 同尺寸同轨迹的「已走过」配色图）沿树枝路径做进度揭示（替代旧半透明绿线染色方案）
//  - 花朵：树枝上按 积分档位(s1..s4)/4星分 的位置放 1~4 朵花；积分跨档即「弹性绽放」获得动画；
//          4 星（彩色）特效（魔法棒施法，2026-07-15）：4 星花一开始就是大彩花；到顶后 4 星旋转 500ms、
//          旋转到 200ms 时甩出花瓣粒子簇（魔法感）飞向 3 星，3 星旋转 200ms 同时覆彩色；
//          逐朵（3→2→1）施法，三朵全彩后结束并弹出结算面板。
//  - 调试：SHOW_DEBUG=true 时画出 Catmull-Rom 曲线 + 控制点（测试期核对路径）

var UIComponent = require('../base/UIComponent.js');
var AssetPreloader = require('../AssetPreloader.js');
var StarScores = require('../../utils/starScores.js');

// 离屏画布（复用，避免每帧创建）：用于「沿路径揭示 image_719」的遮罩合成
var _revealCanvas = null;
var _revealCtx = null;
function _getRevealCtx() {
  if (!_revealCtx) {
    _revealCanvas = wx.createCanvas();
    _revealCanvas.width = 279;
    _revealCanvas.height = 44;
    _revealCtx = _revealCanvas.getContext('2d');
  }
  return _revealCtx;
}

// 调试开关（测试期画曲线+控制点核对路径；上线前改 false）
var SHOW_DEBUG = false;

// 控制点（相对框左上角，279×85 坐标系；用户给定）
var CTRL = [
  { x: 22,  y: 28 }, // P1（设计稿 Point01：left:22 top:28）
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
var WORM_HEAD_AHEAD = 7;      // 头部锚点相对「路径点」的前冲量（px）：头部边缘中心位于路径点前方 7px（虫头微微探出进度点）
var TRAIL_W = 12;             // 绿色轨迹线宽（仅作 image_719 未就绪时的兜底）
var REVEAL_W = 46;            // 已走过路径「揭示遮罩」描边宽度（>图高44，确保覆盖整条树枝厚度；719 仅树枝处有像素，过宽不溢出）
var LERP = 0.15;              // 每帧缓动系数（约 60fps）
var BRANCH_TOP_PAD = 0;       // 曲线纵向偏移：控件原点 this.y 已对齐新图顶(78)，控制点按 279×44 框标（y∈[4,31]），故归零=直接贴合图内容。若真机看曲线偏离树枝，按像素差调此值（负=上移，正=下移，1:1）。
var FLOWER_POP_MS = 750;      // 花朵获得动画时长（蓄力 → 弹性绽放 → 回弹）— 放慢让「绽放」看得清
var FLOWER_BURST_MS = 650;     // 获得瞬间光环 + 星点爆发持续
var FLOWER_ANCHOR = 0;         // 花朵锚点比例：0 = 花朵「中心点」直接对齐路径点（虫头撞到的是花中心）
// ===== 4 星「魔法棒施法」序列（用户 2026-07-15 指定）=====
var FOUR_ROT_MS = 300;        // 4 星花旋转施法时长
var FOUR_LAUNCH_AT = 0;     // 旋转进行到该时刻甩出花瓣粒子簇
var PETAL_FLY_MS = 800;       // 花瓣粒子飞向目标花的时长
var PETAL_COUNT = 8;          // 每簇花瓣粒子数
var TARGET_COLOR_MS = 200;    // 目标花「旋转 + 覆彩色」时长
var FOUR_CAST_TARGETS = [2, 1, 0]; // 施法顺序：先 3 星、再 2 星、再 1 星，逐一覆彩色
var FOUR_CAST_DELAYS = [400, 600, 800]; // ★每朵花的施法「开始延迟」(ms，相对 4 星特效起点)。与 FOUR_CAST_TARGETS 一一对应：第 0 项=先施法的花、第 1 项=其次……独立计时，不再串行等前一朵播完。改这里即可控制每朵开始时间（[0,0,0]=三朵同时开）。
var FOUR_TAIL_MS = 120;       // 序列结束后到结算面板弹出的缓冲（防被遮罩盖住）

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

// 花朵获得动画曲线：蓄力(花苞微缩) → 弹性绽放(花瓣散开 + 旋转 overshoot) → 回弹(settle)
// 返回 { scale, rot, bloom }；bloom 控制花瓣聚拢(0)→散开(1)，让「获得」像真花开放而非橡皮缩放。
function flowerPop(pd) {
  var c1 = 1.70158, c3 = c1 + 1;
  if (pd < 0.16) {
    // 蓄力：轻微缩成花苞，聚拢花瓣
    var a = pd / 0.16;
    return { scale: 0.55 + 0.27 * a, rot: 0, bloom: 0.28 + 0.20 * a };
  } else if (pd < 0.62) {
    // 弹出：easeOutBack 弹过 1 再回（含一次 overshoot），花瓣散开、旋转约 324°
    var b = (pd - 0.16) / 0.46;
    var e = 1 + c3 * Math.pow(b - 1, 3) + c1 * Math.pow(b - 1, 2);
    return { scale: 0.82 + 0.34 * e, rot: Math.PI * 2 * e, bloom: Math.min(1, 0.48 + 0.52 * e) };
  }
  // 回弹：1.16 → 1（sin 缓回），锁定全开
  var c = (pd - 0.62) / 0.38;
  var sc = 1.16 + (1 - 1.16) * Math.sin(c * Math.PI / 2);
  return { scale: sc, rot: Math.PI * 2, bloom: 1 };
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
    this._lastUpdate = 0;

    // ===== 星级花朵 =====
    this._starScores = [0, 0, 0, 0]; // [s1,s2,s3,s4]
    this._starReady = false;         // 本关 starScores 是否已就绪（防止 _resetPlayState 误触发花朵）
    this._currentTier = 0;           // 已达成最高星级（0~4）
    this._flowers = this._makeFlowers();
    this._preplacedVisible = true;   // 4 朵小花从进关即常驻树枝（用户确认：关卡一开始就有，随进度原地长大），非结算专属
    this._petals = [];               // 4 星施法甩出的花瓣粒子簇
    this._stepFlowers = [];          // 步数→飞小花 粒子簇（从步数框飞向 4 星花）
    this._fourCasts = null;          // 4 星施法：每朵花独立的施法记录（含各自 startAt），取代串行状态机
    this._fourSpinStart = 0;         // 4 星源花最近一次甩花瓣的旋转起点时间戳（重叠施法时各自触发）
    this._fourStarActive = false;
    this._fourStarStart = 0;         // 4 星特效起始时间（用于判断结算面板是否延后弹出）
    this._fourStarTotalMs = 0;       // 4 星特效总时长（按每朵 startAt 取最大推算），_triggerFourStar 时计算
    this._castFlash = 0;             // 4 星施法瞬间的高光环（魔法感）
  }

  _makeFlowers() {
    var arr = [];
    for (var i = 0; i < 4; i++) {
      // i===3（4 星花）为「施法源花」：进关即覆彩 + 大尺寸（25），作为魔法棒施法起点，
      // 不是虫子到达后才变彩。其余 3 朵为普通花，跨档时原地长大（黄→经施法覆彩）。
      var isFour = (i === 3);
      arr.push({
        obtained: isFour,    // 4 星花从进关即视为已长出（直接大彩花呈现，不再等跨档）
        popStart: 0,         // 获得/放大动画起始时间（0=已完成/静止）
        popKind: 'normal',   // 'normal' | 'fourstar'（4 星接棒放大）
        colored: isFour,     // 是否覆彩色（4 星：进关即彩）
        finalSize: 25, // 大花尺寸统一 25（普通花与 4 星花一致）
      });
    }
    return arr;
  }

  /** 设置本关星级门槛（由 PlayingEngine.loadLevel 调用） */
  setStarScores(arr) {
    this._starScores = (arr && arr.length === 4) ? arr.slice() : [0, 0, 0, 0];
    this._starReady = true;
    this._currentTier = 0;
    this._flowers = this._makeFlowers();
    this._petals = [];
    this._stepFlowers = [];
    this._fourCasts = null;
    this._fourSpinStart = 0;
    this._fourStarActive = false;
    this._fourStarStart = 0;
    this._castFlash = 0;
    this._preplacedVisible = true;   // 常驻：进关即显示 4 朵小花朵（结算时未达成的也以小花形态在树枝上，原地长大）
  }

  /** 步数→飞小花：从步数框(fromX,fromY)飞出一「小堆」彩虹小花，沿弧线飞向 4 星花朵位置（纯视觉，不新增金币） */
  spawnStepFlowers(count, fromX, fromY) {
    var target = this._flowerCenter(3);
    var now = Date.now();
    var dx = target.x - fromX, dy = target.y - fromY;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var px = -dy / len, py = dx / len; // 垂直方向（用于弧线甩出）
    var n = Math.max(1, Math.min(count || 0, 12)); // 一小堆：上限 12 朵，避免过多
    for (var k = 0; k < n; k++) {
      // 起点在步数框附近做小散布，形成「一小堆」飞出感
      var spread = 12;
      var sx = fromX + (Math.random() * 2 - 1) * spread;
      var sy = fromY + (Math.random() * 2 - 1) * spread;
      var f = (k + 1) / (n + 1);
      var bow = (18 + Math.random() * 26) * (k % 2 === 0 ? 1 : -1); // 弧线弯曲方向交替
      this._stepFlowers.push({
        fromX: sx, fromY: sy,
        toX: target.x, toY: target.y,
        cx: sx + (target.x - sx) * f + px * bow,
        cy: sy + (target.y - sy) * f + py * bow,
        start: now + Math.random() * 60,
        dur: 520 + Math.random() * 180,
        rot: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() * 2 - 1) * 6,
        size: (9 + Math.random() * 5) * (2 / 3),   // 飞小花尺寸（原 9~14，×2/3 减 1/3 → 6~9.3；光晕随 p.size 等比缩）
      });
    }
  }

  /** 步数→飞小花是否仍在播放（结算面板据此延后弹出，避免遮住飞行中的小花） */
  isStepFlowersAnimating() {
    return this._stepFlowers.length > 0;
  }

  /** 设置进度（由 PlayingEngine 推猪/结算时调用）
   * @param {number} current 当前积分（分子）
   * @param {number} total 总积分（分母 = 4 星门槛）
   */
  setScore(current, total) {
    total = total || 1;
    var t = current / total;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    this._progress = t;
    // 星级跨档检测：实时触发花朵获得动画 / 4 星流星特效
    if (this._starReady) {
      var newTier = StarScores.getStarTier(current, this._starScores);
      if (newTier > this._currentTier) {
        for (var i = this._currentTier; i < newTier; i++) {
          if (this._flowers[i] && !this._flowers[i].obtained) {
            this._flowers[i].obtained = true;
            this._flowers[i].popStart = Date.now();
            this._flowers[i].popKind = 'normal';
            this._flowers[i].finalSize = 25;
            this._flowers[i].colored = (i === 3); // 注意：4 星花(colored)已在 _makeFlowers 初始化，此处对 i===3 因 !obtained 会被跳过
          }
        }
        this._currentTier = newTier;
        if (newTier >= 4 && !this._fourStarActive) {
          this._triggerFourStar();
        }
      }
    }
  }

  /** 断点续玩恢复：直接呈现「已逃出 N 头猪」对应的小虫位置与已获得花朵，不播任何动画。
   *  小虫直接停在目标处、花朵静态常驻（与「进入关卡直接展示结果」一致）。
   *  @param {number} current 已获积分（恢复时 = 已逃出猪数 escapedCount）
   *  @param {number} total   总积分（= 4 星门槛 totalScore） */
  showResultImmediate(current, total) {
    total = total || 1;
    var t = current / total;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    this._progress = t;
    this._displayed = t;                 // 直接到位，不缓动
    if (this._starReady) {
      var tier = StarScores.getStarTier(current, this._starScores);
      this._currentTier = tier;
      for (var i = 0; i < tier && i < this._flowers.length; i++) {
        if (this._flowers[i] && !this._flowers[i].obtained) {
          this._flowers[i].obtained = true;
          this._flowers[i].popStart = 0; // 静态，不播放获得动画
          this._flowers[i].popKind = 'normal';
          this._flowers[i].finalSize = 25;
          this._flowers[i].colored = (i === 3);
        }
      }
      // 中途恢复不会到 4 星（需结算剩余步数转化），故不触发 4 星施法特效
    }
  }

  /** 4 星（彩色星）特效是否仍在播放（结算面板据此延后弹出，避免被遮罩盖住看不到） */
  isFourStarAnimating() {
    if (!this._fourStarActive) return false;
    return (Date.now() - this._fourStarStart) < this._fourStarTotalMs;
  }

  /** 4 星特效剩余播放时长（ms），用于结算面板精确延后 */
  getFourStarRemainMs() {
    if (!this._fourStarActive) return 0;
    var remain = this._fourStarTotalMs - (Date.now() - this._fourStarStart);
    return remain > 0 ? remain : 0;
  }

  /** 花朵 i 的「绘制中心」屏幕坐标（含底部中心锚点上移），用于施法粒子起止点对齐 */
  _flowerCenter(i) {
    var frac = this._starFrac(i);
    var pos = this._pointAt(frac);
    var size = (this._flowers[i] && this._flowers[i].finalSize) ? this._flowers[i].finalSize : 25;
    var anchorUp = FLOWER_ANCHOR * size;
    return { x: this.x + pos.x, y: this.y + BRANCH_TOP_PAD + pos.y - anchorUp };
  }

  // 花朵 i 在树枝上的进度比例：s_i / 4星分（4 星固定终点）
  _starFrac(i) {
    if (i >= 3) return 1;
    var denom = this._starScores[3] || 1;
    if (denom <= 0) return (i + 1) / 4;
    return Math.min(1, this._starScores[i] / denom);
  }

  _triggerFourStar() {
    this._fourStarActive = true;
    this._fourStarStart = Date.now();
    // 每朵花独立的施法记录：各自带 startAt（相对特效起点的延迟），互不等候 → 彻底摆脱「串行等前一朵」。
    this._fourCasts = FOUR_CAST_TARGETS.map(function (t, i) {
      var d = (FOUR_CAST_DELAYS && FOUR_CAST_DELAYS[i] != null) ? FOUR_CAST_DELAYS[i] : 0;
      return { target: t, startAt: d, launched: false, colored: false, launchStart: 0 };
    });
    // 总时长 = 所有花里「startAt + 旋转甩出(FOUR_LAUNCH_AT) + 飞行(PETAL_FLY_MS) + 覆彩(TARGET_COLOR_MS)」的最大值，再加尾部缓冲。
    // 不再用「数量 × 单朵周期」，因为各花并行、重叠。
    var maxEnd = 0;
    for (var i = 0; i < this._fourCasts.length; i++) {
      var end = this._fourCasts[i].startAt + FOUR_LAUNCH_AT + PETAL_FLY_MS + TARGET_COLOR_MS;
      if (end > maxEnd) maxEnd = end;
    }
    this._fourStarTotalMs = maxEnd + FOUR_TAIL_MS;
  }

  /** 从 4 星花甩出一簇花瓣粒子（魔法感）飞向目标花 */
  _launchPetalBurst(targetIdx) {
    var origin = this._flowerCenter(3);
    var target = this._flowerCenter(targetIdx);
    var now = Date.now();
    var dx = target.x - origin.x, dy = target.y - origin.y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var px = -dy / len, py = dx / len; // 垂直方向（用于甩出弧线）
    var colors = ['#FF5C8A', '#FFB13D', '#5CCBFF', '#9B6CFF', '#7CF2C0', '#FFE14D'];
    for (var k = 0; k < PETAL_COUNT; k++) {
      var f = (k + 1) / (PETAL_COUNT + 1);
      // 控制点：沿连线在中段、朝垂直方向甩出一小段弧，形成「撒出去」的魔法轨迹
      var bow = (12 + Math.random() * 22) * (k % 2 === 0 ? 1 : -1);
      this._petals.push({
        fromX: origin.x, fromY: origin.y,
        toX: target.x, toY: target.y,
        cx: origin.x + dx * f + px * bow,
        cy: origin.y + dy * f + py * bow,
        start: now + Math.random() * 40,
        dur: PETAL_FLY_MS - 40 + Math.random() * 80,
        rot: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() * 2 - 1) * 8,
        size: 5 + Math.random() * 4,
        color: colors[k % colors.length],
      });
    }
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
    if (Math.abs(this._progress - this._displayed) < 0.0005) this._displayed = this._progress;

    // 花朵获得/放大动画收尾（popStart 置 0 表示静止）
    for (var fi = 0; fi < this._flowers.length; fi++) {
      var f = this._flowers[fi];
      if (f.obtained && f.popStart) {
        if ((now - f.popStart) / FLOWER_POP_MS >= 1) f.popStart = 0;
      }
    }
    // 4 星「魔法棒施法」：每朵花按各自 startAt 独立计时，互不等待（并行/重叠均可）。
    // 单朵时间轴（相对其 startAt）：[0, FOUR_LAUNCH_AT) 旋转蓄力 → 第 FOUR_LAUNCH_AT 甩花瓣 →
    // [FOUR_LAUNCH_AT, FOUR_LAUNCH_AT+PETAL_FLY_MS) 花瓣飞行 → 到期目标花旋转覆彩 → +TARGET_COLOR_MS 该朵结束。
    if (this._fourStarActive && this._fourCasts) {
      var base = this._fourStarStart;
      var allDone = true;
      for (var ci = 0; ci < this._fourCasts.length; ci++) {
        var c = this._fourCasts[ci];
        var e = now - base - c.startAt;   // 该朵自己的已流逝时间（<0 表示还没到它开始）
        if (e < 0) { allDone = false; continue; }
        if (!c.launched && e >= FOUR_LAUNCH_AT) {
          c.launched = true;
          c.launchStart = now;
          this._castFlash = now;
          this._fourSpinStart = now;      // 4 星源花旋转（重叠施法时各自重置，连续转）
          this._launchPetalBurst(c.target);
        }
        if (!c.colored && e >= (FOUR_LAUNCH_AT + PETAL_FLY_MS)) {
          c.colored = true;
          var ctf = this._flowers[c.target];
          if (ctf) { ctf.colored = true; ctf.finalSize = 25; ctf.popStart = now; ctf.popKind = 'fourstar'; }
        }
        // 该朵是否彻底结束：覆彩 + TARGET_COLOR_MS 已走完
        if (e < (FOUR_LAUNCH_AT + PETAL_FLY_MS + TARGET_COLOR_MS)) allDone = false;
      }
      if (allDone) this._fourStarActive = false; // 所有花全彩且各自动画结束 → 结算面板可弹出
    }
    // 花瓣粒子：到达（已完成飞行）即淘汰
    for (var pi = this._petals.length - 1; pi >= 0; pi--) {
      if ((now - this._petals[pi].start) / this._petals[pi].dur >= 1) this._petals.splice(pi, 1);
    }
    // 步数→飞小花：到达（已完成飞行）即淘汰
    for (var sfi = this._stepFlowers.length - 1; sfi >= 0; sfi--) {
      if ((now - this._stepFlowers[sfi].start) / this._stepFlowers[sfi].dur >= 1) this._stepFlowers.splice(sfi, 1);
    }
  }

  /**
   * 树枝底层（绿色已走过揭示 + 调试曲线）：绘制于装饰树叶「之下」。
   * 绿色进度条属于树枝皮肤的一部分，本应被前景草丛(树叶)压住。
   */
  renderBranchLayer(ctx) {
    // 一次性诊断：确认本组件渲染管线已接入，并报告虫图资源就绪状态
    if (!this._diagDone) {
      this._diagDone = true;
      console.log('[BranchProgress] render 已接入 | level_worm就绪=' + AssetPreloader.isReady('level_worm') +
        ' | big_flower就绪=' + AssetPreloader.isReady('big_flower') +
        ' | 初始进度=' + this._progress.toFixed(3) +
      ' | 虫图=' + (AssetPreloader.isReady('level_worm') ? 'OK' : '兜底自绘'));
    }
    // 整体下移 BRANCH_TOP_PAD，使虫路径对齐背景框内实际树枝图；控件原点 this.y 已对齐新图顶(78)，控制点按新图框标 → pad=0 直接贴合
    var ox = this.x, oy = this.y + BRANCH_TOP_PAD;
    // 轨迹与调试曲线不依赖虫图，始终绘制（便于在虫图缺失时仍能确认功能在跑）
    if (SHOW_DEBUG) this._renderDebug(ctx, ox, oy);
    // 已走过的路：优先用 image_719 沿路径揭示（进度条感）；719 未注入时兜底旧绿线
    if (AssetPreloader.isReady('bg_deco_719')) {
      this._renderReveal(ctx, ox, oy);
    } else {
      this._renderTrail(ctx, ox, oy);
    }
  }

  /**
   * 树枝上层（小虫 + 花朵 + 粒子 + 施法高光）：绘制于装饰树叶「之上」。
   * 小虫与星级花是爬在树枝上的「主体」，必须压在前景草丛之上，避免被树叶遮挡。
   */
  renderUILayer(ctx) {
    var ox = this.x, oy = this.y + BRANCH_TOP_PAD;
    this._renderFlowers(ctx, ox, oy);
    this._renderWorm(ctx, ox, oy);
    if (this._petals.length) this._renderPetals(ctx);
    this._renderCastFlash(ctx);
  }

  render(ctx) {
    this.renderBranchLayer(ctx);
    this.renderUILayer(ctx);
  }

  /**
   * 步数→飞小花「独立最高层」渲染：本方法只画从右上角步数牌中心飞出的彩虹小花，
   * 由 PlayingEngine 在步数牌/顶栏/金币之后调用，确保飞花盖过右上角步数牌
   * （PlayingEngine.render 为手写按行序绘制，UIManager 的 zIndex 不生效，故需独立层）。
   * 其它粒子（4 星花瓣/施法高光）位置均在进度条范围内、不溢出步数牌，仍走基础层 render()。
   */
  renderStepFlowersLayer(ctx) {
    if (this._stepFlowers.length) this._renderStepFlowers(ctx);
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
    ctx.strokeStyle = 'rgba(120, 200, 90, 0.4)';
    ctx.lineWidth = TRAIL_W;
    ctx.lineCap = 'butt';   // 与 reveal 遮罩一致：避免 round 端点多探出半线宽
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

  /**
   * 已走过的路：用 image_719（与 image_718 同尺寸同轨迹的「已走过」配色图）沿树枝路径做进度揭示。
   * 实现：离屏画布上用「粗描边路径」作为遮罩，再 source-in 只保留 719 落在遮罩内的像素，最后贴回主画布。
   * 经过的部分显示 719（已走过配色），未经过的部分透出底层 image_718（原树枝），形成进度条感。
   */
  _renderReveal(ctx, ox, oy) {
    if (this._displayed <= 0.0005) return;   // 进度为 0 时不揭示，避免起点出现静态色块
    var octx = _getRevealCtx();
    if (!octx) return;
    octx.clearRect(0, 0, 279, 44);
    // 1) 遮罩：从起点到当前进度点，沿中心线的粗描边（round 端点/转弯，保证平滑）
    octx.save();
    octx.beginPath();
    var dense = this._dense, cum = this._arc.cum, total = this._arc.total;
    var target = this._displayed * total;
    octx.moveTo(dense[0].x, dense[0].y);
    for (var i = 1; i < dense.length; i++) {
      if (cum[i] > target) {
        var segLen = cum[i] - cum[i - 1];
        var localT = segLen > 0 ? (target - cum[i - 1]) / segLen : 0;
        var x = dense[i - 1].x + (dense[i].x - dense[i - 1].x) * localT;
        var y = dense[i - 1].y + (dense[i].y - dense[i - 1].y) * localT;
        octx.lineTo(x, y);
        break;
      }
      octx.lineTo(dense[i].x, dense[i].y);
    }
    octx.lineWidth = REVEAL_W;
    // butt 端点：避免 round 端点沿路径多出 lineWidth/2(=23px) 的半圆，导致绿色遮罩探到虫头前方
    octx.lineCap = 'butt';
    octx.lineJoin = 'round';
    octx.strokeStyle = '#ffffff';
    octx.stroke();
    octx.restore();
    // 2) 仅保留 719 与遮罩重叠的像素（= 经过部分的树枝配色）
    octx.globalCompositeOperation = 'source-in';
    var img = AssetPreloader.get('bg_deco_719');
    if (img) octx.drawImage(img, 0, 0, 279, 44);
    octx.globalCompositeOperation = 'source-over';
    // 3) 贴回主画布（与 image_718 绘制位置/尺寸一致：10,78,279,44）
    ctx.drawImage(_revealCanvas, ox, oy);
  }

  _renderWorm(ctx, ox, oy) {
    var pos = this._pointAt(this._displayed);
    var wx = ox + pos.x;
    var wy = oy + pos.y;
    var finalAngle = pos.angle;
    ctx.save();
    ctx.translate(wx, wy);
    ctx.rotate(finalAngle);
    // 头朝右；朝左时上下翻转保持正立
    if (Math.cos(finalAngle) < 0) ctx.scale(1, -1);
    // 头部锚点：把虫子的「头部边缘中心」定位在路径点前方 WORM_HEAD_AHEAD px（虫头微微探出进度点，而非身体中心），
    // 这样「头部到达之处即进度、头部撞到小花时小花才长大」，更真实。
    ctx.translate(-WORM_W / 2 + WORM_HEAD_AHEAD, 0);
    var img = AssetPreloader.get('level_worm');
    if (img) {
      ctx.drawImage(img, -WORM_W / 2, -WORM_H / 2, WORM_W, WORM_H);
    } else {
      // 虫图未注入（多为微信开发者工具未重新打包新增图片所致）→ 兜底自绘占位虫，确保功能可见
      this._drawFallbackWorm(ctx);
    }
    ctx.restore();
  }

  // 4 朵星级花（含 4 星施法特效）
  _renderFlowers(ctx, ox, oy) {
    var now = Date.now();
    // 4 星源花在「甩花瓣」瞬间旋转一圈（魔法棒挥舞感）；重叠施法时每次甩出都会重新触发，连续旋转
    var fourRot = 0;
    if (this._fourSpinStart) {
      var fe = (now - this._fourSpinStart) / FOUR_ROT_MS;
      if (fe >= 1) {
        this._fourSpinStart = 0;
      } else {
        if (fe < 0) fe = 0;
        var ef = fe < 0.5 ? 2 * fe * fe : 1 - Math.pow(-2 * fe + 2, 2) / 2; // easeInOut
        fourRot = ef * Math.PI * 2;
      }
    }
    for (var i = 0; i < 4; i++) {
      var f = this._flowers[i];
      if (!f) continue;
      if (f.obtained) {
        var frac = this._starFrac(i);
        var pos = this._pointAt(frac);
        // 获得/放大动画：蓄力 → 弹性绽放(花瓣散开) → 回弹
        var scale = 1, rot = 0, bloom = 1;
        if (i === 3) rot += fourRot;
        if (f.popStart) {
          var pd = (now - f.popStart) / FLOWER_POP_MS;
          if (pd > 1) pd = 1;
          var ap = flowerPop(pd);
          scale = ap.scale; rot = ap.rot; bloom = ap.bloom;
        }
        // 底部中心锚点：花的底部中心对齐路径点 → 整朵偏高一点，虫头撞到的是花底
        var anchorUp = FLOWER_ANCHOR * (f.finalSize || 25) * scale;
        var fx = ox + pos.x, fy = oy + pos.y - anchorUp;
        // 获得瞬间：光环 + 星点爆发点缀（与花朵同中心，避免错位）
        if (f.popStart) {
          var bd = (now - f.popStart) / FLOWER_BURST_MS;
          if (bd <= 1) this._renderFlowerBurst(ctx, fx, fy, f.finalSize || 25, bd, f.colored);
        }
        // 每朵花始终只渲染一份（finalSize × 当前 scale），绝不在别处画同位置小版本 → 杜绝「一大一小叠在一起」
        this.drawFlower(ctx, fx, fy, f.finalSize || 25, scale, rot, f.colored, bloom);
      } else if (this._preplacedVisible) {
        // 预置小花朵：未达成时以静态小尺寸显示在树枝槽位，待小虫爬到即原地旋转放大（同一条花，不分离）
        var pfrac = this._starFrac(i);
        var ppos = this._pointAt(pfrac);
        var panchor = FLOWER_ANCHOR * 14;
        this.drawFlower(ctx, ox + ppos.x, oy + ppos.y - panchor, 14, 1, 0, false, 1);
      }
    }
  }

  // 花瓣粒子（4 星施法甩出，魔法感）：带光晕的彩色花瓣沿弧线飞向目标花
  _renderPetals(ctx) {
    var now = Date.now();
    for (var i = 0; i < this._petals.length; i++) {
      var p = this._petals[i];
      var e = (now - p.start) / p.dur;
      if (e < 0) continue;
      if (e >= 1) continue;
      // 二次贝塞尔弧线（魔法甩出轨迹）
      var mt = 1 - e;
      var bx = mt * mt * p.fromX + 2 * mt * e * p.cx + e * e * p.toX;
      var by = mt * mt * p.fromY + 2 * mt * e * p.cy + e * e * p.toY;
      var ang = p.rot + e * p.rotSpeed;
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(ang);
      // 光晕
      ctx.globalAlpha = 0.9;
      var g = ctx.createRadialGradient(0, 0, 0, 0, 0, p.size * 1.7);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, p.size * 1.7, 0, Math.PI * 2);
      ctx.fill();
      // 花瓣（小椭圆）
      ctx.globalAlpha = 1;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size, p.size * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // 步数→飞小花：彩虹小花沿弧线从步数框飞向 4 星花，末段缩小淡出（复用 drawFlower 画彩色小花）
  _renderStepFlowers(ctx) {
    var now = Date.now();
    for (var i = 0; i < this._stepFlowers.length; i++) {
      var p = this._stepFlowers[i];
      var e = (now - p.start) / p.dur;
      if (e < 0) continue;
      if (e >= 1) continue;
      // 二次贝塞尔弧线（从步数框甩出、飞向 4 星花）
      var mt = 1 - e;
      var bx = mt * mt * p.fromX + 2 * mt * e * p.cx + e * e * p.toX;
      var by = mt * mt * p.fromY + 2 * mt * e * p.cy + e * e * p.toY;
      // 末段缩小 + 淡出（飞近 4 星花时消散，像「融入」大花）
      var alpha = 1, scale = 1;
      if (e > 0.7) {
        var te = (e - 0.7) / 0.3;
        alpha = 1 - te;
        scale = 1 - 0.45 * te;
      }
      var ang = p.rot + e * p.rotSpeed;
      // 飞行中微微发光的光晕
      ctx.save();
      ctx.globalAlpha = alpha * 0.5;
      var g = ctx.createRadialGradient(bx, by, 0, bx, by, p.size * 1.7);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(bx, by, p.size * 1.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      this.drawFlower(ctx, bx, by, p.size, scale, ang, true, 1); // colored=true → 彩虹小花
    }
  }

  // 4 星施法瞬间的高光环（魔法棒挥出那一下）
  _renderCastFlash(ctx) {
    if (!this._castFlash) return;
    var age = Date.now() - this._castFlash;
    if (age > 260) { this._castFlash = 0; return; }
    var c = this._flowerCenter(3);
    var e = age / 260;
    ctx.save();
    ctx.globalAlpha = (1 - e) * 0.85;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 3 * (1 - e) + 0.5;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 8 + e * 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 花朵获得瞬间的光环 + 星点爆发
  _renderFlowerBurst(ctx, x, y, size, bd, colored) {
    ctx.save();
    var r = size * (0.4 + bd * 0.9);
    ctx.globalAlpha = (1 - bd) * 0.85;
    ctx.strokeStyle = colored ? 'rgba(255,255,255,0.95)' : 'rgba(255,240,150,0.95)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    for (var sp = 0; sp < 4; sp++) {
      var sa = sp * Math.PI / 2 + Math.PI / 4;
      var sd = size * (0.3 + bd * 0.8);
      var sx = x + Math.cos(sa) * sd, sy = y + Math.sin(sa) * sd;
      ctx.globalAlpha = (1 - bd) * 0.9;
      ctx.fillStyle = colored ? '#FFFFFF' : '#FFEE00';
      ctx.beginPath();
      ctx.arc(sx, sy, 2.4 * (1 - bd) + 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * 绘制一朵花（Figma：黄底 + 橙心 + 阴影；新增 bloom 控制花瓣聚拢→散开）
   * @param {number} x,y 中心屏幕坐标
   * @param {number} size 目标尺寸
   * @param {number} scale 缩放（获得动画用，1=原尺寸）
   * @param {number} rotate 旋转弧度
   * @param {boolean} colored 是否覆彩色（4 星：彩色 3 星 == 4 星）
   * @param {number} bloom 绽放度 0=花苞聚拢, 1=全开（获得动画用）
   */
  drawFlower(ctx, x, y, size, scale, rotate, colored, bloom) {
    ctx.save();
    ctx.translate(x, y);
    if (rotate) ctx.rotate(rotate);
    var s = size * (scale != null ? scale : 1);
    var b = (bloom != null) ? bloom : 1;
    // 阴影
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.beginPath();
    ctx.ellipse(0, s * 0.55, s * 0.5, s * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    // 彩花：改用 big_flower.png 图片绘制（图片未就绪时兜底走下方代码绘制，避免空图）
    if (colored) {
      var flowerImg = AssetPreloader.get('big_flower');
      if (flowerImg) {
        ctx.drawImage(flowerImg, -s / 2, -s / 2, s, s);
        ctx.restore();
        return;
      }
    }
    // 以下：代码绘制（普通花 / 彩花图片未就绪兜底）
    // 花瓣（bloom 控制聚拢→散开；彩色时换色）
    var petalOff = s * (0.05 + 0.23 * b);
    var petalR = s * (0.30 + 0.20 * b);
    var petalColors = colored
      ? ['#FF5C8A', '#FFB13D', '#5CCBFF', '#9B6CFF']
      : ['#FFEE00', '#FFEE00', '#FFEE00', '#FFEE00'];
    for (var p = 0; p < 4; p++) {
      var ang = p * Math.PI / 2 + Math.PI / 4;
      ctx.fillStyle = petalColors[p];
      ctx.beginPath();
      ctx.arc(Math.cos(ang) * petalOff, Math.sin(ang) * petalOff, petalR * 0.62, 0, Math.PI * 2);
      ctx.fill();
    }
    // 中心橙圆（花苞时略小）
    ctx.fillStyle = '#FFA600';
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.22 * (0.5 + 0.5 * b), 0, Math.PI * 2);
    ctx.fill();
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
