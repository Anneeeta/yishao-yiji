const examples = require('./examples')
const { normalize, imageName, imageNames, imageLimit, categories, fallbackCategory, categoryName, customCategoryNames } = require('./model')

const storageKey = 'recipe-gallery.library.v1'
const directory = wx.env.USER_DATA_PATH + '/cookbook'
const fs = wx.getFileSystemManager()
const samples = new Set(examples.map(recipe => recipe.cover))
const extensions = { jpeg: 'jpg', jpg: 'jpg', png: 'png', webp: 'webp', gif: 'gif', heic: 'heic', heif: 'heif' }
const backupLimit = 12 * 1024 * 1024
const backupType = 'recipe-gallery'

function uid() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12)
}

function call(context, method, options = {}) {
  return new Promise((resolve, reject) => {
    context[method]({ ...options, success: resolve, fail: reject })
  })
}

function ensureDirectory() {
  try {
    fs.accessSync(directory)
  } catch (error) {
    fs.mkdirSync(directory, true)
  }
}

function photoPath(file) {
  if (!imageName(file)) return ''
  return samples.has(file) ? '/assets/' + file : directory + '/' + file
}

function display(recipe) {
  return {
    ...recipe,
    coverPath: photoPath(recipe.cover),
    ingredients: recipe.ingredients.map((row, index) => ({ ...row, key: index })),
    steps: recipe.steps.map((step, index) => ({ ...step, key: index, photoPath: photoPath(step.photo) })),
    example: isOriginalExample(recipe)
  }
}

function isOriginalExample(recipe) {
  return examples.some(sample => sample.id === recipe.id && sample.updatedAt === recipe.updatedAt)
}

function normalizeHiddenCategories(values) {
  if (!Array.isArray(values)) return []
  return categories.filter(name => name !== fallbackCategory && values.includes(name))
}

function moveHiddenRecipes(recipes, hidden) {
  return recipes.map(recipe => hidden.includes(recipe.category)
    ? { ...recipe, category: fallbackCategory }
    : recipe)
}

function readLibrary() {
  const stored = wx.getStorageSync(storageKey)
  if (stored === '' || stored === undefined) return { recipes: examples.map(normalize), categories: [], hiddenCategories: [] }
  if (!stored || stored.version !== 1 || !Array.isArray(stored.recipes)) {
    throw new Error('无法读取食谱，请勿清理数据')
  }
  const hiddenCategories = normalizeHiddenCategories(stored.hiddenCategories)
  return {
    recipes: moveHiddenRecipes(stored.recipes, hiddenCategories),
    hiddenCategories,
    categories: customCategoryNames([
      ...(Array.isArray(stored.categories) ? stored.categories : []),
      ...stored.recipes.map(recipe => recipe.category)
    ])
  }
}

function list() {
  return readLibrary().recipes
}

function listCategories() {
  const state = readLibrary()
  return categories.filter(name => !state.hiddenCategories.includes(name)).concat(state.categories)
}

function addCategory(rawName) {
  const name = categoryName(rawName)
  if (!name) throw new Error('请输入有效的分类名称')
  const state = readLibrary()
  const existing = categories.concat(state.categories).find(value => value.toLowerCase() === name.toLowerCase())
  if (state.hiddenCategories.includes(existing)) {
    commit({ ...state, hiddenCategories: state.hiddenCategories.filter(value => value !== existing) })
    return existing
  }
  if (existing) return existing
  commit({ ...state, categories: state.categories.concat(name) })
  return name
}

function removeCategory(name) {
  if (name === fallbackCategory) throw new Error('「其他」分类不能删除')
  const state = readLibrary()
  if (!categories.includes(name) && !state.categories.includes(name)) return
  const dropDefault = categories.includes(name) && !state.hiddenCategories.includes(name)
  commit({
    recipes: moveHiddenRecipes(state.recipes, [name]),
    categories: state.categories.filter(value => value !== name),
    hiddenCategories: dropDefault ? state.hiddenCategories.concat(name) : state.hiddenCategories
  })
}

function commit(state) {
  wx.setStorageSync(storageKey, { version: 1, ...state })
}

function get(id) {
  return list().find(recipe => recipe.id === id)
}

