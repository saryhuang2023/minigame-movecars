// 关卡地图（主页）配置
// 第一章：路径 + 关卡位置【全由 Figma 设计稿坐标固定】，不再程序化自动生成。
// 一条路径图（main_level_road.png）按「段」平铺：一段 = 一张路图，段内 11 个固定槽位，
//   后续段直接连到上方（numPages = ceil(总关数/11)）。
// 锚点（用户定稿）：
//   ① 第一关按钮底部 ↔ 开始按钮顶部 保证间距（设计 30px 屏幕间距）。
//   ② 第一张背景图整屏覆盖（renderBackground 已按整屏平铺，此处不改）。
// 设计基准画布宽 = 393（与开始按钮一致），渲染缩放 = SCREEN_WIDTH / 393，x/y 同比例不变形。

module.exports = {
  // ===== 背景 =====
  // key: 草原背景图资源 key（由 GameEngine 注册后通过 setBackground 注入）。
  background: {
    key: 'bg',
    fallbackTop: '#BFE8A0',     // 兜底渐变：上（远草）
    fallbackBottom: '#8FD46F',  // 兜底渐变：下（近草）
  },

  // ===== 设计画布 =====
  // Figma 画布宽 393。渲染时所有 design px 按 = SCREEN_WIDTH / designWidth 缩放。
  designWidth: 393,

  // ===== 路径图（平铺单元）=====
  // 第一条路径：width 220.54 / height 626.5，水平居中于画布（center = 画布中心 196.5）。
  // 后续段直接连到上方，复用同一张图。
  road: {
    w: 220.54,
    h: 626.5,
  },

  // ===== 开始按钮（屏幕 px，用于锚定第一关↔开始钮间距）=====
  startButton: {
    bottom: 65,    // 距屏幕底（design px）
    height: 86,    // 按钮高（design px）
    width: 180,    // 按钮宽（design px，备用）
  },

  // 第一关按钮底部 ↔ 开始按钮顶部 的屏幕间距（design px）。
  gapBottom: 30,

  // ===== 11 个固定槽位（design 393 画布坐标）=====
  // left/top = 钮左上角（design px）；w/h = 钮尺寸（design px）。
  // 槽位中心 = (left + w/2, top + h/2)，作为该关按钮的世界锚点。
  // 槽 0/1 为 117×115 大钮（设计上常处于已通关态），槽 2~10 为 69×69 小钮。
  // 钮的实际绘制尺寸由「状态」决定（cleared→大图117×115 / current·locked→小图69×69），
  //   这里的 w/h 仅用于计算槽位中心。
  slots: [
    { left: 23,  top: 566, w: 117, h: 115 },
    { left: 118, top: 496, w: 117, h: 115 },
    { left: 257, top: 472, w: 69,  h: 69  },
    { left: 241, top: 372, w: 69,  h: 69  },
    { left: 142, top: 356, w: 69,  h: 69  },
    { left: 52,  top: 289, w: 69,  h: 69  },
    { left: 111, top: 207, w: 69,  h: 69  },
    { left: 229, top: 184, w: 69,  h: 69  },
    { left: 267, top: 94,  w: 69,  h: 69  },
    { left: 166, top: 52,  w: 69,  h: 69  },
    { left: 72,  top: 31,  w: 69,  h: 69  },
  ],

  // ===== 引导手（hand_guide.png）=====
  // 手图 anatomy：指尖（食指）在图像左上角，红色袖口在右下，朝上指手势。
  // 定位锚点 = 图像**左上角**（指尖），offsetX/offsetY = 左上角相对「开始按钮中心」的设计 px 偏移。
  //   偏移 (0,0) → 指尖直接落在开始按钮中心（指向中心）；tap 动画 +9px 向下点按（指尖压入按钮）。
  //   不透明度恒为 1（不做半透明脉冲处理）。
  //   开始按钮为屏幕固定 HUD：180×86、水平居中、bottom 距屏底 65px（与 GameEngine.renderMenu 同算）。
  hand: {
    w: 63.86,
    h: 64.14,
    offsetX: 0,     // 指尖 X：水平对齐开始按钮中心
    offsetY: 0,     // 指尖 Y：落在开始按钮中心（design px），tap +9px 向下点按
  },

  // ===== 滚动（拖拽 + 惯性）=====
  scroll: {
    friction: 0.92,           // 惯性衰减系数（每 16.67ms 帧）
    rubberBand: 0.4,          // 越界橡皮筋回弹系数
    maxVelocity: 60,          // 单帧最大滚动速度（px/帧，防飞车）
  },
};
