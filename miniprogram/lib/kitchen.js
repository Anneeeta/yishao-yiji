// Fill in the environment ID when deploying the optional cloud function.
const environment = ''
let initialized = false

async function call(action, data = {}) {
  if (!wx.cloud) throw new Error('请使用支持云开发的微信版本')
  let response
  try {
    if (!initialized) {
      wx.cloud.init(environment ? { env: environment } : {})
      initialized = true
    }
    response = await wx.cloud.callFunction({ name: 'familyKitchen', data: { ...data, action } })
  } catch (error) {
    throw new Error('无法连接家庭厨房，请检查网络、云环境和 familyKitchen 部署')
  }
  if (!response.result || response.result.error) throw new Error(response.result && response.result.error || '厨房响应异常')
  return response.result.value
}

module.exports = { call }
