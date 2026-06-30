// LoadingManager.js — 三阶段加载调度器
// 协调 Phase1→Phase2→Phase3 资源加载，提供统一进度值 (0→1)

var PigRenderer = require('../render/PigRenderer.js');
var config = require('./LoadingConfig.js');
var cloud = require('../cloud.js');
var audio = require('../audio/AudioManager.js');
var Theme = require('../ui/Theme.js');
var SkinSystem = require('../game/SkinSystem.js');
var GoldSystem = require('../game/GoldSystem.js');
var AssetPreloader = require('../ui/AssetPreloader.js');

function LoadingManager() {
  this._progress = 0;
  this._done = false;
  this._phase = 0;              // 0=未开始, 1/2/3
  this._onDoneFns = [];

  // 存储加载完成的资源
  this._images = {};            // path → Image（所有已加载图片）
  this._playerData = null;      // 云端玩家数据
  this._cloudLevelRange = null; // 云端关卡范围
  this._chapterData = null;     // 云端章节配置

  // Phase 各子项进度
  this._p1 = { idleLoaded: 0, imgLoaded: 0, fontLoaded: false };
  this._p2 = { imgLoaded: 0, animLoaded: 0, audioProgress: 0 };
  this._p3 = { endpointsDone: 0 };

  // 定时器
  this._pollTimer = null;
}

// ===== 公开 API =====

/** 启动加载流程 */
LoadingManager.prototype.start = function () {
  var self = this;
  console.log('[LoadingManager] === 开始三阶段加载 ===');

  // === Phase 1: 关键资源（0-40%） ===
  this._phase = 1;
  self._loadPhase1();

  // 建立轮询：每帧更新进度
  this._pollTimer = setInterval(function () {
    self._tick();
  }, 50);
};

/** 获取当前进度 (0~1) */
LoadingManager.prototype.getProgress = function () {
  return this._progress;
};

/** 是否加载完成 */
LoadingManager.prototype.isDone = function () {
  return this._done;
};

/** 注册完成回调 */
LoadingManager.prototype.onDone = function (fn) {
  if (this._done) { fn(); return; }
  this._onDoneFns.push(fn);
};

/** 获取已加载的图片 */
LoadingManager.prototype.getImage = function (path) {
  return this._images[path] || null;
};

/** 获取云端数据 */
LoadingManager.prototype.getPlayerData = function () { return this._playerData; };
LoadingManager.prototype.getCloudLevelRange = function () { return this._cloudLevelRange; };
LoadingManager.prototype.getChapterData = function () { return this._chapterData; };

// ===== 内部：各阶段加载 =====

LoadingManager.prototype._loadPhase1 = function () {
  var self = this;
  var p1 = config.PHASE1;

  // 1. 加载 idle 动画帧（LoadingRenderer 画猪需要）
  PigRenderer.preloadIdle(function (loaded, total) {
    self._p1.idleLoaded = loaded;
  });

  // 2. 加载 bg.jpg + coin.png
  for (var i = 0; i < p1.images.length; i++) {
    var item = p1.images[i];
    self._loadOneImage(item.key, item.path, function () {
      self._p1.imgLoaded++;
    });
  }

  // 3. 加载字体
  if (typeof wx !== 'undefined' && wx.loadFont) {
    try {
      var family = wx.loadFont(p1.fontPath);
      if (family) {
        Theme.font.family = family;
        console.log('[LoadingManager] 字体加载成功: ' + family);
      }
      self._p1.fontLoaded = true;
    } catch (e) {
      console.warn('[LoadingManager] 字体加载失败:', e && e.message);
      self._p1.fontLoaded = true; // 失败也算完成，不阻塞
    }
  } else {
    self._p1.fontLoaded = true;
  }
};

LoadingManager.prototype._startPhase2 = function () {
  var self = this;
  var p2 = config.PHASE2;
  this._phase = 2;
  console.log('[LoadingManager] → Phase 2 开始（游戏资源）');

  // 1. 加载所有游戏图片
  for (var i = 0; i < p2.images.length; i++) {
    (function (path) {
      self._loadOneImage(null, path, function () {
        self._p2.imgLoaded++;
      });
    })(p2.images[i]);
  }

  // 2. 加载非 idle 动画帧（run/escape/hint）
  PigRenderer.preloadAllAnims(function (loaded, total) {
    self._p2.animLoaded = loaded;
  });

  // 3. 启动音频下载
  if (p2.audioEnabled) {
    audio.init(function (progress) {
      self._p2.audioProgress = progress;
    });
  }
};

