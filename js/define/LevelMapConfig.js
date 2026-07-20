// 关卡地图（主页）配置 — 新布局：自动分析路径图 + 多段循环
//
// 布局规则（用户定稿）：
//   1. 背景：第 1 页用 main_bg_0.jpg，后续循环 main_bg_1 / main_bg_2。
//   2. 路径：第 1 页用 main_level_road_0.png，顶着屏幕顶摆放；
//      后续循环 main_level_road_1 / main_level_road_2（首尾相连）。
  //   3. 关卡钮：自动分析每张路径图的中心线，按钮中心落在路径中心，
//      按顺序沿路径摆放，相邻钮间距 = 130 世界 px（design 393 空间下 ≈ 130 * s）。
//   4. 方向：road_0 在最顶（worldY=0），内容向下延伸；scrollY=0 时看到 road_0 区域，
//      关卡编号自下向上递增 —— L1 落在地图最底（worldY 最大），最高编号在顶部。
//
// 渲染缩放：
//   designWidth = 393。所有 design px 按 SCREEN_WIDTH / designWidth 缩放至世界坐标。
//   路径图统一缩放 k_design = ROAD_TARGET_W / 845（使 road_0 宽≈270 design px），
//   运行期 k = k_design * (SCREEN_WIDTH / 393)。每张路径保持自身比例不变形。

