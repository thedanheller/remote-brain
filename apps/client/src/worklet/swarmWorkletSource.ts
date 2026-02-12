export const SWARM_WORKLET_SOURCE = `
const { IPC } = BareKit
const Hyperswarm = require('hyperswarm')
const bs58 = require('bs58')

let swarm = null
let discovery = null
let socket = null

function emit(event) {
  IPC.write(Buffer.from(JSON.stringify(event)))
}

async function closeResources(notify) {
  const previousSocket = socket
  socket = null

  if (previousSocket) {
    try {
      previousSocket.destroy()
    } catch {}
  }

  if (discovery) {
    try {
      discovery.destroy()
    } catch {}
    discovery = null
  }

  if (swarm) {
    try {
      await swarm.destroy()
    } catch {}
    swarm = null
  }

  if (notify) {
    emit({ type: 'disconnected' })
  }
}

function attachSocket(nextSocket) {
  if (socket) {
    nextSocket.destroy()
    return
  }

  socket = nextSocket
  emit({ type: 'connected' })

  nextSocket.on('data', (chunk) => {
    emit({ type: 'incoming', chunk: chunk.toString() })
  })

  nextSocket.on('close', () => {
    if (socket === nextSocket) {
      socket = null
      emit({
        type: 'network_error',
        code: 'HOST_DISCONNECTED',
        message: 'Host disconnected'
      })
      emit({ type: 'disconnected' })
    }
  })

  nextSocket.on('error', () => {
    if (socket === nextSocket) {
      socket = null
      emit({
        type: 'network_error',
        code: 'HOST_DISCONNECTED',
        message: 'Connection error'
      })
      emit({ type: 'disconnected' })
    }
  })
}

async function handleConnect(serverId) {
  emit({ type: 'connecting' })
  await closeResources(false)

  let topic
  try {
    topic = bs58.decode(serverId)
  } catch {
    emit({
      type: 'network_error',
      code: 'INVALID_SERVER_ID',
      message: 'Could not decode Server ID'
    })
    emit({ type: 'disconnected' })
    return
  }

  if (!topic || topic.length !== 32) {
    emit({
      type: 'network_error',
      code: 'INVALID_SERVER_ID',
      message: 'Server ID must decode to 32 bytes'
    })
    emit({ type: 'disconnected' })
    return
  }

  try {
    swarm = new Hyperswarm()

    swarm.on('connection', (nextSocket) => {
      attachSocket(nextSocket)
    })

    swarm.on('error', () => {
      emit({
        type: 'network_error',
        code: 'CONNECT_FAILED',
        message: 'Failed to start Hyperswarm client'
      })
    })

    discovery = swarm.join(topic, { server: false, client: true })
    await discovery.flushed()
  } catch {
    emit({
      type: 'network_error',
      code: 'CONNECT_FAILED',
      message: 'Failed to join host topic'
    })
    await closeResources(true)
  }
}

function handleSend(data) {
  if (!socket) {
    emit({
      type: 'network_error',
      code: 'HOST_OFFLINE',
      message: 'No connected host peer'
    })
    return
  }

  try {
    socket.write(data)
  } catch {
    emit({
      type: 'network_error',
      code: 'HOST_DISCONNECTED',
      message: 'Failed to write to host peer'
    })
    emit({ type: 'disconnected' })
  }
}

IPC.on('data', async (chunk) => {
  let command
  try {
    command = JSON.parse(Buffer.from(chunk).toString())
  } catch {
    emit({
      type: 'network_error',
      code: 'BAD_MESSAGE',
      message: 'Bad worklet command'
    })
    return
  }

  if (!command || typeof command.type !== 'string') {
    emit({
      type: 'network_error',
      code: 'BAD_MESSAGE',
      message: 'Missing worklet command type'
    })
    return
  }

  if (command.type === 'connect') {
    await handleConnect(command.serverId)
    return
  }

  if (command.type === 'disconnect') {
    await closeResources(true)
    return
  }

  if (command.type === 'send') {
    handleSend(command.data)
    return
  }

  emit({
    type: 'network_error',
    code: 'BAD_MESSAGE',
    message: 'Unknown worklet command'
  })
})
`;
