const library = require('../../lib/library')
const { categories, fallbackCategory, maxCategoryLength, maxIngredients, maxSteps, normalizeIngredient, maxSubstituteLength } = require('../../lib/model')

let nextRowKey = 0
function ingredientRow(row) {
  return { ...normalizeIngredient(row), key: nextRowKey++ }
}

function stepRow(row = { text: '', photo: '' }) {
  return { ...row, key: nextRowKey++ }
}

function initial() {
  return {
    title: '', category: categories[0], duration: '', servings: '', cover: '',
    ingredients: [ingredientRow()], steps: [stepRow()], notes: ''
  }
}

Page({
  data: {
    categories, form: initial(), coverPath: '', stepPaths: [''], categoryIndex: 0,
    addingCategory: false, managingCategories: false, categoryDraft: '', maxCategoryLength, fallbackCategory,
    busy: false, unavailable: false, maxIngredients, maxSteps, maxSubstituteLength, ingredientOptions: false
  },

  onLoad(options) {
    this.addedPhotos = []
    try {
      const categories = library.listCategories()
      this.setData({ categories })
      if (!options.id) {
        if (!categories.includes(this.data.form.category)) {
          this.updateCategories(fallbackCategory)
        }
        return
      }
      wx.setNavigationBarTitle({ title: '编辑食谱' })
      const recipe = library.get(options.id)
      if (!recipe) throw new Error('找不到这份食谱')
      recipe.ingredients = recipe.ingredients.length ? recipe.ingredients.map(ingredientRow) : [ingredientRow()]
      recipe.steps = recipe.steps.length ? recipe.steps.map(stepRow) : [stepRow()]
      this.assign(recipe)
    } catch (error) {
      this.setData({ unavailable: true })
      library.loadingError(error, '无法打开食谱')
    }
  },

  onUnload() {
    this.unloaded = true
    this.cleanPhotos(this.addedPhotos)
  },

  onShow() {
    if (!this.voiceSavedId) return
    wx.redirectTo({
      url: '/pages/recipe/index?id=' + encodeURIComponent(this.voiceSavedId),
      fail: () => wx.navigateBack()
    })
  },

  cleanPhotos(files) {
    try {
      library.discardPhotos(files)
    } catch (error) {
      // Keep the images when the saved library could not be read.
    }
  },

  assign(form) {
    this.setData({
      form, categoryIndex: Math.max(0, this.data.categories.indexOf(form.category)),
      coverPath: library.photoPath(form.cover),
      stepPaths: form.steps.map(step => library.photoPath(step.photo))
    })
  },

  input(event) {
    const { field } = event.currentTarget.dataset
    this.setData({ ['form.' + field]: event.detail.value })
  },

  async openVoice() {
    if (this.openingVoice || this.data.form.id || this.data.busy) return
    this.openingVoice = true
    try {
      const form = this.data.form
      if (form.title || form.duration || form.servings || form.notes ||
          form.ingredients.some(row => row.name || row.amount || row.substitute) ||
          form.steps.some(step => step.text || step.photo)) {
        const result = await library.call(wx, 'showModal', {
          title: '用食谱助手记菜',
          content: '在聊天中确认保存后，将以助手整理的草稿为准，保留你已选好的封面和分类。',
          confirmText: '继续'
        })
        if (!result.confirm) return
      }
      const { eventChannel } = await library.call(wx, 'navigateTo', {
        url: '/pages/voice/index',
        events: { voiceSaved: id => { this.voiceSavedId = id } }
      })
      eventChannel.emit('voiceEntry', { category: form.category, cover: form.cover })
    } catch (error) {
      library.loadingError(error, '无法打开语音助手')
    } finally {
      this.openingVoice = false
    }
  },

  toggleIngredientOptions() {
    this.setData({ ingredientOptions: !this.data.ingredientOptions })
  },

  toggleOptional(event) {
    const { index } = event.currentTarget.dataset
    this.setData({ ['form.ingredients[' + index + '].optional']: event.detail.value === true })
  },

  category(event) {
    const categoryIndex = Number(event.detail.value)
    const category = this.data.categories[categoryIndex]
    if (category) this.setData({ categoryIndex, 'form.category': category })
  },

  openCategory() { this.setData({ addingCategory: true, managingCategories: false, categoryDraft: '' }) },
  closeCategory() { this.setData({ addingCategory: false, categoryDraft: '' }) },
  inputCategory(event) { this.setData({ categoryDraft: event.detail.value }) },
  toggleManageCategories() {
    this.setData({ managingCategories: !this.data.managingCategories, addingCategory: false, categoryDraft: '' })
  },

  updateCategories(selected) {
    const categories = library.listCategories()
    this.setData({ categories, categoryIndex: categories.indexOf(selected), 'form.category': selected })
  },

  saveCategory(event) {
    if (!this.data.addingCategory || this.data.busy) return
    try {
      const rawName = event.detail && typeof event.detail.value === 'string' ? event.detail.value : this.data.categoryDraft
      const category = library.addCategory(rawName)
      this.updateCategories(category)
      this.closeCategory()
    } catch (error) {
      library.loadingError(error, '分类未保存')
    }
  },

  async deleteCategory(event) {
    const { category } = event.currentTarget.dataset
    if (this.deletingCategory || !category || category === fallbackCategory) return
    this.deletingCategory = true
    try {
      const count = library.list().filter(recipe => recipe.category === category).length
      const { confirm } = await library.call(wx, 'showModal', {
        title: '删除分类',
        content: count ? '「' + category + '」下的 ' + count + ' 道食谱会移到「其他」。' : '删除「' + category + '」？',
        confirmText: '删除',
        confirmColor: '#a74e42'
      })
      if (!confirm || this.unloaded) return
      library.removeCategory(category)
      this.updateCategories(this.data.form.category === category ? fallbackCategory : this.data.form.category)
    } catch (error) {
      library.loadingError(error, '分类未删除')
    } finally {
      this.deletingCategory = false
    }
  },

  inputRow(event) {
    const { section, index, field } = event.currentTarget.dataset
    this.setData({ ['form.' + section + '[' + index + '].' + field]: event.detail.value })
  },

  addRow(event) {
    const { section } = event.currentTarget.dataset
    const rows = this.data.form[section]
    const ingredient = section === 'ingredients'
    if (rows.length >= (ingredient ? maxIngredients : maxSteps)) return
    const row = ingredient ? ingredientRow() : stepRow()
    this.assign({ ...this.data.form, [section]: rows.concat(row) })
  },

  deleteRow(event) {
    if (this.data.busy) return
    const { section, index } = event.currentTarget.dataset
    const removed = this.data.form[section][index]
    this.assign({ ...this.data.form, [section]: this.data.form[section].filter((row, i) => i !== index) })
    this.releaseDraftPhoto(removed.photo)
  },

  releaseDraftPhoto(file) {
    if (!file || !this.addedPhotos.includes(file)) return
    this.cleanPhotos([file])
  },

  setPhoto(index, photo) {
    if (index === undefined) {
      this.releaseDraftPhoto(this.data.form.cover)
      this.setData({ 'form.cover': photo, coverPath: library.photoPath(photo) })
    } else {
      this.releaseDraftPhoto(this.data.form.steps[index].photo)
      this.setData({ ['form.steps[' + index + '].photo']: photo, ['stepPaths[' + index + ']']: library.photoPath(photo) })
    }
  },

  async pickPhoto(event) {
    if (this.data.busy) return
    const { index } = event.currentTarget.dataset
    this.setData({ busy: true })
    try {
      const photo = await library.selectPhoto()
      if (this.unloaded) this.cleanPhotos([photo])
      else {
        this.addedPhotos.push(photo)
        this.setPhoto(index, photo)
      }
    } catch (error) {
      if (!this.unloaded && !library.isCancel(error)) library.loadingError(error, '照片添加失败，请检查权限或本机空间')
    } finally {
      if (!this.unloaded) this.setData({ busy: false })
    }
  },

  removePhoto(event) {
    if (!this.data.busy) this.setPhoto(event.currentTarget.dataset.index, '')
  },

  save() {
    if (this.saving || this.voiceSavedId || this.data.busy || this.data.unavailable) return
    this.saving = true
    try {
      const editing = Boolean(this.data.form.id)
      const recipe = library.save(this.data.form)
      const back = () => wx.navigateBack({ fail: () => { this.saving = false } })
      if (editing) back()
      else wx.redirectTo({ url: '/pages/recipe/index?id=' + encodeURIComponent(recipe.id), fail: back })
    } catch (error) {
      this.saving = false
      library.loadingError(error, '食谱未保存，请检查本机存储空间')
    }
  }
})
