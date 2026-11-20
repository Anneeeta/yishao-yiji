const { getConfig, saveConfig } = require('../../lib/voice-api')
const { loadingError } = require('../../lib/library')

Page({
  data: {
    form: {},
    chatFields: [
      { key: 'chatBase', label: '整理 API Base URL', placeholder: 'https://api.siliconflow.cn/v1' },
      { key: 'chatModel', label: '整理模型', placeholder: '填写模型 ID' },
      { key: 'chatKey', label: '整理 API Key', placeholder: '填写你的 Key', secret: true }
    ],
    speechFields: [
      { key: 'speechBase', label: '转写 API Base URL', placeholder: 'https://api.siliconflow.cn/v1' },
      { key: 'speechModel', label: '转写模型', placeholder: '填写模型 ID' },
      { key: 'speechKey', label: '转写 API Key', placeholder: '同域名时留空则使用整理 Key', secret: true }
    ]
  },

  onLoad() { this.setData({ form: getConfig() }) },

  input(event) {
    this.setData({ ['form.' + event.currentTarget.dataset.key]: event.detail.value })
  },

  save() {
    try {
      saveConfig(this.data.form)
      wx.navigateBack()
    } catch (error) {
      loadingError(error, '设置未保存')
    }
  }
})
