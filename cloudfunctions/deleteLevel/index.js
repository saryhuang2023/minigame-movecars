// 云函数：删除关卡
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { id, name } = event;

  try {
    if (id) {
      await db.collection('levels').doc(id).remove();
      return { code: 0, msg: 'deleted' };
    }
    if (name) {
      const res = await db.collection('levels')
        .where({ _openid: OPENID, name })
        .get();
      if (res.data.length === 0) {
        return { code: -1, msg: '关卡不存在' };
      }
      await db.collection('levels').doc(res.data[0]._id).remove();
      return { code: 0, msg: 'deleted' };
    }
    return { code: -1, msg: '缺少 id 或 name' };
  } catch (err) {
    return { code: -1, msg: err.message };
  }
};
