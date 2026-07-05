// AudioDefine — 音频系统配置与常量
// 自 AudioConfig.js 改名迁移（v133 常量整理）
// 所有静态常量在模块内定义，云端路径引用 CloudDefine

var CloudDefine = require('../define/CloudDefine.js');

// ===== 云存储配置 =====
var CLOUD_PREFIX = CloudDefine.CLOUD.AUDIO_PREFIX || '';

/**
 * 从云存储 fileID 中提取前缀
 * 用法: AudioDefine.setCloudPrefix(fileID)
 */
function setCloudPrefix(sampleFileID) {
  if (!sampleFileID || sampleFileID.indexOf('cloud://') !== 0) return;
  var audioIdx = sampleFileID.indexOf('/audio/');
  if (audioIdx >= 0) {
    CLOUD_PREFIX = sampleFileID.substring(0, audioIdx) + '/audio/';
  } else {
    var lastSlash = sampleFileID.lastIndexOf('/');
    if (lastSlash > 0) {
      CLOUD_PREFIX = sampleFileID.substring(0, lastSlash + 1);
    }
  }
  console.log('[AudioDefine] CLOUD_PREFIX set:', CLOUD_PREFIX);
}

function isCloudEnabled() {
  return !!CLOUD_PREFIX;
}

// ===== 版本检测 =====
var AUDIO_VERSION_KEY = 'audio_cache_version';
var VERSION_FILE = 'version.txt';

// ===== 本地路径 =====
var CACHE_DIR = wx.env.USER_DATA_PATH + '/audio/';
var SFX_CACHE_DIR = CACHE_DIR + 'sfx/';
var MUSIC_CACHE_DIR = CACHE_DIR + 'music/';
var LOCAL_SFX_DIR = 'assets/audio/sfx/';
var LOCAL_MUSIC_DIR = 'assets/audio/music/';

// ===== 语音预算 =====
var MAX_VOICES = 8;

// ===== 优先级（数字越小越优先） =====
var PRIORITY = {
  UI: 0,
  VICTORY: 0,
  ACTION: 1,
  SFX: 2,
  AMBIENT: 3,
};

// ===== SFX 事件定义 =====
var SFX_EVENTS = {
  'collide':      { files: ['collide_duang.mp3'],    priority: PRIORITY.SFX },
  'escape':       { files: ['escape_2.mp3'],         priority: PRIORITY.SFX },
  'coin_fly':     { files: ['coin_fly.mp3'],         priority: PRIORITY.SFX },
  'coin_get':     { files: ['coin_get.mp3'],         priority: PRIORITY.SFX },
  'coin_roll':    { files: ['coin_roll.mp3'],        priority: PRIORITY.SFX },
  'victory':      { files: ['victory.mp3'],          priority: PRIORITY.VICTORY },
  'rewards':      { files: ['rewards.mp3'],          priority: PRIORITY.SFX },
  'button_click': { files: ['button_click.mp3'],     priority: PRIORITY.UI },
  'hint_reveal':  { files: ['hint_reveal.mp3'],      priority: PRIORITY.ACTION },
  'stamina_add':  { files: ['stamina_add.mp3'],      priority: PRIORITY.UI },
  'rotate_loop':  { files: ['rotate_loop.mp3'],      priority: PRIORITY.AMBIENT },
};

// ===== 音乐配置 =====
var MUSIC = {
  explore: { file: 'bgm_explore.mp3', volume: 0.5, fadeMs: 2000 },
  level:   { file: 'bgm_level.mp3',   volume: 0.5, fadeMs: 2000 },
};

module.exports = {
  // 云存储（运行时可变）
  get CLOUD_PREFIX() { return CLOUD_PREFIX; },
  setCloudPrefix: setCloudPrefix,
  isCloudEnabled: isCloudEnabled,

  // 路径
  CACHE_DIR: CACHE_DIR,
  SFX_CACHE_DIR: SFX_CACHE_DIR,
  MUSIC_CACHE_DIR: MUSIC_CACHE_DIR,
  LOCAL_SFX_DIR: LOCAL_SFX_DIR,
  LOCAL_MUSIC_DIR: LOCAL_MUSIC_DIR,

  // 版本检测
  AUDIO_VERSION_KEY: AUDIO_VERSION_KEY,
  VERSION_FILE: VERSION_FILE,

  // 音频参数
  MAX_VOICES: MAX_VOICES,
  PRIORITY: PRIORITY,
  SFX_EVENTS: SFX_EVENTS,
  MUSIC: MUSIC,
};
