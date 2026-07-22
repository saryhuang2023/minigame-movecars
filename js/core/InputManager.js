// 输入管理器：统一管理触摸事件，支持路由到不同处理器

const databus = require('../databus.js');
const BugReporter = require('../debug/BugReporter.js');
const DebugPanel = require('../debug/DebugPanel.js');
const ConfirmDialog = require('../ui/ConfirmDialog.js');   // 通用确认/提示窗：打开时拦截全局触控
const LoadingDialog = require('../ui/LoadingDialog.js');   // 通用加载中窗：打开时屏蔽所有触控

class InputManager {
  constructor() {
    this.events = [];
    this.listeners = {};

    wx.onTouchStart((e) => {
      this.events.push(this.normalizeEvent('touchstart', e));
    });

    wx.onTouchMove((e) => {
      this.events.push(this.normalizeEvent('touchmove', e));
    });

    wx.onTouchEnd((e) => {
      this.events.push(this.normalizeEvent('touchend', e));
    });
  }

  /** 将微信触摸事件统一转为 x/y 坐标格式 */
  normalizeEvent(type, e) {
    const mapTouch = (t) => ({
      identifier: t.identifier,
      x: t.clientX,
      y: t.clientY
    });
    return {
      type,
      touches: (e.touches || []).map(mapTouch),
      changedTouches: (e.changedTouches || []).map(mapTouch),
      timeStamp: e.timeStamp
    };
  }

  /** 每帧调用，处理积压事件 */
  handlePendingEvents() {
    while (this.events.length > 0) {
      const e = this.events.shift();

      // 开发者调试面板：三指手势检测（在一切事件处理之前）
      DebugPanel.checkGesture(e);

      // 三指手势进行中 → 所有事件只给 DebugPanel，不分发给引擎
      if (DebugPanel._gestureActive) continue;

      // 调试面板可见时，优先消费所有事件
      if (DebugPanel.visible) {
        if (DebugPanel.handleEvent(e)) continue;
      }

      // 通用确认窗打开时，所有触摸交给它处理（覆盖菜单/游玩/编辑各状态）
      if (ConfirmDialog.isOpen()) {
        ConfirmDialog.handleEvent(e);
        continue;
      }

      // 通用加载中窗打开时，屏蔽所有触摸（等待异步/服务器回包期间不可操作）
      if (LoadingDialog.isOpen()) {
        LoadingDialog.handleEvent(e);
        continue;
      }

      // 排查系统：记录所有触摸事件
      BugReporter.logAction(e);
      const state = databus.gameState;
      if (this.listeners[state]) {
        try {
          this.listeners[state](e);
        } catch (err) {
          console.error('[InputManager] 引擎处理器异常，已吞并:', err);
        }
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
