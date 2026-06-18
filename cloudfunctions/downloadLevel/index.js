// 云函数：下载完整关卡数据
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { id, name } = event;

  try {
    if (id) {
      const res = await db.collection('levels').doc(id).get();
      return { code: 0, data: res.data };
    }
    if (name) {
      const res = await db.collection('levels')
        .where({ name })
        .get();
      if (res.data.length === 0) {
        return { code: -1, msg: '关卡不存在' };
      }
      return { code: 0, data: res.data[0] };
    }
    return { code: -1, msg: '缺少 id 或 name' };
  } catch (err) {
    return { code: -1, msg: err.message };
  }
};
