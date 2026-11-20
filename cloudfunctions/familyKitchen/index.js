const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const kitchens = db.collection('family_kitchens')
const orders = db.collection('family_orders')

class InputError extends Error {}
function requireThat(test, message) { if (!test) throw new InputError(message) }
function hash(text) { return crypto.createHash('sha256').update(text).digest('hex').slice(0, 32) }
function field(value, length) { return typeof value === 'string' ? value.trim().slice(0, length) : '' }
async function find(collection, id) {
  return (await collection.where({ _id: id }).limit(1).get()).data[0]
}
function menuView(kitchen) {
  return { id: kitchen._id, title: kitchen.title, dishes: kitchen.dishes }
}

async function publish(owner, event) {
  const title = field(event.title, 24)
  requireThat(title && Array.isArray(event.dishes) && event.dishes.length <= 32, '请填写厨房名称，最多选 32 道菜')
  const dishes = event.dishes.map(row => {
    requireThat(row && /^[a-z0-9-]{1,80}$/.test(row.id) && field(row.title, 44), '菜品信息不完整')
    return { id: row.id, title: field(row.title, 44) }
  })
  requireThat(new Set(dishes.map(row => row.id)).size === dishes.length, '菜单中有重复的菜')
  const data = { title, dishes }
  const existing = await find(kitchens, owner)
  if (existing) await kitchens.doc(owner).update({ data })
  else {
    try { await kitchens.add({ data: { _id: owner, ...data, members: [] } }) }
    catch (error) {
      if (!await find(kitchens, owner)) throw error
      await kitchens.doc(owner).update({ data })
    }
  }
  return { id: owner }
}

async function handle(actor, event) {
  switch (event.action) {
    case 'list': {
      const joined = await kitchens.where({ members: actor }).limit(100).get()
      const own = await find(kitchens, actor)
      return { own: own ? menuView(own) : null, joined: joined.data.map(k => ({ id: k._id, title: k.title })) }
    }
    case 'publish': return publish(actor, event)
    case 'invite': {
      requireThat(await find(kitchens, actor), '请先发布可点的菜')
      const token = crypto.randomBytes(24).toString('hex')
      await kitchens.doc(actor).update({ data: { inviteHash: hash(token), inviteUntil: Date.now() + 86400000 } })
      return { id: actor, token }
    }
    case 'join':
    case 'menu':
    case 'submit': break
    case 'orders': {
      const offset = event.offset || 0
      requireThat(Number.isSafeInteger(offset) && offset >= 0, '无效页码')
      const batch = await orders.where({ kitchen: actor }).orderBy('receivedAt', 'desc').skip(offset).limit(40).get()
      return { orders: batch.data.map(({ _id, kitchen, ...item }) => ({ id: 'cloud-' + _id, ...item })) }
    }
    default: throw new InputError('未知操作')
  }
  requireThat(typeof event.kitchen === 'string' && /^[a-f0-9]{32}$/.test(event.kitchen), '厨房链接无效')
  const kitchen = await find(kitchens, event.kitchen)
  requireThat(kitchen, '厨房已不可用')
  if (event.action === 'join') {
    requireThat(actor !== kitchen._id, '这是你自己的厨房')
    if (!kitchen.members.includes(actor)) {
      requireThat(typeof event.token === 'string' && /^[a-f0-9]{48}$/.test(event.token), '邀请无效')
      const result = await kitchens.where({ _id: kitchen._id, inviteHash: hash(event.token),
        inviteUntil: db.command.gt(Date.now()) }).update({ data: {
        members: db.command.addToSet(actor), inviteHash: db.command.remove(), inviteUntil: db.command.remove()
      } })
      if (!result.stats.updated) {
        const latest = await find(kitchens, kitchen._id)
        requireThat(latest && latest.members.includes(actor), '邀请已失效，请让家人再发一张')
      }
    }
    return { id: kitchen._id }
  }
  requireThat(kitchen.members.includes(actor), '请先接受厨房主人的邀请')
  if (event.action === 'menu') return menuView(kitchen)
  requireThat(typeof event.requestId === 'string' && /^[a-z0-9-]{8,80}$/.test(event.requestId), '请重新提交')
  const id = hash([actor, kitchen._id, event.requestId].join('/'))
  if (await find(orders, id)) return { id }
  requireThat(Array.isArray(event.ids) && event.ids.length > 0 && event.ids.length <= 32, '请至少选一道菜')
  const selected = kitchen.dishes.filter(dish => event.ids.includes(dish.id))
  requireThat(selected.length === event.ids.length, '菜单有更新，请刷新后重新选菜')
  const data = { _id: id, kitchen: kitchen._id, receivedAt: Date.now(), title: kitchen.title,
    recipeIds: selected.map(d => d.id), dishes: selected.map(d => d.title),
    guest: field(event.guest, 16), note: field(event.note, 60) }
  try { await orders.add({ data }) }
  catch (error) { if (!await find(orders, id)) throw error }
  return { id }
}

exports.main = async (event) => {
  const { OPENID, APPID } = cloud.getWXContext()
  if (!OPENID || !APPID) return { error: '请从微信小程序打开厨房' }
  try { return { value: await handle(hash(APPID + '/' + OPENID), event || {}) } }
  catch (error) {
    if (error instanceof InputError) return { error: error.message }
    throw error
  }
}
