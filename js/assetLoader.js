// 资源加载器 - 统一管理图片、音频等资源

const AssetLoader = {
  images: {},
  audios: {},

  /**
   * 加载单张图片
   * @param {string} key - 资源别名
   * @param {string} src - 图片路径
   */
  loadImage(key, src) {
    return new Promise((resolve, reject) => {
      const img = wx.createImage();
      img.onload = () => {
        this.images[key] = img;
        resolve(img);
      };
      img.onerror = (err) => {
        console.error(`图片加载失败: ${src}`, err);
        reject(err);
      };
      img.src = src;
    });
  },

  /**
   * 批量加载图片
   * @param {Array<{key: string, src: string}>} list
   */
  async loadAllImages(list) {
    const tasks = list.map(({ key, src }) => this.loadImage(key, src));
    await Promise.all(tasks);
    console.log(`✅ 图片资源加载完成 (${tasks.length} 张)`);
  },

  /**
   * 获取已加载的图片
   * @param {string} key
   * @returns {Image|null}
   */
  getImage(key) {
    return this.images[key] || null;
  },

  /**
   * 释放所有资源
   */
  dispose() {
    this.images = {};
    this.audios = {};
  },
};

module.exports = AssetLoader;
