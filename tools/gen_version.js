#!/usr/bin/env node
// tools/gen_version.js — 生成本地资源指纹清单 version.json
//
// 用法（在项目根目录执行）：
//   node tools/gen_version.js
//
// 扫描「源根目录」生成清单：
//   - cloud-src/ : 纯云端资源的「本地源镜像」，用于构建期算 MD5；
//                 该目录已在 project.config.json 的 packOptions.ignore 排除，
//                 不会打进包，但 gen_version 会扫它生成 data/... 条目。
//                 （目录内保持与云存储相同的相对结构，如
//                   cloud-src/skins/rock/idle/1.png
//                   → 清单 key "data/skins/rock/idle/1.png"）
//
// ⚠️ 设计约定（用户需求）：
//   - assets/ 下的资源永远只读本地、不参与云端版本管理，因此【不扫描 assets/】。
//   - 只有 cloud-src/ 下的资源才走云端：版本清单（version.json）、云存储下载、本地缓存。
//   - 音频（mp3 等）也放在 cloud-src/ 下并纳入同一清单（key 以 "data/audio/" 开头），
//     与图片统一版本管理（音频在云存储 data/ 目录内，位于 data/audio/ 下）。
//   若 cloud-src/ 不存在则直接报错退出（纯云端资源必须提供镜像）。
//
// 资源 key 规则：
//   - 图片/其他资源（.png/.jpg/.jpeg/.webp/.gif/.bmp）：key = "data/" + 相对路径
//   - 音频资源（.mp3/.wav/.ogg/.m4a）：key = "data/" + 相对路径（相对路径已含 "audio/" 子目录）
//
// 设计对齐（客户端）：
//   - 图片走 CLOUD_DATA_PREFIX + "<rel>"           → 云存储路径 data/<rel>
//   - 音频走 CLOUD_DATA_PREFIX + "audio/<rel>"（即 CLOUD_PREFIX = CLOUD_DATA_PREFIX+"audio/"）
//                                                → 云存储路径 data/audio/<rel>
//   所有资源 key 恰好等于「云存储根目录（cloud://env/）下的相对路径」。
//
// 产物 version.json 需经微信开发者工具手动上传至云存储 data/ 目录（覆盖同名文件），
// 客户端启动时会下载 data/version.json 一次，与本地缓存指纹比对后只对变化的文件重新下载。
//
// ⚠️ 维护要点：cloud-src/ 是「上传云存储的源头」，请保持其内容与该云端文件一致；
//    若云上改了图却没同步本地镜像 → manifest MD5 不变 → 客户端以为没变、不重拉。

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var ROOT = path.resolve(__dirname, '..');        // 项目根目录
var OUTPUT = path.join(ROOT, 'version.json');

// 源根目录：仅 cloud-src/（纯云端资源的本地镜像）。
// assets/ 资源只读本地、不纳入云端版本管理，故不扫描。
var SOURCE_ROOTS = [
  { dir: path.join(ROOT, 'cloud-src'), label: 'cloud-src' }
];

// 纳入清单的资源后缀
var AUDIO_EXT = { '.mp3': 1, '.wav': 1, '.ogg': 1, '.m4a': 1 };
var IMAGE_EXT = { '.png': 1, '.jpg': 1, '.jpeg': 1, '.webp': 1, '.gif': 1, '.bmp': 1 };

function md5File(filePath) {
  var buf = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(buf).digest('hex');
}

function walk(dir, cb) {
  var entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (var i = 0; i < entries.length; i++) {
    var ent = entries[i];
    var full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walk(full, cb);
    } else if (ent.isFile()) {
      cb(full);
    }
  }
}

function main() {
  var manifest = {};
  var imgCount = 0, audioCount = 0, skipCount = 0, rootCount = 0;

  SOURCE_ROOTS.forEach(function (root) {
    if (!fs.existsSync(root.dir)) {
      console.log('[gen_version] 跳过不存在的源根目录: ' + root.label + ' (' + root.dir + ')');
      return;
    }
    rootCount++;
    walk(root.dir, function (full) {
      var rel = path.relative(root.dir, full).split(path.sep).join('/');
      var ext = path.extname(full).toLowerCase();

      var key;
      if (AUDIO_EXT[ext]) {
        key = 'data/' + rel;       // 音频：与图片统一走 data/ 前缀（rel 已含 audio/ 子目录）
        audioCount++;
      } else if (IMAGE_EXT[ext]) {
        key = 'data/' + rel;       // 图片/其他资源：data/ + 相对路径
        imgCount++;
      } else {
        skipCount++;               // 非资源文件（json/ttf/...）不纳入清单
        return;
      }

      if (manifest.hasOwnProperty(key)) {
        console.warn('[gen_version] ⚠ key 冲突（多源根出现同一相对路径），后者覆盖: ' + key);
      }
      manifest[key] = md5File(full);
    });
  });

  if (rootCount === 0) {
    console.error('[gen_version] 没有任何可用的源根目录（cloud-src/ 不存在，纯云端资源必须提供本地镜像）');
    process.exit(1);
  }

  // 按 key 排序，便于 git diff / 人工核对
  var sorted = {};
  Object.keys(manifest).sort().forEach(function (k) {
    sorted[k] = manifest[k];
  });

  fs.writeFileSync(OUTPUT, JSON.stringify(sorted, null, 2));
  console.log('[gen_version] 生成完成 → ' + OUTPUT);
  console.log('[gen_version] 图片/资源: ' + imgCount + '  音频: ' + audioCount + '  跳过(非资源): ' + skipCount);
  console.log('[gen_version] 清单条目合计: ' + Object.keys(sorted).length);
  console.log('[gen_version] 下一步：用微信开发者工具将 version.json 上传到云存储 data/ 目录（覆盖同名文件）');
}

main();
