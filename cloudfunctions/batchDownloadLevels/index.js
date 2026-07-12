// 云函数：批量下载关卡（增量同步）
// 客户端传入 versions: { "0001": 3, "0002": 5 }，仅返回版本号有变化的关卡
// compress: true 时 gzip 压缩（默认）
const cloud = require('wx-server-sdk');
const zlib = require('zlib');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  try {
    const { versions, compress } = event;

    const res = await db.collection('levels')
      .field({ _id: true, name: true, data: true, version: true, published: true, stepBonusThreshold: true })
      .limit(500)
      .get();

    if (!res.data || res.data.length === 0) {
      return { code: 0, ok: true, count: 0, changed: 0, skipped: 0 };
    }

    const localVersions = versions || {};
    const payload = {};
    let skipped = 0;

    for (const level of res.data) {
      const serverVersion = level.version || 1;
      if (localVersions[level.name] !== undefined && serverVersion <= localVersions[level.name]) {
        skipped++;
        continue;
      }
      payload[level.name] = {
        data: level.data,
        _id: level._id,
        version: serverVersion,
        published: level.published === true,
        stepBonusThreshold: level.stepBonusThreshold || level.crownSteps || 0
      };
    }

    if (Object.keys(payload).length === 0) {
      return { code: 0, ok: true, count: res.data.length, changed: 0, skipped };
    }

    const jsonStr = JSON.stringify(payload);
    const useCompress = compress !== false; // 默认压缩

    if (useCompress) {
      const compressed = zlib.gzipSync(Buffer.from(jsonStr, 'utf-8'));
      const base64 = compressed.toString('base64');
      return {
        code: 0,
        ok: true,
        count: res.data.length,
        changed: Object.keys(payload).length,
        skipped,
        base64: base64,
        compressedSize: compressed.length,
        originalSize: Buffer.byteLength(jsonStr, 'utf-8')
      };
    }

    // 不压缩：直接 base64 编码（小游戏客户端可解码）
    const base64 = Buffer.from(jsonStr, 'utf-8').toString('base64');
    return {
      code: 0,
      ok: true,
      count: res.data.length,
      changed: Object.keys(payload).length,
      skipped,
      base64: base64,
      originalSize: Buffer.byteLength(jsonStr, 'utf-8')
    };
  } catch (err) {
    return { code: -1, ok: false, msg: err.message };
  }
};