function cleanup(files, remaining) {
  const used = new Set(remaining.flatMap(imageNames))
  for (const file of files) {
    if (!imageName(file) || samples.has(file) || used.has(file)) continue
    try {
      fs.unlinkSync(photoPath(file))
    } catch (error) {
      // A missing or inaccessible image should not roll back a saved recipe.
    }
  }
}

function save(input) {
  const state = readLibrary()
  const all = state.recipes
  const old = all.find(recipe => recipe.id === input.id)
  const now = Date.now()
  if (input.id && !old) throw new Error('这份食谱已删除')
  const recipe = normalize({
    ...input,
    category: state.hiddenCategories.includes(input.category) ? fallbackCategory : input.category,
    id: old ? old.id : uid(),
    createdAt: old && !isOriginalExample(old) ? old.createdAt : now,
    updatedAt: now
  })
  const next = all.filter(row => row.id !== recipe.id).concat(recipe)
  commit({ ...state, recipes: next, categories: customCategoryNames(state.categories.concat(recipe.category)) })
  if (old) cleanup(imageNames(old), next)
  return recipe
}

function toggleFavorite(id) {
  const state = readLibrary()
  const recipe = state.recipes.find(row => row.id === id)
  if (!recipe) throw new Error('这份食谱已删除')
  recipe.favorite = !recipe.favorite
  commit(state)
  return recipe.favorite
}

function remove(ids) {
  const state = readLibrary()
  const all = state.recipes
  const next = all.filter(row => !ids.includes(row.id))
  commit({ ...state, recipes: next })
  cleanup(all.filter(row => ids.includes(row.id)).flatMap(imageNames), next)
}

function removeExamples() {
  remove(list().filter(isOriginalExample).map(recipe => recipe.id))
}

async function pickPhoto() {
  const picked = await call(wx, 'chooseMedia', {
    count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed']
  })
  const photo = picked.tempFiles[0]
  if (!photo) throw new Error('未选中图片')
  let source = photo.tempFilePath
  let size = photo.size
  let info = await call(wx, 'getImageInfo', { src: source })
  if (!size) size = (await call(fs, 'stat', { path: source })).stats.size
  for (const pixels of [1080, 800, 600]) {
    if (size <= imageLimit && Math.max(info.width, info.height) <= 1280 && extensions[info.type]) break
    const dimension = info.width >= info.height ? 'compressedWidth' : 'compressedHeight'
    const compressed = await call(wx, 'compressImage', { src: source, quality: 74, [dimension]: pixels })
    source = compressed.tempFilePath
    size = (await call(fs, 'stat', { path: source })).stats.size
    info = await call(wx, 'getImageInfo', { src: source })
  }
  const extension = extensions[info.type]
  if (!extension || size > imageLimit) throw new Error('图片太大或格式不支持，请换一张')
  return { path: source, extension }
}

async function persistPhoto(photo) {
  const file = uid() + '.' + photo.extension
  if (!photo.path || !imageName(file)) throw new Error('图片格式不支持')
  ensureDirectory()
  try {
    await call(fs, 'copyFile', { srcPath: photo.path, destPath: photoPath(file) })
  } catch (error) {
    cleanup([file], [])
    throw new Error('无法保存封面，请重新选择图片或检查存储空间')
  }
  return file
}

async function selectPhoto() {
  return persistPhoto(await pickPhoto())
}

function discardPhotos(files) {
  cleanup(files, list())
}

function loadingError(error, fallback) {
  const message = error && error.message
  wx.showToast({ title: message || fallback, icon: 'none', duration: 2600 })
}

function isCancel(error) {
  return /cancel/i.test((error && error.errMsg) || '')
}

function backupRecord(recipe) {
  const images = Object.create(null)
  for (const file of imageNames(recipe)) {
    if (samples.has(file)) continue
    try {
      images[file] = fs.readFileSync(photoPath(file), 'base64')
    } catch (error) {
      throw new Error('“' + recipe.title + '”的图片无法读取，请在编辑页更换或移除')
    }
  }
  return JSON.stringify({ recipe, images })
}

function clearExports() {
  ensureDirectory()
  for (const file of fs.readdirSync(directory)) {
    if (/^backup-[a-z0-9-]+\.json$/.test(file)) fs.unlinkSync(directory + '/' + file)
  }
}

