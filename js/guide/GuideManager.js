// 引导系统 — 调度器
// PlayingEngine 组合持有，管理所有引导模块的注册、激活、更新、结束。
//
// 职责：
//   1. 注册引导模块列表
//   2. 管理空闲计时器（距离上次棋盘操作的秒数）
//   3. 每帧轮询：无活跃引导时逐个检查 checkCondition → 激活第一个满足的
//   4. 有活跃引导时轮询 checkEndCondition → 触发 onDeactivate
//   5. 保证同一时间只有一个引导在跑

class GuideManager {
  /**
   * @param {PlayingEngine} engine - PlayingEngine 引用（引导模块通过 engine 访问 gp、_hint 等）
   */
  constructor(engine) {
    this._engine = engine;
    this._guides = [];              // 注册的引导模块列表
    this._activeGuide = null;       // 当前激活的引导（null = 所有引导均未激活）
    this._completedGuides = {};     // 已完成的引导 ID 集合（一次性引导用，防止重复触发）

    this._idleTime = 0;             // 空闲计时器（秒），touchend 时清零
  }

  // ==============================================================
  // 公共 API
  // ==============================================================

  /** 注册引导模块（通常在 PlayingEngine constructor 中调用） */
  register(guide) {
    this._guides.push(guide);
  }

  /**
   * 每帧更新（PlayingEngine.render() 中调用）。
   * @param {number} dt - 本帧秒数
   */
  onFrame(dt) {
    // 空闲计时
    this._idleTime += dt;

    var state = this._buildState();

    if (this._activeGuide) {
      // 活跃引导 → 更新 + 检查结束条件
      this._activeGuide.onUpdate(dt, state, this._engine);
      if (this._activeGuide.checkEndCondition(state, this._engine)) {
        this._deactivateGuide();
      }
    } else {
      // 无活跃引导 → 轮询激活条件
      for (var i = 0; i < this._guides.length; i++) {
        var g = this._guides[i];
        // 已完成的一次性引导跳过
        if (this._completedGuides[g.id]) continue;
        if (g.checkCondition(state, this._engine)) {
          this._activateGuide(g);
          break; // 同时只激活一个
        }
      }
    }
  }

  /** 玩家操作棋盘时调用（PlayingEngine.onTouchStart/Move/End 中调用），重置空闲计时 */
  onPlayerAction() {
    this._idleTime = 0;
  }

  /** 进入/重开关卡时调用（PlayingEngine._resetPlayState() 中调用），清理状态 */
  reset() {
    if (this._activeGuide) {
      this._deactivateGuide();
    }
    this._idleTime = 0;
  }

  // ==============================================================
  // 内部
  // ==============================================================

  _activateGuide(guide) {
    console.log('[GuideManager] 激活引导: ' + guide.id);
    this._activeGuide = guide;
    guide.onActivate(this._engine);
  }

  _deactivateGuide() {
    var g = this._activeGuide;
    console.log('[GuideManager] 停用引导: ' + (g ? g.id : 'null'));
    this._activeGuide = null;
    // 标记为已完成，防止一次性引导重复触发
    this._completedGuides[g.id] = true;
    g.onDeactivate(this._engine);
  }

  _buildState() {
    var hint = this._engine._hint;
    return {
      levelName: this._engine.levelName,
      idleTime: this._idleTime,
      steps: this._engine.steps,
      hintActive: hint.isActive(),
      hintPigId: hint.getTargetId(),
    };
  }
}

module.exports = GuideManager;
