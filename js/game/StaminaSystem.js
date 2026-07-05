// StaminaSystem — 体力系统（纯本地，无服务器）
// 体力以"个数"计，最大 5 个，每 1 小时恢复 1 个

var GameDefine = require('../define/GameDefine.js');
var ST = GameDefine.GAME.STAMINA;
var STORAGE_KEY = 'player_stamina';

// ========== 飞行动画配置（自行调参） ==========
var FLY = {
  DURATION: 1200,       // 飞行阶段时长 ms（从起点飞到终点）
  HOLD: 600,           // 到达后停留时长 ms
  ICON_SIZE: 24,        // 飞行中图标显示尺寸 px（与左上角一致）
  ARC_HEIGHT: 80,       // 弧线高度 px（抛物线顶点偏移，正值向上拱）
  EASING: 'easeOutCubic',  // 缓动类型（easeOutCubic / easeOutQuad）
};

// ========== 体力新增动效配置（自行调参） ==========
var FLIP = {
  DURATION: 400,        // 翻转动画时长 ms
};

/**
 * @typedef {Object} StaminaData
 * @property {number} count - 当前体力个数 (0~max)
 * @property {number} lastRecoveryTime - 上次恢复时间戳 (ms)
 * @property {number} adClaimedToday - 今日广告领取次数
 * @property {string} adClaimedDate - 广告领取记录的日期 (YYYY-MM-DD)
 */

function StaminaSystem() {
  this._data = null;
  this._flyAnim = null;  // { startTime, fromX, fromY, toX, toY, phase: 'fly'|'hold' }
  this._flyCallback = null;
  this._flipAnims = [];  // [{ index, startTime }]  体力新增翻转动画
  this._prevCount = -1;  // 上一帧的体力数，用于检测新增
}

/** 读取并同步体力 */
StaminaSystem.prototype.load = function () {
  var raw = null;
  try { raw = wx.getStorageSync(STORAGE_KEY); } catch (e) {}
  this._data = raw || { count: ST.MAX, lastRecoveryTime: Date.now(), adClaimedToday: 0, adClaimedDate: '' };
  this._data.max = ST.MAX;
  this._sync();
  return this._data;
};

/** 同步体力：根据时间差计算恢复量 */
StaminaSystem.prototype._sync = function () {
  if (this._data.count >= ST.MAX) {
    this._data.lastRecoveryTime = Date.now();
    return;
  }
  var now = Date.now();
  var elapsed = now - this._data.lastRecoveryTime;
  var recovered = Math.floor(elapsed / ST.RECOVERY_INTERVAL);
  if (recovered > 0) {
    var oldCount = this._data.count;
    this._data.count = Math.min(this._data.count + recovered, ST.MAX);
    this._data.lastRecoveryTime += recovered * ST.RECOVERY_INTERVAL;
    this._addFlips(oldCount, this._data.count);
  }
  this._save();
};

/** 保存到本地 */
StaminaSystem.prototype._save = function () {
  try { wx.setStorageSync(STORAGE_KEY, this._data); } catch (e) {}
};

// ========== 查询 ==========

/** 当前体力个数 */
StaminaSystem.prototype.getCount = function () {
  this._sync();
  return this._data.count;
};

/** 是否有足够体力 */
StaminaSystem.prototype.canPlay = function () {
  return this.getCount() >= ST.COST_PER_GAME;
};

/** 倒计时：距离下一次恢复还剩多少毫秒 */
StaminaSystem.prototype.getNextRecoveryMs = function () {
  this._sync();
  if (this._data.count >= ST.MAX) return 0;
  var now = Date.now();
  var elapsed = now - this._data.lastRecoveryTime;
  return ST.RECOVERY_INTERVAL - (elapsed % ST.RECOVERY_INTERVAL);
};

/** 倒计时 mm:ss */
StaminaSystem.prototype.getCountdownText = function () {
  var ms = this.getNextRecoveryMs();
  if (ms <= 0) return '';
  var s = Math.floor(ms / 1000);
  var m = Math.floor(s / 60);
  var sec = s % 60;
  return (m < 10 ? '0' + m : m) + ':' +
    (sec < 10 ? '0' + sec : sec); 
};

/** 今日广告领取次数 */
StaminaSystem.prototype.getAdClaimedToday = function () {
  this._resetAdIfNewDay();
  return this._data.adClaimedToday;
};

/** 今日剩余广告领取次数 */
StaminaSystem.prototype.getAdRemainingToday = function () {
  return Math.max(0, ST.AD_DAILY_LIMIT - this.getAdClaimedToday());
};

// ========== 操作 ==========

