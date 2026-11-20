const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

// In-memory doubles for the SDK methods used by familyKitchen. Each invocation
// receives its own WeChat identity and shares the same two collections.
function setup() {
  const tables = new Map()
  const command = { gt: value => ({ gt: value }), addToSet: value => ({ add: value }), remove: () => ({ remove: true }) }
  function collection(name) {
    if (!tables.has(name)) tables.set(name, new Map())
    const rows = tables.get(name)
    function update(row, changes) {
      for (const [key, value] of Object.entries(changes)) {
        if (value && value.remove) delete row[key]
        else if (value && value.add) row[key] = [...new Set([...row[key], value.add])]
        else row[key] = structuredClone(value)
      }
    }
    return {
      async add({ data }) {
        if (rows.has(data._id)) throw new Error('duplicate')
        rows.set(data._id, structuredClone(data))
      },
      doc(id) { return { update: async ({ data }) => update(rows.get(id), data) } },
      where(filter) {
        const matches = () => [...rows.values()].filter(row => Object.entries(filter).every(([k, v]) =>
          v && v.gt ? row[k] > v.gt : Array.isArray(row[k]) ? row[k].includes(v) : row[k] === v))
        let start = 0, max = 100
        return {
          limit(n) { max = n; return this },
          skip(n) { start = n; return this },
          orderBy() { return this },
          async get() { return { data: structuredClone(matches().slice(start, start + max)) } },
          async update({ data }) {
            const found = matches()
            found.forEach(row => update(row, data))
            return { stats: { updated: found.length } }
          }
        }
      }
    }
  }
  const source = readFileSync(path.join(__dirname, '../cloudfunctions/familyKitchen/index.js'), 'utf8')
  return (user, action, data = {}) => {
    const sdk = { init() {}, database: () => ({ collection, command }), getWXContext: () => ({ OPENID: user, APPID: 'demo' }) }
    const context = { exports: {}, require: name => name === 'wx-server-sdk' ? sdk : require(name) }
    vm.runInNewContext(source, context)
    return context.exports.main({ action, ...data }).then(result => JSON.parse(JSON.stringify(result)))
  }
}

test('邀请只用一次，绑定后可复访，点单归属由服务端决定', async () => {
  const call = setup()
  const dishes = [{ id: 'chicken', title: '板栗烧鸡' }, { id: 'egg', title: '炒蛋' }]
  const { value: { id: kitchen } } = await call('host', 'publish', { title: '我家的菜', dishes })
  const guestMenu = () => call('guest', 'menu', { kitchen })
  assert.ok((await guestMenu()).error)
  const first = (await call('host', 'invite')).value
  const second = (await call('host', 'invite')).value
  assert.ok((await call('guest', 'join', { kitchen, token: first.token })).error)
  assert.ok((await call('guest', 'join', { kitchen, token: second.token })).value)
  assert.ok((await call('stranger', 'join', { kitchen, token: second.token })).error)
  assert.equal((await call('guest', 'list')).value.joined[0].id, kitchen)
  assert.deepEqual((await guestMenu()).value.dishes, dishes)

  const payload = { kitchen, ids: ['chicken', 'egg'], requestId: 'test-retry', guest: '妈妈', note: '少油' }
  assert.ok((await call('stranger', 'submit', { ...payload, OPENID: 'guest' })).error)
  const results = await Promise.all([call('guest', 'submit', payload), call('guest', 'submit', payload)])
  assert.ok(results[0].value.id)
  assert.equal(results[0].value.id, results[1].value.id)
  assert.equal((await call('stranger', 'orders', { kitchen })).value.orders.length, 0)
  const inbox = (await call('host', 'orders')).value.orders
  assert.equal(inbox.length, 1)
  assert.deepEqual(inbox[0].recipeIds, payload.ids)
  assert.equal(inbox[0].note, '少油')
  await call('host', 'publish', { title: '周末', dishes: [dishes[1]] })
  assert.equal((await guestMenu()).value.dishes.length, 1)
  assert.ok((await call('guest', 'submit', { ...payload, requestId: 'new-order' })).error)
  assert.equal((await call('guest', 'submit', payload)).value.id, results[0].value.id)
})
