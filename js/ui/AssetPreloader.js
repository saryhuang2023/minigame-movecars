// ===== 资源预加载器 =====
// 在游戏启动时集中加载面板/UI 资源，避免首次打开面板时图片未就绪
//
// 使用方式：
//   1. 注册：AssetPreloader.register({ key: 'assets/path/file.png' })
//   2. 启动：AssetPreloader.preload(callback)  // fire-and-forget
//   3. 获取：AssetPreloader.get('key')          // 返回 Image 对象（同步）

var _images = {};       // key → Image 对象
var _ready = {};        // key → true/false
var _pending = 0;       // 尚未完成的加载数

/**
 * 注册需要预加载的资源清单
 * @param {Object} manifest — { key: 'assets/xxx/yyy.png', ... }
 */
function register(manifest) {
  var keys = Object.keys(manifest);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (!manifest.hasOwnProperty(key)) continue;
    if (_images[key]) continue; // 已注册过，跳过

    var path = manifest[key];
    var img = wx.createImage();
    _pending++;

    // IIFE 捕获当前 key/path 值（避免 for-in + var 的闭包陷阱）
    (function(k, p) {
      img.onload = function () {
        _ready[k] = true;
        _pending--;
      };
      img.onerror = function (err) {
        console.warn('[AssetPreloader] 加载失败:', k, p, err);
        _ready[k] = false;
        _pending--;
      };
    })(key, path);

    img.src = path;
    _images[key] = img;
    _ready[key] = false;
  }
}

/**
 * 启动预加载（fire-and-forget）
 * @param {Function} [onAllDone] — 全部完成后回调（用于进度条等）
 */
function preload(onAllDone) {
  if (_pending <= 0) {
    if (onAllDone) onAllDone();
    return;
  }

  // 轮询检查（微信小游戏 Image.onload 在部分机型延迟触发）
  var timer = setInterval(function () {
    if (_pending <= 0) {
      clearInterval(timer);
      if (onAllDone) onAllDone();
    }
  }, 50);
}

/**
 * 获取已预加载的 Image 对象（同步）
 * 如果未注册或未加载完成，返回 null（调用方需自行处理）
 */
function get(key) {
  return _images[key] || null;
}

/**
 * 检查指定资源是否已就绪
 */
function isReady(key) {
  return _ready[key] === true;
}

/**
 * 所有已注册资源是否全部就绪
 */
function isAllReady() {
  return _pending <= 0;
}

module.exports = {
  register: register,
  preload: preload,
  get: get,
  isReady: isReady,
  isAllReady: isAllReady,
};
