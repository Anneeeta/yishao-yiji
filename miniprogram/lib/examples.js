const rows = [
  ['tomato', '番茄炒蛋', '家常菜', '15 分钟', '鸡蛋|3 个;番茄|2 个;小葱|1 根;盐|少许',
    ['番茄切块，鸡蛋加少许盐打匀。', '锅中热油，蛋液炒至刚凝固就盛出。', '炒软番茄，等汁水出来后倒回鸡蛋，拌匀撒葱。'], '鸡蛋先盛出，再回锅拌几下，口感更嫩。'],
  ['salmon', '味噌煎三文鱼', '家常菜', '25 分钟', '三文鱼|2 块;白味噌|1 大匙;味醂|1 大匙;青菜|适量',
    ['味噌和味醂拌匀，薄薄抹在鱼肉上，冷藏腌 10 分钟。', '擦去表面的厚酱，鱼皮朝下用中小火煎，再翻面煎熟。', '焯好青菜，与三文鱼一起装盘。'], '酱容易焦，薄薄一层就够了。'],
  ['noodles', '葱油拌面', '主食', '20 分钟', '细面|200 克;小葱|1 把;食用油|3 大匙;生抽|2 大匙;糖|1 小匙',
    ['小葱切段，擦干水，用小火炸到微褐。', '关小火倒入生抽和糖，搅至糖化。', '煮好的面沥水，加葱油和炸葱拌匀。'], '起锅前淋一点面汤，酱汁更容易裹匀。'],
  ['soup', '冬瓜排骨汤', '汤羹', '60 分钟', '排骨|400 克;冬瓜|350 克;姜|3 片;盐|适量',
    ['排骨冷水入锅焯水，捞出洗去浮沫。', '放入排骨、姜和清水，小火炖 40 分钟。', '放入去皮切块的冬瓜，再炖至透明，加盐调味。'], '冬瓜晚一点放，煮出来还有形。']
]

const recipes = rows.map(([key, title, category, duration, ingredients, steps, notes], index) => ({
  id: 'sample-' + key,
  title, category, duration, notes,
  cover: key + '.jpg',
  servings: '2 人份',
  ingredients: ingredients.split(';').map(value => {
    const [name, amount] = value.split('|')
    return { name, amount }
  }),
  steps: steps.map(text => ({ text, photo: '' })),
  favorite: false,
  createdAt: 1000 - index,
  updatedAt: 1000 - index
}))

module.exports = recipes
