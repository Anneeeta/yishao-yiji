const { getConfig, readiness, transcribe, chat, transcriptLimit } = require('../../lib/voice-api')
const recorder = require('../../lib/voice-recorder')
const library = require('../../lib/library')
const { fallbackCategory } = require('../../lib/model')

const confirmationWords = new Set([
  '确认', '确认保存', '确认写入', '保存', '保存食谱',
  '保存这份食谱', '确认保存这份食谱', '可以保存', '同意保存', '就按这版保存'
])

function isSaveConfirmation(text) {
  return confirmationWords.has(text
    .replace(/[。！!，,、\s]+$/g, '')
    .replace(/^(?:好的|好)[，,、\s]+/, ''))
}

Page({
  data: {
    stage: '', transcript: '', transcriptLimit, audioSeconds: 0,
    speechReady: false, chatReady: false, messages: [], pending: '', pendingPhoto: '', attachment: null, error: '',
    coverPath: '', hasChatCover: false,
    draft: null, draftOpen: false, savedRecipe: null, endId: 'chat-end-0', scrollTo: ''
  },

  onLoad() {
    this.history = []
    this.messageId = 0
    this.scrollId = 0
    this.entry = { category: fallbackCategory, cover: '' }
    this.channel = this.getOpenerEventChannel()
    if (this.channel) {
      this.channel.on('voiceEntry', entry => {
        this.entry = entry
        this.fromEditor = true
        if (!this.coverPhoto) this.setData({ coverPath: library.photoPath(entry.cover) })
      })
    }
  },

  onShow() {
    this.setData(readiness(getConfig()))
  },

  onUnload() {
    this.unloaded = true
    if (['starting', 'recording', 'stopping'].includes(this.data.stage)) recorder.cancel()
    if (this.task) this.task.abort()
  },

  onHide() {
    if (this.data.stage === 'recording') this.stopRecording()
  },

  settings() {
    if (!this.data.stage) wx.navigateTo({ url: '/pages/voice-settings/index' })
  },

  input(event) {
    if (!this.data.stage) this.setData({ transcript: event.detail.value, error: '' })
  },

  async attachImage() {
    if (this.data.stage || this.savedId || this.audioPath) return
    this.setData({ stage: 'selecting-image' })
    try {
      const attachment = await library.pickPhoto()
      if (!this.unloaded) this.setData({ attachment, error: '' })
    } catch (error) {
      if (!this.unloaded && !library.isCancel(error)) library.loadingError(error, '无法添加图片')
    } finally {
      if (!this.unloaded) this.setData({ stage: '' })
    }
  },

  detachImage() {
    if (!this.data.stage) this.setData({ attachment: null, error: '' })
  },

  previewPhoto(event) {
    const path = event.currentTarget.dataset.path
    if (path) wx.previewImage({ current: path, urls: [path] })
  },

  scrollDown(changes = {}) {
    const endId = 'chat-end-' + ++this.scrollId
    this.setData({ ...changes, endId }, () => {
      if (!this.unloaded) this.setData({ scrollTo: endId })
    })
  },

  async startRecording() {
    if (this.data.stage || this.savedId) return
    if (!this.data.speechReady) {
      this.settings()
      return
    }
    this.audioPath = ''
    this.setData({ stage: 'starting', audioSeconds: 0 })
    try {
      const recording = await recorder.start(() => {
        if (!this.unloaded) this.setData({ stage: 'recording' })
      })
      if (this.unloaded) return
      this.audioPath = recording.tempFilePath
      this.setData({ audioSeconds: Math.max(1, Math.round(recording.duration / 1000)) })
    } catch (error) {
      if (!this.unloaded) library.loadingError(error, '无法录音')
    } finally {
      if (!this.unloaded) this.setData({ stage: '' })
    }
  },

  stopRecording() {
    if (this.data.stage !== 'recording') return
    this.setData({ stage: 'stopping' })
    recorder.stop()
  },

  async recognize() {
    if (this.data.stage || !this.audioPath) return
    this.setData({ stage: 'transcribing' })
    try {
      const text = await transcribe(getConfig(), this.audioPath, task => { this.task = task })
      if (this.unloaded) return
      const existing = this.data.transcript.trim()
      const combined = (existing ? existing + '\n' + text : text).slice(0, transcriptLimit)
      this.audioPath = ''
      this.setData({ audioSeconds: 0, transcript: combined, error: '' })
    } catch (error) {
      if (!this.unloaded) library.loadingError(error, '语音识别失败')
    } finally {
      this.task = null
      if (!this.unloaded) this.setData({ stage: '' })
    }
  },

  async sendMessage() {
    const text = this.data.transcript.trim()
    const attachment = this.data.attachment
    if (this.data.stage || this.audioPath || this.savedId || this.saving || (!text && !attachment)) return
    if (isSaveConfirmation(text)) {
      if (attachment) {
        this.scrollDown({ error: '还有未发送的图片。请先发送或移除图片，再确认保存' })
        return
      }
      await this.saveConfirmedDraft(text)
      return
    }
    if (!text) {
      this.coverPhoto = attachment
      this.reviewedDraft = null
      this.scrollDown({
        messages: this.appendTurn('', '已选作待保存的封面。发送另一张图片可以更换。', attachment.path),
        coverPath: attachment.path, hasChatCover: true, draftOpen: false, transcript: '', attachment: null, error: ''
      })
      return
    }
    if (!this.data.chatReady) {
      this.settings()
      return
    }
    this.reviewedDraft = null
    this.scrollDown({ stage: 'chatting', pending: text, pendingPhoto: attachment ? attachment.path : '', error: '', draftOpen: false })
    try {
      const reply = await chat(getConfig(), this.history, text, this.currentDraft, task => { this.task = task })
      if (this.unloaded) return
      this.history = this.history.concat(
        { role: 'user', content: text },
        { role: 'assistant', content: reply.message }
      ).slice(-12)
      if (attachment) this.coverPhoto = attachment
      this.currentDraft = reply.draft || this.currentDraft
      const draft = reply.draft && {
        ...reply.draft,
        ingredients: reply.draft.ingredients.map((row, key) => ({ ...row, key })),
        steps: reply.draft.steps.map((step, key) => ({ ...step, key }))
      }
      this.scrollDown({
        messages: this.appendTurn(text, reply.message, attachment && attachment.path), draft,
        coverPath: this.coverPhoto ? this.coverPhoto.path : library.photoPath(this.entry.cover),
        hasChatCover: Boolean(this.coverPhoto),
        draftOpen: false, transcript: '', pending: '', pendingPhoto: '', attachment: null
      })
    } catch (error) {
      if (!this.unloaded) this.scrollDown({ pending: '', pendingPhoto: '', error: error.message || '消息发送失败，请重试' })
    } finally {
      this.task = null
      if (!this.unloaded) this.setData({ stage: '' })
    }
  },

  removeChatCover() {
    if (this.data.stage || !this.coverPhoto) return
    this.coverPhoto = null
    this.reviewedDraft = null
    this.setData({ coverPath: library.photoPath(this.entry.cover), hasChatCover: false, draftOpen: false })
  },

  toggleDraft() {
    if (this.data.stage || !this.data.draft) return
    const draftOpen = !this.data.draftOpen
    if (draftOpen) this.reviewedDraft = this.currentDraft
    this.setData({ draftOpen })
  },

  discardAudio() {
    if (this.data.stage) return
    this.audioPath = ''
    this.setData({ audioSeconds: 0 })
  },

  appendTurn(user, assistant, photo = '') {
    return this.data.messages.concat(
      { id: ++this.messageId, role: 'user', text: user, photo },
      { id: ++this.messageId, role: 'assistant', text: assistant }
    ).slice(-24)
  },

  async saveConfirmedDraft(text) {
    if (this.savedId || this.saving || !isSaveConfirmation(text)) return
    if (!this.data.draft || !this.currentDraft) {
      this.scrollDown({
        messages: this.appendTurn(text, '这轮还没有可以确认的食谱草稿。请继续补充做法，等我整理好再保存。'),
        transcript: '', error: ''
      })
      return
    }
    if (this.reviewedDraft !== this.currentDraft) {
      this.scrollDown({
        messages: this.appendTurn(text, '请先打开「查看草稿」，核对这一版后，再发送「确认」。'),
        transcript: '', error: ''
      })
      return
    }
    this.saving = true
    this.setData({ stage: 'saving', error: '' })
    let addedCover = ''
    let saved
    try {
      const category = library.listCategories().includes(this.entry.category) ? this.entry.category : fallbackCategory
      if (this.coverPhoto) addedCover = await library.persistPhoto(this.coverPhoto)
      if (this.unloaded) return
      saved = library.save({ ...this.currentDraft, category, cover: addedCover || this.entry.cover })
    } catch (error) {
      if (!this.unloaded) this.scrollDown({ error: error.message || '保存失败，请重试' })
      return
    } finally {
      if (addedCover && !saved) {
        try { library.discardPhotos([addedCover]) } catch (error) { /* Preserve the original save error. */ }
      }
      this.saving = false
      if (!this.unloaded) this.setData({ stage: '' })
    }
    this.savedId = saved.id
    if (this.fromEditor) this.channel.emit('voiceSaved', saved.id)
    this.scrollDown({
      messages: this.appendTurn(text, '已保存《' + saved.title + '》到你的食谱画册。'),
      savedRecipe: { id: saved.id, title: saved.title }, draft: null, draftOpen: false, transcript: '', error: ''
    })
  },

  viewSavedRecipe() {
    if (!this.savedId) return
    const open = () => wx.redirectTo({ url: '/pages/recipe/index?id=' + encodeURIComponent(this.savedId) })
    if (this.fromEditor) wx.navigateBack({ fail: open })
    else open()
  }
})
