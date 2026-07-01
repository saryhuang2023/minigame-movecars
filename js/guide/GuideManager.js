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

    // --- 诊断用 ---
    this._lastSkipLogTs = {};       // 每个 guide 上次打"跳过"日志的时间
    this._loggedReset = false;      // 是否已打过 reset 日志（防重复）
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

    // --- 心跳日志：每 5 秒报告一次状态 ---
    var now = Date.now();
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
        if (this._completedGuides[g.id]) {
          // 每 5 秒最多打一次"已跳过"日志
          if (!this._lastSkipLogTs[g.id] || now - this._lastSkipLogTs[g.id] > 5000) {
            console.log('[LOG] GuideManager skip ' + g.id + ' — 已完成（completedGuides 中有记录）');
            this._lastSkipLogTs[g.id] = now;
          }
          continue;
        }
        if (g.checkCondition(state, this._engine)) {
          this._activateGuide(g);
          break; // 同时只激活一个
        } 
      }
    }
  }

  /** 玩家操作棋盘时调用（PlayingEngine.onTouchStart/Move/End 中调用），重置空闲计时 */
  onPlayerAction() {
    // 每 3 秒最多打一次（触摸频繁时避免刷屏）
    var now = Date.now();
    if (!this._lastActionLogTs || now - this._lastActionLogTs > 3000) {
      console.log('[LOG] GuideManager onPlayerAction — idleTime 重置为 0（之前=' + this._idleTime.toFixed(1) + 's）');
      this._lastActionLogTs = now;
    }
    this._idleTime = 0;
  }

  /** 进入/重开关卡时调用（PlayingEngine._resetPlayState() 中调用），清理状态 */
  reset() {
    console.log('[LOG] GuideManager reset — level=' + this._engine.levelName +
      ' active=' + (this._activeGuide ? this._activeGuide.id : 'null') +
      ' completed=[' + Object.keys(this._completedGuides).join(',') + ']');
    if (this._activeGuide) {
      // 纯清理：调 onDeactivate 释放引导资源，但**不**标记 completed
      // reset 是切关/重进，不是"引导自然结束"，下次进同一关应有再次触发机会
      console.log('[LOG] GuideManager reset 清理活跃引导: ' + this._activeGuide.id + '（不标记完成）');
      this._activeGuide.onDeactivate(this._engine);
      this._activeGuide = null;
    }
    this._idleTime = 0;
    // 重置心跳计时器，确保新关卡立即能打心跳
    this._lastSkipLogTs = {};
    this._lastActionLogTs = 0;
  }

  /** 获取当前活跃引导的高亮猪 ID（用于渲染染色+换动作），无活跃引导返回 null */
  getActiveGuidePigId() {
    return this._activeGuide ? this._activeGuide.getGuidePigId() : null;
  }

  // ==============================================================
  // 内部
  // ==============================================================

  _activateGuide(guide) {
    console.log('[LOG] GuideManager 激活引导: ' + guide.id + '（idleTime=' + this._idleTime.toFixed(1) + 's）');
    this._activeGuide = guide;
    guide.onActivate(this._engine);
  }

  _deactivateGuide() {
    var g = this._activeGuide;
    console.log('[LOG] GuideManager 停用引导: ' + (g ? g.id : 'null') + ' → 标记 completedGuides');
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
