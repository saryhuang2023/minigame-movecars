// 连击系统 — 纯逻辑模块（组合模式，由 PlayingEngine 持有）
// 职责：计数、计时器、最大连击记录、UI 组件调度
// 不依赖 PlayingEngine，仅需要 ComboWidget 引用 + 窗口时长

function ComboSystem(comboWindow) {
  this._count = 0;               // 当前连击数
  this._maxCombo = 0;            // 本局最大连击
  this._timer = null;            // 重置窗口定时器
  this._startTime = 0;           // 当前连击窗口起始时间
  this._window = comboWindow || 3000;
  this._widget = null;           // ComboWidget 引用（延迟绑定）
}

/**
 * 绑定 UI 组件（PlayingEngine 在 _setupUI 后调用）
 */
ComboSystem.prototype.setWidget = function(widget) {
  this._widget = widget;
};

/** 获取本局最大连击数（供结算面板使用） */
ComboSystem.prototype.getMaxCombo = function() {
  return this._maxCombo;
};

/** 获取当前连击数 */
ComboSystem.prototype.getCount = function() {
  return this._count;
};

/** 连击是否进行中（count >= 2） */
ComboSystem.prototype.isActive = function() {
  return this._count >= 2;
};

/**
 * 重置全部状态（关卡启动/退出时调用）
 * widget 可能未绑定，加判空守卫
 */
ComboSystem.prototype.reset = function() {
  this._count = 0;
  if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  this._maxCombo = 0;
  this._startTime = 0;
  if (this._widget) this._widget.reset();
};

/**
 * 触发一次连击（猪逃脱时调用）
 * 自动管理计数+窗口计时器，≥2 连时广播到 UI 组件
 */
ComboSystem.prototype.trigger = function() {
  this._count++;
  if (this._count > this._maxCombo) this._maxCombo = this._count;
  this._startTime = Date.now();

  // 重置窗口计时器
  if (this._timer) clearTimeout(this._timer);
  var self = this;
  this._timer = setTimeout(function() {
    self._count = 0;
    self._timer = null;
    if (self._widget) self._widget.close();
  }, this._window);

  // 2 连及以上通知 UI
  if (this._count >= 2 && this._widget) {
    this._widget.trigger(this._count);
  }
};

module.exports = ComboSystem;
