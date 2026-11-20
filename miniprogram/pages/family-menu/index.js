const library = require('../../lib/library')
const family = require('../../lib/family-menu')
const kitchen = require('../../lib/kitchen')
const ownerFlag = 'recipe-gallery.kitchen-owner'

Page({
  data: { tab: 'menu', title: family.defaultTitle, query: '', items: [], total: 0, selected: 0, shareReady: false, orders: [] },

  onLoad(options) {
    this.ids = new Set()
    this.recipes = []
    try {
      const draft = family.getMenuDraft()
      if (draft) {
        this.ids = new Set(draft.ids)
        this.setData({ title: draft.title })
      }
    } catch (error) {
      library.loadingError(null, '无法读取家庭菜单草稿')
    }
    if (options.tab === 'orders') this.setData({ tab: 'orders' })
  },

  onShow() {
    try {
      this.recipes = library.list().sort((a, b) => b.createdAt - a.createdAt)
      const existing = new Set(this.recipes.map(recipe => recipe.id))
      this.ids = new Set([...this.ids].filter(id => existing.has(id)))
      this.refresh()
      this.showOrders()
      if (this.data.tab === 'orders' && wx.getStorageSync(ownerFlag)) this.syncOrders()
    } catch (error) {
      library.loadingError(error, '无法读取菜单')
    }
  },

  showOrders() {
    const orders = family.listOrders().map(order => ({
      id: order.id, title: order.title, guest: order.guest, dishes: order.dishes.join('、'),
      count: order.dishes.length, received: family.dateLabel(order.receivedAt)
    }))
    this.setData({ orders })
  },
  async syncOrders() {
    if (this.data.syncing) return
    this.setData({ syncing: true, cloudError: '' })
    try {
      let offset = 0
      let rows
      const cursorKey = 'recipe-gallery.kitchen-inbox-latest'
      const cursor = wx.getStorageSync(cursorKey)
      let newest
      do {
        const result = await kitchen.call('orders', { offset })
        rows = result.orders
        if (!offset && rows.length) newest = rows[0].id
        family.importKitchenOrders(rows)
        offset += rows.length
      } while (rows.length === 40 && !rows.some(row => row.id === cursor))
      this.showOrders()
      if (newest) {
        wx.setStorageSync(cursorKey, newest)
        wx.setStorageSync(ownerFlag, true)
      }
    } catch (error) { this.setData({ cloudError: error.message || '暂时无法同步' }) }
    finally { this.setData({ syncing: false }) }
  },
  async publish() {
    if (this.data.publishing) return
    const dishes = this.recipes.filter(recipe => this.ids.has(recipe.id)).map(({ id, title }) => ({ id, title }))
    this.setData({ publishing: true, cloudError: '' })
    try {
      await kitchen.call('publish', { title: family.menuTitle(this.data.title), dishes })
      wx.setStorageSync(ownerFlag, true)
      wx.showToast({ title: '厨房菜单已更新', icon: 'success' })
      wx.navigateTo({ url: '/pages/kitchen/index' })
    } catch (error) { this.setData({ cloudError: error.message }) }
    finally { this.setData({ publishing: false }) }
  },

  refresh(changes = {}) {
    const { title, query } = { ...this.data, ...changes }
    const match = query.trim().toLowerCase()
    const selected = this.recipes.filter(recipe => this.ids.has(recipe.id))
    this.names = selected.map(recipe => recipe.title)
    this.sharePath = family.makeMenuPath(title, this.names, selected.map(recipe => recipe.id))
    const items = this.recipes
      .filter(recipe => !match || (recipe.title + ' ' + recipe.category).toLowerCase().includes(match))
      .map(recipe => ({ id: recipe.id, title: recipe.title, category: recipe.category, checked: this.ids.has(recipe.id) }))
    this.setData({ ...changes, items, total: this.recipes.length, selected: selected.length, shareReady: Boolean(this.sharePath) })
  },

  remember() {
    try {
      family.saveMenuDraft(this.data.title, [...this.ids])
    } catch (error) {
      library.loadingError(null, '菜单草稿暂时无法保存在本机')
    }
  },

  titleInput(event) { this.refresh({ title: event.detail.value }) },
  search(event) { this.refresh({ query: event.detail.value }) },
  switchTab(event) {
    const tab = event.currentTarget.dataset.tab
    if (tab === 'menu' || tab === 'orders') this.setData({ tab, cloudError: '' })
    if (tab === 'orders' && wx.getStorageSync(ownerFlag)) this.syncOrders()
  },

  toggleDish(event) {
    const id = event.currentTarget.dataset.id
    const recipe = this.recipes.find(item => item.id === id)
    if (!recipe) return
    if (this.ids.has(id)) this.ids.delete(id)
    else {
      if (this.ids.size >= family.maxDishes) {
        library.loadingError(null, '这张菜单已选满，请分成两张分享')
        return
      }
      if (this.recipes.some(item => this.ids.has(item.id) && item.title === recipe.title)) {
        library.loadingError(null, '菜单里已有同名菜')
        return
      }
      this.ids.add(id)
    }
    this.refresh()
    this.remember()
  },

  preview() {
    if (this.sharePath) wx.navigateTo({ url: this.sharePath })
  },

  copyMenu() {
    if (!this.names.length) return
    wx.setClipboardData({ data: [family.menuTitle(this.data.title), ...this.names.map(name => '· ' + name)].join('\n') })
  },

  openOrder(event) {
    const id = event.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/family-order/index?local=' + encodeURIComponent(id) })
  },

  onShareAppMessage(options = {}) {
    if (options.from === 'button' && this.data.tab === 'menu' && this.sharePath) {
      return { title: family.menuTitle(this.data.title) + ' · 想吃什么？', path: this.sharePath, imageUrl: '/assets/family-menu-card.jpg' }
    }
    return { title: '一勺一记', path: '/pages/gallery/index' }
  }
})
