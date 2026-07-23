// 关卡地图（主页）
// 路径 + 沿路径自动分析的关卡按钮，整段随相机 scrollY 无缝滑动；背景按段分配。
//
// 布局（自动分析路径图）：
//   - 第 1 段：main_level_road_0.png（顶着屏幕顶摆放），背景 main_bg_0.jpg
//   - 后续段循环：main_level_road_1 / main_level_road_2，背景循环 main_bg_1 / main_bg_2
//   - 关卡钮中心点落在路径中心线上，相邻钮间距 = 50 世界 px
//   - 方向：段 0 在最顶（worldY=0），内容向下延伸；scrollY=0 看到 road_0 区域（L1 靠上）
//
// 数据全部来自真实进度：
//   - 总关数：assets/levels/index.json 的 maxLevel（或云端 _cloudMaxLevel）
//   - 每关星级：wx.getStorageSync('levelStars') → { '0001': 3, ... }
//   - 进度边界：wx.getStorageSync('lastLevelIndex')（已完成关的 0 基索引），frontier = lastLevelIndex + 1
// 状态：i<=lastIdx → cleared / i===frontier → current / 其余 → locked

const { ctx, SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');
const cfg = require('../define/LevelMapConfig.js');
const databus = require('../databus.js');
const LevelButton = require('./widgets/LevelButton.js');
const ButtonPress = require('../anim/ButtonPress.js');
const AssetPreloader = require('./AssetPreloader.js');

// 开发预览开关
const PREVIEW_CLEARED = false;

function pad4(n) { return String(n).padStart(4, '0'); }

class LevelMap {
  constructor() {
    this._touching = false;
    this._lastY = 0;
    this._vel = 0;
    this._lastTime = 0;
    this._alpha = 1;

    // 多路径图 / 多背景图（keyed by config key）
    this._roadImages = {};     // { 'main_level_road_0': Image, ... }
    this._bgImages = {};       // { 'main_bg_0': Image, ... }
    this._bgReady = false;

    // 关卡点击 + 按压反馈
    this._btnPress = new ButtonPress();
    this._pressingLevel = false;
    this._pressedLevelIdx = -1;
    this._entering = false;
    this._tapStartX = 0; this._tapStartY = 0; this._tapMoved = false; this._tapCandidate = -1;
    this.onSelectLevel = null;

    this._cloudMaxSeen = databus._cloudMaxLevel || 0;
    this._total = this._readTotal();
    this._buildLevels();
    this.scrollY = this._computeFrontierScroll();

    // 地图装饰：固定锚点 + 每锚点随机选图（会话内固定，构造时展开一次）。
    this._pathPts = null;        // 路径点缓存（渲染复用）
    this._decoItems = [];        // 展开后的装饰实例 [{x, y, key|null, size}]（world 坐标）
    this._buildDecorationItems();
  }

  _readTotal() {
    var localMax = 0;
    try {
      var fs = wx.getFileSystemManager();
      var indexRaw = fs.readFileSync('assets/levels/index.json', 'utf8');
      var indexData = JSON.parse(indexRaw);
      if (typeof indexData.maxLevel === 'string') localMax = parseInt(indexData.maxLevel, 10) || 0;
      else if (typeof indexData.maxLevel === 'number') localMax = indexData.maxLevel;
      else if (Array.isArray(indexData)) localMax = indexData.length;
    } catch (e) {}

    var cloudMax = databus._cloudMaxLevel || 0;
    try { cloudMax = Math.max(cloudMax, parseInt(wx.getStorageSync('_cloudMaxLevel'), 10) || 0); } catch (e) {}

    var cachedCount = 0;
    try {
      var dir = wx.env.USER_DATA_PATH + '/levels';
      var files = fs.readdirSync(dir);
      for (var fi = 0; fi < files.length; fi++) if (/^\d{4}\.json$/.test(files[fi])) cachedCount++;
    } catch (e) {}

    return Math.max(localMax, cloudMax, cachedCount) || cfg.roadButtons.road_0.length;
  }

  _syncTotal() {
    var cloudMax = databus._cloudMaxLevel || 0;
    if (cloudMax === this._cloudMaxSeen) return;
    this._cloudMaxSeen = cloudMax;
    var n = this._readTotal();
    if (n !== this._total) {
      this._total = n;
      this._buildLevels();
      this.scrollY = this._computeFrontierScroll();
    }
  }

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

  _dbgLogProgress(result) {
    var sig = JSON.stringify(result.starsMap) + '|' + result.lastIdx;
    if (sig === this._dbgProgressSig) return;
    this._dbgProgressSig = sig;
    console.log('[LevelMap] 进度: lastIdx=' + result.lastIdx + ' frontier=' + result.frontier);
  }

  // ===== 核心：从预分析路径数据构建关卡布局 =====
  // 方向：段 0 在 worldY=0（顶），向下延伸。scrollY=0 时看到顶部。
  //   关卡钮在下方整体 reverse，故 L1 落地图最底、最底段也即入口（与用户需求一致）。
  //   路径图（road）：从下到上 = [0,1,2,1,2,1,2,...] —— 最底=road_0（入口，仅一次且满 11 钮），
  //     其上 road_1/road_2 交替循环；每段「按钮来源 + 显示图」皆同一 rk，钮必落该段路径上。
  //     钮数差异（road_0=11，road_1=road_2=14）由「顶端段吸收余量」消化，避免底部 road_0 缺钮。
  //   背景图（bg）：从下到上 = [0,1,2,0,1,2,...] —— 三图均匀循环（距底 %3）。
  //   跨段间距：按钮实际落点为路径图自然位置，段内本就非均匀；跨段衔接处按「两邻段近缝处
  //     段内间距的均值」补白，使跨段相邻钮间距与段内一致（不再出现 L11↔L12 比段内更挤的情况）。
  //     （早先用固定 130 图像 px 目标，但因段内实际约 330，反而把缝距压得更紧——已改为局部均值。）
  _buildLevels() {
    var s = SCREEN_WIDTH / cfg.designWidth;
    var k = cfg.roadTargetW / 845 * s;          // 统一缩放

    var btns = cfg.roadButtons;                   // { road_0: [{x,y},...], ... }
    var roads = cfg.roads;                       // { road_0: {key,W,H}, ... }
    var bgs = cfg.bgs;                           // { bg_0: {key}, ... }

    var N = Math.max(this._total || 0, btns.road_0.length);
    var r0cap = btns.road_0.length;              // road_0 钮数（如 11）

    // 1) 自「底」向上生成段序列（底→顶）：每段 { rk, count }
    //    底 = road_0（满 11 钮）；其上 road_1/road_2 交替，余量由最顶段吸收。
    var segs = [];   // 索引 0 = 最底段
    if (N <= r0cap) {
      segs.push({ rk: 'road_0', count: N });
    } else {
      segs.push({ rk: 'road_0', count: r0cap });
      var rem = N - r0cap;
      var fb = 1;                                    // 距底偏移（底=0）
      while (rem > 0 && segs.length < 1000) {
        var rk = (fb % 2 === 1) ? 'road_1' : 'road_2';   // 距底奇=road_1，偶=road_2
        var c = Math.min(btns[rk].length, rem);
        if (c <= 0) break;
        segs.push({ rk: rk, count: c });
        rem -= c;
        fb++;
      }
    }
    // 翻转成「自顶向下」构建顺序（索引 0 = 最顶段，末尾 = 最底 road_0）
    var buildOrder = segs.slice().reverse();
    var totalSeg = buildOrder.length;

    // 2) 自顶向下构建段并放置按钮（每段按钮与显示图同 rk，钮落该段路径）
    //    段与段之间按「边界钮间距」补白，保证跨段相邻钮间距 ≥ buttonStepWorld（与段内一致）。
    this._segments = [];
    this._levels = [];

    // 图像空间 2D 距离
    function imgDist(a, b) {
      var dx = a.x - b.x, dy = a.y - b.y;
      return Math.sqrt(dx * dx + dy * dy);
    }

    // 预计算每段信息（含段内近缝处间距，用于让跨段缝距与段内一致）
    var built = buildOrder.map(function (entry) {
      var ri = roads[entry.rk];
      // 余量段（count < 全长）须取路径「末端」count 个钮，使衔接钮为路径真终点；
      // 否则取首 count 个钮会把衔接点落在路径中段，导致与下一段缝隙异常大（如 L39↔L40）。
      var arr = (entry.count < btns[entry.rk].length)
        ? btns[entry.rk].slice(btns[entry.rk].length - entry.count)
        : btns[entry.rk];
      var segW = ri.W * k;
      var roadLeft = (SCREEN_WIDTH - segW) / 2;
      // 段内相邻钮 2D 间距（图像 px）
      var gaps = [];
      for (var i = 0; i < entry.count - 1; i++) gaps.push(imgDist(arr[i], arr[i + 1]));
      return {
        rk: entry.rk,
        count: entry.count,
        ri: ri,
        arr: arr,
        segW: segW,
        roadLeft: roadLeft,
        btnTopY: arr[0].y,                              // 段内最靠上钮（y 最小）
        btnBotY: arr[entry.count - 1].y,                // 段内最靠下钮（y 最大）
        // 近缝处段内间距：上方段用「最靠下」的间距，下方段用「最靠上」的间距
        lastGap: gaps.length ? gaps[gaps.length - 1] : 0,
        firstGap: gaps.length ? gaps[0] : 0,
      };
    });

    // 计算每段 segTop：首段=0；其后每段 = 前段底 + 跨段补白。
    //   补白目标 = 两邻段「近缝处段内间距」的均值（图像 px），保证跨段相邻钮
    //   间距与段内一致，不出现 L11↔L12 之类比段内更挤的情况。
    //   （按钮实际落点即路径图自然位置，段内本就非均匀，故用局部均值而非固定 STEP。）
    var segTops = [];
    var segY = 0;
    for (var bIdx = 0; bIdx < built.length; bIdx++) {
      if (bIdx > 0) {
        var prevB = built[bIdx - 1];                  // 上方段
        var curB = built[bIdx];                       // 下方段
        var targetImg = (prevB.lastGap + curB.firstGap) / 2;   // 目标缝距（图像 px）
        // 自然缝（无 pad）的 2D 距离（世界 px）：dx 含两段的 roadLeft 偏移差
        var dxWorld = (curB.roadLeft + curB.arr[0].x * k) -
                      (prevB.roadLeft + prevB.arr[prevB.count - 1].x * k);
        var dy0World = (prevB.ri.H + curB.arr[0].y - prevB.arr[prevB.count - 1].y) * k;
        var targetWorld = targetImg * k;
        // 需要的竖直补白（世界 px），使 2D 缝距 ≥ 目标
        var needDy = Math.sqrt(Math.max(0, targetWorld * targetWorld - dxWorld * dxWorld)) - dy0World;
        var padWorld = Math.max(0, needDy);
        segY += prevB.ri.H * k + padWorld;
      }
      segTops.push(segY);                              // 记录本段顶部世界 Y
    }

    var globalBtnIdx = 0;    // 全局按钮计数器（= level index）
    for (var segIdx = 0; segIdx < built.length; segIdx++) {
      var b = built[segIdx];
      var ri = b.ri;
      var rbtns = b.arr;   // 已含余量段「末端」切片，钮顺序与显示图一致
      var segTopY = segTops[segIdx];

      var segH = ri.H * k;
      var segW = ri.W * k;
      var roadLeft = (SCREEN_WIDTH - segW) / 2;

      // 背景：距底偏移 %3（最底=0 → 0,1,2,0,1,2...）
      var fromBottom = totalSeg - 1 - segIdx;
      var bgId = fromBottom % 3;

      this._segments.push({
        roadKey: b.rk,
        imgKey: ri.key,
        segTop: segTopY,
        segH: segH,
        segW: segW,
        roadLeft: roadLeft,
        bgKey: bgs['bg_' + bgId].key,
        k: k,
      });

      for (var bi = 0; bi < b.count && globalBtnIdx < N; bi++) {
        var bb = rbtns[bi];
        this._levels.push({
          index: globalBtnIdx,
          x: roadLeft + bb.x * k,
          worldY: segTopY + bb.y * k,
        });
        globalBtnIdx++;
      }
    }

    // 内容总高 = 末段底（用于底部留白叠加）
    segY = segTops[built.length - 1] + built[built.length - 1].ri.H * k;

    // 3) 反转关卡顺序：L1 落在地图最底部（worldY 最大），编号自下向上递增。
    //    仅翻转数组顺序、保持 index === 数组下标，沿用 _levelState / _onTapLevel
    //    「数组下标即关卡号」约定，避免点击/状态判定错位。按钮 worldY 不变，仅编号归属翻转。
    this._levels.reverse();
    for (var li = 0; li < this._levels.length; li++) {
      this._levels[li].index = li;
    }

    // 末尾留白：地图最顶关卡（最高编号）上方保留 trailBottom(design px) 空间。
    //   整体平移所有钮与段，不影响 road_0↔开始钮 间隙（该间隙为 segY 之上的附加项）。
    var TRAIL = (cfg.trailBottom || 100);   // design px
    var minLevelY = Math.min.apply(null, this._levels.map(function (l) { return l.worldY; }));
    var shiftWorld = TRAIL * s - minLevelY;
    for (var si2 = 0; si2 < this._levels.length; si2++) this._levels[si2].worldY += shiftWorld;
    for (var st2 = 0; st2 < this._segments.length; st2++) this._segments[st2].segTop += shiftWorld;
    // 预同步 segY（供下方 _contentHeight 计算；road_0 底已含 shiftWorld）
    segY = segTops[built.length - 1] + built[built.length - 1].ri.H * k + shiftWorld;

    // 底部留白：road_0 之下补一段「空白底」，把整张地图往上顶，
    //   使 road_0 底部距离「闯关按钮」顶部 gapBottom(design px)。
    //   闯关钮真实布局(GameEngine._computeStaminaLayout)：
    //     startY = SCREEN_HEIGHT - START_BTN_BOTTOM_MARGIN*scale - START_BTN_H*scale
    //     → 钮顶在屏底上方 (START_BTN_BOTTOM_MARGIN + START_BTN_H) 处。
    //   故 road_0 底应落在屏底上方 (START_BTN_BOTTOM_MARGIN + START_BTN_H + gap) 处，
    //   即整图需相对「贴屏底」再上移该距离。
    var START_BTN_BOTTOM_MARGIN = cfg.startButton.bottom;   // 与 GameEngine 一致（design px）
    var START_BTN_H = cfg.startButton.height;               // 86
    var gapDesign = cfg.gapBottom;                          // 30
    this._bottomGapScreen = (START_BTN_BOTTOM_MARGIN + START_BTN_H + gapDesign) * s;
    // 在 road_0 之下追加等量空白底（不画路径，仅用于把 road_0 整体往上顶）
    this._contentHeight = segY + this._bottomGapScreen;
    this._maxScroll = Math.max(0, this._contentHeight - SCREEN_HEIGHT);

    // 调试输出
    console.log('[LevelMap] 布局构建完成: ' + this._levels.length + ' 关, ' +
      this._segments.length + ' 段, 内容高=' + Math.round(this._contentHeight) +
      ', 最大滚动=' + Math.round(this._maxScroll));
  }

  // ===== 多图像注入 =====
  setRoad(images) {
    // images 可为 { key: Image } 或单张 Image（向后兼容）
    if (images && typeof images === 'object' && !images.width) {
      this._roadImages = images;
    } else {
      this._roadImages = { 'main_level_road': images };
    }
  }
  setBackground(images) {
    if (images && typeof images === 'object' && !images.width) {
      this._bgImages = images;
      // 任一 bg 就绪即可
      for (var k in images) {
        if (images[k] && images[k].width) { this._bgReady = true; break; }
      }
    } else if (images && images.width) {
      this._bgImages = { 'bg': images };
      this._bgReady = true;
    }
  }

  _computeFrontierScroll() {
    if (!this._levels || this._levels.length === 0) return 0;
    var prog = this._getProgress();
    var targetIdx = Math.min(prog.frontier, this._levels.length - 1);
    if (targetIdx < 0) targetIdx = 0;
    var lv = this._levels[targetIdx];
    // 目标关卡定位到屏幕上部约 35% 处
    var targetScroll = lv.worldY - SCREEN_HEIGHT * 0.35;
    return Math.max(0, Math.min(targetScroll, this._maxScroll));
  }

  _scrollToFrontier() { this.scrollY = this._computeFrontierScroll(); }

  // ===== 输入（不变）=====
  handleEvent(e) {
    if (e.type === 'touchstart') {
      var t = e.touches && e.touches[0];
      if (!t) return;
      this._touching = true;
      this._lastY = t.y;
      this._vel = 0;
      this._tapStartX = t.x; this._tapStartY = t.y;
      this._tapMoved = false;
      this._tapCandidate = this._hitTestLevel(t.x, t.y);
      this._pressingLevel = false;
      this._pressedLevelIdx = -1;
      if (this._tapCandidate >= 0 && this._levelState(this._tapCandidate) !== 'locked') {
        this._pressingLevel = true;
        this._pressedLevelIdx = this._tapCandidate;
        this._btnPress.press('lv' + this._tapCandidate);
      }
    } else if (e.type === 'touchmove') {
      var tm = e.touches && e.touches[0];
      if (!tm || !this._touching) return;
      if (this._pressingLevel) {
        if (Math.abs(tm.x - this._tapStartX) > 12 || Math.abs(tm.y - this._tapStartY) > 12) {
          this._pressingLevel = false;
          this._pressedLevelIdx = -1;
          this._tapMoved = true;
          this._lastY = tm.y;
          this._vel = 0;
        } else {
          return;
        }
      }
      var dy = tm.y - this._lastY;
      var dScroll = -dy;
      this.scrollY += dScroll;
      this._lastY = tm.y;
      this._vel = this._vel * 0.7 + dScroll * 0.3;
      this._clampScroll(true);
      if (Math.abs(tm.x - this._tapStartX) > 12 || Math.abs(tm.y - this._tapStartY) > 12) this._tapMoved = true;
    } else if (e.type === 'touchend') {
      this._touching = false;
      if (this._pressingLevel && !this._tapMoved && this._pressedLevelIdx >= 0) {
        this._onTapLevel(this._pressedLevelIdx);
      }
      this._pressingLevel = false;
      this._pressedLevelIdx = -1;
      this._tapCandidate = -1;
    }
  }

  _hitTestLevel(sx, sy) {
    var wY = sy + this.scrollY;
    var s = SCREEN_WIDTH / cfg.designWidth;
    for (var i = 0; i < this._levels.length; i++) {
      var lv = this._levels[i];
      var st = this._levelState(i);
      var hw, hh;
      if (st === 'cleared') { hw = 70 / 2 * s; hh = 68 / 2 * s; }
      else { hw = 69 / 2 * s; hh = 68 / 2 * s; }
      if (Math.abs(sx - lv.x) <= hw && Math.abs(wY - lv.worldY) <= hh) return i;
    }
    return -1;
  }

  _levelState(idx) {
    var prog = this._getProgress();
    return (idx <= prog.lastIdx) ? 'cleared'
         : (idx === prog.frontier ? 'current' : 'locked');
  }

  _onTapLevel(idx) {
    var state = this._levelState(idx);
    if (state === 'locked') return;
    if (state === 'current') {
      if (this.onSelectLevel) this.onSelectLevel(idx, 'current');
      return;
    }
    this._entering = true;
    if (this.onSelectLevel) this.onSelectLevel(idx, 'cleared');
  }

  update() {
    this._syncTotal();
    if (databus.gameState !== 'menu') {
      this._entering = false;
      this._pressingLevel = false;
      this._pressedLevelIdx = -1;
    }
    var now = Date.now();
    var dt = this._lastTime ? (now - this._lastTime) / 16.667 : 1;
    if (dt > 4) dt = 4;
    this._lastTime = now;
    if (!this._touching) {
      if (Math.abs(this._vel) > 0.02) {
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
    if (this._alpha < 1) this._alpha = Math.min(1, this._alpha + dt / 30);
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

  // ===== 渲染分层 =====
  renderPath(c) {
    c = c || ctx;
    c.save();
    c.globalAlpha = this._alpha;
    c.save();
    c.translate(0, -this.scrollY);
    this._renderRoad(c);
    c.restore();
    c.restore();
  }

  renderButtons(c) {
    c = c || ctx;
    c.save();
    c.globalAlpha = this._alpha;
    c.save();
    c.translate(0, -this.scrollY);
    this._renderButtons(c);
    c.restore();
    c.restore();
  }

  // ===== 背景（按段分配不同 bg 图）=====
  // c：可选目标上下文；缺省用全局 ctx（支持离屏快照渲染）
  renderBackground(c) {
    c = c || ctx;
    if (!this._bgReady) {
      // 兜底渐变
      var b = cfg.background || { fallbackTop: '#BFE8A0', fallbackBottom: '#8FD46F' };
      var g = c.createLinearGradient(0, 0, 0, SCREEN_HEIGHT);
      g.addColorStop(0, b.fallbackTop || '#BFE8A0');
      g.addColorStop(1, b.fallbackBottom || '#8FD46F');
      c.save(); c.fillStyle = g; c.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT); c.restore();
      return;
    }

    c.save();
    c.translate(0, -this.scrollY);
    var viewTop = this.scrollY;
    var viewBottom = this.scrollY + SCREEN_HEIGHT;

    // ① 兜底底色：先铺可见区为不透明色，确保任何亚像素缝隙都落在底色上而非透明黑。
    //   背景为绿系渐变，这里用偏下缘的绿，缝隙（仅 1~2px）视觉无碍。
    var fb = cfg.background || {};
    c.fillStyle = fb.fallbackBottom || '#8FD46F';
    c.fillRect(0, Math.floor(viewTop), SCREEN_WIDTH, Math.ceil(viewBottom) - Math.floor(viewTop));

    for (var si = 0; si < this._segments.length; si++) {
      var seg = this._segments[si];
      if (seg.segTop + seg.segH < viewTop || seg.segTop > viewBottom) continue;
      var bgImg = this._bgImages[seg.bgKey];
      if (!bgImg || !bgImg.width) continue;
      // 背景向下延伸到「下一段顶部」(末段延伸到 contentHeight)，覆盖段间补白区域。
      var drawBottom = (si === this._segments.length - 1)
        ? this._contentHeight
        : this._segments[si + 1].segTop;
      // ② 整数对齐 + 跨段 overdraw ±1px：消除「浮点坐标经 DPR 放大后变成非整数物理
      //   像素 + 缩放插值边缘半透明」造成的 1~2px 透黑缝（Android 真机尤其明显）。
      //   各段背景图内容本就支持轻微位移/拉伸（<10% 不可见），±1px 重复/裁切完全无感。
      var top = Math.round(seg.segTop) - 1;     // 上探 1px：盖住上一段底边缝隙
      var bottom = Math.round(drawBottom) + 1;  // 下探 1px：盖住本段顶边缝隙
      var drawH = bottom - top;
      c.drawImage(bgImg, 0, top, SCREEN_WIDTH, drawH);
    }
    this._drawDecorations(c);   // 背景之上、路径之下（c 仍处 translate(0,-scrollY)）
    c.restore();
  }

  // ===== 路径（程序化无缝道路：白色半透明路身 + 绿色虚线中线）=====
  //   替代原图绘制（road PNG），保证跨段/跨图 100% 无缝连接。
  //   样式还原原图：白色半透路身(~50设计px宽) + 绿色虚线中线(#7ECB50 ~5.5设计px)。
  _renderRoad(c) {
    c = c || ctx;
    var levels = this._levels;
    if (levels.length < 2) return;

    var s = SCREEN_WIDTH / cfg.designWidth;
    var stepPx = 18 * s;   // 插值步长（world px）

    // 路径控制点（所有关卡中心）→ 先 Chaikin 倒圆角消除锐角，再 Catmull-Rom 平滑。
    //   Chaikin 保留首尾端点（首关/末关精确落在路端），内部每个尖角被切为圆弧，
    //   整体路由不变（仍依次经过各关），但转弯由「V 形锐角」变为「高速公路式缓弧」。
    var pathPts = this._computePathPts();

    c.save();

    // 第一层：白色半透明路身（粗实线）
    c.strokeStyle = 'rgba(255, 255, 255, 0.30)';
    c.lineWidth = 50 * s;       // 路身宽度（design px → world）
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.setLineDash([]);
    this._strokePath(pathPts, c);

    // 第二层：绿色虚线中线
    c.strokeStyle = '#7ECB50';
    c.lineWidth = 5.5 * s;
    // dash 数组：每根短线段长 / 线段间空白长（design px），由 cfg.roadDash 控制。
    //   默认 [6, 16] = 短线段 + 稀疏间隔（高速路面标线观感）。
    c.setLineDash([cfg.roadDash[0] * s, cfg.roadDash[1] * s]);
    this._strokePath(pathPts, c);

    c.restore();
  }

  // ===== 地图空白装饰（随机点缀）=====
  //   探测与随机都在构造期完成（会话内固定）；绘制插在背景之上、路径之下。
  _computePathPts() {
    if (this._pathPts) return this._pathPts;
    var levels = this._levels;
    if (!levels || levels.length < 2) { this._pathPts = []; return this._pathPts; }
    var s = SCREEN_WIDTH / cfg.designWidth;
    var stepPx = 18 * s;
    var pts = levels.map(function (l) { return { x: l.x, y: l.worldY }; });
    var smooth = this._chaikin(pts, cfg.roadSmoothIters || 2);
    this._pathPts = this._catmullRomPath(smooth, smooth.length, stepPx);
    return this._pathPts;
  }

  // 固定锚点装饰：按段展开。每段 bgKey 对应 decorationAnchors 一组锚点；
  // 背景图循环铺，故同组锚点每隔 3 段周期性复现。每锚点随机选一张装饰图，
  // 并按 noneChance 概率留空（不画）。会话内固定（构造时展开一次）。
  _buildDecorationItems() {
    this._decoItems = [];
    var anchors = cfg.decorationAnchors;
    if (!anchors || !this._segments || !this._segments.length) return;
    var s = SCREEN_WIDTH / cfg.designWidth;
    var d = cfg.decoration || {};
    var keys = cfg.decorations || [];
    var noneChance = (typeof d.noneChance === 'number') ? d.noneChance : 0.2;
    for (var si = 0; si < this._segments.length; si++) {
      var seg = this._segments[si];
      var group = anchors[seg.bgKey];
      if (!group || !group.length) continue;
      for (var i = 0; i < group.length; i++) {
        var a = group[i];
        var key = null;
        if (keys.length && Math.random() >= noneChance) {
          key = keys[Math.floor(Math.random() * keys.length)];
        }
        var jr = (d.jitter || 0) * s;                  // 抖动半径（world）
        var ang = Math.random() * Math.PI * 2, rad = Math.random() * jr;
        this._decoItems.push({
          x: a.x * s + Math.cos(ang) * rad,   // design → world + 圆形随机抖动
          y: seg.segTop + a.y * s + Math.sin(ang) * rad,
          key: key,                   // null = 本锚点留空
        });
      }
    }
  }

  // 背景层之上、路径之下绘制（c 已 translate(0,-scrollY)，直接用 world 坐标；以锚点为中心）。
  //   按图片实际像素尺寸 × 缩放绘制（自然比例），不再用固定 size，避免憋小/失真；
  //   带地面投影（shadow）增强“贴地”立体感。
  _drawDecorations(c) {
    var items = this._decoItems;
    if (!items || !items.length) return;
    var s = SCREEN_WIDTH / cfg.designWidth;
    var d = cfg.decoration || {};
    var sh = d.shadow || {};
    c.save();   // 隔离阴影设置，不污染后续绘制
    c.shadowColor = sh.color || 'rgba(0,0,0,0.25)';
    c.shadowBlur = (sh.blur || 6) * s;
    c.shadowOffsetX = (sh.offsetX || 0) * s;   // 负=向左（阳光右上方斜射）
    c.shadowOffsetY = (sh.offsetY || 4) * s;   // 正=向下
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it.key) continue;                       // 本锚点留空
      var img = AssetPreloader.get(it.key);
      if (!img || !AssetPreloader.isReady(it.key)) continue;
      var w = img.width * s, h = img.height * s;   // 实际尺寸 × design→world 缩放
      c.drawImage(img, it.x - w / 2, it.y - h / 2, w, h);
    }
    c.restore();
  }

  // ===== Chaikin 角点切割：把折线「倒圆角」，消除高速公路式的锐角 =====
  //   open curve 规则：保留首尾端点；内部每个顶点被替换为相邻边的 1/4、3/4 两点，
  //   原尖角即被一段平滑弧取代。iterations 越大越圆润（默认 2）。
  //   仅改变局部几何、不移动整体路由，故关卡仍依次被路径串接。
  _chaikin(pts, iterations) {
    var P = pts;
    for (var it = 0; it < iterations; it++) {
      if (P.length < 3) break;
      var Q = [P[0]];
      for (var i = 0; i < P.length - 1; i++) {
        var a = P[i], b = P[i + 1];
        Q.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
        Q.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
      }
      Q.push(P[P.length - 1]);
      P = Q;
    }
    return P;
  }

  // ===== Catmull-Rom 插值生成密集路径点 =====
  _catmullRomPath(pts, n, stepPx) {
    if (n === 2) return [{x:pts[0].x,y:pts[0].y},{x:pts[1].x,y:pts[1].y}];
    var out = [{x: pts[0].x, y: pts[0].y}];
    for (var i = 0; i < n - 1; i++) {
      var p0 = pts[Math.max(0, i - 1)];
      var p1 = pts[i];
      var p2 = pts[Math.min(n - 1, i + 1)];
      var p3 = pts[Math.min(n - 1, i + 2)];
      var dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      var steps = Math.max(1, Math.ceil(dist / stepPx));
      for (var st = 1; st <= steps; st++) {
        var t = st / steps, t2 = t * t, t3 = t2 * t;
        out.push({
          x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
        });
      }
    }
    return out;
  }

  // 沿路径点序列描边（单次 beginPath+stroke）
  _strokePath(pathPts, c) {
    c = c || ctx;
    if (!pathPts || pathPts.length < 2) return;
    c.beginPath();
    c.moveTo(pathPts[0].x, pathPts[0].y);
    for (var i = 1; i < pathPts.length; i++) c.lineTo(pathPts[i].x, pathPts[i].y);
    c.stroke();
  }

  // ===== 按钮（不变）=====
  _renderButtons(c) {
    c = c || ctx;
    var top = this.scrollY - 40;
    var bottom = this.scrollY + SCREEN_HEIGHT + 40;
    var prog = this._getProgress();

    c.save();
    for (var i = 0; i < this._levels.length; i++) {
      var lv = this._levels[i];
      if (lv.worldY < top || lv.worldY > bottom) continue;

      var id = lv.index + 1;
      var name = pad4(id);
      var stars = prog.starsMap[name] || 0;

      if (PREVIEW_CLEARED) {
        this._drawLevelButton(lv, { state: 'cleared', stars: 1 + (lv.index % 4), levelId: id }, c);
        continue;
      }
      if (lv.index <= prog.lastIdx) {
        this._drawLevelButton(lv, { state: 'cleared', stars: stars, levelId: id }, c);
      } else if (lv.index === prog.frontier) {
        this._drawLevelButton(lv, { state: 'current', levelId: id }, c);
      } else {
        this._drawLevelButton(lv, { state: 'locked', levelId: id }, c);
      }
    }
    c.restore();
  }

  _drawLevelButton(lv, opts, c) {
    c = c || ctx;
    var s = SCREEN_WIDTH / cfg.designWidth;
    var pressS = this._btnPress ? this._btnPress.getScale('lv' + lv.index) : 1;
    var isSmall = (opts.state === 'current' || opts.state === 'locked');
    c.save();
    c.translate(lv.x, lv.worldY);
    c.scale(s, s);
    if (isSmall) c.translate(0, -3.5);
    c.scale(pressS, pressS);
    LevelButton.draw(c, 0, 0, opts);
    c.restore();
  }

}

module.exports = LevelMap;
