const library = require('../../lib/library')

Page({
  data: { recipe: null, checked: [], error: false },
  onLoad(options) { this.id = options.id },

  onShow() {
    try {
      const recipe = library.get(this.id)
      const checked = recipe && this.data.recipe && recipe.updatedAt === this.data.recipe.updatedAt
        ? this.data.checked
        : Array(recipe ? recipe.ingredients.length : 0).fill(false)
      this.setData({ recipe: recipe ? library.display(recipe) : null, checked, error: false })
    } catch (error) {
      this.setData({ recipe: null, error: true })
      library.loadingError(error, '无法读取食谱')
    }
  },

  toggleIngredient(event) {
    const index = event.currentTarget.dataset.index
    this.setData({ ['checked[' + index + ']']: !this.data.checked[index] })
  },

  preview(event) {
    const current = event.currentTarget.dataset.path
    const { coverPath, steps } = this.data.recipe
    const urls = [coverPath, ...steps.map(step => step.photoPath)].filter(Boolean)
    wx.previewImage({ current, urls })
  },

  edit() { wx.navigateTo({ url: '/pages/edit/index?id=' + encodeURIComponent(this.id) }) },
  back() { wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/gallery/index' }) }) },

  favorite() {
    try {
      this.setData({ 'recipe.favorite': library.toggleFavorite(this.id) })
    } catch (error) {
      library.loadingError(error, '收藏未保存')
    }
  },

  async remove() {
    const result = await library.call(wx, 'showModal', {
      title: '删除这份食谱？',
      content: '食谱和关联照片将从本机删除。',
      confirmText: '删除',
      confirmColor: '#a33f34'
    }).catch(() => ({}))
    if (!result.confirm) return
    try {
      library.remove([this.id])
      this.back()
    } catch (error) {
      library.loadingError(error, '删除失败')
    }
  }
})
