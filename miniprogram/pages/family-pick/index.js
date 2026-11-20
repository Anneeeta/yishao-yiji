const family = require('../../lib/family-menu')

Page({
  data: { menu: null, items: [], count: 0, guest: '', note: '', order: null, canShare: false },

  onLoad(options) {
    const menu = family.readMenuCard(options.menu)
    if (!menu) return
    this.checked = new Set()
    this.setData({
      menu,
      items: menu.dishes.map((title, index) => ({ index, title, checked: false }))
    })
  },

  toggleDish(event) {
    const index = Number(event.currentTarget.dataset.index)
    if (!this.data.menu || !this.data.menu.dishes[index]) return
    if (this.checked.has(index)) this.checked.delete(index)
    else this.checked.add(index)
    this.setData({ ['items[' + index + '].checked']: this.checked.has(index), count: this.checked.size })
  },

  changeGuest(event) { this.setData({ guest: event.detail.value }) },
  changeNote(event) { this.setData({ note: event.detail.value }) },

  review() {
    if (!this.data.menu || !this.checked.size) return
    const dishes = this.data.menu.dishes.filter((_, index) => this.checked.has(index))
    const ids = this.data.menu.recipeIds.filter((_, index) => this.checked.has(index))
    const order = family.makeOrder(this.data.menu.title, dishes, this.data.guest, this.data.note, ids)
    this.sharePath = family.makeOrderPath(order)
    this.setData({ order, canShare: Boolean(this.sharePath) })
    wx.pageScrollTo({ scrollTop: 0, duration: 160 })
  },

  revise() {
    this.sharePath = ''
    this.setData({ order: null, canShare: false })
  },

  copyOrder() {
    if (this.data.order) wx.setClipboardData({ data: family.orderSummary(this.data.order) })
  },

  home() { wx.reLaunch({ url: '/pages/gallery/index' }) },

  onShareAppMessage(options = {}) {
    const order = this.data.order
    if (options.from === 'button' && order && this.sharePath) {
      const sender = order.guest ? order.guest + '想吃' : '想吃'
      return { title: sender + '这 ' + order.dishes.length + ' 道菜', path: this.sharePath, imageUrl: '/assets/family-menu-card.jpg' }
    }
    const menu = this.data.menu
    const path = menu && family.makeMenuPath(menu.title, menu.dishes, menu.recipeIds)
    if (path) return { title: menu.title + ' · 想吃什么？', path, imageUrl: '/assets/family-menu-card.jpg' }
    return { title: '一勺一记', path: '/pages/gallery/index' }
  }
})
