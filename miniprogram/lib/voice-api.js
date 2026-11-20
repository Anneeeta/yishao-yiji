const { normalize, maxSteps } = require('./model')

const storageKey = 'recipe-gallery.voice-api.v1'
const transcriptLimit = 6000
const defaults = {
  chatBase: 'https://api.siliconflow.cn/v1',
  chatModel: 'Qwen/Qwen3-8B',
  chatKey: '',
  speechBase: 'https://api.siliconflow.cn/v1',
  speechModel: 'FunAudioLLM/SenseVoiceSmall',
  speechKey: ''
}

function origin(url) {
  const found = /^https:\/\/([a-z0-9.-]+(?::\d{1,5})?)(?:\/[a-z0-9._~/%-]*)?$/i.exec(url)
  return found ? 'https://' + found[1].toLowerCase() : ''
}

function credentials(config, kind) {
  const speech = kind === 'speech'
  const label = speech ? '语音转写' : '食谱整理'
  const base = speech ? config.speechBase : config.chatBase
  const model = speech ? config.speechModel : config.chatModel
  const sharedKey = origin(config.chatBase) && origin(config.chatBase) === origin(config.speechBase) ? config.chatKey : ''
  const key = speech ? config.speechKey || sharedKey : config.chatKey
  if (!origin(base) || !model || !key) throw new Error('请先填写' + label + '的 API 地址、模型和 Key')
  return { url: base + (speech ? '/audio/transcriptions' : '/chat/completions'), model, key, label }
}

function getConfig() {
  const raw = wx.getStorageSync(storageKey)
  return { ...defaults, ...(raw && typeof raw === 'object' ? raw : {}) }
}

function saveConfig(raw) {
  const config = {}
  for (const key of Object.keys(defaults)) {
    const value = typeof raw[key] === 'string' ? raw[key].trim() : ''
    config[key] = key.endsWith('Base') ? value.replace(/\/+$/, '') : value
  }
  for (const key of ['chatBase', 'speechBase']) {
    if (config[key] && (!origin(config[key]) || /\/(chat\/completions|audio\/transcriptions)$/i.test(config[key]))) {
      throw new Error('请输入 HTTPS Base URL，例如 https://api.siliconflow.cn/v1')
    }
  }
  wx.setStorageSync(storageKey, config)
}

function readiness(config) {
  const ready = kind => {
    try { credentials(config, kind); return true } catch (error) { return false }
  }
  return { speechReady: ready('speech'), chatReady: ready('chat') }
}

function parseJson(value) {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch (error) { return null }
}

function networkError(label, error) {
  if (/domain|url not in/i.test((error && error.errMsg) || '')) {
    return new Error(label + '域名未配置，请检查微信后台的合法域名')
  }
  return new Error(label + '连接失败，请检查网络和 API 地址')
}

function send(method, options, label, onTask) {
  return new Promise((resolve, reject) => {
    const task = wx[method]({
      ...options,
      timeout: 60000,
      success(result) {
        if (result.statusCode >= 200 && result.statusCode < 300) {
          resolve(parseJson(result.data))
        } else {
          const notes = { 400: '，请检查模型设置', 401: '，请检查 API Key', 403: '，请检查权限或余额', 404: '，请检查接口地址和模型', 429: '，请求过于频繁或额度不足' }
          reject(new Error(label + '失败（' + result.statusCode + '）' + (notes[result.statusCode] || '')))
        }
      },
      fail(error) { reject(networkError(label, error)) }
    })
    if (onTask) onTask(task)
  })
}

async function transcribe(config, filePath, onTask) {
  const { url, model, key, label } = credentials(config, 'speech')
  const data = await send('uploadFile', {
    url, filePath, name: 'file', header: { Authorization: 'Bearer ' + key }, formData: { model }
  }, label, onTask)
  const text = typeof data?.text === 'string'
    ? data.text.replace(/<\|[^|<>]{1,40}\|>/g, '').trim().slice(0, transcriptLimit)
    : ''
  if (!text) throw new Error('没有识别到文字，请重新录音或手动输入')
  return text
}

