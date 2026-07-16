// PlayingDefine — 关卡游玩配置与常量

var PLAY = {

  // ---------- 逃脱 ----------
  ESCAPE_SPEED: 280,                    // 正常逃脱速度（逻辑像素/秒），2026-07-15 起翻倍（原120）
  SNAP_ANGLE_PUSH_THRESHOLD: 90,        // 吸收对齐角度阈值

  // ---------- 入场动画时序 ----------
  ENTRANCE: {
    PIG_FADE_DELAY: 300,
    PIG_FADE_DUR: 500,
    UI_START: 800,
    UI_DUR: 500,
    TOTAL: 1300,
  },

  // ---------- 存档 ----------
  CHECKPOINT_INTERVAL: 5000,            // 存档定时器间隔 ms
  LOAD_TIMEOUT: 6000,                   // 关卡加载超时 ms

  // ---------- 金币飞行 ----------
  GOLD_FLY_TARGET: { cx: 68, cy: 62 }, // 金币磁吸目标坐标（对齐 GoldWidget 金币中心 COIN_X=57+10.5 / COIN_Y=51+10.5）

  // ---------- 胜利动画 ----------
  VICTORY: {
    GROW_DURATION: 1600,
    HOLD_DURATION: 500,
    SUCK_DURATION: 530,
    MAX_SCALE: 1.2,
  },

  // ---------- 提示系统 ----------
  HINT: {
    INTERVAL: 2000,          // 每轮间隔 ms（重建周期）
    GHOST_LOOP_GAP: 1500,    // 幽灵逃脱两次播放之间的间隔 ms（1.5秒）
  },

  // ---------- 连击 ----------
  COMBO: {
    UNLOCK_THRESHOLD: 5,    // 解锁所需连击数
    TIMEOUT: 1500,           // 连击超时 ms
  },

  // ---------- 回放 ----------
  REPLAY: {
    MAX_GAP: 500,            // 回放播放间隙上限 ms
  },

  // ---------- 触摸滚动（LevelSelectEngine） ----------
  TOUCH_SCROLL: {
    MOMENTUM_DECAY: 0.95,
    MIN_VELOCITY: 2,
    OVERSCROLL_BOUNCE: 0.3,
  },

};

module.exports = { PLAY };
