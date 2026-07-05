// GameDefine — 游戏通用配置与常量
// 吸收：Theme.js + SceneDefaults.js + EntityTypes.js + 散落常量
// 命名规则：系统名+define.js，统一放在 js/define/ 目录

var GAME = {

  // ================================================================
  // THEME — 设计令牌系统（原 Theme.js）
  // ================================================================
  THEME: {
    // ---------- 色彩 ----------
    colors: {
      primary: '#8B5CF6',
      primaryLight: '#F3EEFF',
      primaryMuted: 'rgba(139,92,246,0.3)',
      danger: '#FF5252',
      dangerLight: '#FFF0F0',
      pink: '#EC4899',
      pinkLight: '#FFF5FA',
      pinkMid: '#FFFAFD',
      pinkBorder: 'rgba(249,168,212,0.5)',
      gold: '#FFD700',
      goldLight: '#FFF8E1',
      dark: '#0F172A',
      muted: '#64748B',
      white: '#FFFFFF',
      surface: 'rgba(255,255,255,0.92)',
    },

    // ---------- 间距 ----------
    spacing: {
      xs: 4,
      sm: 8,
      md: 12,
      lg: 16,
      xl: 24,
      padding: 16,
      cardGap: 8,
      cardPadding: 12,
    },

    // ---------- 圆角 ----------
    radius: {
      sm: 6,
      md: 12,
      lg: 16,
      xl: 22,
      xxl: 32,
      card: 32,
    },

    // ---------- 阴影预设 ----------
    shadow: {
      card:   { color: 'rgba(161,150,181,0.15)', blur: 12, offsetX: 4, offsetY: 4 },
      panel:  { color: 'rgba(94,63,153,0.1)',    blur: 18, offsetX: 0, offsetY: 4 },
      button: { color: 'rgba(161,150,181,0.2)',  blur: 16, offsetX: 4, offsetY: 6 },
    },

    // ---------- 字体 ----------
    font: {
      family: 'GenSenRounded2TW',
      size:   { xs: 10, sm: 12, md: 14, lg: 18, xl: 20, xxl: 24 },
      weight: { normal: 'normal', bold: 'bold' },
    },

    // ---------- 按钮默认尺寸 ----------
    button: {
      minWidth: 44,
      minHeight: 36,
      defaultW: 90,
      defaultH: 68,
      radius: 22,
      borderWidth: 2.5,
    },

    // ---------- 动画参数 ----------
    animation: {
      pressScale: 0.92,
      springTension: 200,
      springFriction: 20,
      pressDuration: 100,
      releaseDuration: 200,
    },

    // ---------- 布局常量 ----------
    layout: {
      topBarH: 68,
      bottomBarH: 80,
    },
  },

  // ================================================================
  // SCENE — 场景默认配置（原 SceneDefaults.js）
  // ================================================================
  SCENE: {
    sceneId: 0,
    name: '默认场景',

    background: 'assets/images/levels/0/bg.jpg',

    boardColors: {
      holeEmpty: '#7ED038',
      holeEmptyAlpha: 0.55,
      holeOccupied: '#66AE27',
    },

    boardArea: {
      top: 170,
      bottom: 136,
      hMargin: 5,
    },

    // 后续可替换元素统一追加于此
  },

  // ================================================================
  // ENTITY — 精灵类型定义（原 EntityTypes.js）
  // ================================================================
  ENTITY: {
    TYPES: { PIG: 'pig', ROCK: 'rock' },

    PROPS: {
      pig_0: { skinId: 0, draggable: true, canEscape: true, minLength: 70 },
      rock:  { skinId: -1, draggable: false, canEscape: false, minLength: 50 },
    },

    LABELS: { pig: '猪', rock: '石头' },

    /** 根据精灵对象获取属性 */
    props: function(sprite) {
      if (!sprite) return this.PROPS['pig_0'];
      var type = sprite.type || 'pig';
      if (type === 'rock') return this.PROPS['rock'];
      var skinId = (sprite.skinId != null) ? sprite.skinId : 0;
      var key = type + '_' + skinId;
      return this.PROPS[key] || this.PROPS['pig_0'];
    },

    /** 根据 type+skinId 获取属性 */
    propsByKey: function(type, skinId) {
      if (type === 'rock') return this.PROPS['rock'];
      var key = (type || 'pig') + '_' + (skinId || 0);
      return this.PROPS[key] || this.PROPS['pig_0'];
    },

    /** 返回精灵的完整 key（如 "pig_0" 或 "rock"） */
    key: function(sprite) {
      var type = sprite.type || 'pig';
      if (type === 'rock') return 'rock';
      return type + '_' + (sprite.skinId || 0);
    },

    /** 精灵类型中文标签 */
    label: function(type) {
      return this.LABELS[type] || type;
    },
  },

  // ================================================================
  // BOARD — 棋盘几何与物理参数
  // ================================================================
  BOARD: {
    DEFAULT_ROWS: 5,
    DEFAULT_ODD_COLS: 3,
    DEFAULT_BOARD_WIDTH: 375,
    DEFAULT_BOARD_RATE: 2.74,
    REFERENCE_DIAMETER: 50,      // boardScale 参考直径
    BOARD_SCALE_MIN: 0.75,       // boardScale 下限
    BOARD_SCALE_MAX: 1.5,        // boardScale 上限
    CHASE_SPEED: 12,             // 旋转追逐速度
    HEAD_ZONE_MULT: 1,           // 头部区域 = mult × diameter
    PUSH_ANIM_DURATION: 6400,    // 推出动画时长 ms
    MAX_PUSH_STEPS: 100,         // 最大推出步数
    BINARY_SEARCH_ROUNDS: 12,    // 二分查找轮数
    COLLISION_SOUND_CD: 250,     // 碰撞音效冷却 ms

    // 碰撞体比例系数（相对 scaledDiameter）
    BODY_RATIOS: {
      CAP_RADIUS:          2 / 3,   // 猪间碰撞 cap 半径
      COLLISION_CAP:       2 / 5,   // 猪间碰撞半宽
      TAIL_SHRINK:         1 / 5,   // 尾部碰撞区缩减
      TOUCH_HH:            1.5,     // 触摸判定的高度半宽（相对 scaledHalfDiameter）
      TOUCH_HEAD_EXT:      0.5,     // 触摸头延伸
      HEAD_HOLE_THRESHOLD: 2 / 3,   // 头部落孔阈值
      ROCK_RADIUS:         1 / 4,   // 石头碰撞半径
    },

    // 碰撞闪红
    COLLISION_FLASH: {
      TOTAL: 500,           // 总时长 ms
      FADE_IN: 80,
      HOLD: 380,
      FADE_OUT: 120,
      MAX_ALPHA: 0.7,
    },

    // 顶部栏/底栏高度（编辑器/游玩共用）
    TOP_BAR_H: 48,
    BOTTOM_STRIP_H_DEFAULT: 175,

    // 棋盘宽度屏幕比例下限（由不包含错落列的 cols=oddCols 决定）
    // boardWidth = max(SCREEN_WIDTH * percent, levelBoardWidth)
    BOARD_WIDTH_PERCENT: {
      3: 288 / 393,    // cols ≤ 3
      4: 378 / 393,    // 3 < cols <= 5 → cols=4
      5: 383 / 393,    // cols > 5
    },
  },

  // ================================================================
  // PIG_RENDER — 猪渲染配置
  // ================================================================
  PIG_RENDER: {
    // 颜色
    COLORS: {
      PIG: '#FFD700',
      STROKE: '#FFB300',
      SELECTED: '#2196F3',
      COLLISION_BOX: '#8B6914',
    },

    // 三宫格切片比例
    TAIL_SLICE: 0.37,
    HEAD_SLICE: 0.51,
    WIDTH_HEIGHT_RATE_MIN: 1.8,

    // 默认帧数
    IDLE_FRAME_COUNT: 11,
    RUN_FRAME_COUNT: 8,
    ESCAPE_FRAME_COUNT: 8,
    HINT_FRAME_COUNT: 8,

    // 帧动画间隔（总时长 / 帧数）
    IDLE_FRAME_INTERVAL: 600 / 11,   // ≈54.5ms
    RUN_FRAME_INTERVAL: 300 / 8,     // =37.5ms
    ESCAPE_FRAME_INTERVAL: 200 / 8,  // =25ms
    HINT_FRAME_INTERVAL: 200 / 8,    // =25ms

    // 风筝抖动参数
    WOBBLE: {
      FREQ: 10,
      AMPLITUDE: 0.005,
      PIVOT: 0.75,
      TAIL_FREQ: 5,
      TAIL_AMPLITUDE: 0.015,
    },

    // 动画类型枚举
    ANIM_TYPE: { IDLE: 'idle', RUN: 'run', ESCAPE: 'escape', HINT: 'hint' },
  },

  // ================================================================
  // UI — 通用 UI 常量
  // ================================================================
  UI: {
    // UIManager 层级（z-order）
    LAYER: {
      BOARD_CARD: 0,
      INFO: 1,
      CONTROL: 2,
      OVERLAY: 3,
      MODAL: 4,
    },

    LONG_PRESS_THRESHOLD: 500,   // 长按判定 ms
    DPR_MAX: 2,                  // 设备像素比上限
  },

  // ================================================================
  // STORAGE_KEYS — 全局存储 Key
  // ================================================================
  STORAGE_KEYS: {
    GOLD: 'player_gold',
    GOLD_CLAIMED: 'player_gold_claimed',
    OWNED_SKINS: 'player_owned_skins',
    EQUIPPED_SKIN: 'player_equipped_skin',
    SKIN_CONFIG_VERSION: 'skin_config_version',
    RECORD_PREFIX: 'record_',          // 个人最好记录 key 前缀
    USERINFO_CACHE: 'userinfo_cache',  // 用户信息缓存
    FIRST_GOLD_PREFIX: 'first_gold_',  // 旧版兼容 key 前缀
    AUDIO_VERSION: 'audio_cache_version',
  },

  // ================================================================
  // LEVEL — 关卡通用配置
  // ================================================================
  LEVEL: {
    NAME_PAD: 4,                 // 关卡名零填充位数（"0001"）
    DEFAULT_CROWN_STEPS: 0,
    DEFAULT_VERSION: 0,
    DEFAULT_READY: 0,
  },

  // ================================================================
  // STAMINA — 体力系统配置
  // ================================================================
  STAMINA: {
    MAX: 5,                      // 最大个数
    COST_PER_GAME: 1,            // 每局消耗个数
    AD_GAIN: 1,                  // 看广告领体力个数
    RECOVERY_INTERVAL: 60 * 60 * 1000,  // 自然恢复 1 个所需毫秒（1 小时）
    AD_DAILY_LIMIT: 10,           // 每天看广告领体力上限
    ICON_SIZE: 24,               // 图标显示尺寸
    ICON_GAP: 4,                 // 图标间距
  },

};

