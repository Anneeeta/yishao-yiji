const kitchen = require('../../lib/kitchen')

Page({
  data: { mode: 'home', busy: false, loaded: false, error: '', own: null, joined: [], token: '',
    menu: null, items: [], count: 0, guest: '', note: '', sent: false },

  onLoad(options) {
    this.invitation = options.kitchen && { kitchen: options.kitchen, token: options.token }
    if (this.invitation) this.setData({ mode: 'join' })
  },
  onShow() {
    if (this.data.mode === 'home') this.home()
    else if (this.data.mode === 'menu' && !this.data.sent) this.refreshMenu()
  },
  async run(work) {
    if (this.data.busy) return
    this.setData({ busy: true, error: '' })
    try { await work() }
    catch (error) { this.setData({ error: error.message || '操作未完成，请重试' }) }
    finally { this.setData({ busy: false }) }
  },
  home() {
    return this.run(async () => {
      this.setData({ mode: 'home' })
      const result = await kitchen.call('list')
      this.setData({ ...result, loaded: true })
    })
  },
  invite() {
    return this.run(async () => {
      const result = await kitchen.call('invite')
      this.setData({ token: result.token })
    })
  },
  join() {
    return this.run(async () => {
      const { id } = await kitchen.call('join', this.invitation)
      await this.loadMenu(id)
    })
  },
  async loadMenu(id) {
    const menu = await kitchen.call('menu', { kitchen: id })
    const same = this.data.menu && this.data.menu.id === id && !this.data.sent
    const selected = new Set(same ? this.data.items.filter(row => row.checked).map(row => row.id) : [])
    const items = menu.dishes.map(row => ({ ...row, checked: selected.has(row.id) }))
    this.setData({ mode: 'menu', menu, items, count: items.filter(row => row.checked).length, sent: false,
      guest: same ? this.data.guest : '', note: same ? this.data.note : '' })
  },
  openMenu(event) { return this.run(() => this.loadMenu(event.currentTarget.dataset.id)) },
  refreshMenu() { return this.run(() => this.loadMenu(this.data.menu.id)) },
  toggle(event) {
    if (this.data.busy) return
    const items = this.data.items.map(row => row.id === event.currentTarget.dataset.id ? { ...row, checked: !row.checked } : row)
    this.setData({ items, count: items.filter(row => row.checked).length })
  },
  guestInput(event) { this.setData({ guest: event.detail.value }) },
  noteInput(event) { this.setData({ note: event.detail.value }) },
  submit() {
    if (this.data.sent || !this.data.count) return
    return this.run(async () => {
      const { menu, guest, note } = this.data
      const ids = this.data.items.filter(row => row.checked).map(row => row.id).sort()
      const payload = { kitchen: menu.id, ids, guest, note }
      const key = 'recipe-gallery.pending-order.' + menu.id
      const signature = JSON.stringify(payload)
      let pending = wx.getStorageSync(key)
      if (!pending || pending.signature !== signature) {
        pending = { signature, requestId: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) }
        wx.setStorageSync(key, pending)
      }
      await kitchen.call('submit', { ...payload, requestId: pending.requestId })
      this.setData({ sent: true })
      wx.removeStorageSync(key)
    })
  },
  onShareAppMessage(options = {}) {
    if (options.from === 'button' && this.data.token && this.data.own) return {
      title: '邀请你来「' + this.data.own.title + '」点菜',
      path: '/pages/kitchen/index?kitchen=' + this.data.own.id + '&token=' + this.data.token,
      imageUrl: '/assets/family-menu-card.jpg'
    }
    return { title: '一勺一记', path: '/pages/gallery/index' }
  }
})
