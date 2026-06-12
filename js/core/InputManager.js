// 触摸事件处理：点击检测 + 坐标转换

const databus = require('../databus.js');
const Button = require('../ui/Button.js');
const MoveSystem = require('../systems/MoveSystem.js');

class InputManager {
  constructor() {
    this.events = [];
    this.enabled = true;

    wx.onTouchStart((e) => {
      if (!this.enabled) return;
      const touch = e.touches[0];
      if (!touch) return;
      this.events.push({ x: touch.clientX, y: touch.clientY });
    });
  }

  /** 处理积压事件 */
  handlePendingEvents() {
    while (this.events.length > 0) {
      const evt = this.events.shift();
      this.processClick(evt.x, evt.y);
    }
  }

  /** 处理单次点击 */
  processClick(x, y) {
    const state = databus.gameState;

    if (state === 'menu') {
      this.handleMenuClick(x, y);
    } else if (state === 'playing') {
      this.handlePlayingClick(x, y);
    } else if (state === 'victory' || state === 'defeat' || state === 'victory_all') {
      this.handleEndClick(x, y);
    }
  }

  /** 菜单界面点击 */
  handleMenuClick(x, y) {
    Button.checkClick(x, y);
  }

  /** 游戏中点击 */
  handlePlayingClick(x, y) {
    // 动画播放中禁止操作
    if (databus.animLock) return;

    // 1. 检查按钮点击
    if (Button.checkClick(x, y)) return;

    // 2. 检查汽车点击
    for (const car of databus.cars) {
      if (car.status === 'idle' && car.containsPoint(x, y)) {
        MoveSystem.tryMove(car);
        return;
      }
    }
  }

  /** 结算界面点击 */
  handleEndClick(x, y) {
    Button.checkClick(x, y);
  }
}

module.exports = InputManager;