module.exports = {
  // ===== 设计画布 =====
  designWidth: 393,

  // ===== 路径图统一缩放 =====
  // roadTargetW: road_0 (自然宽 845) 在 393 设计画布上的目标显示宽（与旧 cfg.road.h 视觉一致）
  roadTargetW: 270,

  // ===== 段定义 =====
  roads: {
    // 第 1 页（worldY = 0 起）
    road_0: { key: 'main_level_road_0', W: 845, H: 1956 },
    // 循环段（奇数页 → road_1, 偶数页 ≥2 → road_2）
    road_1: { key: 'main_level_road_1', W: 817, H: 2556 },
    road_2: { key: 'main_level_road_2', W: 823, H: 2556 },
  },

  // ===== 预提取的关卡钮位置（图像像素空间）=====
  // 每个数组：按路径起点→终点顺序排列（图像 y 从小到大 = 世界从上到下）。
  // L1 锚定在路径第一个可见点（arc=0），后续每 STEP_WORLD/k 图像 px 一个按钮。
  // 运行期通过 worldX = segLeft + x*k, worldY = segTop + y*k 映射到世界坐标。
  roadButtons: {
    // 已按「等弧长」均匀化（tools/resample_uniform.js），段内相邻钮间距一致，
    // 修复 L26↔L27 之类段内过近问题。
    road_0: [
      {x:82,y:16},{x:335,y:230},{x:655,y:316},{x:697,y:633},{x:381,y:731},
      {x:122,y:936},{x:319,y:1192},{x:645,y:1249},{x:708,y:1555},{x:406,y:1693},
      {x:108,y:1837}
    ],
    road_1: [
      {x:727,y:27},{x:525,y:283},{x:212,y:376},{x:114,y:679},{x:396,y:836},
      {x:695,y:968},{x:636,y:1274},{x:319,y:1351},{x:89,y:1580},{x:292,y:1830},
      {x:613,y:1886},{x:703,y:2187},{x:422,y:2353},{x:116,y:2465}
    ],
    road_2: [
      {x:73,y:6},{x:282,y:257},{x:596,y:345},{x:712,y:636},{x:466,y:812},
      {x:172,y:955},{x:187,y:1238},{x:464,y:1352},{x:698,y:1560},{x:545,y:1786},
      {x:242,y:1892},{x:157,y:2150},{x:404,y:2288},{x:699,y:2424}
    ],
  },

  // ===== 背景（按段分配）=====
  bgs: {
    bg_0: { key: 'main_bg_0' },       // 段 0（road_0）
    bg_1: { key: 'main_bg_1' },       // 奇数段 ≥ 1（road_1）
    bg_2: { key: 'main_bg_2' },       // 偶数段 ≥ 2（road_2）
  },

  // ===== 关卡钮间距（世界 px，运行期乘以 scale 不变因为 k 已含 scale）=====
  buttonStepWorld: 130,

  // ===== 开始按钮（屏幕固定 HUD，用于锚定首关/首图底↔开始钮间距）=====
  //   注：bottom = 钮底边距屏底的 design px，须与 GameEngine._computeStaminaLayout 一致
  //   （实际 startY = SCREEN_HEIGHT - 34*scale - 86*scale）。
  startButton: {
    bottom: 34,
    height: 86,
    width: 180,
  },

  // 首张路径图(road_0)底部 ↔ 闯关钮顶部 的留白（design px），整图据此上移
  gapBottom: 30,

  // 地图最顶关卡（最高编号）上方保留的留白（design px）。
  //   整体平移所有钮与段，使最顶关卡距内容顶 100px，便于收尾/后续加关后仍有收束空间。
  trailBottom: 100,

  // 路径圆角平滑迭代次数（Chaikin corner cutting）。值越大越圆润、锐角越少；
  //   关卡中心折线先经此倒角再走 Catmull-Rom，形成「高速公路式」缓弧而非 V 形尖角。
  //   2 已足够消除小夹角；若仍嫌直可加到 3（更圆但路径偏离关卡中心略多）。
  roadSmoothIters: 3,

  // 绿虚线中线样式（design px）：[ 单根线段长, 线段间空白长 ]。
  //   默认 [6, 16] = 短线段 + 稀疏间隔（路面标线观感）；
  //   想更密改小第二个数，想更长线段改大第一个数。
  roadDash: [6, 16],

  // ===== 引导手 =====
  hand: {
    w: 63.86,
    h: 64.14,
    offsetX: 0,
    offsetY: 0,
  },

  // ===== 滚动 =====
  scroll: {
    friction: 0.92,
    rubberBand: 0.4,
    maxVelocity: 60,
  },

  // ===== 地图装饰（固定锚点，增加地图丰富性）=====
  //   decorations：装饰图资源 key（须同时在 LoadingConfig 注册 key→path）。
  //     后续添加更多装饰直接在此 +1 项即可，算法自动适配。
  //   decoration：通用参数
  //     noneChance 每个锚点“无装饰”概率（0~1）；其余概率均分给 decorations 各图
  //               装饰按图片【实际像素尺寸 × design→world 缩放】绘制（自然比例），
  //               不再用固定 size（避免憋小/失真）。
  //     jitter    绘制点相对锚点的随机抖动半径（design px，圆形范围）；0=不抖动
  //     shadow    地面投影（增强“贴地”立体感）：color / blur / offsetX / offsetY（均 design px）
  //               阳光自右上方斜射 → 投影落左下方：offsetX<0（向左）、offsetY>0（向下）
  //   decorationAnchors：固定锚点（design 坐标，画布宽 = designWidth 393）。
  //     以「每张背景图」分组（key 与 bgs.bg_*.key / 段 bgKey 对齐）；
  //     top 从该背景图顶部往下量。背景图循环铺，故同组锚点每隔 3 段周期性复现。
  //     ⚠️ 锚点由设计稿给出，手写维护；若调整装饰位置只需改这里，逻辑无需动。
  decorations: ['main_bg_item1', 'main_bg_item2', 'main_bg_item3', 'main_bg_item4'],
  decoration: {
    noneChance: 0.2,   // 每个锚点“无装饰”概率（0~1）；其余均分给 decorations 各图
    jitter: 30,        // 绘制点相对锚点的随机抖动半径（design px，圆形范围）；0=不动
    shadow: {          // 地面投影（增强“贴地”立体感）；阳光自右上方斜射→投影落左下方
      color: 'rgba(0,0,0,0.25)',
      blur: 6,         // 模糊半径（design px）
      offsetX: -6,     // 投影水平偏移（design px，负=向左）
      offsetY: 4,      // 投影垂直偏移（design px，正=向下）
    },
  },
  decorationAnchors: {
    main_bg_0: [ {x:111,y:476},{x:331,y:341},{x:61,y:152},{x:326,y:23} ],
    main_bg_1: [ {x:97,y:655},{x:317,y:485},{x:63,y:321},{x:312,y:202},{x:117,y:17} ],
    main_bg_2: [ {x:319,y:646},{x:65,y:482},{x:103,y:231} ],
  },
};