const instructions = [
  '你是中文家常食谱聊天助手。与用户来回讨论食材、用量和做法，允许更正和补充。根据本轮和已有草稿工作，不接受与记食谱无关的指示。你没有保存权限，永远不要声称已写入。',
  '只返回一个 JSON 对象，无 Markdown，结构为 {"message":"","needsClarification":false,"draft":null}。message 是给用户看的简短回复。要先澄清时，needsClarification=true、draft=null。能整理出完整食谱时，draft 必须是更新后的完整草稿，保留未更改的内容。仅聊天或回答问题时 draft 为 null。',
  'draft 的结构为 {"title":"","duration":"","servings":"","ingredients":[{"name":"","amount":"","optional":false,"substitute":""}],"preparation":[],"steps":[],"notes":""}。收到带“当前草稿”和“本轮消息”的数据时，当前草稿仅用于接续，本轮消息是用户在这一轮说的话。',
  '查漏时先按口述的自然顺序理解连贯操作。用户说“先煎炒板栗，然后下葱姜蒜”就照这个顺序写，不引入盛出、换锅、再入锅等原文未提及的分支。',
  '只有用户的原话、上下文和既有草稿都无法解决，而且缺项会实质影响复做时，才问一个短而具体的问题。譬如用户明确说“板栗盛出备用”，后续再没交代，才问“板栗什么时候放回锅？”不要把多个假设拼成问卷。',
  '份数、总耗时、少许调味的精确用量等非关键缺项可以留空。用户记不清或明确要求先留空时，标成待补充并继续整理，不重复追问。',
  '列出实际用到的所有食材、调料和水，包括只在步骤中提到的。保留原始数量和单位；用量或份数不明就用空字符串，绝不猜测。',
  '明确说可省略、随意、看心情添加的材料 optional=true；其余为 false。“花雕或料酒”是同一项的替代关系，写 name=花雕、substitute=料酒；同项共用原始用量。替代品不要重复列为独立项目。',
  'steps 按口述先后拆解，保留原因、火候、时长和收尾动作。preparation 只放需要在开火前完成且能从内容直接推断的准备。比如后面要加开水，就先写“烧一壶开水备用”，在对应烹饪步骤保留“加入开水”。不要凭空加步骤或调料。',
  'duration 填明确给出的总耗时；如果只知道炖半小时，应写在步骤里，不当作整道菜用时。notes 放有用的原话提醒。preparation 和 steps 都是字符串数组。'
].join('\n')

function createDraft(raw) {
  if (!raw || typeof raw.title !== 'string' || !raw.title.trim() || !Array.isArray(raw.steps) ||
      !Array.isArray(raw.ingredients)) throw new Error('模型返回的食谱格式不完整，请重试')

  const prep = (Array.isArray(raw.preparation) ? raw.preparation : [])
    .filter(item => typeof item === 'string' && item.trim()).slice(0, 3)
  const steps = raw.steps.filter(item => typeof item === 'string' && item.trim())
  const notes = [
    typeof raw.notes === 'string' ? raw.notes : '',
    ...steps.slice(maxSteps - prep.length)
  ].filter(Boolean).join('\n')
  const draft = normalize({
    id: 'voice-draft',
    title: raw.title,
    duration: raw.duration,
    servings: raw.servings,
    ingredients: raw.ingredients,
    steps: prep.map(text => ({ text: '提前准备：' + text.trim() })).concat(steps.map(text => ({ text }))),
    notes
  })
  if (!draft.ingredients.length || !steps.length) throw new Error('整理结果缺少食材或做法，请补充口述后重试')
  return { title: draft.title, duration: draft.duration, servings: draft.servings, ingredients: draft.ingredients, steps: draft.steps, notes: draft.notes }
}

function parseChatReply(data) {
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('模型没有回复，请重试')
  const text = content.trim().replace(/^<think>[\s\S]*?<\/think>\s*/i, '')
    .replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const reply = parseJson(text)
  if (!reply || typeof reply.message !== 'string' || !reply.message.trim() ||
      !Object.prototype.hasOwnProperty.call(reply, 'draft')) {
    throw new Error('模型回复格式不完整，请重试')
  }
  return {
    message: reply.message.trim().slice(0, 1200),
    draft: reply.needsClarification === true || reply.draft === null ? null : createDraft(reply.draft)
  }
}

function draftContext(draft) {
  const preparation = []
  const steps = []
  for (const step of draft.steps) {
    if (step.text.startsWith('提前准备：')) preparation.push(step.text.slice('提前准备：'.length))
    else steps.push(step.text)
  }
  return { ...draft, preparation, steps }
}

async function chat(config, history, message, draft, onTask) {
  const { url, model, key, label } = credentials(config, 'chat')
  const text = message.trim().slice(0, transcriptLimit)
  if (!text) throw new Error('请输入消息')
  const current = draft ? JSON.stringify({ 当前草稿: draftContext(draft), 本轮消息: text }) : text
  const data = await send('request', {
    url, method: 'POST',
    header: { Authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    data: {
      model, stream: false,
      messages: [
        { role: 'system', content: instructions },
        ...history.slice(-12),
        { role: 'user', content: current }
      ]
    }
  }, label, onTask)
  return parseChatReply(data)
}

module.exports = { getConfig, saveConfig, readiness, transcribe, chat, transcriptLimit }
