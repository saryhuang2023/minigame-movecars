// 关主系统 — 纯逻辑模块（组合模式，由 PlayingEngine 持有）
// 职责：关主数据获取、夺位判定、个人记录管理、用户信息缓存
// 不依赖 PlayingEngine，仅需云函数 API + 微信存储 + 头像加载回调

function MasterSystem(avatarLoader) {
  this._levelMaster = null;       // { masterUserId, masterSteps, masterNickname, masterAvatarUrl, avatarImg }
  this._myRecord = null;          // 个人最好步数 | null
  this._masterLoading = false;    // 异步拉取关主信息是否进行中
  this._isNewMaster = false;      // 本局是否成为新关主（供结算面板使用）
  this._masterClaimPending = false; // 夺位请求是否还在进行
  this._userInfo = null;          // { nickName, avatarUrl } 持久化缓存
  this._myOpenId = null;          // 当前用户 openid（懒获取，用于匿名昵称降级）
  this._levelName = '';           // 当前关卡编号字符串
  this._loadAvatarImage = avatarLoader; // function(url) → Promise<Image>
}

// ========== 初始化 / 重置 ==========

/** 绑定关卡，读取本地个人记录 */
MasterSystem.prototype.init = function (levelName) {
  this._levelName = levelName;
  this._myRecord = wx.getStorageSync('record_' + levelName) || null;
};

/** 从本地缓存加载用户信息 */
MasterSystem.prototype.loadUserInfo = function () {
  var cached = wx.getStorageSync('userinfo_cache');
  this._userInfo = (cached && cached.avatarUrl) ? cached : null;
};

/** 重置关主运行时状态（关卡切换/退出时调用，不改变 _myRecord） */
MasterSystem.prototype.reset = function () {
  this._isNewMaster = false;
  this._levelMaster = null;
  this._masterLoading = false;
  this._masterClaimPending = false;
};

// ========== 数据获取 ==========

/** 异步获取当前用户 openid（火后即忘，静默失败） */
MasterSystem.prototype.fetchMyOpenId = function () {
  if (this._myOpenId) return;
  var self = this;
  require('../cloud.js').getOpenId()
    .then(function (openid) { self._myOpenId = openid; })
    .catch(function (err) { console.warn('[关主] getOpenId fail:', err); });
};

/** 异步拉取关主信息 + 加载头像（含 loading 防重入） */
MasterSystem.prototype.fetchMaster = function () {
  if (this._masterLoading) return;
  this._masterLoading = true;
  var self = this;
  require('../cloud.js').getLevelInfo(this._levelName)
    .then(function (master) {
      self._levelMaster = master;
      self._masterLoading = false;
      if (master && master.masterAvatarUrl) {
        self._loadAvatarImage(master.masterAvatarUrl).then(function (img) {
          if (self._levelMaster) self._levelMaster.avatarImg = img;
        }).catch(function () {});
      }
    })
    .catch(function (err) {
      console.warn('[关主] _fetchLevelMaster fail:', err);
      self._levelMaster = null;
      self._masterLoading = false;
    });
};

// ========== 个人记录 ==========

/** 更新本地个人最好成绩（仅当本次步数更优时写入） */
MasterSystem.prototype.updateMyRecord = function (steps) {
  var prev = wx.getStorageSync('record_' + this._levelName);
  if (prev == null || prev === '' || steps < parseInt(prev)) {
    wx.setStorageSync('record_' + this._levelName, steps);
    this._myRecord = steps;
  }
};

// ========== 夺位 ==========

/**
 * 尝试夺位成为关主。
 * @param {Object}  params
 * @param {number}  params.steps              当前步数
 * @param {boolean} params.hasUsedRemove      是否用过移除（已弃用，保留兼容）
 * @param {boolean} params.isTrialMode        是否试玩模式（是则跳过夺位）
 * @param {Function} [params.onShowAuthDialog] 需要弹出授权对话框时的回调
 * @param {Function} [params.onNewMaster]      夺位成功回调（PlayingEngine 内部调度动画）
 * @param {Function} [params.onClaimNotGranted] 服务器拒绝 / 错误回调（清理授权按钮）
 */
