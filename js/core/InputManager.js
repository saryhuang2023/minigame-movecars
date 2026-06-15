// 输入管理器：统一管理触摸事件，支持路由到不同处理器

const databus = require('../databus.js');

class InputManager {
  constructor() {
    this.events = [];
    this.listeners = {};

    wx.onTouchStart((e) => {
      this.events.push({ type: 'touchstart', ...e });
    });

    wx.onTouchMove((e) => {
      this.events.push({ type: 'touchmove', ...e });
    });

    wx.onTouchEnd((e) => {
      this.events.push({ type: 'touchend', ...e });
    });
  }

  /** 每帧调用，处理积压事件 */
  handlePendingEvents() {
    while (this.events.length > 0) {
      const e = this.events.shift();
      const state = databus.gameState;
      if (this.listeners[state]) {
        this.listeners[state](e);
      }
    }
  }

  /** 注册某个游戏状态的事件处理器 */
  on(state, handler) {
    this.listeners[state] = handler;
  }

  /** 移除某个状态的处理器 */
  off(state) {
    delete this.listeners[state];
  }
}

module.exports = InputManager;