// ========== 工具函数 ==========

/**
 * 根据棋盘列数（不包含错落列，即 oddCols）获取棋盘宽度占屏幕宽度的最小比例
 * 用于 boardWidth = max(SCREEN_WIDTH * percent, levelBoardWidth)
 * @param {number} oddCols 贴边列数
 * @returns {number} 比例值
 */
function getBoardWidthPercent(oddCols) {
  var pt = GAME.BOARD.BOARD_WIDTH_PERCENT;
  if (oddCols <= 3) return pt[3];
  if (oddCols > 5) return pt[5];
  return pt[4];  // oddCols = 4
}

// ========== 导出 ==========
// Plan A 使用方式：const Theme = require('../define/GameDefine.js').THEME
// Entity 函数：const ENT = require('../define/GameDefine.js').ENTITY，然后 ENT.props(sprite) 等
// 同时导出 GAME 和所有扁平化子模块（方便 .THEME / .SCENE 直接访问）
module.exports = {
  GAME: GAME,
  THEME: GAME.THEME,
  SCENE: GAME.SCENE,
  ENTITY: GAME.ENTITY,
  BOARD: GAME.BOARD,
  PIG_RENDER: GAME.PIG_RENDER,
  UI: GAME.UI,
  STORAGE_KEYS: GAME.STORAGE_KEYS,
  LEVEL: GAME.LEVEL,
  getBoardWidthPercent: getBoardWidthPercent,
};
