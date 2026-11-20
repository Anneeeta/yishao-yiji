const family = require('../../lib/family-menu')
const library = require('../../lib/library')
const { prepareOrder } = require('../../lib/order-shopping')

Page({
  data: { order: null, accepted: false, dishes: [], shopping: [], shoppingOpen: false, incomplete: false },

  onLoad(options) {
    try {
      const saved = family.listOrders()
      const card = options.local ? null : family.readOrderCard(options.order)
      const local = saved.find(item => item.id === (options.local || (card && card.id)))
      const order = local || card
      if (order) {
        this.checks = new Set((local && local.shoppingChecks) || [])
        this.setData({ order, accepted: Boolean(local) })
      }
    } catch (error) {
      library.loadingError(null, '无法打开这份点菜单')
    }
  },

  onShow() {
    if (!this.data.order) return
    try {
      const { dishes, shopping, incomplete } = prepareOrder(this.data.order, library.list())
      this.setData({ dishes, incomplete, shopping: shopping.map(row => ({ ...row, checked: this.checks.has(row.key) })) })
    } catch (error) {
      this.setData({ dishes: this.data.order.dishes.map(title => ({ title, issue: '食谱读取失败' })), shopping: [], incomplete: true })
      library.loadingError(error, '暂时无法读取本机食谱')
    }
  },

  toggleShopping() { this.setData({ shoppingOpen: !this.data.shoppingOpen }) },

  toggleItem(event) {
    const index = Number(event.currentTarget.dataset.index)
    const row = this.data.shopping[index]
    if (!row) return
    const checks = this.data.shopping.filter(item => item.key === row.key ? !row.checked : item.checked).map(item => item.key)
    try {
      if (this.data.accepted) family.saveShoppingChecks(this.data.order.id, checks)
      this.checks = new Set(checks)
      this.setData({ ['shopping[' + index + '].checked']: !row.checked })
    } catch (error) {
      library.loadingError(null, '勾选未保存，请重试')
    }
  },

  accept() {
    if (!this.data.order || this.data.accepted) return
    try {
      family.acceptOrder({ ...this.data.order, shoppingChecks: [...this.checks] })
      this.setData({ accepted: true })
      wx.showToast({ title: '已收下', icon: 'success' })
    } catch (error) {
      library.loadingError(null, '暂时无法保存，请检查本机存储')
    }
  },

  copy() {
    if (this.data.order) wx.setClipboardData({ data: family.orderSummary(this.data.order) })
  },

  inbox() {
    const pages = getCurrentPages()
    if (pages.length >= 2 && pages[pages.length - 2].route === 'pages/family-menu/index') wx.navigateBack()
    else wx.redirectTo({ url: '/pages/family-menu/index?tab=orders' })
  }
})
