// 设计令牌系统 — 所有视觉参数集中管理
// Ardot 设计稿色彩系统 (fileId: 694583967818218)

const Theme = {
  // ========== 色彩 ==========
  colors: {
    // 品牌色
    primary: '#8B5CF6',            // 紫色 — 提示按钮、强调
    primaryLight: '#F3EEFF',       // 浅紫 — 按钮渐变顶
    primaryMuted: 'rgba(139,92,246,0.3)',  // 禁用态文字

    danger: '#FF5252',             // 红色 — 移除按钮
    dangerLight: '#FFF0F0',        // 浅红 — 按钮渐变顶

    pink: '#EC4899',               // 粉红 — 关卡徽章背景
    pinkLight: '#FFF5FA',          // 浅粉 — 面板渐变顶
    pinkMid: '#FFFAFD',            // 极浅粉 — 面板渐变底
    pinkBorder: 'rgba(249,168,212,0.5)',  // 面板边框

    gold: '#FFD700',               // 金色 — 奖杯/关主
    goldLight: '#FFF8E1',          // 浅金

    dark: '#0F172A',               // 深色文字
    muted: '#64748B',              // 次要文字

    white: '#FFFFFF',
    surface: 'rgba(255,255,255,0.92)',
  },

  // ========== 间距 ==========
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    padding: 16,                   // 内容区外边距
    cardGap: 8,                    // 卡片间距
    cardPadding: 12,               // 棋盘卡片内边距
  },

  // ========== 圆角 ==========
  radius: {
    sm: 6,
    md: 12,
    lg: 16,
    xl: 22,
    xxl: 32,
    card: 32,                      // 棋盘卡片
  },

  // ========== 阴影预设 ==========
  shadow: {
    // 卡片阴影（棋盘卡片）
    card: {
      color: 'rgba(161, 150, 181, 0.15)',
      blur: 12,
      offsetX: 4,
      offsetY: 4,
    },
    // 面板阴影（关主面板）
    panel: {
      color: 'rgba(94, 63, 153, 0.1)',
      blur: 18,
      offsetX: 0,
      offsetY: 4,
    },
    // 按钮阴影
    button: {
      color: 'rgba(161, 150, 181, 0.2)',
      blur: 16,
      offsetX: 4,
      offsetY: 6,
    },
  },

  // ========== 字体 ==========
  font: {
    family: 'GenSenRounded2TW',
    size: {
      xs: 10,
      sm: 12,
      md: 14,
      lg: 18,
      xl: 20,
      xxl: 24,
    },
    weight: {
      normal: 'normal',
      bold: 'bold',
    },
  },

  // ========== 按钮默认尺寸 ==========
  button: {
    minWidth: 44,
    minHeight: 36,
    defaultW: 90,
    defaultH: 68,
    radius: 22,
    borderWidth: 2.5,
  },

  // ========== 动画参数 ==========
  animation: {
    pressScale: 0.92,              // 按压缩放比例
    springTension: 200,
    springFriction: 20,
    pressDuration: 100,            // 按压动画时长 ms
    releaseDuration: 200,          // 释放弹回时长 ms
  },

  // ========== 布局常量 ==========
  layout: {
    topBarH: 48,
    bottomBarH: 90,
  },
};

module.exports = Theme;
