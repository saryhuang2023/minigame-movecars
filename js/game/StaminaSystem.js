// StaminaSystem — 体力系统（纯本地，无服务器）
// 体力以"个数"计，最大 5 个，每 1 小时恢复 1 个

var GameDefine = require('../define/GameDefine.js');
var ST = GameDefine.GAME.STAMINA;
var STORAGE_KEY = 'player_stamina';

// ========== 飞行动画配置（自行调参） ==========
// 与金币/道具飞行同语言：单段二次贝塞尔 + easeInOutCubic，
// 中段最快、两端减速 —— 平滑上抛弧、轻轻吸附进目标（不再「俯冲砸下」）。
var FLY = {
  DUR: 780,         // 飞行总时长 ms（与金币飞行对齐）
  HOLD: 60,         // 抵达后短暂停留，随后触发「嵌入」特效
  ICON_SIZE: 20,    // 飞行中图标显示尺寸 px（与底部一致）
  ARC_HEIGHT: 80,   // 弧线控制点相对「起→终」直线中点上移量 px（越大越抛）
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
    this._save();   // 懒写入：仅在体力「真的恢复」时才落盘
  }
  // recovered === 0 时不写盘：避免启动即重写 player_stamina，
  // 清缓存后该 key 不再被「复活」（只在消耗/领广告等真实变更时才会重建）
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
    ctrlX: null, ctrlY: null,          // 贝塞尔控制点（二次曲线，上抛弧），首次 update 时计算
    lastX: fromX, lastY: fromY,        // 上一帧坐标，用于估算速度（做拉伸/残影）
    phase: 'fly'
  };
  this._flyCallback = callback || null;
};

/** 更新飞行动画，返回 { x, y, vx, vy, progress, phase, done } */
StaminaSystem.prototype.updateFly = function () {
  if (!this._flyAnim) return null;
  var now = Date.now();
  var a = this._flyAnim;
  var elapsed = now - a.startTime;

  // 控制点：起→终 直线中点，向上抬高 ARC_HEIGHT，形成平滑上抛弧（与金币飞行同语言）
  if (a.ctrlX == null) {
    a.ctrlX = (a.fromX + a.toX) / 2;
    a.ctrlY = Math.min(a.fromY, a.toY) - FLY.ARC_HEIGHT;
  }

  // ① 飞行段：二次贝塞尔 + easeInOutCubic（中段最快、两端减速 → 平滑吸附，无硬砸）
  if (a.phase === 'fly') {
    var rawT = Math.min(elapsed / FLY.DUR, 1);
    var t = rawT < 0.5 ? 4 * rawT * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 3) / 2;
    var mt = 1 - t;
    var x = mt * mt * a.fromX + 2 * mt * t * a.ctrlX + t * t * a.toX;
    var y = mt * mt * a.fromY + 2 * mt * t * a.ctrlY + t * t * a.toY;
    var vx = x - a.lastX, vy = y - a.lastY;
    a.lastX = x; a.lastY = y;
    if (rawT >= 1) { a.phase = 'hold'; a.startTime = now; }
    return { x: x, y: y, vx: vx, vy: vy, progress: rawT, phase: 'fly', done: false };
  }

  // ② 抵达停留：极短，随后触发「嵌入」特效
  if (a.phase === 'hold') {
    var holdT = elapsed / FLY.HOLD;
    if (holdT >= 1) {
      this._flyAnim = null;
      if (this._flyCallback) { var cb = this._flyCallback; this._flyCallback = null; cb(); }
      return { x: a.toX, y: a.toY, vx: 0, vy: 0, progress: 1, phase: 'hold', done: true };
    }
    return { x: a.toX, y: a.toY, vx: 0, vy: 0, progress: holdT, phase: 'hold', done: false };
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
