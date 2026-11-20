const library = require('../../lib/library')

Page({
  data: { files: [], busy: false },

  onUnload() {
    try { library.clearExports() } catch (error) { /* Temporary exports can be cleared on the next export. */ }
  },

  prepare() {
    if (this.data.busy) return
    this.setData({ busy: true, files: [] })
    wx.showLoading({ title: '正在整理备份', mask: true })
    setTimeout(() => {
      try {
        const paths = library.exportFiles()
        this.setData({ files: paths.map((path, index) => ({ path, name: '一勺一记-' + (index + 1) + '之' + paths.length + '.json' })) })
        wx.hideLoading()
      } catch (error) {
        wx.hideLoading()
        library.loadingError(error, '生成备份失败，请检查本机存储空间')
      } finally {
        this.setData({ busy: false })
      }
    }, 32)
  },

  async share(event) {
    if (this.data.busy) return
    const file = this.data.files[event.currentTarget.dataset.index]
    if (!file) return
    if (!wx.shareFileMessage) {
      library.loadingError(null, '请在新版手机微信中发送备份')
      return
    }
    try {
      await library.call(wx, 'shareFileMessage', { filePath: file.path, fileName: file.name })
    } catch (error) {
      if (!library.isCancel(error)) library.loadingError(error, '文件发送失败，请在手机微信中重试')
    }
  },

  async importFile() {
    if (this.data.busy) return
    this.setData({ busy: true })
    let processing = false
    try {
      const result = await library.call(wx, 'chooseMessageFile', { count: 1, type: 'file', extension: ['json'] })
      if (!result.tempFiles.length) return
      processing = true
      wx.showLoading({ title: '正在恢复食谱', mask: true })
      await new Promise(resolve => setTimeout(resolve, 32))
      const { imported, skipped, importedCategories } = library.restore(result.tempFiles[0].path)
      wx.hideLoading()
      processing = false
      await library.call(wx, 'showModal', {
        title: '恢复完成',
        content: '导入 ' + imported + ' 道食谱，跳过 ' + skipped + ' 道。' +
          (importedCategories ? '新增 ' + importedCategories + ' 个分类。' : ''),
        showCancel: false
      })
    } catch (error) {
      if (processing) wx.hideLoading()
      if (!library.isCancel(error)) library.loadingError(error, '无法恢复备份，请检查文件和本机空间')
    } finally {
      this.setData({ busy: false })
    }
  },

  async removeExamples() {
    const result = await library.call(wx, 'showModal', {
      title: '清除示例食谱？',
      content: '已编辑的示例会保留。'
    }).catch(() => ({}))
    if (!result.confirm) return
    try {
      library.removeExamples()
      wx.showToast({ title: '已清除', icon: 'success' })
    } catch (error) {
      library.loadingError(error, '清除失败')
    }
  }
})
