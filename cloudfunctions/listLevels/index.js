// 云函数：返回已发布关卡的数量范围（minLevel, maxLevel）
// 利用关卡名连续递增的约定，仅返回两个数字，避免 1000 条查询上限
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  try {
    const [minRes, maxRes] = await Promise.all([
      db.collection('levels')
        .where({ published: true })
        .orderBy('name', 'asc')
        .limit(1)
        .get(),
      db.collection('levels')
        .where({ published: true })
        .orderBy('name', 'desc')
        .limit(1)
        .get(),
    ]);

    const minName = minRes.data[0] ? parseInt(minRes.data[0].name, 10) : 0;
    const maxName = maxRes.data[0] ? parseInt(maxRes.data[0].name, 10) : 0;

    return { code: 0, data: { minLevel: minName, maxLevel: maxName } };
  } catch (err) {
    return { code: -1, msg: err.message };
  }
};