MasterSystem.prototype.tryClaim = function (params) {
  // 关主信息尚未拉回 → 不判定夺位（避免 currentMin=9999 误判通关即夺位）
  if (this._masterLoading) return;
  var steps = params.steps;
  if (params.isTrialMode) return;

  this.updateMyRecord(steps);
  var currentMin = this._levelMaster ? this._levelMaster.masterSteps : 9999;
  if (steps >= currentMin) return; // 持平不夺

  this._masterClaimPending = true;
  var self = this;

  this._getUserInfo().then(function (userInfo) {
    if (!userInfo.avatarUrl && params.onShowAuthDialog) {
      params.onShowAuthDialog();
    }
    require('../cloud.js').claimLevelMaster(self._levelName, steps, userInfo.avatarUrl || '', userInfo.nickName || '')
      .then(function (res) {
        self._masterClaimPending = false;
        if (res.code === 0) {
          self._levelMaster = res.master;
          if (res.master && res.master.masterAvatarUrl) {
            self._loadAvatarImage(res.master.masterAvatarUrl).then(function (img) {
              if (self._levelMaster) self._levelMaster.avatarImg = img;
            }).catch(function () {});
          }
          if (res.claimed) {
            self._isNewMaster = true;
            if (params.onNewMaster) params.onNewMaster();
          } else if (params.onClaimNotGranted) {
            params.onClaimNotGranted();
          }
        }
      })
      .catch(function (err) {
        self._masterClaimPending = false;
        if (params.onClaimNotGranted) params.onClaimNotGranted();
        console.warn('[关主] claimLevelMaster 失败:', err);
      });
  });
};

/**
 * 获取真实头像昵称后重传关主（由授权对话框回调触发）。
 * @returns {Promise} resolve 为云函数原始返回
 */
MasterSystem.prototype.retryClaimWithRealInfo = function (steps, nickName, avatarUrl) {
  this._userInfo = { nickName: nickName, avatarUrl: avatarUrl };
  wx.setStorageSync('userinfo_cache', this._userInfo);
  var self = this;
  return require('../cloud.js').claimLevelMaster(this._levelName, steps, avatarUrl, nickName)
    .then(function (result) {
      if (result && result.code === 0) {
        self._levelMaster = result.master;
        if (result.master && result.master.masterAvatarUrl) {
          return self._loadAvatarImage(result.master.masterAvatarUrl).then(function (img) {
            if (self._levelMaster) self._levelMaster.avatarImg = img;
            return result;
          });
        }
      }
      return result;
    });
};

// ========== 内部：获取用户信息（缓存优先，不再调 wx.getUserInfo） ==========

MasterSystem.prototype._getUserInfo = function () {
  if (this._userInfo) return Promise.resolve(this._userInfo);
  // 尝试从缓存读取（loading 阶段已预加载）
  var cached = null;
  try { cached = wx.getStorageSync('userinfo_cache'); } catch (e) {}
  if (cached && (cached.avatarUrl || cached.nickName)) {
    this._userInfo = { nickName: cached.nickName || '', avatarUrl: cached.avatarUrl || '' };
    return Promise.resolve(this._userInfo);
  }
  // 无缓存：用 openid 降级
  var self = this;
  var nick = self._myOpenId ? '玩家' + self._myOpenId.slice(-4) : '';
  self._userInfo = { nickName: nick, avatarUrl: '' };
  return Promise.resolve(self._userInfo);
};

// ========== 访问器 ==========

MasterSystem.prototype.getMaster = function () { return this._levelMaster; };
MasterSystem.prototype.getMyRecord = function () { return this._myRecord; };
MasterSystem.prototype.isLoading = function () { return this._masterLoading; };
MasterSystem.prototype.isNewMaster = function () { return this._isNewMaster; };
MasterSystem.prototype.isClaimPending = function () { return this._masterClaimPending; };

/** 获取已加载的关主头像（Image 对象，未加载则 undefined） */
MasterSystem.prototype.getAvatarImg = function () {
  return this._levelMaster && this._levelMaster.avatarImg;
};

/** 当前用户 openid（从 fetchMyOpenId 异步获取，可能为空） */
MasterSystem.prototype.getMyOpenId = function () {
  return this._myOpenId;
};

module.exports = MasterSystem;
