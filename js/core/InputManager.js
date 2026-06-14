// 输入管理器：统一管理触摸事件

class InputManager {
  constructor() {
    this.events = [];

    wx.onTouchStart((e) => {
      this.events.push(e);
    });

    wx.onTouchMove((e) => {
      this.events.push(e);
    });

    wx.onTouchEnd((e) => {
      this.events.push(e);
    });
  }

  /** 每帧调用，处理积压事件 */
  handlePendingEvents() {
    while (this.events.length > 0) {
      const e = this.events.shift();
      this.processTouch(e);
    }
  }

  /** 处理单个触摸事件 */
  processTouch(e) {
    const touch = e.touches.length > 0 ? e.touches[0] : e.changedTouches[0];
    console.log('[InputManager]', e.type, 'at', touch.x, touch.y);
  }
}

module.exports = InputManager;
