let manager
let session
const maxDuration = 120000

function finish(method, value) {
  const current = session
  session = null
  if (!current) return
  clearTimeout(current.timer)
  current[method](value)
}

function setup() {
  if (manager) return
  manager = wx.getRecorderManager()
  manager.onStart(() => {
    if (!session) {
      manager.stop()
      return
    }
    clearTimeout(session.timer)
    if (session.cancelled) {
      manager.stop()
      return
    }
    session.onStart()
    session.timer = setTimeout(() => finish('reject', new Error('录音超时，请重试')), maxDuration + 8000)
  })
  manager.onStop(result => {
    if (session?.cancelled) finish('reject', new Error('录音已取消'))
    else if (result.tempFilePath && result.duration > 500) finish('resolve', result)
    else finish('reject', new Error('录音太短，请再说一次'))
  })
  manager.onError(() => finish('reject', new Error('无法录音，请检查微信的麦克风权限，或改用文字输入')))
}

function start(onStart) {
  return new Promise((resolve, reject) => {
    if (session) {
      reject(new Error('录音正在结束，请稍后重试'))
      return
    }
    setup()
    session = { resolve, reject, onStart }
    session.timer = setTimeout(() => finish('reject', new Error('未能启动录音，请在手机微信中重试')), 18000)
    try {
      manager.start({ duration: maxDuration, sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 48000, format: 'mp3' })
    } catch (error) {
      finish('reject', new Error('无法启动录音，请在手机微信中重试'))
    }
  })
}

function stop() {
  if (session) manager.stop()
}

function cancel() {
  if (!session) return
  session.cancelled = true
  stop()
}

module.exports = { start, stop, cancel }
