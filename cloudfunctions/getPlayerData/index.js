// 云函数：获取玩家数据（条件拉取）
// 客户端带上本地版本号：一致则只回成功、不回内容（省流量）；不一致才回全量。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const clientVersion = (typeof event.version === 'number') ? event.version : 0;

  try {
    const res = await db.collection('players')
      .where({ _openid: OPENID })
      .get();

    if (res.data.length === 0) {
      // 新玩家，无存档
      return { code: 0, data: null };
    }

    const record = res.data[0];

    // 版本一致（含旧存档无 version 字段的情况已在下方判为非一致）：不返回内容，仅回成功
    if (typeof record.version === 'number' && record.version === clientVersion) {
      return { code: 0, data: null, version: record.version, unchanged: true };
    }

    // 版本不一致：返回全量内容 + 当前版本号
    return { code: 0, data: record, version: record.version };
  } catch (err) {
    return { code: -1, msg: err.message };
  }
};
