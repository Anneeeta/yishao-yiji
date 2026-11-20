const unitAliases = new Map([
  ['g', '克'], ['kg', '千克'], ['公斤', '千克'], ['ml', '毫升'], ['l', '升']
])

function amountLabel(amounts) {
  const parts = []
  const totals = new Map()
  for (const amount of amounts) {
    // Only add plain quantities. Keep ranges and cooks' descriptions as written.
    const match = /^(\d{1,8}(?:\.\d{1,4})?)\s*(克|千克|公斤|毫升|升|g|kg|ml|l|斤|两|个|颗|粒|片|块|根|条|把|枚|瓣|张|只|勺|大勺|小勺|匙|大匙|小匙|茶匙|汤匙|杯|碗|瓶|袋|盒|罐|包|份)$/i.exec(amount)
    if (!match) {
      parts.push({ text: amount || '用量未填' })
      continue
    }
    const unit = unitAliases.get(match[2].toLowerCase()) || match[2]
    let total = totals.get(unit)
    if (!total) {
      total = { unit, scaled: 0 }
      totals.set(unit, total)
      parts.push(total)
    }
    total.scaled += Math.round(Number(match[1]) * 10000)
  }
  return parts.map(part => part.text || (part.scaled / 10000) + ' ' + part.unit).join(' + ')
}

function prepareOrder(order, recipes) {
  const groups = new Map()
  const dishes = order.dishes.map((title, index) => {
    const id = order.recipeIds && order.recipeIds[index]
    const matches = recipes.filter(recipe => id ? recipe.id === id : recipe.title === title)
    if (matches.length !== 1) return { title, issue: matches.length ? '本机有同名食谱' : '本机找不到食谱' }
    const recipe = matches[0]
    for (const row of recipe.ingredients) {
      const optional = Boolean(row.optional)
      const substitute = row.substitute || ''
      const key = JSON.stringify([row.name, optional, substitute])
      if (!groups.has(key)) groups.set(key, { name: row.name, optional, substitute, amounts: [] })
      groups.get(key).amounts.push(row.amount)
    }
    return { title, id: recipe.id, issue: recipe.ingredients.length ? '' : '食谱还没填食材' }
  })
  const shopping = [...groups.values()].map(group => {
    const { name, optional, substitute } = group
    const amount = amountLabel(group.amounts)
    return { name, amount, optional, substitute, key: JSON.stringify([name, optional, substitute, amount]) }
  }).sort((a, b) => Number(a.optional) - Number(b.optional))
  return { dishes, shopping, incomplete: dishes.some(dish => dish.issue) }
}

module.exports = { prepareOrder }
