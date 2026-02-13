import { ErrorCode, MAX_PROMPT_SIZE } from "@localllm/protocol";

export const SWARM_WORKLET_SOURCE = `
const { IPC } = BareKit

const MAX_PROMPT_SIZE = ${MAX_PROMPT_SIZE}
const MAX_INBOUND_BUFFER_BYTES = 64 * 1024
const SERVER_INFO_TIMEOUT_MS = 15000
const REQUEST_TIMEOUT_MS = 30000

let swarm = null
let discovery = null
let socket = null
let HyperswarmFactory = null
let SafeHyperswarmFactory = null
let inboundBuffer = ''
let activeRequestId = null
let closing = false
let serverInfoTimeoutId = null
let requestTimeoutId = null
let serverInfoReceived = false
let unhandledHooksInstalled = false
let bareHooksInstalled = false

function emit(event) {
  try {
    IPC.write(Buffer.from(JSON.stringify(event)))
  } catch {}
}

function toErrorMessage(value) {
  if (value && typeof value === 'object' && typeof value.message === 'string') {
    return value.message
  }

  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value)
  } catch {
    return 'Unknown error'
  }
}

function handleThenable(result, onReject) {
  if (!result || typeof result.then !== 'function') {
    return false
  }

  result.catch((error) => {
    try {
      onReject(error)
    } catch {}
  })

  return true
}

function guarded(fn, code, fallbackMessage) {
  return (...args) => {
    try {
      const result = fn(...args)
      if (result && typeof result.then === 'function') {
        result.catch((error) => {
          emitError(code, fallbackMessage + ': ' + toErrorMessage(error), activeRequestId || undefined)
        })
      }
    } catch (error) {
      emitError(code, fallbackMessage + ': ' + toErrorMessage(error), activeRequestId || undefined)
    }
  }
}

function resolveUnhandledReason(eventOrReason) {
  if (eventOrReason !== null && typeof eventOrReason === 'object' && 'reason' in eventOrReason) {
    return eventOrReason.reason
  }

  return eventOrReason
}

function reportUnhandledRejection(eventOrReason) {
  try {
    emitError(
      '${ErrorCode.CONNECT_FAILED}',
      'Worklet unhandled rejection: ' + toErrorMessage(resolveUnhandledReason(eventOrReason)),
      activeRequestId || undefined
    )
  } catch {}
}

function reportUncaughtException(error) {
  try {
    emitError(
      '${ErrorCode.CONNECT_FAILED}',
      'Worklet uncaught exception: ' + toErrorMessage(error),
      activeRequestId || undefined
    )
  } catch {}
}

function getBareRuntime() {
  if (typeof globalThis !== 'undefined' && globalThis && globalThis.Bare) {
    return globalThis.Bare
  }

  if (typeof Bare !== 'undefined') {
    return Bare
  }

  return null
}

function installUnhandledHooks() {
  if (unhandledHooksInstalled) {
    return
  }

  unhandledHooksInstalled = true

  const bareRuntime = getBareRuntime()
  if (
    !bareHooksInstalled &&
    bareRuntime &&
    typeof bareRuntime.on === 'function'
  ) {
    bareHooksInstalled = true
    bareRuntime.on('unhandledRejection', (reason) => {
      reportUnhandledRejection(reason)
    })
    bareRuntime.on('uncaughtException', (error) => {
      reportUncaughtException(error)
    })
  }

  if (typeof globalThis !== 'undefined') {
    const handleUnhandledRejection = (event) => {
      try {
        if (event && typeof event === 'object' && typeof event.preventDefault === 'function') {
          event.preventDefault()
        }
      } catch {}

      reportUnhandledRejection(event)
    }

    if (typeof globalThis.addEventListener === 'function') {
      try {
        globalThis.addEventListener('unhandledrejection', handleUnhandledRejection)
      } catch {}
    }

    globalThis.onunhandledrejection = handleUnhandledRejection

    globalThis.onerror = (message) => {
      try {
        emitError(
          '${ErrorCode.CONNECT_FAILED}',
          'Worklet runtime error: ' + toErrorMessage(message),
          activeRequestId || undefined
        )
      } catch {}
      return true
    }
  }

  if (typeof process !== 'undefined' && process && typeof process.on === 'function') {
    process.on('unhandledRejection', (reason) => {
      reportUnhandledRejection(reason)
    })

    process.on('uncaughtException', (error) => {
      reportUncaughtException(error)
    })
  }
}

function emitError(code, message, requestId) {
  const payload = {
    type: 'onError',
    code,
    message
  }

  if (requestId) {
    payload.requestId = requestId
  }

  emit(payload)
}

function emitRawMessage(direction, text) {
  emit({
    type: 'onRawMessage',
    direction,
    text
  })
}

function suppressRejection(result) {
  handleThenable(result, () => {})
}

function destroySocket(targetSocket) {
  if (!targetSocket) {
    return
  }

  try {
    suppressRejection(targetSocket.destroy())
  } catch {}
}

function attachDiscoveryErrorHandler(value) {
  const target = value && value.discovery ? value.discovery : value
  if (!target || typeof target !== 'object') {
    return
  }

  try {
    target._onerror = (error) => {
      emitError('${ErrorCode.CONNECT_FAILED}', 'Discovery error: ' + toErrorMessage(error))
    }
  } catch {}
}

function getSafeHyperswarmFactory(factory) {
  if (SafeHyperswarmFactory) {
    return SafeHyperswarmFactory
  }

  SafeHyperswarmFactory = class SafeHyperswarm extends factory {
    async _handleNetworkUpdate(...args) {
      try {
        return await super._handleNetworkUpdate(...args)
      } catch (error) {
        emitError('${ErrorCode.CONNECT_FAILED}', 'Swarm network update failed: ' + toErrorMessage(error))
        return false
      }
    }

    async _handleNetworkChange(...args) {
      try {
        return await super._handleNetworkChange(...args)
      } catch (error) {
        emitError('${ErrorCode.CONNECT_FAILED}', 'Swarm network change failed: ' + toErrorMessage(error))
        return false
      }
    }

    join(topic, opts = {}) {
      const session = super.join(topic, opts)
      attachDiscoveryErrorHandler(session)
      return session
    }
  }

  return SafeHyperswarmFactory
}

function writeSocketMessage(targetSocket, message, requestId, failureMessage) {
  try {
    const writeResult = targetSocket.write(message)
    handleThenable(writeResult, (error) => {
      if (requestId && activeRequestId === requestId) {
        activeRequestId = null
        clearRequestTimeout()
      }

      emitError(
        '${ErrorCode.HOST_DISCONNECTED}',
        failureMessage + ': ' + toErrorMessage(error),
        requestId
      )
    })
    return true
  } catch (error) {
    emitError(
      '${ErrorCode.HOST_DISCONNECTED}',
      failureMessage + ': ' + toErrorMessage(error),
      requestId
    )
    return false
  }
}

function clearServerInfoTimeout() {
  if (serverInfoTimeoutId) {
    clearTimeout(serverInfoTimeoutId)
    serverInfoTimeoutId = null
  }
}

function clearRequestTimeout() {
  if (requestTimeoutId) {
    clearTimeout(requestTimeoutId)
    requestTimeoutId = null
  }
}

function resetRequestTimeout() {
  if (!activeRequestId) {
    clearRequestTimeout()
    return
  }

  const timedRequestId = activeRequestId
  clearRequestTimeout()
  requestTimeoutId = setTimeout(() => {
    if (activeRequestId !== timedRequestId) {
      return
    }

    activeRequestId = null
    clearRequestTimeout()
    emitError('${ErrorCode.TIMEOUT_NO_RESPONSE}', 'No response chunk received within 30 seconds', timedRequestId)
  }, REQUEST_TIMEOUT_MS)
}

function emitProtocolError(message) {
  emitError('${ErrorCode.BAD_MESSAGE}', message, activeRequestId || undefined)
}

function startServerInfoTimeout(targetSocket) {
  clearServerInfoTimeout()
  serverInfoTimeoutId = setTimeout(guarded(() => {
    if (socket !== targetSocket || serverInfoReceived) {
      return
    }

    emitError('${ErrorCode.TIMEOUT_NO_RESPONSE}', 'No server_info received within 15 seconds')
    closeResources()
    emit({
      type: 'onDisconnect',
      code: '${ErrorCode.TIMEOUT_NO_RESPONSE}',
      message: 'Connection timed out'
    })
  }, '${ErrorCode.CONNECT_FAILED}', 'Failed while waiting for server info'), SERVER_INFO_TIMEOUT_MS)
}

function closeResources() {
  if (closing) {
    return
  }

  closing = true
  clearServerInfoTimeout()
  clearRequestTimeout()
  serverInfoReceived = false

  const previousSocket = socket
  socket = null
  inboundBuffer = ''
  activeRequestId = null

  if (previousSocket) {
    try {
      previousSocket.removeAllListeners()
    } catch {}

    destroySocket(previousSocket)
  }

  if (discovery) {
    try {
      suppressRejection(discovery.destroy())
    } catch {}
    discovery = null
  }

  if (swarm) {
    try {
      suppressRejection(swarm.destroy())
    } catch {}
    swarm = null
  }

  closing = false
}

function nextRequestId() {
  return 'req-' + Date.now() + '-' + Math.floor(Math.random() * 100000)
}

function handleProtocolLine(line) {
  emitRawMessage('in', line)

  let message
  try {
    message = JSON.parse(line)
  } catch {
    emitProtocolError('Malformed protocol payload')
    return
  }

  if (!message || typeof message.type !== 'string') {
    emitProtocolError('Protocol message missing type')
    return
  }

  if (message.type === 'server_info') {
    const payload = message.payload
    if (
      payload &&
      typeof payload.host_name === 'string' &&
      typeof payload.model === 'string' &&
      (payload.status === 'ready' || payload.status === 'busy')
    ) {
      serverInfoReceived = true
      clearServerInfoTimeout()
      emit({
        type: 'onServerInfo',
        hostName: payload.host_name,
        model: payload.model,
        status: payload.status
      })
      return
    }

    emitProtocolError('Invalid server_info payload')
    return
  }

  if (message.type === 'chat_chunk') {
    const requestId = message.request_id
    const payload = message.payload

    if (typeof requestId === 'string' && payload && typeof payload.text === 'string') {
      if (activeRequestId === requestId) {
        resetRequestTimeout()
      }

      emit({
        type: 'onChunk',
        requestId,
        text: payload.text
      })
      return
    }

    emitProtocolError('Invalid chat_chunk payload')
    return
  }

  if (message.type === 'chat_end') {
    const requestId = message.request_id
    const payload = message.payload

    if (
      typeof requestId === 'string' &&
      payload &&
      (payload.finish_reason === 'stop' || payload.finish_reason === 'abort' || payload.finish_reason === 'error')
    ) {
      if (activeRequestId === requestId) {
        activeRequestId = null
        clearRequestTimeout()
      }

      emit({
        type: 'onChatEnd',
        requestId,
        finishReason: payload.finish_reason
      })
      return
    }

    emitProtocolError('Invalid chat_end payload')
    return
  }

  if (message.type === 'error') {
    const payload = message.payload

    if (payload && typeof payload.code === 'string' && typeof payload.message === 'string') {
      const requestId = typeof message.request_id === 'string' ? message.request_id : undefined
      if (requestId && activeRequestId === requestId) {
        activeRequestId = null
        clearRequestTimeout()
      }

      emitError(payload.code, payload.message, requestId)
      return
    }

    emitProtocolError('Invalid error payload')
    return
  }

  emitProtocolError('Unsupported protocol message type')
}

function disconnectForBadInboundBuffer() {
  emitError('${ErrorCode.BAD_MESSAGE}', 'Inbound protocol buffer exceeded 64 KB', activeRequestId || undefined)
  closeResources()
  emit({
    type: 'onDisconnect',
    code: '${ErrorCode.BAD_MESSAGE}',
    message: 'Disconnected due to malformed protocol stream'
  })
}

function onSocketData(chunk) {
  inboundBuffer += chunk.toString()

  if (Buffer.byteLength(inboundBuffer, 'utf8') > MAX_INBOUND_BUFFER_BYTES) {
    disconnectForBadInboundBuffer()
    return
  }

  while (true) {
    const newlineIndex = inboundBuffer.indexOf('\n')
    if (newlineIndex === -1) {
      return
    }

    const line = inboundBuffer.slice(0, newlineIndex).trim()
    inboundBuffer = inboundBuffer.slice(newlineIndex + 1)

    if (!line) {
      continue
    }

    handleProtocolLine(line)
  }
}

function attachSocket(nextSocket) {
  if (socket) {
    destroySocket(nextSocket)
    return
  }

  socket = nextSocket
  serverInfoReceived = false
  startServerInfoTimeout(nextSocket)

  nextSocket.on('data', guarded(onSocketData, '${ErrorCode.BAD_MESSAGE}', 'Failed handling socket data'))

  nextSocket.on('close', guarded(() => {
    if (closing || socket !== nextSocket) {
      return
    }

    closeResources()
    emit({
      type: 'onDisconnect',
      code: '${ErrorCode.HOST_DISCONNECTED}',
      message: 'Host disconnected'
    })
  }, '${ErrorCode.HOST_DISCONNECTED}', 'Socket close handler failed'))

  nextSocket.on('error', guarded(() => {
    if (closing || socket !== nextSocket) {
      return
    }

    closeResources()
    emit({
      type: 'onDisconnect',
      code: '${ErrorCode.HOST_DISCONNECTED}',
      message: 'Connection error'
    })
  }, '${ErrorCode.HOST_DISCONNECTED}', 'Socket error handler failed'))
}

function handleConnect(topicBytes) {
  closeResources()

  if (!Array.isArray(topicBytes)) {
    emitError('${ErrorCode.INVALID_SERVER_ID}', 'Topic must be an array of bytes')
    return
  }

  const validLength = topicBytes.length === 32
  const validByteValues = topicBytes.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)
  if (!validLength || !validByteValues) {
    emitError('${ErrorCode.INVALID_SERVER_ID}', 'Topic must contain exactly 32 bytes')
    return
  }

  const topic = Buffer.from(topicBytes)

  try {
    if (!HyperswarmFactory) {
      HyperswarmFactory = require('hyperswarm')
    }
  } catch (error) {
    emitError('${ErrorCode.CONNECT_FAILED}', 'Failed to load Hyperswarm: ' + toErrorMessage(error))
    return
  }

  try {
    const HyperswarmCtor = getSafeHyperswarmFactory(HyperswarmFactory)
    swarm = new HyperswarmCtor()

    swarm.on('connection', guarded((nextSocket) => {
      attachSocket(nextSocket)
    }, '${ErrorCode.CONNECT_FAILED}', 'Failed to attach socket'))

    swarm.on('error', guarded((error) => {
      emitError('${ErrorCode.CONNECT_FAILED}', 'Failed to start Hyperswarm client: ' + toErrorMessage(error))
    }, '${ErrorCode.CONNECT_FAILED}', 'Swarm error handler failed'))

    discovery = swarm.join(topic, { server: false, client: true })
    attachDiscoveryErrorHandler(discovery)
    suppressRejection(
      discovery.flushed().catch(() => {
        closeResources()
        emitError('${ErrorCode.CONNECT_FAILED}', 'Failed to join host topic')
      })
    )
  } catch (error) {
    closeResources()
    emitError('${ErrorCode.CONNECT_FAILED}', 'Failed to join host topic: ' + toErrorMessage(error))
  }
}

function handleSendPrompt(prompt) {
  if (typeof prompt !== 'string') {
    emitError('${ErrorCode.BAD_MESSAGE}', 'Prompt must be a string')
    return
  }

  const normalized = prompt.trim()
  if (!normalized) {
    emitError('${ErrorCode.BAD_MESSAGE}', 'Prompt cannot be empty')
    return
  }

  const promptByteLength = new TextEncoder().encode(normalized).byteLength
  if (promptByteLength > MAX_PROMPT_SIZE) {
    emitError('${ErrorCode.BAD_MESSAGE}', 'Prompt exceeds max size')
    return
  }

  if (!socket) {
    emitError('${ErrorCode.HOST_OFFLINE}', 'No connected host peer')
    return
  }

  if (activeRequestId) {
    emitError('${ErrorCode.MODEL_BUSY}', 'A request is already active', activeRequestId)
    return
  }

  const requestId = nextRequestId()
  const message = JSON.stringify({
    type: 'chat_start',
    request_id: requestId,
    payload: { prompt: normalized }
  }) + '\n'

  try {
    emitRawMessage('out', message.trim())
    if (!writeSocketMessage(socket, message, requestId, 'Failed to write to host peer')) {
      return
    }
    activeRequestId = requestId
    resetRequestTimeout()
  } catch {}
}

function handleAbort() {
  if (!socket || !activeRequestId) {
    return
  }

  const requestId = activeRequestId
  const message = JSON.stringify({
    type: 'abort',
    request_id: requestId
  }) + '\n'

  try {
    emitRawMessage('out', message.trim())
    if (!writeSocketMessage(socket, message, requestId, 'Failed to send abort')) {
      return
    }
    activeRequestId = null
    clearRequestTimeout()
  } catch {}
}

installUnhandledHooks()

IPC.on('data', guarded((chunk) => {
  let command
  try {
    command = JSON.parse(Buffer.from(chunk).toString())
  } catch {
    emitError('${ErrorCode.BAD_MESSAGE}', 'Bad worklet command')
    return
  }

  if (!command || typeof command.type !== 'string') {
    emitError('${ErrorCode.BAD_MESSAGE}', 'Missing worklet command type')
    return
  }

  if (command.type === 'connect') {
    handleConnect(command.topic)
    return
  }

  if (command.type === 'disconnect') {
    closeResources()
    emit({
      type: 'onDisconnect',
      code: '${ErrorCode.USER_DISCONNECTED}',
      message: 'Disconnected'
    })
    return
  }

  if (command.type === 'sendPrompt') {
    handleSendPrompt(command.prompt)
    return
  }

  if (command.type === 'abort') {
    handleAbort()
    return
  }

  emitError('${ErrorCode.BAD_MESSAGE}', 'Unknown worklet command')
}, '${ErrorCode.BAD_MESSAGE}', 'Worklet command handler failed'))
`;
