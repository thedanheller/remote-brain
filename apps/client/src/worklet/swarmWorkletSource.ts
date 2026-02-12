export const SWARM_WORKLET_SOURCE = `
const { IPC } = BareKit
const Hyperswarm = require('hyperswarm')
const bs58 = require('bs58')

const MAX_PROMPT_SIZE = 8192
const SERVER_INFO_TIMEOUT_MS = 15000

let swarm = null
let discovery = null
let socket = null
let inboundBuffer = ''
let activeRequestId = null
let closing = false
let serverInfoTimeoutId = null
let serverInfoReceived = false

function emit(event) {
  IPC.write(Buffer.from(JSON.stringify(event)))
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

function clearServerInfoTimeout() {
  if (serverInfoTimeoutId) {
    clearTimeout(serverInfoTimeoutId)
    serverInfoTimeoutId = null
  }
}

function startServerInfoTimeout(targetSocket) {
  clearServerInfoTimeout()
  serverInfoTimeoutId = setTimeout(async () => {
    if (socket !== targetSocket || serverInfoReceived) {
      return
    }

    emitError('TIMEOUT_NO_RESPONSE', 'No server_info received within 15 seconds')
    await closeResources()
    emit({
      type: 'onDisconnect',
      code: 'TIMEOUT_NO_RESPONSE',
      message: 'Connection timed out'
    })
  }, SERVER_INFO_TIMEOUT_MS)
}

async function closeResources() {
  if (closing) {
    return
  }

  closing = true
  clearServerInfoTimeout()
  serverInfoReceived = false

  const previousSocket = socket
  socket = null
  inboundBuffer = ''
  activeRequestId = null

  if (previousSocket) {
    try {
      previousSocket.removeAllListeners()
    } catch {}

    try {
      previousSocket.destroy()
    } catch {}
  }

  if (discovery) {
    try {
      await discovery.destroy()
    } catch {}
    discovery = null
  }

  if (swarm) {
    try {
      await swarm.destroy()
    } catch {}
    swarm = null
  }

  closing = false
}

function nextRequestId() {
  return 'req-' + Date.now() + '-' + Math.floor(Math.random() * 100000)
}

function handleProtocolLine(line) {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    emitError('BAD_MESSAGE', 'Malformed protocol payload')
    return
  }

  if (!message || typeof message.type !== 'string') {
    emitError('BAD_MESSAGE', 'Protocol message missing type')
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

    emitError('BAD_MESSAGE', 'Invalid server_info payload')
    return
  }

  if (message.type === 'chat_chunk') {
    const requestId = message.request_id
    const payload = message.payload

    if (typeof requestId === 'string' && payload && typeof payload.text === 'string') {
      emit({
        type: 'onChunk',
        requestId,
        text: payload.text
      })
      return
    }

    emitError('BAD_MESSAGE', 'Invalid chat_chunk payload')
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
      }

      emit({
        type: 'onChatEnd',
        requestId,
        finishReason: payload.finish_reason
      })
      return
    }

    emitError('BAD_MESSAGE', 'Invalid chat_end payload')
    return
  }

  if (message.type === 'error') {
    const payload = message.payload

    if (payload && typeof payload.code === 'string' && typeof payload.message === 'string') {
      const requestId = typeof message.request_id === 'string' ? message.request_id : undefined
      if (requestId && activeRequestId === requestId) {
        activeRequestId = null
      }

      emitError(payload.code, payload.message, requestId)
      return
    }

    emitError('BAD_MESSAGE', 'Invalid error payload')
    return
  }

  emitError('BAD_MESSAGE', 'Unsupported protocol message type')
}

function onSocketData(chunk) {
  inboundBuffer += chunk.toString()

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
    nextSocket.destroy()
    return
  }

  socket = nextSocket
  serverInfoReceived = false
  startServerInfoTimeout(nextSocket)

  nextSocket.on('data', onSocketData)

  nextSocket.on('close', async () => {
    if (closing || socket !== nextSocket) {
      return
    }

    await closeResources()
    emit({
      type: 'onDisconnect',
      code: 'HOST_DISCONNECTED',
      message: 'Host disconnected'
    })
  })

  nextSocket.on('error', async () => {
    if (closing || socket !== nextSocket) {
      return
    }

    await closeResources()
    emit({
      type: 'onDisconnect',
      code: 'HOST_DISCONNECTED',
      message: 'Connection error'
    })
  })
}

async function handleConnect(serverId) {
  if (typeof serverId !== 'string') {
    emitError('INVALID_SERVER_ID', 'Server ID must be a string')
    return
  }

  await closeResources()

  let topic
  try {
    topic = bs58.decode(serverId.trim())
  } catch {
    emitError('INVALID_SERVER_ID', 'Could not decode Server ID')
    return
  }

  if (!topic || topic.length !== 32) {
    emitError('INVALID_SERVER_ID', 'Server ID must decode to 32 bytes')
    return
  }

  try {
    swarm = new Hyperswarm()

    swarm.on('connection', (nextSocket) => {
      attachSocket(nextSocket)
    })

    swarm.on('error', () => {
      emitError('CONNECT_FAILED', 'Failed to start Hyperswarm client')
    })

    discovery = swarm.join(topic, { server: false, client: true })
    await discovery.flushed()
  } catch {
    await closeResources()
    emitError('CONNECT_FAILED', 'Failed to join host topic')
  }
}

function handleSendPrompt(prompt) {
  if (typeof prompt !== 'string') {
    emitError('BAD_MESSAGE', 'Prompt must be a string')
    return
  }

  const normalized = prompt.trim()
  if (!normalized) {
    emitError('BAD_MESSAGE', 'Prompt cannot be empty')
    return
  }

  if (normalized.length > MAX_PROMPT_SIZE) {
    emitError('BAD_MESSAGE', 'Prompt exceeds max size')
    return
  }

  if (!socket) {
    emitError('HOST_OFFLINE', 'No connected host peer')
    return
  }

  if (activeRequestId) {
    emitError('MODEL_BUSY', 'A request is already active', activeRequestId)
    return
  }

  const requestId = nextRequestId()
  const message = JSON.stringify({
    type: 'chat_start',
    request_id: requestId,
    payload: { prompt: normalized }
  }) + '\n'

  try {
    socket.write(message)
    activeRequestId = requestId
  } catch {
    emitError('HOST_DISCONNECTED', 'Failed to write to host peer')
  }
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
    socket.write(message)
  } catch {
    emitError('HOST_DISCONNECTED', 'Failed to send abort', requestId)
  }
}

IPC.on('data', async (chunk) => {
  let command
  try {
    command = JSON.parse(Buffer.from(chunk).toString())
  } catch {
    emitError('BAD_MESSAGE', 'Bad worklet command')
    return
  }

  if (!command || typeof command.type !== 'string') {
    emitError('BAD_MESSAGE', 'Missing worklet command type')
    return
  }

  if (command.type === 'connect') {
    await handleConnect(command.serverId)
    return
  }

  if (command.type === 'disconnect') {
    await closeResources()
    emit({
      type: 'onDisconnect',
      code: 'USER_DISCONNECTED',
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

  emitError('BAD_MESSAGE', 'Unknown worklet command')
})
`;
