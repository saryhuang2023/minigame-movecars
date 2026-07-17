// 关卡地图（主页）配置
// 第一章：路径【程序化自动生成】蜿蜒曲线 + 沿路径布置关卡。
// 硬约束：路中心线待在屏幕中央 50% 带内（左右各空 1/4 屏宽给风景）。
// 设计画布高 681（竖直范围参考），缩放按游戏基准宽 393（与开始按钮一致），画布底边距屏底 bottom:171。

module.exports = {
  // ===== 背景 =====
  // key: 草原背景图资源 key（由 LoadingManager 注册后生效）。未就绪时走下方渐变兜底。
  background: {
    key: 'map_bg',
    fallbackTop: '#BFE8A0',     // 兜底渐变：上（远草）
    fallbackBottom: '#8FD46F',  // 兜底渐变：下（近草）
  },

  // ===== 设计画布 =====
  // Figma 画布尺寸；渲染时按 SCREEN_WIDTH / w 缩放。
  // bottomReserve：画布底边距屏幕底的留白（屏幕 px），底部 UI（开始按钮等）预留区。
  pathFrame: { w: 334.86, h: 681, bottomReserve: 171 },

  // ===== 路径：蜿蜒道路（白路 + 绿虚线车道线）=====
  // 路径由 LevelMap._buildLevels 程序化生成（正弦摆动的 S 形蛇道，左右各空 1/4 屏宽给风景），
  //   关卡点位直接落在曲线经过的点上；_buildRoadPath 用 Catmull-Rom 样条保证曲线精确穿过每个点位。
  path: {
    roadWidth: 51,                       // 白路宽度（设计 px）
    roadColor: 'rgba(255,255,255,0.3)',
    lineWidth: 8,                        // 绿虚线宽度（设计 px）
    lineColor: '#7DCC18',
    lineDash: [18, 14],                  // 虚线间隔（设计 px，渲染时乘缩放）
    smooth: true,                        // 锚点间用 Catmull-Rom 样条平滑（曲线精确穿过每个锚点中心）；false 则折线
  },

  // ===== 关卡摆放（第一章：程序化自动生成路径，关卡直接落在路径曲线点上）=====
  levels: {
    buttonR: 30,              // 占位按钮半径（px，当前未用于正式按钮）
    count: 11,                // 第一章 11 关
    topMargin: 40,           // 最顶关距画布顶的设计留白（px）
    levelGap: 130,           // ★ 相邻关卡垂直间距（设计px）：满尺寸钮高 115，2 个/摆臂（左-右），需 > 钮高(115) 防上下重叠
    bottomMargin: 60,         // 保留位（底留白现用 pathFrame.bottomReserve）
    seed: 20260717,           // 可复现随机种子（保留位）
  },

  // ===== 滚动（拖拽 + 惯性）=====
  scroll: {
    friction: 0.92,           // 惯性衰减系数（每 16.67ms 帧）
    rubberBand: 0.4,          // 越界橡皮筋回弹系数
    maxVelocity: 60,          // 单帧最大滚动速度（px/帧，防飞车）
  },
};
