// 引导系统 — 基类模板
// 每个引导模块继承此类，实现四个生命周期方法即可。

class BaseGuide {
  /**
   * @param {string} id - 引导唯一标识（用于 completedGuides 去重，如 'guide1'）
   */
  constructor(id) {
    this.id = id;
  }

  // ==============================================================
  // 子类重写（四个生命周期钩子）
  // ==============================================================

  /**
   * 激活条件检查（每帧轮询，仅在无活跃引导时调用）。
   * @param {object} state - { levelName, idleTime, steps, hintActive, hintPigId }
   * @param {PlayingEngine} engine - PlayingEngine 引用
   * @returns {boolean}
   */
  checkCondition(state, engine) { return false; }

  /**
   * 引导激活时调用（仅一次）。
   * @param {PlayingEngine} engine
   */
  onActivate(engine) {}

  /**
   * 每帧更新（仅在引导活跃时调用）。
   * @param {number} dt - 本帧秒数
   * @param {object} state
   * @param {PlayingEngine} engine
   */
  onUpdate(dt, state, engine) {}

  /**
   * 结束条件检查（每帧轮询，仅在引导活跃时调用）。
   * @param {object} state
   * @param {PlayingEngine} engine
   * @returns {boolean}
   */
  checkEndCondition(state, engine) { return false; }

  /**
   * 引导结束时调用（仅一次），负责清理本引导产生的所有副作用。
   * @param {PlayingEngine} engine
   */
  onDeactivate(engine) {}

  /**
   * 返回引导需要高亮染色的猪 ID（null = 无需高亮）。
   * Guide1 返回 11、Guide2 返回 20，子类按需重写。
   * @returns {number|null}
   */
  getGuidePigId() { return null; }
}

module.exports = BaseGuide;
