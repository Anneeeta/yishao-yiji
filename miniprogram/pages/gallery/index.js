const library = require('../../lib/library')
const { categories, sortOptions, visibleRecipes } = require('../../lib/model')
const pageSize = 30

Page({
  data: {
    categories, selected: '', panel: '', sortOptions, sortIndex: 0,
    favorites: false, query: '', items: [], count: 0, matches: 0, error: false
  },

  onShow() {
    this.refresh()
  },

  refresh(changes = {}) {
    const filters = { ...this.data, ...changes }
    try {
      const all = library.list()
      const categories = library.listCategories()
      const selected = categories.includes(filters.selected) ? filters.selected : ''
      this.filtered = visibleRecipes(all, filters.query, selected, filters.favorites, filters.sortIndex)
      const limit = Object.keys(changes).length ? pageSize : Math.max(this.data.items.length, pageSize)
      const items = this.cards(this.filtered.slice(0, limit))
      this.setData({ ...changes, categories, selected, items, count: all.length, matches: this.filtered.length, error: false })
    } catch (error) {
      this.setData({ error: true })
      library.loadingError(error, '无法读取食谱')
    }
  },

  cards(recipes) {
    return recipes.map(recipe => ({
      id: recipe.id, title: recipe.title, category: recipe.category, duration: recipe.duration,
      favorite: recipe.favorite, example: library.isOriginalExample(recipe), coverPath: library.photoPath(recipe.cover)
    }))
  },

  onReachBottom() {
    const start = this.data.items.length
    if (this.data.error || !this.filtered || start >= this.filtered.length) return
    this.setData({ items: this.data.items.concat(this.cards(this.filtered.slice(start, start + pageSize))) })
  },

  search(event) { this.refresh({ query: event.detail.value }) },
  clearSearch() { this.refresh({ query: '' }) },
  filter(event) {
    this.refresh({ selected: event.currentTarget.dataset.category || '', panel: '' })
  },
  togglePanel(event) {
    const { panel } = event.currentTarget.dataset
    this.setData({ panel: this.data.panel === panel ? '' : panel })
  },
  chooseSort(event) {
    const sortIndex = Number(event.currentTarget.dataset.index)
    if (sortOptions[sortIndex]) this.refresh({ sortIndex, panel: '' })
  },
  toggleFavorites() { this.refresh({ favorites: !this.data.favorites }) },
  reset() { this.refresh({ selected: '', favorites: false, query: '', panel: '' }) },
  add() { wx.navigateTo({ url: '/pages/edit/index' }) },
  backup() { wx.navigateTo({ url: '/pages/backup/index' }) },
  familyMenu() { wx.navigateTo({ url: '/pages/family-menu/index' }) },
  open(event) {
    wx.navigateTo({ url: '/pages/recipe/index?id=' + encodeURIComponent(event.currentTarget.dataset.id) })
  },
  favorite(event) {
    try {
      library.toggleFavorite(event.currentTarget.dataset.id)
      this.refresh()
    } catch (error) {
      library.loadingError(error, '收藏未保存')
    }
  }
})