function exportFiles() {
  const state = readLibrary()
  const recipes = state.recipes.filter(recipe => !isOriginalExample(recipe) || recipe.favorite)
  if (!recipes.length && !state.categories.length && !state.hiddenCategories.length) throw new Error('还没有需要备份的食谱或分类')
  clearExports()
  const prefix = JSON.stringify({
    format: backupType, version: 1, categories: state.categories, hiddenCategories: state.hiddenCategories
  }).slice(0, -1) + ',"entries":['
  const overhead = prefix.replace(/[^\x00-\x7f]/g, 'xxx').length + 2
  const stamp = uid()
  let part = []
  let estimate = overhead
  const paths = []

  function writePart() {
    const filePath = directory + '/backup-' + stamp + '-' + (paths.length + 1) + '.json'
    fs.writeFileSync(filePath, prefix + part.join(',') + ']}', 'utf8')
    paths.push(filePath)
    part = []
    estimate = overhead
  }

  try {
    for (const recipe of recipes) {
      const json = backupRecord(recipe)
      const size = json.replace(/[^\x00-\x7f]/g, 'xxx').length + 1
      if (size + overhead > backupLimit) throw new Error('单份食谱太大，无法备份')
      if (estimate + size > backupLimit && part.length) writePart()
      part.push(json)
      estimate += size
    }
    if (part.length || !paths.length) writePart()
    return paths
  } catch (error) {
    clearExports()
    throw error
  }
}

function readBackup(path) {
  if (fs.statSync(path).size > backupLimit) throw new Error('该备份文件过大')
  let envelope
  try {
    envelope = JSON.parse(fs.readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error('无法读取备份文件')
  }
  if (!envelope || envelope.format !== backupType || envelope.version !== 1 || !Array.isArray(envelope.entries)) {
    throw new Error('请选择一勺一记生成的备份')
  }
  return envelope
}

function restore(path) {
  const backup = readBackup(path)
  const state = readLibrary()
  const next = state.recipes
  const existingCategories = state.categories
  const hiddenCategories = normalizeHiddenCategories([
    ...state.hiddenCategories,
    ...normalizeHiddenCategories(backup.hiddenCategories)
      .filter(name => !next.some(recipe => recipe.category === name && !isOriginalExample(recipe)))
  ])
  const created = []
  let imported = 0
  let skipped = 0
  ensureDirectory()
  try {
    for (const entry of backup.entries) {
      if (!entry || !entry.recipe || typeof entry.recipe !== 'object') throw new Error('备份内容损坏')
      const recipe = normalize(entry.recipe)
      const index = next.findIndex(row => row.id === recipe.id)
      if (index >= 0 && (!isOriginalExample(next[index]) || next[index].favorite)) {
        skipped++
        continue
      }
      const replacements = Object.create(null)
      for (const file of imageNames(recipe)) {
        if (samples.has(file)) continue
        const data = (entry.images || {})[file]
        if (typeof data !== 'string' || data.length > Math.ceil(imageLimit / 3) * 4 ||
            data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
          throw new Error('备份中的图片缺失或损坏')
        }
        const replacement = uid() + file.slice(file.lastIndexOf('.'))
        created.push(replacement)
        fs.writeFileSync(photoPath(replacement), data, 'base64')
        replacements[file] = replacement
      }
      recipe.cover = replacements[recipe.cover] || recipe.cover
      recipe.steps = recipe.steps.map(step => ({ ...step, photo: replacements[step.photo] || step.photo }))
      if (index >= 0) next[index] = recipe
      else next.push(recipe)
      imported++
    }
    const mergedCategories = customCategoryNames([
      ...existingCategories,
      ...(Array.isArray(backup.categories) ? backup.categories : []),
      ...next.map(recipe => recipe.category)
    ])
    const importedCategories = mergedCategories.length - existingCategories.length
    if (imported || importedCategories || hiddenCategories.length !== state.hiddenCategories.length) {
      commit({ recipes: moveHiddenRecipes(next, hiddenCategories), categories: mergedCategories, hiddenCategories })
    }
    return { imported, skipped, importedCategories }
  } catch (error) {
    cleanup(created, [])
    throw error
  }
}

module.exports = {
  call, list, listCategories, addCategory, removeCategory, get, save, display, toggleFavorite, remove, removeExamples,
  pickPhoto, persistPhoto, selectPhoto,
  photoPath, isOriginalExample, discardPhotos, loadingError, isCancel, exportFiles, restore, clearExports
}
