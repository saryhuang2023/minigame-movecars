// EditorDefine — 编辑器配置与常量

var EDITOR = {

  // ---------- 触控 ----------
  DRAG_THRESHOLD: 20,         // 最小移动距离（px），低于此值视为点击
  DRAG_THROTTLE: 33,          // 拖拽节流 ms

  // ---------- 预设模板 ----------
  PRESETS: {
    LABELS: ['70', '125', '205', '275', '342', '397', '468', '灵活', '石头'],
    VALUES: [70, 125, 205, 275, 342, 397, 468, null, 44],
    TYPES:  ['pig', 'pig', 'pig', 'pig', 'pig', 'pig', 'pig', 'pig', 'rock'],
    MAX_PER_ROW: 6,
  },

  // ---------- 默认关卡 ----------
  DEFAULT_LEVEL: {
    board: { rows: 5, oddCols: 3, boardWidth: 375, boardRate: 2.74 },
    pigs: [],
    stepBonusThreshold: 0,
    ready: 0,
    version: 0,
  },

  // ---------- 编辑器布局 ----------
  LAYOUT: {
    BOTTOM_STRIP_H: 92,       // 编辑器底栏高度（覆盖 GameplayEngine 默认）
    PRESET_BAR_H: 68,         // 预设按钮区高度
    TOP_BAR_H: 48,            // 顶栏高度
    BAR_H: 116,               // 48 + 68
  },

  // ---------- 按钮尺寸 ----------
  BTN_SIZES: {
    BACK:    [44, 36],
    BTN:     [52, 32],
    TPL_BTN: [68, 32],
    PIG:     66,
    INFO_BTN: 66,
    LVL_BTN: 72,
    OP:      38,
    SYNC:    50,
    PUBLISH: 50,
  },

  // ---------- 提示箭头 ----------
  HINT_ARROW: {
    LEN: 38,
    SIZE: 8,
  },

  // ---------- Toast ----------
  TOAST: {
    FADE_IN: 200,
  },

};

module.exports = { EDITOR };
