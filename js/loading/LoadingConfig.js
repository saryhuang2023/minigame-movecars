// LoadingConfig.js — 集中配置所有预加载资源
// 按三个 Phase 组织，LoadingManager 依序加载

// ===== Phase 1 (0-40%): 加载画面自身所需的资源 =====
// 这阶段完成后，加载画面可完整渲染：bg + idle猪 + 金币进度条 + 字体文字
var PHASE1 = {
  // 背景 + 进度条金币图标
  images: [
    { key: 'loadingBg', path: 'assets/images/loading_bg.jpg' },
    { key: 'bg',        path: 'assets/images/main_bg.jpg' },
    { key: 'coin',      path: 'assets/images/coin.png' },
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
    'assets/images/popup_bg.png',
    'assets/images/btn_home.png',
    'assets/images/btn_again.png',
    'assets/images/win_cancel.png',
    'assets/images/icon_music.png',
    'assets/images/icon_sound.png',
    'assets/images/victory_bg.png',
    'assets/images/ad_icon.png',
    'assets/images/image_718.png',
    'assets/images/image_719.png',
    'assets/images/pig_icon.png',
    'assets/images/level_brush.png',
    'assets/images/main_buttom.png',
    'assets/images/main_start.png',
    'assets/images/level_bg.jpg',
    'assets/images/level_buttom.png',
    'assets/images/level_worm.png',
    'assets/images/main_avatar_icon.png',
    'assets/images/main_battle_icon.png',
    'assets/images/addstep_icon.png',
    'assets/images/hint_icon.png',
    'assets/images/big_flower.png',
    'assets/images/normal_flower.png',
    'assets/images/empty_flower.png',
    'assets/images/main_level_btn_passed.png',
    'assets/images/main_level_btn_unlocked.png',
    'assets/images/main_level_btn_current.png',
    'assets/images/main_level_road.png',
    'assets/images/hand_guide.png',
    'assets/skins/rock/idle/1.png',
    'assets/skins/rock/hint/1.png',
  ],
  // 非 idle 动画帧 (run 8 + escape 8 + hint 8 = 24)
  animationTotalFrames: 24,
  // 音频是否启用云端下载
  audioEnabled: true,
  // 云端图片资源不再在此硬编码 —— LoadingManager 启动后读取 version.json 清单，
  // 把清单里所有 data/ 开头的图片一次性全量预下载进本地缓存（需求：loading 阶段全量下载）。
};

// ===== AssetPreloader 映射：key → path =====
// LoadingManager 加载完成后将图片注入 AssetPreloader，保持旧 UI 组件兼容
var ASSET_PRELOADER_MAP = {
  settings_bg: 'assets/images/popup_bg.png',
  coin:        'assets/images/coin.png',
  victory_bg:  'assets/images/victory_bg.png',
  btn_again:   'assets/images/btn_again.png',
  btn_home:    'assets/images/btn_home.png',
  ad_icon:     'assets/images/ad_icon.png',
  bg_deco_718: 'assets/images/image_718.png',
  bg_deco_719: 'assets/images/image_719.png',
  pig_icon:    'assets/images/pig_icon.png',
  level_brush: 'assets/images/level_brush.png',
  main_bottom: 'assets/images/main_buttom.png',
  main_start:  'assets/images/main_start.png',
  win_cancel:  'assets/images/win_cancel.png',
  icon_music:  'assets/images/icon_music.png',
  icon_sound:  'assets/images/icon_sound.png',
  level_bottom: 'assets/images/level_buttom.png',
  level_worm:    'assets/images/level_worm.png',
  main_avatar_icon: 'assets/images/main_avatar_icon.png',
  main_battle_icon:  'assets/images/main_battle_icon.png',
  addstep_icon:      'assets/images/addstep_icon.png',
  hint_icon:         'assets/images/hint_icon.png',
  big_flower:        'assets/images/big_flower.png',
  normal_flower:     'assets/images/normal_flower.png',
  empty_flower:      'assets/images/empty_flower.png',
  main_level_btn_passed: 'assets/images/main_level_btn_passed.png',
  main_level_btn_unlocked: 'assets/images/main_level_btn_unlocked.png',
  main_level_btn_current: 'assets/images/main_level_btn_current.png',
  main_level_road: 'assets/images/main_level_road.png',
  hand_guide: 'assets/images/hand_guide.png',
};

// ===== Phase 3 (80-100%): 云端数据 =====
var PHASE3 = {
  // 云端接口：getPlayerData、listLevels、skinConfig
  // ⚠️ endpointCount 必须等于实际异步端点数（3）。
  // listLevels 是核心关卡数据（关卡范围/列表），必须在它回来后游戏才允许进入，
  // 否则 _cloudMaxLevel 为 0 → 关卡列表只剩本地 3 关 → "进入游戏"永远只能进第 3 关。
  endpointCount: 3,
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
