// 通用按钮组件

const { SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');

class Button {
  constructor(config) {
    this.id = config.id || '';
    this.text = config.text || '';
    this.x = config.x || 0;
    this.y = config.y || 0;
    this.w = config.w || 140;
    this.h = config.h || 48;
    this.onClick = config.onClick || null;
    this.enabled = config.enabled !== false;
    this.visible = config.visible !== false;
    this.pressed = false;
    this.hoverAlpha = 0;
  }

  containsPoint(px, py) {
    return (
      this.visible && this.enabled &&
      px >= this.x && px <= this.x + this.w &&
      py >= this.y && py <= this.y + this.h
    );
  }

  handleClick() {
    if (this.enabled && this.visible && this.onClick) {
      this.onClick();
    }
  }

  update(dt) {
    if (this.pressed) {
      this.hoverAlpha = Math.min(1, this.hoverAlpha + dt * 10);
    } else {
      this.hoverAlpha = Math.max(0, this.hoverAlpha - dt * 5);
    }
  }

  render(ctx) {
    if (!this.visible) return;

    ctx.save();

    // 按钮背景
    const bgColor = this.pressed ? '#333' : '#555';
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    ctx.roundRect(this.x, this.y, this.w, this.h, 8);
    ctx.fill();

    // hover 效果
    if (this.hoverAlpha > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.hoverAlpha * 0.15})`;
      ctx.beginPath();
      ctx.roundRect(this.x, this.y, this.w, this.h, 8);
      ctx.fill();
    }

    // 文字
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.text, this.x + this.w / 2, this.y + this.h / 2);

    ctx.restore();
  }
}

// 全局按钮管理
const buttons = [];

const ButtonManager = {
  /** 添加按钮 */
  add(config) {
    const btn = new Button(config);
    buttons.push(btn);
    return btn;
  },

  /** 清除所有按钮 */
  clearAll() {
    buttons.length = 0;
  },

  /** 移除指定按钮 */
  remove(btn) {
    const idx = buttons.indexOf(btn);
    if (idx >= 0) buttons.splice(idx, 1);
  },

  /** 检查点击 */
  checkClick(x, y) {
    for (let i = buttons.length - 1; i >= 0; i--) {
      const btn = buttons[i];
      if (btn.containsPoint(x, y)) {
        btn.pressed = true;
        btn.handleClick();
        // 短暂延迟后恢复
        setTimeout(() => { btn.pressed = false; }, 100);
        return true;
      }
    }
    return false;
  },

  /** 更新所有按钮 */
  updateAll(dt) {
    for (const btn of buttons) {
      btn.update(dt);
    }
  },

  /** 渲染所有按钮 */
  renderAll(ctx) {
    for (const btn of buttons) {
      btn.render(ctx);
    }
  },

  /** 获取所有按钮 */
  getAll() {
    return buttons;
  },
};

module.exports = ButtonManager;