LoadingManager.prototype._startPhase3 = function () {
  var self = this;
  this._phase = 3;
  console.log('[LoadingManager] → Phase 3 开始（云端数据）');

  // 1. 拉取玩家数据
  cloud.getPlayerData().then(function (res) {
    if (res && res.code === 0 && res.data) {
      self._playerData = res.data;
      console.log('[LoadingManager] 云端玩家数据就绪');
    }
    self._p3.endpointsDone++;
  }).catch(function (err) {
    console.warn('[LoadingManager] getPlayerData 失败:', err && err.message);
    self._p3.endpointsDone++;
  });

  // 2. 拉取关卡范围
  cloud.listLevels().then(function (range) {
    self._cloudLevelRange = range;
    console.log('[LoadingManager] 云端关卡范围就绪:', JSON.stringify(range));
    self._p3.endpointsDone++;
  }).catch(function (err) {
    console.warn('[LoadingManager] listLevels 失败:', err && err.message);
    self._p3.endpointsDone++;
  });

  // 3. 拉取章节配置
  cloud.downloadCloudFile('level/chapter.json').then(function (data) {
    if (data && Array.isArray(data)) {
      self._chapterData = data;
      GoldSystem.setChapters(data);
      console.log('[LoadingManager] 云端章节配置就绪: ' + data.length + ' 章');
    }
    self._p3.endpointsDone++;
  }).catch(function (err) {
    console.warn('[LoadingManager] chapter.json 失败:', err && err.message);
    self._p3.endpointsDone++;
  });

  // 4. 皮肤配置（fire-and-forget，不阻塞）
  SkinSystem.loadConfig(function () {
    console.log('[LoadingManager] 皮肤配置就绪');
    self._p3.endpointsDone++;
  });
};

// ===== 内部：每帧更新 =====

LoadingManager.prototype._tick = function () {
  if (this._done) return;

  switch (this._phase) {
    case 1: this._tickPhase1(); break;
    case 2: this._tickPhase2(); break;
    case 3: this._tickPhase3(); break;
  }
};

LoadingManager.prototype._tickPhase1 = function () {
  var w = config.PHASE_WEIGHTS;
  var p1 = config.PHASE1;

  // Phase 1 子项权重分配: idleFrames 50%, images 25%, font 25%
  var idleRatio = this._p1.idleLoaded / p1.idleFrameCount;
  var imgRatio = this._p1.imgLoaded / p1.images.length;
  var fontRatio = this._p1.fontLoaded ? 1 : 0;

  var phaseProgress = idleRatio * 0.50 + imgRatio * 0.25 + fontRatio * 0.25;
  this._progress = phaseProgress * w.phase1;

  // 检查阶段完成
  if (this._p1.idleLoaded >= p1.idleFrameCount &&
      this._p1.imgLoaded >= p1.images.length &&
      this._p1.fontLoaded) {
    this._progress = w.phase1; // 精确卡位
    this._startPhase2();
  }
};

LoadingManager.prototype._tickPhase2 = function () {
  var w = config.PHASE_WEIGHTS;
  var p2 = config.PHASE2;

  // Phase 2 子项权重: images 40%, animFrames 35%, audio 25%
  var imgRatio = this._p2.imgLoaded / p2.images.length;
  var animRatio = this._p2.animLoaded / p2.animationTotalFrames;
  var audioRatio = this._p2.audioProgress; // audio.init 的 progress 已是 0~1

  if (!p2.audioEnabled) audioRatio = 1; // 音频未启用 → 视为完成

  var phaseProgress = imgRatio * 0.40 + animRatio * 0.35 + audioRatio * 0.25;
  this._progress = w.phase1 + phaseProgress * w.phase2;

  // 检查阶段完成
  if (imgRatio >= 1 && animRatio >= 1 && audioRatio >= 1) {
    this._progress = w.phase1 + w.phase2;
    this._startPhase3();
  }
};

LoadingManager.prototype._tickPhase3 = function () {
  var w = config.PHASE_WEIGHTS;
  var p3 = config.PHASE3;

  // Phase 3: 简单平均
  var ratio = this._p3.endpointsDone / p3.endpointCount;
  this._progress = w.phase1 + w.phase2 + ratio * w.phase3;

  // 检查完成
  if (this._p3.endpointsDone >= p3.endpointCount) {
    this._progress = 1.0;
    this._finish();
  }
};

// ===== 内部：单图加载 =====

LoadingManager.prototype._loadOneImage = function (key, path, onDone) {
  var self = this;
  var img = wx.createImage();

  img.onload = function () {
    if (key) self._images[key] = img;
    self._images[path] = img;
    if (onDone) onDone();
  };
  img.onerror = function (err) {
    console.warn('[LoadingManager] 图片加载失败: ' + path + ' ' + (err && err.message || ''));
    if (onDone) onDone(); // 失败也记数，不阻塞
  };

  img.src = path;
};

// ===== 完结 =====

LoadingManager.prototype._finish = function () {
  var self = this;
  if (this._done) return;
  this._done = true;
  this._progress = 1.0;

  if (this._pollTimer) {
    clearInterval(this._pollTimer);
    this._pollTimer = null;
  }

  // 将加载完成的图片注入 AssetPreloader（保持旧 UI 组件兼容）
  var map = config.ASSET_PRELOADER_MAP;
  var assetKeys = Object.keys(map);
  for (var i = 0; i < assetKeys.length; i++) {
    var key = assetKeys[i];
    var path = map[key];
    var img = this._images[path];
    if (img) {
      AssetPreloader.set(key, img);
    }
  }
  console.log('[LoadingManager] AssetPreloader 注入完成: ' + assetKeys.length + ' 个 key');

  console.log('[LoadingManager] === 全部资源加载完成 ===');

  // 触发完成回调
  for (var j = 0; j < this._onDoneFns.length; j++) {
    try { this._onDoneFns[j](); } catch (e) {
      console.error('[LoadingManager] onDone 回调异常:', e);
    }
  }
  this._onDoneFns = [];
};

module.exports = LoadingManager;
