// UI 组件抽象基类 — 所有 UI 控件的统一接口
// 组件只知道自己的位置/大小/显隐，不碰游戏逻辑

let _nextId = 1;

class UIComponent {
  /**
   * @param {Object} opts
   * @param {number} opts.x
   * @param {number} opts.y
   * @param {number} opts.w
   * @param {number} opts.h
   * @param {number} [opts.zIndex=0]
   * @param {boolean} [opts.visible=true]
   */
  constructor(opts = {}) {
    this.id = 'ui_' + (_nextId++);
    this.x = opts.x || 0;
    this.y = opts.y || 0;
    this.w = opts.w || 0;
    this.h = opts.h || 0;
    this.zIndex = opts.zIndex || 0;
    this.visible = opts.visible !== false;

    /** @type {UIComponent[]} */
    this.children = [];
    /** @type {UIComponent|null} */
    this.parent = null;

    // 动画状态（子类覆写 update() 推进）
    this._animState = {};
    this._mounted = false;

    // 事件回调（引擎注入）
    this.onClick = null;           // (comp) => void
    this.onPressStart = null;      // (comp) => void
    this.onPressEnd = null;        // (comp) => void
    this.onLongPress = null;       // (comp) => void
  }

  // ========== 生命周期 ==========

  /** 挂载到 UIManager 时调用 */
  mount() {
    this._mounted = true;
    this.children.forEach(function(c) { c.mount(); });
  }

  /** 从 UIManager 卸载时调用 */
  unmount() {
    this._mounted = false;
    this.children.forEach(function(c) { c.unmount(); });
  }

  // ========== 布局 ==========

  /** 设置包围盒 */
  setBounds(x, y, w, h) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
  }

  /** 标记需要重新布局 */
  markDirty() {
    this._dirty = true;
    if (this.parent) this.parent.markDirty();
  }

  /** 重新计算子组件布局（容器覆写） */
  layout() {
    // 基类默认不做布局计算
  }

  // ========== 子组件管理 ==========

  addChild(child) {
    child.parent = this;
    this.children.push(child);
    if (this._mounted) child.mount();
    this.markDirty();
    return child;
  }

  removeChild(child) {
    var idx = this.children.indexOf(child);
    if (idx !== -1) {
      child.unmount();
      this.children.splice(idx, 1);
      child.parent = null;
      this.markDirty();
    }
  }

  removeAllChildren() {
    for (var i = 0; i < this.children.length; i++) {
      this.children[i].unmount();
      this.children[i].parent = null;
    }
    this.children.length = 0;
    this.markDirty();
  }

  // ========== 显隐控制 ==========

  show() {
    if (!this.visible) {
      this.visible = true;
      this.markDirty();
    }
  }

  hide() {
    if (this.visible) {
      this.visible = false;
      this.markDirty();
    }
  }

  // ========== 碰撞检测 ==========

  /**
   * 判断点 (px, py) 是否在组件内
   * 子类可覆写以实现非矩形检测
   */
  hitTest(px, py) {
    if (!this.visible) return false;
    return px >= this.x && px <= this.x + this.w &&
           py >= this.y && py <= this.y + this.h;
  }

  // ========== 逐帧更新 ==========

  /**
   * 每帧调用，推进动画状态
   * @param {number} dt — 距上一帧毫秒数
   */
  update(dt) {
    // 子类覆写
  }

  // ========== 渲染 ==========

  /**
   * 核心渲染方法（子类必须覆写）
   * @param {CanvasRenderingContext2D} ctx
   */
  render(ctx) {
    // 子类覆写
  }

  /**
   * 渲染自身 + 递归渲染子组件
   * UIManager 调用此方法
   */
  renderTree(ctx) {
    if (!this.visible) return;
    ctx.save();
    this.render(ctx);
    // 递归渲染子组件
    for (var i = 0; i < this.children.length; i++) {
      this.children[i].renderTree(ctx);
    }
    ctx.restore();
  }

  // ========== 工具 ==========

  /** 获取组件中心点 */
  getCenter() {
    return { x: this.x + this.w / 2, y: this.y + this.h / 2 };
  }
}

module.exports = UIComponent;
