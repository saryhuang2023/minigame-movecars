// 关卡地图（主页）
// 路径 + 沿路径自动摆放的关卡按钮，整段随相机 scrollY 无缝滑动；背景由主界面 drawBackground 负责。
// 数据全部来自真实进度：
//   - 总关数：assets/levels/index.json 的 maxLevel（或云端 _cloudMaxLevel）
//   - 每关星级：wx.getStorageSync('levelStars') → { '0001': 3, ... }
//   - 进度边界：wx.getStorageSync('lastLevelIndex')（已完成关的 0 基索引），frontier = lastLevelIndex + 1
// 状态：i<=lastIdx → cleared（最终版 LevelButton）；i===frontier → current（占位）；其余 → locked（占位）。

const { ctx, SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');
const cfg = require('../define/LevelMapConfig.js');
const databus = require('../databus.js');
const LevelButton = require('./widgets/LevelButton.js');
const ButtonPress = require('../anim/ButtonPress.js');

// 开发预览开关：默认 false（走真实进度数据，符合「已通关按钮按最终正式版」要求）。
// 置 true 可让所有按钮临时渲染为「已通关」并循环 1~4 星，方便直接核对 cleared 按钮最终效果。
// 正式发布前保持 false 即可，无需删除此开关。
const PREVIEW_CLEARED = false;

// 可复现随机：mulberry32。同一 seed → 同一关卡抖动，回主菜单不漂移。
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 关卡名 = 4 位零填充（与 GameEngine._buildProjectLevels / PlayingEngine 一致）
function pad4(n) { return String(n).padStart(4, '0'); }

class LevelMap {
  constructor() {
    this._touching = false;
    this._lastY = 0;
    this._vel = 0;             // 惯性速度（px/帧）
    this._lastTime = 0;
    this._alpha = 1;           // 叠加层：直接以满透明度叠加在主界面之上
    this._previewPathOnly = false; // 关卡按钮随路径一起渲染（true 时仅画路径、屏蔽关卡，仅调试用）

    this._bgImg = null;       // 草原背景图（由 GameEngine 注入，随路径同速滚动）
    this._bgReady = false;

    // 关卡点击进入 + 通用按压反馈（复用项目 ButtonPress，与开始/设置按钮完全一致的按下回弹体感）
    this._btnPress = new ButtonPress();   // 按压回弹动画：按下缩 0.95 → 松手 easeOutBack 回弹 1.0
    this._pressingLevel = false;          // 当前手指是否【按在某可点击关卡上】→ 本回合不滚地图、按钮显示按压态
    this._pressedLevelIdx = -1;           // 被按下的关卡索引；-1 无
    this._entering = false;     // 进关流程进行中（屏蔽重复点击）
    this._tapStartX = 0; this._tapStartY = 0; this._tapMoved = false; this._tapCandidate = -1;
    this.onSelectLevel = null;  // GameEngine 注入：选中关卡回调(index, state)

    this._cloudMaxSeen = databus._cloudMaxLevel || 0;
    this._total = this._readTotal();   // 真实总关数（构造时本地 index.json 已就绪）
    this._buildLevels();
    this.scrollY = this._maxScroll;   // 初始定位到最底部：关卡1 在屏幕下方，往上滑看更高关
  }

  // 真实总关数：本地 index.json maxLevel 与云端 _cloudMaxLevel 取大；都为 0 时回退到配置里的占位数量
  _readTotal() {
    var localMax = 0;
    try {
      var fs = wx.getFileSystemManager();
      var indexRaw = fs.readFileSync('assets/levels/index.json', 'utf8');
      var indexData = JSON.parse(indexRaw);
      if (typeof indexData.maxLevel === 'number') localMax = indexData.maxLevel;
      else if (Array.isArray(indexData)) localMax = indexData.length;
    } catch (e) { /* 无 index.json：等云端 */ }
    var cloudMax = databus._cloudMaxLevel || 0;
    return Math.max(localMax, cloudMax) || cfg.levels.count;
  }

  // 云端关卡范围就绪后自同步（无需 GameEngine 主动推）：cloudMax 变化才重建
  _syncTotal() {
    var cloudMax = databus._cloudMaxLevel || 0;
    if (cloudMax === this._cloudMaxSeen) return;
    this._cloudMaxSeen = cloudMax;
    var n = this._readTotal();
    if (n !== this._total) {
      this._total = n;
      this._buildLevels();
      this.scrollY = this._maxScroll;   // 重新锚定到最底部（关卡1）
    }
  }

  // 读取真实进度：星级表 + 已完成关索引（→ frontier）
  _getProgress() {
    var starsMap = {};
    try { starsMap = wx.getStorageSync('levelStars') || {}; } catch (e) {}
    var lastIdx = -1;
    try {
      var raw = wx.getStorageSync('lastLevelIndex');
      if (raw !== '' && raw !== undefined && raw !== null) {
        var v = parseInt(raw, 10);
        if (!isNaN(v)) lastIdx = v;
      }
    } catch (e) {}
    var result = { starsMap: starsMap, lastIdx: lastIdx, frontier: lastIdx + 1 };
    this._dbgLogProgress(result);
    return result;
  }

  // 仅在进度数据变化时打日志（避免每帧 60 次刷屏）
  _dbgLogProgress(result) {
    var sig = JSON.stringify(result.starsMap) + '|' + result.lastIdx;
    if (sig === this._dbgProgressSig) return;
    this._dbgProgressSig = sig;
    var starCount = 0;
    for (var k in result.starsMap) { if (result.starsMap.hasOwnProperty(k)) starCount++; }
    console.log('[LevelMap] 读取进度: lastIdx=' + result.lastIdx + ' frontier=' + result.frontier + ' 已记录星级关数=' + starCount + ' starsMap=' + JSON.stringify(result.starsMap));
  }

  // 自动生成蜿蜒路径 + 沿路径布置关卡（第一章）
  // 硬约束：路中心线始终待在屏幕中央 50% 带内（[0.25W, 0.75W]），
  //         左右各空出 25% 屏宽留给风景；路边缘也不侵入风景带。
  _buildLevels() {
    this._scale = SCREEN_WIDTH / 393;             // 设计 → 世界 缩放（按宽充满）
    var s = this._scale;
    var N = Math.max(cfg.levels.count, this._total || 0) || cfg.levels.count;

    // 屏幕 1/4 留白用于风景：路中心线限定在 [margin + halfRoad, W - margin - halfRoad]
    var margin = SCREEN_WIDTH * 0.25;
    var halfRoad = cfg.path.roadWidth * s / 2;
    var xMin = margin + halfRoad;                       // 路中心线最左（贴中央带左缘内侧）
    var xMax = SCREEN_WIDTH - margin - halfRoad;        // 路中心线最右（贴中央带右缘内侧）
    var xMid = (xMin + xMax) / 2;
    var spacing = (xMax - xMin) / 2;                    // 中央带半宽 = 极端↔中心的水平跨度
    // 振幅取满幅 spacing：第 i 关落在 左/右 极值交替（每摆臂 2 个），波形为连续 S 形；
    //   路中心线精确落在 [xMin, xMax]（=中央带内侧），路边缘刚好抵 0.25W/0.75W 风景界而不越界。
    var amp = spacing;

    // 竖直：每关固定垂直间距 gap（满尺寸钮高 115，需 > 钮高防上下重叠）
    var gap = (cfg.levels.levelGap || 130) * s;
    var topReserve = (cfg.levels.topMargin || 40) * s;          // 顶留白（设计px）
    // 地图钮恢复正常满尺寸（不再缩小）：中央带只能并排 2 个满尺寸钮，故每摆臂回到 左-右 2 个；
    //   相邻关位于左右极值（水平错开≈2·spacing），永不水平重叠，钮为满尺寸 117×115。
    this._btnScale = 1;                                 // 正常大小：地图与进关后一致，均为满尺寸
    // 底留白（屏幕px）：保证「第一关按钮底部」与「开始按钮顶部」间隔 30px，且短屏也看得到第一关。
    //   开始按钮 180×86、bottom 距屏底 65*scale(s=SCREEN_WIDTH/393) → 其顶部距屏底 (65+86)*scale。
    //   第一关钮半高取 cleared 钮最大半高 58(115/2)。GAP_BOTTOM=30 为用户要求间隔。
    var startBtnTopFromBottom = (65 + 86) * s;   // 开始按钮顶部距屏幕底（px）
    var firstBtnHalfH = 57.5 * this._btnScale;    // 关卡钮最大半高（cleared 115/2）按地图缩放后
    var GAP_BOTTOM = 30;                          // 第一关底 ↔ 开始钮顶 间隔
    var bottomReserve = startBtnTopFromBottom + firstBtnHalfH + GAP_BOTTOM;

    this._levels = [];
    for (var i = 0; i < N; i++) {
      // 关卡1(i=0) 在最底，关卡N(i=N-1) 在最顶；worldY 越大越靠下
      var wy = topReserve + (N - 1 - i) * gap;
      // 蜿蜒（每摆臂 2 个：左-右 极值交替）：sin(t·π·(N-1)+π/2) → 相邻关落左右相反极值；
      //   Catmull-Rom 平滑成连续 S 形，每个钮中心精确落在路径上。
      var t = N > 1 ? i / (N - 1) : 0;
      var wx = xMid + amp * Math.sin(t * Math.PI * (N - 1) + Math.PI / 2);
      this._levels.push({ index: i, worldY: wy, x: wx, r: cfg.levels.buttonR });
    }
    // 路径 = 依次穿过各关卡中心（渲染用 Catmull-Rom，精确过每一点）
    this._roadPts = this._levels.map(function (lv) { return { x: lv.x, y: lv.worldY }; });

    this._contentHeight = topReserve + (N - 1) * gap + bottomReserve;
    this._maxScroll = Math.max(0, this._contentHeight - SCREEN_HEIGHT);
  }

  // _pathX 已移除：路径改为穿过锚点的曲线（见 _renderPath / _buildRoadPath）。

  // ===== 输入（事件形状与 InputManager.normalizeEvent 对齐）=====
  handleEvent(e) {
    if (e.type === 'touchstart') {
      var t = e.touches && e.touches[0];
      if (!t) return;
      this._touching = true;
      this._lastY = t.y;
      this._vel = 0;
      this._tapStartX = t.x; this._tapStartY = t.y;
      this._tapMoved = false;
      this._tapCandidate = this._hitTestLevel(t.x, t.y);  // 命中候选关（不论状态）
      // 命中【可点击】关卡（cleared/current）→ 进入按压态：本回合不滚地图，按钮显示按下回弹
      this._pressingLevel = false;
      this._pressedLevelIdx = -1;
      if (this._tapCandidate >= 0 && this._levelState(this._tapCandidate) !== 'locked') {
        this._pressingLevel = true;
        this._pressedLevelIdx = this._tapCandidate;
        this._btnPress.press('lv' + this._tapCandidate);   // 触发按压缩放（1→0.95）
      }
    } else if (e.type === 'touchmove') {
      var tm = e.touches && e.touches[0];
      if (!tm || !this._touching) return;
      // 处于按压关模式：移动超阈值 → 判定为拖拽，取消按压、转为地图滚动
      if (this._pressingLevel) {
        if (Math.abs(tm.x - this._tapStartX) > 12 || Math.abs(tm.y - this._tapStartY) > 12) {
          this._pressingLevel = false;
          this._pressedLevelIdx = -1;
          this._tapMoved = true;
          this._lastY = tm.y;          // 以当前点作为滚动起点（本帧位移 0，下一帧正常滚）
          this._vel = 0;
          // 不 return：继续下方滚动逻辑
        } else {
          return;                       // 仍在按压、未越界 → 不滚动地图，保持按钮按着
        }
      }
      var dy = tm.y - this._lastY;       // 屏幕空间手指位移
      var dScroll = -dy;                  // 手指下滑 → 内容上移（scrollY 减小）
      this.scrollY += dScroll;
      this._lastY = tm.y;
      // 平滑速度，兼容一帧多次 move / 一次 move 跨多帧
      this._vel = this._vel * 0.7 + dScroll * 0.3;
      this._clampScroll(true);
      // 移动超阈值 → 视为拖拽（滚动），取消点击进关
      if (Math.abs(tm.x - this._tapStartX) > 12 || Math.abs(tm.y - this._tapStartY) > 12) {
        this._tapMoved = true;
      }
    } else if (e.type === 'touchend') {
      this._touching = false;
      // 松手且未移动 → 触发点击进关（与通用按钮一致：按下→松手才触发，而非按下瞬间）
      if (this._pressingLevel && !this._tapMoved && this._pressedLevelIdx >= 0) {
        this._onTapLevel(this._pressedLevelIdx);
      }
      this._pressingLevel = false;
      this._pressedLevelIdx = -1;
      this._tapCandidate = -1;
      // 保留 this._vel 供惯性
    }
  }

  /** 命中测试：屏幕坐标 → 世界坐标，返回所在关索引；未命中返回 -1 */
  _hitTestLevel(sx, sy) {
    var wY = sy + this.scrollY;                 // 屏幕 y → 世界 y
    var k = this._btnScale || 1;
    var hw = 117 / 2 * k;                        // 关卡钮半宽（满尺寸 117）
    var hh = 115 / 2 * k;                        // 关卡钮半高（满尺寸 115）
    for (var i = 0; i < this._levels.length; i++) {
      var lv = this._levels[i];
      if (Math.abs(sx - lv.x) <= hw && Math.abs(wY - lv.worldY) <= hh) return i;
    }
    return -1;
  }

  /** 关卡状态：cleared（已通关）/ current（当前关）/ locked（未解锁） */
  _levelState(idx) {
    var prog = this._getProgress();
    return (idx <= prog.lastIdx) ? 'cleared'
         : (idx === prog.frontier ? 'current' : 'locked');
  }

  /** 点击关卡：按进度判定 → locked 忽略 / current 走原开始流程（耗体力）/ cleared 直接进（不耗体力） */
  _onTapLevel(idx) {
    var state = this._levelState(idx);
    if (state === 'locked') return;             // 未解锁不可点
    if (state === 'current') {
      if (this.onSelectLevel) this.onSelectLevel(idx, 'current');   // 当前关：消耗体力（同开始按钮）
      return;
    }
    // 已通关：直接进关（不耗体力）。行为与普通按钮一致，不再单独叠加选中呼吸环。
    this._entering = true;                      // 进关流程中，屏蔽重复点击
    if (this.onSelectLevel) this.onSelectLevel(idx, 'cleared');
  }

  update() {
    this._syncTotal();   // 自同步云端关卡范围（若有更新）

    // 离开主菜单（gameState 已切到 playing）→ 清进关态 + 按压态，避免残留/重复触发
    if (databus.gameState !== 'menu') {
      this._entering = false;
      this._pressingLevel = false;
      this._pressedLevelIdx = -1;
    }

    var now = Date.now();
    var dt = this._lastTime ? (now - this._lastTime) / 16.667 : 1;
    if (dt > 4) dt = 4;                  // 卡顿/切后台大间隔夹紧
    this._lastTime = now;

    if (!this._touching) {
      if (Math.abs(this._vel) > 0.02) {
        // 限速防飞车
        var step = this._vel * dt;
        var cap = cfg.scroll.maxVelocity * dt;
        if (step > cap) step = cap;
        else if (step < -cap) step = -cap;
        this.scrollY += step;
        this._vel *= Math.pow(cfg.scroll.friction, dt);
        if (Math.abs(this._vel) < 0.05) this._vel = 0;
        this._clampScroll(false);
      } else {
        this._vel = 0;
        this._clampScroll(false);
      }
    }

    if (this._alpha < 1) {
      this._alpha = Math.min(1, this._alpha + dt / 30); // ~0.5s 淡入
    }
  }

  _clampScroll(dragging) {
    var max = this._maxScroll;
    if (this.scrollY < 0) {
      if (dragging) { this.scrollY = 0; this._vel = 0; }
      else { this.scrollY *= cfg.scroll.rubberBand; this._vel = 0; }
    } else if (this.scrollY > max) {
      if (dragging) { this.scrollY = max; this._vel = 0; }
      else { this.scrollY = max + (this.scrollY - max) * cfg.scroll.rubberBand; this._vel = 0; }
    }
  }

  // ===== 渲染（分层，配合 GameEngine 双层调用）=====
  // 路径层：贴着背景，在主界面(scene/HUD)之下绘制。整段随 scrollY 无缝滑动。
  renderPath() {
    ctx.save();
    ctx.globalAlpha = this._alpha;
    ctx.save();
    ctx.translate(0, -this.scrollY);     // 世界空间：路径整体跟手
    this._renderPath();
    ctx.restore();
    ctx.restore();
  }

  // 关卡按钮层：贴在路径上，随路径一起在主界面之下绘制（不浮到菜单控件之上）。
  renderButtons() {
    ctx.save();
    ctx.globalAlpha = this._alpha;
    ctx.save();
    ctx.translate(0, -this.scrollY);     // 世界空间：按钮整体跟手
    this._renderButtons();
    ctx.restore();
    ctx.restore();
  }

  // 草原背景层：与路径/按钮同速（scrollY）滚动，三者作为同一整体无缝滑动。
  renderBackground() {
    if (this._bgReady && this._bgImg) {
      var imgW = this._bgImg.width, imgH = this._bgImg.height;
      var scale = Math.max(SCREEN_WIDTH / imgW, SCREEN_HEIGHT / imgH);
      var dw = imgW * scale, dh = imgH * scale;
      var dx = (SCREEN_WIDTH - dw) / 2;
      ctx.save();
      ctx.translate(0, -this.scrollY);   // 世界空间：背景随路径一起滚动
      var startTile = Math.floor((this.scrollY - dh) / dh);
      var endTile = Math.floor((this.scrollY + SCREEN_HEIGHT) / dh) + 1;
      for (var ti = startTile; ti <= endTile; ti++) {
        ctx.drawImage(this._bgImg, dx, ti * dh, dw, dh);
      }
      ctx.restore();
    } else {
      // 兜底渐变（屏幕空间，静态）：草原资源未就绪时占位
      var b = cfg.background;
      var g = ctx.createLinearGradient(0, 0, 0, SCREEN_HEIGHT);
      g.addColorStop(0, b.fallbackTop);
      g.addColorStop(1, b.fallbackBottom);
      ctx.save();
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
      ctx.restore();
    }
  }

  // 注入草原背景图（GameEngine 加载完成后调用）
  setBackground(img) {
    this._bgImg = img || null;
    this._bgReady = !!(img && img.width);
  }

  _renderPath() {
    var s = this._scale;
    // 道路 = 自动生成的蜿蜒路径，依次穿过各关卡中心（见 _buildLevels 的 this._roadPts）
    var pts = this._roadPts || [];
    if (!pts.length) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 白路：半透明白，51px 描边（沿曲线）
    this._buildRoadPath(pts);
    ctx.setLineDash([]);
    ctx.lineWidth = cfg.path.roadWidth * s;
    ctx.strokeStyle = cfg.path.roadColor;
    ctx.stroke();

    // 绿虚线车道线：走白路正中央（同一曲线），8px 虚线
    this._buildRoadPath(pts);
    ctx.lineWidth = cfg.path.lineWidth * s;
    ctx.strokeStyle = cfg.path.lineColor;
    ctx.setLineDash([cfg.path.lineDash[0] * s, cfg.path.lineDash[1] * s]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();
  }

  // 构建道路路径（仅 path，不描边）：依次【精确穿过】所有锚点。
  // 平滑模式用 Catmull-Rom 样条（转三次贝塞尔），保证曲线过每一个锚点中心、
  // 且段间 C1 连续平滑 —— 这样每个按钮中心都精确落在路径中心上。
  _buildRoadPath(pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    var n = pts.length;
    if (cfg.path.smooth && n > 2) {
      for (var i = 0; i < n - 1; i++) {
        var p0 = pts[i === 0 ? 0 : i - 1];   // 段首前邻（首段复用自身）
        var p1 = pts[i];                     // 段首（锚点，曲线必过）
        var p2 = pts[i + 1];                 // 段尾（锚点，曲线必过）
        var p3 = pts[i + 2 < n ? i + 2 : n - 1]; // 段尾后邻（末段复用自身）
        // Catmull-Rom → 三次贝塞尔控制点
        var c1x = p1.x + (p2.x - p0.x) / 6;
        var c1y = p1.y + (p2.y - p0.y) / 6;
        var c2x = p2.x - (p3.x - p1.x) / 6;
        var c2y = p2.y - (p3.y - p1.y) / 6;
        ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2.x, p2.y);
      }
    } else {
      for (var j = 1; j < n; j++) ctx.lineTo(pts[j].x, pts[j].y);
    }
  }

  _renderButtons() {
    if (this._previewPathOnly) return;   // 第一章预览：先只看路径，关卡槽位 Step2 接入后改 false
    var top = this.scrollY - 40;
    var bottom = this.scrollY + SCREEN_HEIGHT + 40;
    var prog = this._getProgress();      // 真实星级 + 进度边界（每帧读一次）

    ctx.save();
    for (var i = 0; i < this._levels.length; i++) {
      var lv = this._levels[i];
      if (lv.worldY < top || lv.worldY > bottom) continue; // 可见性裁剪

      var id = lv.index + 1;
      var name = pad4(id);
      var stars = prog.starsMap[name] || 0;

      if (PREVIEW_CLEARED) {
        // 开发预览：强制全部渲染为已通关，星级循环 1~4，便于核对最终效果
        this._drawLevelButton(lv, {
          state: 'cleared',
          stars: 1 + (lv.index % 4),
          levelId: id,
        });
        continue;
      }

      if (lv.index <= prog.lastIdx) {
        // 已通关：最终正式版按钮（按真实星级画 1~3 朵大花 / 4 星 3 朵彩花）
        this._drawLevelButton(lv, {
          state: 'cleared',
          stars: stars,
          levelId: id,
        });
      } else if (lv.index === prog.frontier) {
        // 当前关：与未解锁同图 + 外圈呼吸光环区分
        this._drawLevelButton(lv, {
          state: 'current',
          levelId: id,
        });
      } else {
        // 未解锁：正式图片按钮（main_level_btn_unlocked.png）
        this._drawLevelButton(lv, {
          state: 'locked',
          levelId: id,
        });
      }
    }
    ctx.restore();
  }

  // 地图钮缩放绘制：以 (lv.x, lv.worldY) 为中心，按 this._btnScale 缩放（满尺寸=1）；
  //   叠加项目通用的按压回弹反馈（ButtonPress）：按下时整钮缩到 0.95、松手 easeOutBack 回弹 1.0，
  //   与开始/设置/通用按钮完全一致。围绕按钮中心 (58.5, 57.5) 缩放，避免偏移。
  _drawLevelButton(lv, opts) {
    var k = this._btnScale || 1;
    var pressS = this._btnPress ? this._btnPress.getScale('lv' + lv.index) : 1;
    ctx.save();
    ctx.translate(lv.x, lv.worldY);
    ctx.scale(k, k);
    ctx.translate(58.5, 57.5);
    ctx.scale(pressS, pressS);
    ctx.translate(-58.5, -57.5);
    LevelButton.draw(ctx, 0, 0, opts);
    ctx.restore();
  }
}

module.exports = LevelMap;
