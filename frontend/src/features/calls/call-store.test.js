import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCallStore } from '@/features/calls/call-store'

function fakePeer() {
  const iceListeners = new Set()
  const stateListeners = new Set()
  return {
    muted: false,
    speaker: false,
    disposed: false,
    iceCandidates: { subscribe: (listener) => iceListeners.add(listener) },
    connectionState: { subscribe: (listener) => stateListeners.add(listener) },
    createOffer: vi.fn(async () => 'offer-sdp'),
    createAnswer: vi.fn(async () => 'answer-sdp'),
    setRemoteDescription: vi.fn(async () => {}),
    addIceCandidate: vi.fn(async () => {}),
    setMuted: vi.fn(async function setMuted(value) {
      this.muted = value
    }),
    setSpeaker: vi.fn(async function setSpeaker(value) {
      this.speaker = value
    }),
    dispose: vi.fn(async function dispose() {
      this.disposed = true
    }),
    emitState(value) {
      for (const listener of stateListeners) listener(value)
    },
  }
}

function setup() {
  const peer = fakePeer()
  const sent = []
  const api = {
    capabilities: vi.fn(async () => ({ enabled: true, turnConfigured: false, recorded: false, persisted: false })),
    iceConfig: vi.fn(async () => ({ iceServers: [{ urls: ['stun:stun.test:3478'] }] })),
    create: vi.fn(async () => ({
      id: '11111111-1111-4111-8111-111111111111',
      callerId: 'caller',
      calleeId: 'callee',
      status: 'ringing',
      direction: 'outgoing',
      peer: { id: 'callee', displayName: 'Callee' },
    })),
    accept: vi.fn(async () => ({})),
    reject: vi.fn(async () => ({})),
    cancel: vi.fn(async () => ({})),
    busy: vi.fn(async () => ({})),
    connected: vi.fn(async () => ({})),
    end: vi.fn(async () => ({})),
  }
  const socket = {
    subscribe: (listener) => {
      socket.listener = listener
      return () => {}
    },
    send: (payload) => sent.push(payload),
  }
  const store = createCallStore({
    api,
    socket,
    peerFactory: async () => peer,
    requestMicrophone: async () => true,
  })
  store.getState().bindSocket()
  return { store, api, peer, sent, socket }
}

describe('web call store', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('places an outgoing call, signals an offer, and toggles mute/speaker', async () => {
    const { store, peer, sent, api } = setup()
    await store.getState().loadCapabilities()
    expect(store.getState().capabilities.enabled).toBe(true)
    expect(store.getState().capabilities.recorded).toBe(false)
    expect(store.getState().capabilities.persisted).toBe(false)
    await store.getState().startCall({ userId: 'callee', name: 'Callee' })
    expect(store.getState().active.phase).toBe('ringing')
    expect(store.getState().active.outgoing).toBe(true)
    expect(sent.some((item) => item.event === 'call.offer' && item.data.sdp === 'offer-sdp')).toBe(true)
    await store.getState().toggleMute()
    await store.getState().toggleSpeaker()
    expect(peer.muted).toBe(true)
    expect(peer.speaker).toBe(true)
    peer.emitState('connected')
    await vi.waitFor(() => expect(store.getState().active.phase).toBe('connected'))
    expect(api.connected).toHaveBeenCalled()
    await store.getState().cancel()
    expect(peer.disposed).toBe(true)
    expect(store.getState().active.phase).toBe('ended')
  })

  it('does not start a call when the microphone is denied', async () => {
    const { api, socket } = setup()
    const store = createCallStore({
      api,
      socket,
      peerFactory: async () => fakePeer(),
      requestMicrophone: async () => false,
    })
    await store.getState().loadCapabilities()
    await expect(store.getState().startCall({ userId: 'callee', name: 'Callee' })).rejects.toMatchObject({
      code: 'MIC_DENIED',
    })
    expect(store.getState().active.phase).toBe('failed')
  })

  it('hides calling when the server flag is off', async () => {
    const { socket } = setup()
    const store = createCallStore({
      api: { capabilities: async () => ({ enabled: false, recorded: false, persisted: false }) },
      socket,
      peerFactory: async () => fakePeer(),
    })
    await store.getState().loadCapabilities()
    expect(store.getState().capabilities.enabled).toBe(false)
    await expect(store.getState().startCall({ userId: 'callee', name: 'Callee' })).rejects.toMatchObject({
      code: 'CALLS_DISABLED',
    })
    expect(store.getState().active).toBeNull()
  })

  it('presents an incoming invite from another employee', async () => {
    const { store, socket, sent } = setup()
    await store.getState().loadCapabilities()
    socket.listener({
      event: 'call.invite',
      data: {
        callId: '33333333-3333-4333-8333-333333333333',
        callerId: 'caller',
        calleeId: 'me',
        caller: { id: 'caller', displayName: 'Priya' },
      },
    })
    expect(store.getState().active.phase).toBe('ringing')
    expect(store.getState().active.outgoing).toBe(false)
    expect(store.getState().active.peerName).toBe('Priya')
    expect(sent.some((item) => item.event === 'call.ringing')).toBe(true)
  })

  it('marks a second ringing call busy when this device is already live', async () => {
    const { store, api, socket } = setup()
    await store.getState().loadCapabilities()
    await store.getState().startCall({ userId: 'callee', name: 'Callee' })
    socket.listener({
      event: 'call.invite',
      data: { callId: '22222222-2222-4222-8222-222222222222', callerId: 'other' },
    })
    expect(api.busy).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222')
    expect(store.getState().active.peerId).toBe('callee')
  })
})
