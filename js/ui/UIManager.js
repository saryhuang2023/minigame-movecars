// UI 总调度器 — 管理组件树、事件路由、渲染调度、动画更新
// 引擎只和 UIManager 对话，不知道任何具体 UI 组件

var UIComponent = require('./base/UIComponent.js');

// 固定层级常量
var LAYER = {
  BOARD_CARD: 0,    // 棋盘卡片背景
  INFO: 1,          // 信息面板（关主、连击、小金猪）
  CONTROL: 2,       // 控制按钮（顶部栏、底部栏）
  OVERLAY: 3,       // 叠加层（提示方向指示器）
  MODAL: 4,         // 模态弹窗（结算、授权、Toast）
};

function UIManager(theme) {
  this.theme = theme;

  /** @type {UIComponent} 根容器（占满屏幕的虚拟容器） */
  this._root = new UIComponent({ x: 0, y: 0, w: 0, h: 0, zIndex: -999 });

  /** @type {UIComponent[]} 平铺组件列表（按 z 排序） */
  this._flat = [];

  /** @type {UIComponent|null} 当前被按压的组件 */
  this._pressed = null;

  /** @type {UIComponent|null} 长按计时器对应的组件 */
  this._longPressTarget = null;
  this._longPressTimer = null;
  this._longPressThreshold = 500;  // ms

  /** @type {boolean} 是否有激活的模态层（屏蔽底层事件） */
  this._modalActive = false;

  /** @type {number} 当前活跃的模态 zIndex */
  this._modalZIndex = -1;

  /** @type {number} 屏幕宽度（由引擎设置） */
  this.screenWidth = 375;
  /** @type {number} 屏幕高度（由引擎设置） */
  this.screenHeight = 667;
}

// ========== 组件注册 ==========

/**
 * 添加组件到指定层级
 * @param {UIComponent} comp
 * @param {number} [layer] — LAYER 常量
 */
UIManager.prototype.add = function (comp, layer) {
  if (layer !== undefined) comp.zIndex = layer;
  this._flat.push(comp);
  comp.parent = this._root;
  this._sortByZ();
  comp.mount();
};

/**
 * 移除组件
 * @param {string|UIComponent} idOrComp
 */
UIManager.prototype.remove = function (idOrComp) {
  var id = typeof idOrComp === 'string' ? idOrComp : idOrComp.id;
  for (var i = 0; i < this._flat.length; i++) {
    if (this._flat[i].id === id) {
      this._flat[i].unmount();
      this._flat[i].parent = null;
      this._flat.splice(i, 1);
      return;
    }
  }
};

/** 清空所有 UI 组件 */
UIManager.prototype.clear = function () {
  for (var i = 0; i < this._flat.length; i++) {
    this._flat[i].unmount();
    this._flat[i].parent = null;
  }
  this._flat.length = 0;
  this._pressed = null;
  this._cancelLongPress();
  this._modalActive = false;
  this._modalZIndex = -1;
};

// ========== 模态管理 ==========

/**
 * 激活模态层 — 屏蔽底层所有事件
 * @param {number} zIndex — 模态层 zIndex（低于此层级的不响应事件）
 */
UIManager.prototype.activateModal = function (zIndex) {
  this._modalActive = true;
  this._modalZIndex = zIndex;
};

/** 关闭模态层 */
UIManager.prototype.deactivateModal = function () {
  this._modalActive = false;
  this._modalZIndex = -1;
};

// ========== 事件路由 ==========

/**
 * 处理 touchstart
 * @param {number} x
 * @param {number} y
 * @returns {boolean} 是否被 UI 层消费
 */
UIManager.prototype.handleTouchStart = function (x, y) {
  var hit = this._hitTestTopmost(x, y);
  if (!hit) return false;

  this._pressed = hit;

  if (hit.onPressStart) {
    hit.onPressStart(hit);
  }

  // 启动长按计时器
  if (hit.onLongPress) {
    this._longPressTarget = hit;
    var self = this;
    this._longPressTimer = setTimeout(function () {
      if (self._longPressTarget && self._longPressTarget.onLongPress) {
        self._longPressTarget.onLongPress(self._longPressTarget);
      }
      self._longPressTarget = null;
      self._longPressTimer = null;
    }, this._longPressThreshold);
  }

  return true;
};

/**
 * 处理 touchmove
 * @param {number} x
 * @param {number} y
 * @returns {boolean} 是否被 UI 层消费
 */
UIManager.prototype.handleTouchMove = function (x, y) {
  if (!this._pressed) return false;

  // 手指滑出按压组件 → 取消按压
  if (!this._pressed.hitTest(x, y)) {
    if (this._pressed.onPressEnd) {
      this._pressed.onPressEnd(this._pressed);
    }
    this._pressed = null;
    this._cancelLongPress();
  }

  return true;
};

/**
 * 处理 touchend
 * @param {number} x
 * @param {number} y
 * @returns {boolean} 是否被 UI 层消费
 */
UIManager.prototype.handleTouchEnd = function (x, y) {
  this._cancelLongPress();

  var pressed = this._pressed;
  this._pressed = null;

  if (!pressed) return false;

  // 触发 onPressEnd（松手动画回弹）
  if (pressed.onPressEnd) {
    pressed.onPressEnd(pressed);
  }

  // 如果手指还在组件内 → 触发 onClick
  if (pressed.hitTest(x, y) && pressed.onClick) {
    pressed.onClick(pressed);
  }

  return true;
};

// ========== 渲染 ==========

/**
 * 渲染整个 UI 树
 * @param {CanvasRenderingContext2D} ctx
 */
UIManager.prototype.render = function (ctx) {
  for (var i = 0; i < this._flat.length; i++) {
    this._flat[i].renderTree(ctx);
  }
};

// ========== 动画更新 ==========

/**
 * 每帧调用，推进所有组件的动画
 * @param {number} dt — 距上一帧毫秒数
 */
UIManager.prototype.update = function (dt) {
  for (var i = 0; i < this._flat.length; i++) {
    this._flat[i].update(dt);
  }
};

// ========== 内部方法 ==========

/**
 * 按 z 排序（从低到高）
 */
UIManager.prototype._sortByZ = function () {
  this._flat.sort(function (a, b) {
    return a.zIndex - b.zIndex;
  });
};

/**
 * 找到当前可交互的最顶层组件
 * @param {number} x
 * @param {number} y
 * @returns {UIComponent|null}
 */
UIManager.prototype._hitTestTopmost = function (x, y) {
  // 从 z 最高向 z 最低遍历（顶层优先）
  for (var i = this._flat.length - 1; i >= 0; i--) {
    var comp = this._flat[i];

    // 模态激活：只响应模态层以上（含）的组件
    if (this._modalActive && comp.zIndex < this._modalZIndex) {
      continue;
    }

    if (comp.visible && comp.hitTest(x, y)) {
      return comp;
    }
  }
  return null;
};

/**
 * 取消长按计时器
 */
UIManager.prototype._cancelLongPress = function () {
  if (this._longPressTimer) {
    clearTimeout(this._longPressTimer);
    this._longPressTimer = null;
  }
  this._longPressTarget = null;
};

// 导出层级常量
UIManager.LAYER = LAYER;

module.exports = UIManager;
