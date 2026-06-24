// 云函数：Bug 管理后台 HTTP API
// 通过 HTTP 访问服务 URL: https://cloud1-4gmoyu9g16089510.service.tcloudbase.com/adminBugs
// 鉴权：URL 参数 ?key=ADMIN_KEY

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// --- 配置 ---
const ADMIN_KEY = 'pigpush2026admin';  // 管理后台密钥，可通过环境变量覆盖

const PAGE_SIZE_MAX = 50;  // 单页最大条数

// --- CORS ---
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8'
};

function jsonResponse(data, statusCode) {
  return {
    statusCode: statusCode || 200,
    headers: { ...CORS_HEADERS },
    body: JSON.stringify(data)
  };
}

function errResponse(msg, statusCode) {
  return jsonResponse({ code: -1, msg: msg }, statusCode || 400);
}

/**
 * 解析请求参数：GET 从 queryStringParameters，POST 从 body
 */
function parseParams(event) {
  // POST 请求优先从 body 取（JSON 字符串需解析）
  if (event.httpMethod === 'POST' && event.body) {
    try {
      return JSON.parse(event.body);
    } catch (e) {
      return null;
    }
  }
  // GET 请求从 queryString 取
  if (event.queryStringParameters) {
    return event.queryStringParameters;
  }
  return {};
}

/**
 * 鉴权：检查 adminKey
 */
function checkAuth(params) {
  const key = typeof params === 'object' ? (params.key || params.adminKey || '') : '';
  return key === ADMIN_KEY;
}

/**
 * 将数据库文档转为 API 响应格式（脱敏）
 */
function formatBug(doc) {
  return {
    _id: doc._id,
    meta: doc.meta || {},
    device: doc.device ? {
      platform: doc.device.platform,
      model: doc.device.model,
      system: doc.device.system,
      brand: doc.device.brand,
      benchmarkLevel: doc.device.benchmarkLevel,
    } : {},
    error: doc.error ? {
      message: doc.error.message,
      stack: (doc.error.stack || '').slice(0, 500),
    } : {},
    game: doc.game ? {
      scene: doc.game.scene,
      levelIndex: doc.game.levelIndex,
      levelName: doc.game.levelName,
      fps: doc.game.fps,
    } : {},
    // 管理字段
    status: doc.status || 'open',
    adminNote: doc.adminNote || '',
    resolvedAt: doc.resolvedAt || null,
    resolvedBy: doc.resolvedBy || '',
  };
}

// --- 主函数 ---
exports.main = async (event, context) => {
  // OPTIONS 预检
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { ...CORS_HEADERS }, body: '' };
  }

  const params = parseParams(event);
  if (!params) {
    return errResponse('请求参数解析失败');
  }
  if (!checkAuth(params)) {
    return errResponse('密钥错误', 403);
  }

  const { action, ...rest } = params;

  try {
    switch (action) {
      case 'list':
        return await handleList(rest);
      case 'detail':
        return await handleDetail(rest);
      case 'stats':
        return await handleStats();
      case 'updateStatus':
        return await handleUpdateStatus(rest);
      default:
        return jsonResponse({
          code: 0,
          msg: 'Bug 管理后台 API',
          actions: {
            list: '?action=list&page=1&pageSize=20&status=open&trigger=crash&sort=newest',
            detail: '?action=detail&id=xxx',
            stats: '?action=stats',
            updateStatus: 'POST { action:"updateStatus", id:"xxx", status:"resolved", adminNote:"已修复", resolvedBy:"admin" }'
          }
        });
    }
  } catch (err) {
    console.error('[adminBugs] 错误:', err);
    return errResponse(err.message || '服务器错误', 500);
  }
};

// --- list：分页列表 ---
async function handleList(params) {
  const page = Math.max(1, parseInt(params.page) || 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, parseInt(params.pageSize) || 20));
  const skip = (page - 1) * pageSize;

  // 构建筛选条件
  var where = {};
  if (params.status) {
    where.status = params.status;
  }
  if (params.trigger) {
    where['meta.trigger'] = params.trigger;
  }
  // 日期范围筛选
  if (params.dateFrom || params.dateTo) {
    where['meta.timestamp'] = {};
    if (params.dateFrom) {
      where['meta.timestamp'] = _.gte(parseInt(params.dateFrom));
    }
    if (params.dateTo) {
      where['meta.timestamp'] = _.and(
        where['meta.timestamp'] || _.gte(0),
        _.lte(parseInt(params.dateTo))
      );
    }
  }

  // 排序
  var orderField = 'meta.timestamp';
  var orderDir = 'desc';
  if (params.sort === 'oldest') {
    orderDir = 'asc';
  } else if (params.sort === 'dupCount') {
    orderField = 'meta.dupCount';
    orderDir = 'desc';
  }

  // 执行查询
  var query = db.collection('bug_reports').where(where);
  var [countRes, listRes] = await Promise.all([
    query.count(),
    query
      .orderBy(orderField, orderDir)
      .skip(skip)
      .limit(pageSize)
      .get()
  ]);

  const total = countRes.total;
  const list = listRes.data.map(formatBug);

  return jsonResponse({
    code: 0,
    data: {
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      list
    }
  });
}

