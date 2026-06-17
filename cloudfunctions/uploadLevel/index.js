// 云函数：上传/更新关卡（乐观并发控制 — version 字段）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { name, data, version } = event;
  if (!name || !data) {
    return { code: -1, msg: '缺少 name 或 data' };
  }

  const clientVersion = (typeof version === 'number') ? version : 0;
  const pigCount = (data.pigs && data.pigs.length) || 0;
  const now = Date.now();

  try {
    const exist = await db.collection('levels')
      .where({ _openid: OPENID, name })
      .get();

    if (exist.data.length === 0) {
      // 新增（首次上传）
      data.version = 1;
      const res = await db.collection('levels').add({
        data: {
          _openid: OPENID, name, data, pigCount,
          version: 1,
          createdAt: now, updatedAt: now
        }
      });
      return { code: 0, msg: 'created', id: res._id, version: 1 };
    }

    // 已存在 — 版本号检查（乐观并发）
    const doc = exist.data[0];
    const serverVersion = (typeof doc.version === 'number') ? doc.version : 0;

    if (clientVersion !== serverVersion) {
      // 版本不匹配 = 冲突：其他设备已保存过，本次写入被拒绝
      return {
        code: 2, msg: 'conflict',
        serverVersion,
        // 返回服务器当前数据，让客户端自动刷新
        data: doc.data
      };
    }

    // 版本匹配 — 原子条件更新
    const newVersion = serverVersion + 1;
    data.version = newVersion;
    const result = await db.collection('levels')
      .where({ _id: doc._id, version: serverVersion })
      .update({
        data: { data, pigCount, version: newVersion, updatedAt: now }
      });

    if (result.stats.updated === 0) {
      // 并发写入导致匹配失败（极小概率）
      return { code: 2, msg: 'conflict', serverVersion };
    }

    return { code: 0, msg: 'updated', id: doc._id, version: newVersion };
  } catch (err) {
    return { code: -1, msg: err.message };
  }
};