/** 消耗体力。返回是否成功 */
StaminaSystem.prototype.consume = function () {
  this._sync();
  if (this._data.count < ST.COST_PER_GAME) return false;
  this._data.count -= ST.COST_PER_GAME;
  if (this._data.count >= ST.MAX - 1) {
    this._data.lastRecoveryTime = Date.now();
  }
  this._save();
  return true;
};

/** 领取广告体力。返回是否成功 */
StaminaSystem.prototype.claimAd = function () {
  this._resetAdIfNewDay();
  if (this._data.adClaimedToday >= ST.AD_DAILY_LIMIT) return false;
  this._sync();
  var oldCount = this._data.count;
  this._data.count = Math.min(this._data.count + ST.AD_GAIN, ST.MAX);
  this._data.adClaimedToday++;
  this._addFlips(oldCount, this._data.count);
  if (this._data.count < ST.MAX) {
    this._data.lastRecoveryTime = Date.now();
  }
  this._save();
  return true;
};

StaminaSystem.prototype._resetAdIfNewDay = function () {
  var today = _getDateStr();
  if (this._data.adClaimedDate !== today) {
    this._data.adClaimedToday = 0;
    this._data.adClaimedDate = today;
  }
};

function _getDateStr() {
  var d = new Date();
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

// ========== 飞行动画 ==========

/** 启动体力飞行动画（使用 FLY 配置） */
StaminaSystem.prototype.startFly = function (fromX, fromY, toX, toY, callback) {
  this._flyAnim = {
    startTime: Date.now(),
    fromX: fromX, fromY: fromY,
    toX: toX, toY: toY,
    phase: 'fly'
  };
  this._flyCallback = callback || null;
};

/** 更新飞行动画，返回 { x, y, progress, phase, done } */
StaminaSystem.prototype.updateFly = function () {
  if (!this._flyAnim) return null;
  var elapsed = Date.now() - this._flyAnim.startTime;
  var a = this._flyAnim;

  if (a.phase === 'fly') {
    var rawT = Math.min(elapsed / FLY.DURATION, 1);
    var t;
    if (FLY.EASING === 'easeOutQuad') {
      t = rawT * (2 - rawT);
    } else {
      t = 1 - Math.pow(1 - rawT, 3);  // easeOutCubic
    }
    // 二次贝塞尔弧线：右上抛出 → 远飞再弧线转回
    var cpx = a.fromX + (a.toX - a.fromX) * 0.4 + 80;
    var cpy = Math.min(a.fromY, a.toY) - FLY.ARC_HEIGHT * 2.2;
    var mt = 1 - t;
    var x = mt * mt * a.fromX + 2 * mt * t * cpx + t * t * a.toX;
    var y = mt * mt * a.fromY + 2 * mt * t * cpy + t * t * a.toY;
    if (rawT >= 1) {
      a.phase = 'hold';
      a.startTime = Date.now();
    }
    return { x: x, y: y, progress: rawT, phase: 'fly', done: false };
  }

  // hold 阶段：停在终点
  if (a.phase === 'hold') {
    var holdT = elapsed / FLY.HOLD;
    if (holdT >= 1) {
      this._flyAnim = null;
      if (this._flyCallback) { var cb = this._flyCallback; this._flyCallback = null; cb(); }
      return { x: a.toX, y: a.toY, progress: 1, phase: 'hold', done: true };
    }
    return { x: a.toX, y: a.toY, progress: holdT, phase: 'hold', done: false };
  }

  return null;
};

/** 飞行动画是否进行中 */
StaminaSystem.prototype.isFlying = function () {
  return !!this._flyAnim;
};

// ========== 体力新增翻转动画 ==========

/** 检测体力新增并触发翻转（从 oldCount 到 newCount） */
StaminaSystem.prototype._addFlips = function (oldCount, newCount) {
  var audio = require('../audio/AudioManager.js');
  for (var i = oldCount; i < newCount; i++) {
    this._flipAnims.push({ index: i, startTime: Date.now() });
    audio.play('stamina_add');
  }
};

/** 获取并清理已完成的翻转动画。返回 [{ index, progress }] */
StaminaSystem.prototype.updateFlips = function () {
  var active = [];
  var now = Date.now();
  for (var i = this._flipAnims.length - 1; i >= 0; i--) {
    var f = this._flipAnims[i];
    var progress = (now - f.startTime) / FLIP.DURATION;
    if (progress >= 1) {
      this._flipAnims.splice(i, 1);
    } else {
      active.push({ index: f.index, progress: progress });
    }
  }
  return active;
};

/** 是否有翻转动画进行中 */
StaminaSystem.prototype.hasFlips = function () {
  return this._flipAnims.length > 0;
};

module.exports = StaminaSystem;
