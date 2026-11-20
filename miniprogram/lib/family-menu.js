const menuKey = 'recipe-gallery.family-menu.v1'
const ordersKey = 'recipe-gallery.family-orders.v1'
const defaultTitle = '家庭菜单'
const maxDishes = 32
const pathLimit = 960
const menuBudget = pathLimit - 100
const menuRoute = '/pages/family-pick/index?menu='
const orderRoute = '/pages/family-order/index?order='

function clip(value, max) {
  return typeof value === 'string' ? Array.from(value.trim()).slice(0, max).join('') : ''
}

function menuTitle(title) {
  return clip(title, 24) || defaultTitle
}

function dishNames(dishes) {
  if (!Array.isArray(dishes)) return []
  return [...new Set(dishes.map(title => clip(title, 44)).filter(Boolean))].slice(0, maxDishes)
}

function encode(value) {
  const bytes = encodeURIComponent(JSON.stringify(value))
    .replace(/%([0-9a-f]{2})/gi, (_, byte) => String.fromCharCode(parseInt(byte, 16)))
  const buffer = Uint8Array.from(bytes, byte => byte.charCodeAt(0)).buffer
  return wx.arrayBufferToBase64(buffer).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decode(value) {
  if (typeof value !== 'string' || value.length > pathLimit || !/^[a-z0-9_-]+$/i.test(value)) return null
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
    const bytes = new Uint8Array(wx.base64ToArrayBuffer(base64))
    const encoded = Array.from(bytes, byte => '%' + byte.toString(16).padStart(2, '0')).join('')
    const parsed = JSON.parse(decodeURIComponent(encoded))
    return Array.isArray(parsed) && parsed[0] === 1 ? parsed : null
  } catch (error) {
    return null
  }
}

function recipeIds(value, count) {
  return Array.isArray(value) && value.length === count &&
    value.every(id => typeof id === 'string' && /^[a-z0-9-]{1,80}$/.test(id)) ? value : []
}

function cardPath(route, fields, ids, budget) {
  if (ids.length) {
    const linked = route + encode([...fields, ids])
    if (linked.length <= budget) return linked
  }
  const path = route + encode(fields)
  return path.length <= budget ? path : ''
}

function makeMenuPath(title, dishes, ids) {
  const names = dishNames(dishes)
  if (!names.length) return ''
  return cardPath(menuRoute, [1, 'menu', menuTitle(title), names], recipeIds(ids, names.length), menuBudget)
}

function readMenuCard(value) {
  const parsed = decode(value)
  if (!parsed || parsed[1] !== 'menu') return null
  const dishes = dishNames(parsed[3])
  return dishes.length ? { title: menuTitle(parsed[2]), dishes, recipeIds: recipeIds(parsed[4], dishes.length) } : null
}

function makeOrder(title, dishes, guest, note, ids) {
  return {
    id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 11),
    title: menuTitle(title), dishes: dishNames(dishes), guest: clip(guest, 16), note: clip(note, 60),
    recipeIds: recipeIds(ids, dishes.length)
  }
}

function makeOrderPath(order) {
  if (!order.dishes.length) return ''
  return cardPath(orderRoute, [1, 'order', order.id, order.title, order.dishes, order.guest, order.note],
    recipeIds(order.recipeIds, order.dishes.length), pathLimit)
}

function readOrderCard(value) {
  const parsed = decode(value)
  if (!parsed || parsed[1] !== 'order' || !/^[a-z0-9-]{4,34}$/.test(parsed[2])) return null
  const dishes = dishNames(parsed[4])
  return dishes.length ? {
    id: parsed[2], title: menuTitle(parsed[3]), dishes, guest: clip(parsed[5], 16), note: clip(parsed[6], 60),
    recipeIds: recipeIds(parsed[7], dishes.length)
  } : null
}

function getMenuDraft() {
  const value = wx.getStorageSync(menuKey)
  if (!value || !Array.isArray(value.ids)) return null
  return { title: menuTitle(value.title), ids: value.ids.filter(id => typeof id === 'string').slice(0, maxDishes) }
}

function saveMenuDraft(title, ids) {
  wx.setStorageSync(menuKey, { title: menuTitle(title), ids: ids.slice(0, maxDishes) })
}

function listOrders() {
  const value = wx.getStorageSync(ordersKey)
  return Array.isArray(value) ? value : []
}

function acceptOrder(order) {
  const saved = listOrders()
  if (saved.some(item => item.id === order.id)) return
  wx.setStorageSync(ordersKey, [{ ...order, receivedAt: Date.now() }, ...saved])
}

function saveShoppingChecks(id, checks) {
  const orders = listOrders()
  const order = orders.find(item => item.id === id)
  if (!order) throw new Error('找不到点菜单')
  order.shoppingChecks = checks
  wx.setStorageSync(ordersKey, orders)
}

function orderSummary(order) {
  return [
    (order.guest ? order.guest + '的点菜单' : '家庭点菜单') + ' · ' + order.title,
    ...order.dishes.map((title, index) => (index + 1) + '. ' + title),
    ...(order.note ? ['备注：' + order.note] : [])
  ].join('\n')
}

function dateLabel(value) {
  const date = new Date(value)
  const pad = number => String(number).padStart(2, '0')
  return (date.getMonth() + 1) + '月' + date.getDate() + '日 ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
}

module.exports = {
  defaultTitle, maxDishes, menuTitle, makeMenuPath, readMenuCard, makeOrder, makeOrderPath, readOrderCard,
  getMenuDraft, saveMenuDraft, listOrders, acceptOrder, saveShoppingChecks, orderSummary, dateLabel
}
