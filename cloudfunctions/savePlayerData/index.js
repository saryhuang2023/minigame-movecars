// 云函数：保存玩家数据
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { data } = event;

  if (!data) {
    return { code: -1, msg: '缺少 data 参数' };
  }

  try {
    // 查找是否已有记录
    const exist = await db.collection('players')
      .where({ _openid: OPENID })
      .get();

    if (exist.data.length > 0) {
      // 更新
      await db.collection('players')
        .doc(exist.data[0]._id)
        .update({
          data: {
            ...data,
            updatedAt: db.serverDate(),
          },
        });
    } else {
      // 新建
      await db.collection('players').add({
        data: {
          ...data,
          _openid: OPENID,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate(),
        },
      });
    }

    return { code: 0, msg: 'ok' };
  } catch (err) {
    return { code: -1, msg: err.message };
  }
};
