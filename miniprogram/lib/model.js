const fallbackCategory = '其他'
const categories = ['家常菜', '主食', '汤羹', '甜点', '饮品', fallbackCategory]
const maxCategoryLength = 16
const sortOptions = ['最新添加', '最早添加', '最近编辑', '按菜名']
const maxSteps = 16
const maxIngredients = 40
const imageLimit = 450 * 1024
const maxSubstituteLength = 80

function clip(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function name(value) {
  return typeof value === 'string' && /^[a-z0-9-]{1,80}$/.test(value) ? value : ''
}

function imageName(value) {
  return typeof value === 'string' && /^[a-z0-9-]{1,80}\.(jpg|png|webp|gif|heic|heif)$/.test(value) ? value : ''
}

function categoryName(value) {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
  return name && name !== '全部' && name.length <= maxCategoryLength ? name : ''
}

function customCategoryNames(values) {
  return [...new Set(values.map(categoryName).filter(value => value && !categories.includes(value)))]
}

function normalizeIngredient(row) {
  return {
    name: clip(row && row.name, 60),
    amount: clip(row && row.amount, 40),
    optional: Boolean(row && row.optional === true),
    substitute: clip(row && row.substitute, maxSubstituteLength)
  }
}

function normalize(input) {
  const title = clip(input.title, 44)
  const id = name(input.id)
  if (!id || !title) throw new Error('请输入菜名')
  return {
    id,
    title,
    category: categoryName(input.category) || fallbackCategory,
    duration: clip(input.duration, 16),
    servings: clip(input.servings, 16),
    cover: imageName(input.cover),
    ingredients: (Array.isArray(input.ingredients) ? input.ingredients : []).slice(0, maxIngredients)
      .map(normalizeIngredient)
      .filter(row => row.name),
    steps: (Array.isArray(input.steps) ? input.steps : []).slice(0, maxSteps)
      .map(row => ({ text: clip(row && row.text, 500), photo: imageName(row && row.photo) }))
      .filter(row => row.text || row.photo),
    notes: clip(input.notes, 1200),
    favorite: input.favorite === true,
    createdAt: Number.isFinite(input.createdAt) ? input.createdAt : Date.now(),
    updatedAt: Number.isFinite(input.updatedAt) ? input.updatedAt : Date.now()
  }
}

function imageNames(recipe) {
  return [...new Set([recipe.cover, ...recipe.steps.map(step => step.photo)].filter(Boolean))]
}

function compareRecipes(a, b, sortIndex) {
  const byName = () => a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id)
  switch (sortIndex) {
    case 1: return a.createdAt - b.createdAt || byName()
    case 2: return b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || byName()
    case 3: return byName()
    default: return b.createdAt - a.createdAt || byName()
  }
}

function visibleRecipes(recipes, query, category, favorites, sortIndex = 0) {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  return recipes.filter(recipe => {
    if (favorites && !recipe.favorite) return false
    if (category && recipe.category !== category) return false
    const search = [recipe.title, recipe.category, ...recipe.ingredients.flatMap(row => [row.name, row.substitute || ''])]
      .join(' ').toLowerCase()
    return words.every(word => search.includes(word))
  }).sort((a, b) => compareRecipes(a, b, sortIndex))
}

module.exports = {
  categories, fallbackCategory, maxCategoryLength, sortOptions, categoryName, customCategoryNames,
  maxSteps, maxIngredients, maxSubstituteLength, imageLimit, normalize, normalizeIngredient, imageName, imageNames, visibleRecipes
}
