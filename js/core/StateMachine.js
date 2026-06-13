// 状态机：menu / playing / victory / defeat

const databus = require('../databus.js');

class StateMachine {
  constructor() {
    this.current = 'menu';
    this.handlers = {
      enter: {},
      exit: {},
      update: {},
      render: {},
    };
  }

  /** 注册状态处理器 */
  on(event, state, handler) {
    if (!this.handlers[event]) this.handlers[event] = {};
    this.handlers[event][state] = handler;
  }

  /** 切换状态 */
  transition(newState) {
    const oldState = this.current;
    if (oldState === newState) return;

    // 调用旧状态 exit
    if (this.handlers.exit[oldState]) {
      this.handlers.exit[oldState]();
    }

    this.current = newState;
    databus.gameState = newState;

    // 调用新状态 enter
    if (this.handlers.enter[newState]) {
      this.handlers.enter[newState]();
    }
  }

  /** 更新当前状态 */
  update(dt) {
    if (this.handlers.update[this.current]) {
      this.handlers.update[this.current](dt);
    }
  }

  /** 渲染当前状态 */
  render(ctx) {
    if (this.handlers.render[this.current]) {
      this.handlers.render[this.current](ctx);
    }
  }
}

module.exports = StateMachine;
