// 关卡地图（主页）
// 路径 + 沿路径固定的关卡按钮，整段随相机 scrollY 无缝滑动；背景由主界面 drawBackground 负责。
// 数据全部来自真实进度：
//   - 总关数：assets/levels/index.json 的 maxLevel（或云端 _cloudMaxLevel）
//   - 每关星级：wx.getStorageSync('levelStars') → { '0001': 3, ... }
//   - 进度边界：wx.getStorageSync('lastLevelIndex')（已完成关的 0 基索引），frontier = lastLevelIndex + 1
// 状态：i<=lastIdx → cleared（最终版 LevelButton）；i===frontier → current（占位）；其余 → locked（占位）。
//
// 布局（用户定稿，全固定坐标，不再程序化生成）：
//   - 路径图 main_level_road.png（220.54×626.5，水平居中）按「段」平铺，一段含 11 个固定槽位，
//     段 0（含第 1 关）在最底部，段 1 起向上叠。
//   - 11 个槽位中心（design 393 画布）作为各关世界锚点；钮按状态定尺寸
//     （cleared→70×68 / current·locked→69×68 小图）。
//   - 锚点：第一关按钮底 ↔ 开始钮顶 保证间隙（设计 30px）；背景整屏平铺随地图滚动。

const { ctx, SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');
const cfg = require('../define/LevelMapConfig.js');
const databus = require('../databus.js');
const LevelButton = require('./widgets/LevelButton.js');
const ButtonPress = require('../anim/ButtonPress.js');

// 开发预览开关：默认 false（走真实进度数据，符合「已通关按钮按最终正式版」要求）。
// 置 true 可让所有按钮临时渲染为「已通关」并循环 1~4 星，方便直接核对 cleared 按钮最终效果。
// 正式发布前保持 false 即可，无需删除此开关。
const PREVIEW_CLEARED = false;

// 关卡名 = 4 位零填充（与 GameEngine._buildProjectLevels / PlayingEngine 一致）
function pad4(n) { return String(n).padStart(4, '0'); }

class LevelMap {
  constructor() {
    this._touching = false;
    this._lastY = 0;
    this._vel = 0;             // 惯性速度（px/帧）
    this._lastTime = 0;
    this._alpha = 1;           // 叠加层：直接以满透明度叠加在主界面之上

    this._bgImg = null;        // 草原背景图（由 GameEngine 注入，随路径同速滚动）
    this._bgReady = false;
    this._roadImg = null;      // 路径图（由 GameEngine 注入，按段平铺）
    this._handImg = null;      // 引导手（由 GameEngine 注入，指向开始按钮）

    // 关卡点击进入 + 通用按压反馈（复用项目 ButtonPress，与开始/设置按钮完全一致的按下回弹体感）
    this._btnPress = new ButtonPress();   // 按压回弹动画：按下缩 0.95 → 松手 easeOutBack 回弹 1.0
    this._pressingLevel = false;          // 当前手指是否【按在某可点击关卡上】→ 本回合不滚地图、按钮显示按压态
    this._pressedLevelIdx = -1;           // 被按下的关卡索引；-1 无
    this._entering = false;     // 进关流程进行中（屏蔽重复点击）
    this._tapStartX = 0; this._tapStartY = 0; this._tapMoved = false; this._tapCandidate = -1;
    this.onSelectLevel = null;  // GameEngine 注入：选中关卡回调(index, state)

    this._cloudMaxSeen = databus._cloudMaxLevel || 0;
    this._total = this._readTotal();   // 真实总关数（index.json + localStorage + 文件扫描，三道防线）
    this._buildLevels();
    this.scrollY = this._computeFrontierScroll();   // 从第一帧就定位在当前关
  }

  // 真实总关数：扫描本地关卡缓存 + localStorage 云端记录 + index.json 兜底
  _readTotal() {
    var localMax = 0;
    try {
      var fs = wx.getFileSystemManager();
      var indexRaw = fs.readFileSync('assets/levels/index.json', 'utf8');
      var indexData = JSON.parse(indexRaw);
      if (typeof indexData.maxLevel === 'string') localMax = parseInt(indexData.maxLevel, 10) || 0;
      else if (typeof indexData.maxLevel === 'number') localMax = indexData.maxLevel;
      else if (Array.isArray(indexData)) localMax = indexData.length;
    } catch (e) { /* 无 index.json */ }

    // 云端记录（实时 databus + localStorage 持久化）
    var cloudMax = databus._cloudMaxLevel || 0;
    try { cloudMax = Math.max(cloudMax, parseInt(wx.getStorageSync('_cloudMaxLevel'), 10) || 0); } catch (e) {}

    // 本地缓存：扫描 USER_DATA_PATH/levels/ 下已下载的 .json 文件数量（离线可用）
    var cachedCount = 0;
    try {
      var dir = wx.env.USER_DATA_PATH + '/levels';
      var files = fs.readdirSync(dir);
      for (var fi = 0; fi < files.length; fi++) {
        if (/^\d{4}\.json$/.test(files[fi])) cachedCount++;
      }
    } catch (e) { /* 首次游玩，目录可能不存在 */ }

    return Math.max(localMax, cloudMax, cachedCount) || 11;
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
      this.scrollY = this._computeFrontierScroll();   // 云端数据更新后重新定位
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

  // 计算定位到最新关的 scrollY 值（全通关则最后一关，使目标关在屏幕上部约 35% 处）
  _computeFrontierScroll() {
    if (!this._levels || this._levels.length === 0) return 0;
    var prog = this._getProgress();
    var targetIdx = Math.min(prog.frontier, this._levels.length - 1);
    if (targetIdx < 0) targetIdx = 0;
    var lv = this._levels[targetIdx];
    var targetScroll = lv.worldY - SCREEN_HEIGHT * 0.35;
    return Math.max(0, Math.min(targetScroll, this._maxScroll));
  }

  _scrollToFrontier() {
    this.scrollY = this._computeFrontierScroll();
  }

  // 构建固定槽位布局（第一章）：11 槽位/段平铺，段 0 含第 1 关位于最底。
  // 锚点：第一关按钮底 ↔ 开始钮顶 保持设计 30px 屏幕间距；背景整屏平铺随地图滚动。
  _buildLevels() {
    this._scale = SCREEN_WIDTH / cfg.designWidth;   // 设计 → 世界 缩放（按宽充满）
    var s = this._scale;
    var roadH = cfg.road.h * s;                      // 单段路高（世界 px）
    var N = Math.max(11, this._total || 0);          // 至少铺满 1 段（11 槽）
    var numPages = Math.max(1, Math.ceil(N / cfg.slots.length));

    // 内容总高 = (段数-1)·段高 + 862·s。其中 862 = 段高(626.5) + 间隙区(235.5)，
    //   间隙区让「第一关底↔开始钮顶」在设计 30px（见下方 _maxScroll 推导）。
    this._contentHeight = (numPages - 1) * roadH + 862 * s;
    this._maxScroll = Math.max(0, this._contentHeight - SCREEN_HEIGHT);

    // 段 p 顶部世界 Y：段 0（含第1关）在最底，段 1 起向上叠。
    //   contentTop=0 → 段(numPages-1) 顶在 0；段 p 顶 = (numPages-1-p)·roadH。
    this._levels = [];
    for (var i = 0; i < N; i++) {
      var page = Math.floor(i / cfg.slots.length);
      var slot = i % cfg.slots.length;
      var sd = cfg.slots[slot];
      var segTop = (numPages - 1 - page) * roadH;     // 该段顶部世界 Y
      var cx = (sd.left + sd.w / 2) * s;              // 槽位中心 X（世界 px）
      var cy = segTop + (sd.top + sd.h / 2) * s;      // 槽位中心 Y（世界 px）
      this._levels.push({
        index: i,
        x: cx,
        worldY: cy,
        slotW: sd.w,
        slotH: sd.h,
      });
    }
  }

  // 路径图（按段平铺）
  setRoad(img) { this._roadImg = img || null; }
  // 引导手
  setHand(img) { this._handImg = img || null; }
  // 注入草原背景图（GameEngine 加载完成后调用）
  setBackground(img) {
    this._bgImg = img || null;
    this._bgReady = !!(img && img.width);
  }

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

  /** 命中测试：屏幕坐标 → 世界坐标，返回所在关索引；未命中返回 -1。按状态用对应半尺寸。 */
  _hitTestLevel(sx, sy) {
    var wY = sy + this.scrollY;                 // 屏幕 y → 世界 y
    var s = this._scale;
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
    this._renderRoad();
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

  // 引导手独立层：指向开始按钮（屏幕固定 HUD）。
  //   由 GameEngine 在 renderMenu（开始按钮）之后调用，保证手绘制在按钮之上，不被按钮遮挡。
  //   仅主菜单显示；进入关卡/其它状态隐藏。
  //   延迟显示：主菜单显示后（databus._menuEntranceDoneAt 由 GameEngine 在菜单显示时刻写入），再等 HAND_DELAY_MS 才出现。
  //   点击开始按钮（菜单出场）瞬间隐藏：_menuExiting 由 GameEngine._startMenuExit 设 true，本帧即停画。
  renderHand() {
    if (databus.gameState !== 'menu') return;
    if (databus._menuExiting) return;                     // 正在出场：立即隐藏，不等动画播完
    var doneAt = databus._menuEntranceDoneAt || 0;
    if (!doneAt) return;                                  // 入场未完成，不显示
    if (Date.now() - doneAt < LevelMap.HAND_DELAY_MS) return;  // 入场后延迟未到，不显示
    this._renderHand();
  }

  renderBackground() {
    if (this._bgReady && this._bgImg) {
      // 背景图严格缩放至一屏尺寸（dw=SCREEN_WIDTH, dh=SCREEN_HEIGHT），随地图滚动平铺。
      var dw = SCREEN_WIDTH, dh = SCREEN_HEIGHT;
      ctx.save();
      ctx.translate(0, -this.scrollY);
      var gridOffset = ((this._contentHeight % dh) + dh) % dh;
      var t0 = Math.floor((this.scrollY - gridOffset) / dh);
      var t1 = Math.floor((this.scrollY + SCREEN_HEIGHT - gridOffset) / dh);
      for (var ti = t0; ti <= t1; ti++) {
        ctx.drawImage(this._bgImg, 0, ti * dh + gridOffset, dw, dh);
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

  // 路径图平铺：每段一张 main_level_road.png（设计 220.54×626.5，水平居中），
  //   段 0 在最底、段 1 起向上叠。仅绘制可见段（世界 Y 落在屏幕范围内的）。
  //   ⚠️ 路图 PNG 实际像素可能含透明 padding（如 815×1956），与 config 的 w/h 宽高比不同。
  //     若直接用 config w/h 做 dstRect 会导致非均匀拉伸 → 路径偏移、按钮不对齐。
  //     故采用「固定段高 + 按 PNG 实际宽高比算宽」策略：保持路图不变形。
  _renderRoad() {
    if (!this._roadImg || !this._roadImg.width) return;
    var s = this._scale;
    var roadH = cfg.road.h * s;                                    // 段高（世界 px），锚定值
    var imgAspect = this._roadImg.width / this._roadImg.height;    // PNG 原始宽高比
    var roadW = roadH * imgAspect;                                 // 按比例算出的实际显示宽度
    var roadLeft = (SCREEN_WIDTH - roadW) / 2;                     // 水平居中
    var numPages = Math.max(1, Math.ceil(this._levels.length / cfg.slots.length));

    var yTop = this.scrollY - roadH;
    var yBottom = this.scrollY + SCREEN_HEIGHT + roadH;
    ctx.save();
    for (var p = 0; p < numPages; p++) {
      var segTop = (numPages - 1 - p) * roadH;
      if (segTop + roadH < yTop || segTop > yBottom) continue;
      ctx.drawImage(this._roadImg, roadLeft, segTop, roadW, roadH);
    }
    ctx.restore();
  }

  _renderButtons() {
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
        this._drawLevelButton(lv, {
          state: 'cleared', stars: 1 + (lv.index % 4), levelId: id,
        });
        continue;
      }
      if (lv.index <= prog.lastIdx) {
        this._drawLevelButton(lv, {
          state: 'cleared', stars: stars, levelId: id,
        });
      } else if (lv.index === prog.frontier) {
        this._drawLevelButton(lv, {
          state: 'current', levelId: id,
        });
      } else {
        this._drawLevelButton(lv, {
          state: 'locked', levelId: id,
        });
      }
    }
    ctx.restore();
  }

  // 地图钮缩放绘制：以 (lv.x, lv.worldY) 为中心绘制 frame，再按状态缩放。
  //   cleared → 70×68 钮（居中贴在 frame 中心）。
  //   current/locked → 69×69 小钮（图在 frame 局部 (24,27)，视觉中心比 frame 中心低 3.5px）
  //     → 这里把 frame 中心上移 3.5*scale，使小钮视觉中心正好落在槽位中心 (lv.x, lv.worldY)。
  // 叠加项目通用的按压回弹反馈（ButtonPress）：按下时整钮缩到 0.95、松手 easeOutBack 回弹 1.0，
  //   与开始/设置/通用按钮完全一致。
  _drawLevelButton(lv, opts) {
    var s = this._scale;
    var pressS = this._btnPress ? this._btnPress.getScale('lv' + lv.index) : 1;
    var isSmall = (opts.state === 'current' || opts.state === 'locked');
    ctx.save();
    ctx.translate(lv.x, lv.worldY);   // 槽位中心（世界 px）
    ctx.scale(s, s);                  // 设计 px 空间
    if (isSmall) ctx.translate(0, -3.5);   // 小钮视觉中心比 frame 中心低 3.5，上移补偿
    ctx.scale(pressS, pressS);        // 按压回弹（设计 px 空间）
    LevelButton.draw(ctx, 0, 0, opts);   // frame 中心在原点
    ctx.restore();
  }

  // 引导手：指向「开始按钮」(main_start.png)，以图像**左上角（指尖）**为锚点定位。
  //   手图 anatomy：指尖在左上、红色袖口在右下（朝上指的手势）。
  //   offsetX/offsetY = 手图左上角(指尖)相对「开始按钮中心」的设计 px 偏移。
  //   开始按钮为屏幕固定 HUD（不随地图滚动），本方法绘制于屏幕空间（GameEngine 在开始按钮之后调用），
  //     故指尖直接落在按钮的屏幕固定位（不含 scrollY）。
  //   不透明度恒为 1（不做半透明处理）；播放缓慢点击引导动画：1.1s 周期，sin 脉冲 + 向下指。
  _renderHand() {
    if (!this._handImg || !this._handImg.width) return;

    var s = this._scale;
    // 开始按钮屏幕中心（与 GameEngine.renderMenu 同一套计算：180×86 / bottom 34 / 水平居中）
    var startScale = SCREEN_WIDTH / 393;
    var startW = 180 * startScale;
    var startH = 86 * startScale;
    var startCX = SCREEN_WIDTH / 2 - 0.5 * startScale;          // 按钮中心 X（屏幕）
    var startCY = SCREEN_HEIGHT - 34 * startScale - startH / 2; // 按钮中心 Y（屏幕）

    // 点击引导：1.1s 一个循环，先抬起再按下（tap 向下指）。
    var period = 1100;
    var phase = (Date.now() % period) / period;          // 0..1
    var tap = Math.sin(phase * Math.PI);                 // 0→1→0（按下到最低点）
    // 指尖(图像左上角)锚点：开始按钮中心 + 偏移（屏幕空间，不含 scrollY），tap 向下点按压入按钮。
    var ax = startCX + cfg.hand.offsetX * s+30;
    var ay = startCY + cfg.hand.offsetY * s + tap * 9 * s - 20;

    ctx.save();
    ctx.globalAlpha = this._alpha;   // 不透明白，不随 tap 改变
    ctx.translate(ax, ay);                                 // 屏幕空间（按钮为固定 HUD）
    ctx.drawImage(this._handImg, 0, 0, cfg.hand.w * s, cfg.hand.h * s);  // 左上角(指尖)=锚点
    ctx.restore();
  }
}

// 引导手延迟：主界面入场动画完成后，再等此时长(ms)才出现。
LevelMap.HAND_DELAY_MS = 3000;

module.exports = LevelMap;