// --- detail：单条详情 ---
async function handleDetail(params) {
  const { id } = params;
  if (!id) {
    return errResponse('缺少 id 参数');
  }

  try {
    const res = await db.collection('bug_reports').doc(id).get();
    if (!res.data) {
      return errResponse('记录不存在', 404);
    }
    // 详情返回完整数据（含 logs, replay, perf, stack）
    const doc = res.data;
    return jsonResponse({
      code: 0,
      data: {
        _id: doc._id,
        meta: doc.meta || {},
        device: doc.device || {},
        error: doc.error || {},
        game: doc.game || {},
        replay: doc.replay || [],
        perf: doc.perf || {},
        logs: (doc.logs || []).slice(-100),  // 最近 100 条
        // 管理字段
        status: doc.status || 'open',
        adminNote: doc.adminNote || '',
        resolvedAt: doc.resolvedAt || null,
        resolvedBy: doc.resolvedBy || '',
      }
    });
  } catch (err) {
    if (err.errCode === -1) {
      return errResponse('记录不存在', 404);
    }
    throw err;
  }
}

// --- stats：统计概览 ---
async function handleStats() {
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const todayStart = now - (now % DAY_MS);  // 今天 00:00:00
  const weekStart = todayStart - 7 * DAY_MS;
  const monthStart = todayStart - 30 * DAY_MS;

  // 并行统计
  const [totalRes, byStatus, byTrigger, todayCount, weekCount, monthCount] = await Promise.all([
    db.collection('bug_reports').count(),
    // 按状态统计
    db.collection('bug_reports')
      .aggregate()
      .group({ _id: '$status', count: _.sum(1) })
      .end(),
    // 按触发器统计
    db.collection('bug_reports')
      .aggregate()
      .group({ _id: '$meta.trigger', count: _.sum(1) })
      .end(),
    // 今日新增
    db.collection('bug_reports').where({ 'meta.timestamp': _.gte(todayStart) }).count(),
    // 本周新增
    db.collection('bug_reports').where({ 'meta.timestamp': _.gte(weekStart) }).count(),
    // 本月新增
    db.collection('bug_reports').where({ 'meta.timestamp': _.gte(monthStart) }).count(),
  ]);

  // 格式化状态统计
  const statusMap = {};
  (byStatus.list || []).forEach(item => {
    statusMap[item._id || 'open'] = item.count;
  });

  // 格式化触发器统计
  const triggerMap = {};
  (byTrigger.list || []).forEach(item => {
    triggerMap[item._id || 'unknown'] = item.count;
  });

  return jsonResponse({
    code: 0,
    data: {
      total: totalRes.total,
      byStatus: {
        open: statusMap.open || 0,
        investigating: statusMap.investigating || 0,
        resolved: statusMap.resolved || 0,
        ignored: statusMap.ignored || 0,
      },
      byTrigger: {
        crash: triggerMap.crash || 0,
        unhandledRejection: triggerMap.unhandledRejection || 0,
        lag: triggerMap.lag || 0,
        user: triggerMap.user || 0,
      },
      today: todayCount.total,
      week: weekCount.total,
      month: monthCount.total,
    }
  });
}

// --- updateStatus：状态变更 ---
async function handleUpdateStatus(params) {
  const { id, status, adminNote, resolvedBy } = params;
  if (!id) {
    return errResponse('缺少 id 参数');
  }
  if (!status || !['open', 'investigating', 'resolved', 'ignored'].includes(status)) {
    return errResponse('status 必须为 open / investigating / resolved / ignored');
  }

  try {
    const now = Date.now();
    const updateData = {
      status: status,
      adminNote: adminNote || '',
    };

    // 必要时清除注释
    if (status === 'open') {
      updateData.resolvedAt = null;
      updateData.resolvedBy = '';
    }

    if (status === 'resolved' || status === 'ignored') {
      updateData.resolvedAt = now;
      updateData.resolvedBy = resolvedBy || 'admin';
    }

    await db.collection('bug_reports').doc(id).update({ data: updateData });

    return jsonResponse({ code: 0, msg: 'ok', status: status });
  } catch (err) {
    if (err.errCode === -1) {
      return errResponse('记录不存在', 404);
    }
    throw err;
  }
}
