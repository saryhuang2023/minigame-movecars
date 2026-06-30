// LoadingConfig.js — 集中配置所有预加载资源
// 按三个 Phase 组织，LoadingManager 依序加载

// ===== Phase 1 (0-40%): 加载画面自身所需的资源 =====
// 这阶段完成后，加载画面可完整渲染：bg + idle猪 + 金币进度条 + 字体文字
var PHASE1 = {
  // 背景 + 进度条金币图标
  images: [
    { key: 'bg',   path: 'assets/images/main/bg.jpg' },
    { key: 'coin', path: 'assets/images/common/coin.png' },
  ],
  // idle 序列帧（通过 PigRenderer.preloadIdle 加载，此处声明数量用于进度）
  idleFrameCount: 11,
  // 自定义字体
  fontPath: 'assets/font/dabaotaotao.ttf',
};

// ===== Phase 2 (40-80%): 游戏运行时所需全部资源 =====
var PHASE2 = {
  // 所有 UI / 关卡图片
  images: [
    'assets/images/main/level.png',
    'assets/images/main/skin.png',
    'assets/images/common/popup_bg.png',
    'assets/images/common/btn_home.png',
    'assets/images/common/btn_again.png',
    'assets/images/common/win_cancel.png',
    'assets/images/common/icon_music.png',
    'assets/images/common/icon_sound.png',
    'assets/images/common/setting.png',
    'assets/images/levels/victory_bg.png',
    'assets/images/levels/ad_icon.png',
    'assets/images/levels/leftStep_1.png',
    'assets/images/levels/leftStep_2.png',
    'assets/images/levels/master_bg.png',
    'assets/images/levels/master_hat.png',
    'assets/images/levels/0/bg.jpg',
  ],
  // 非 idle 动画帧 (run 8 + escape 8 + hint 8 = 24)
  animationTotalFrames: 24,
  // 音频是否启用云端下载
  audioEnabled: true,
};

// ===== AssetPreloader 映射：key → path =====
// LoadingManager 加载完成后将图片注入 AssetPreloader，保持旧 UI 组件兼容
var ASSET_PRELOADER_MAP = {
  settings_bg: 'assets/images/common/popup_bg.png',
  coin:        'assets/images/common/coin.png',
  victory_bg:  'assets/images/levels/victory_bg.png',
  btn_again:   'assets/images/common/btn_again.png',
  btn_home:    'assets/images/common/btn_home.png',
  ad_icon:     'assets/images/levels/ad_icon.png',
  win_cancel:  'assets/images/common/win_cancel.png',
  icon_music:  'assets/images/common/icon_music.png',
  icon_sound:  'assets/images/common/icon_sound.png',
  leftStep:    'assets/images/levels/leftStep_1.png',
  master_hat:  'assets/images/levels/master_hat.png',
};

// ===== Phase 3 (80-100%): 云端数据 =====
var PHASE3 = {
  // 云端接口：getPlayerData、listLevels、chapterConfig、skinConfig
  endpointCount: 4,
};

// ===== 阶段权重（影响进度条视觉分段） =====
var PHASE_WEIGHTS = {
  phase1: 0.40,  // 0.00 → 0.40
  phase2: 0.40,  // 0.40 → 0.80
  phase3: 0.20,  // 0.80 → 1.00
};

module.exports = {
  PHASE1: PHASE1,
  PHASE2: PHASE2,
  PHASE3: PHASE3,
  PHASE_WEIGHTS: PHASE_WEIGHTS,
  ASSET_PRELOADER_MAP: ASSET_PRELOADER_MAP,
};
