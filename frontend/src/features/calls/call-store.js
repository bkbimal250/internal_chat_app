import { create } from 'zustand'
import { callsApi } from '@/services/calls-api'
import { websocketManager } from '@/services/websocket'
import { createWebVoicePeer } from '@/features/calls/webrtc-peer'

const LIVE = new Set(['initiating', 'ringing', 'connecting', 'connected', 'reconnecting'])

function emptyCapabilities() {
  return { enabled: false, turnConfigured: false, recorded: false, persisted: false, timeoutSeconds: 45 }
}

function activeFromRecord(record, extras = {}) {
  const peer = record.peer || {}
  const outgoing = record.direction === 'outgoing'
  return {
    id: record.id,
    peerId: peer.id || record.calleeId || record.callerId,
    peerName: peer.fullName || peer.displayName || 'MiChat user',
    outgoing,
    phase: extras.phase || (outgoing ? 'ringing' : 'ringing'),
    hasPhoto: Boolean(peer.hasProfilePhoto),
    photoVersion: peer.photoVersion,
    muted: false,
    speaker: false,
    error: extras.error,
  }
}

export function createCallStore({
  api = callsApi,
  socket = websocketManager,
  peerFactory = createWebVoicePeer,
  requestMicrophone,
} = {}) {
  let peer = null
  let pendingIce = []
  let pendingOffer = null
  let unsubSocket = null

  const store = create((set, get) => ({
    capabilities: emptyCapabilities(),
    active: null,

    async loadCapabilities() {
      try {
        const data = await api.capabilities()
        set({
          capabilities: {
            enabled: data?.enabled === true,
            turnConfigured: data?.turnConfigured === true,
            recorded: data?.recorded === true,
            persisted: data?.persisted === true,
            timeoutSeconds: data?.timeoutSeconds ?? 45,
          },
        })
      } catch {
        set({ capabilities: emptyCapabilities() })
      }
    },

    bindSocket() {
      if (unsubSocket) return
      unsubSocket = socket.subscribe((event) => get().handleEvent(event))
    },

    unbindSocket() {
      unsubSocket?.()
      unsubSocket = null
    },

    async startCall({ userId, name, hasPhoto = false, photoVersion } = {}) {
      const { capabilities, active } = get()
      if (!capabilities.enabled) {
        const error = Object.assign(new Error('Voice calling is not enabled yet.'), { code: 'CALLS_DISABLED' })
        throw error
      }
      if (active && LIVE.has(active.phase)) {
        const error = Object.assign(new Error('You already have an active call.'), { code: 'CALL_IN_PROGRESS' })
        throw error
      }
      set({
        active: {
          id: '',
          peerId: userId,
          peerName: name,
          outgoing: true,
          phase: 'initiating',
          hasPhoto,
          photoVersion,
          muted: false,
          speaker: false,
        },
      })
      try {
        await get()._ensureMic()
        const created = await api.create(userId)
        if (created.direction === 'incoming') {
          set({ active: activeFromRecord(created, { phase: 'ringing' }) })
          return
        }
        set({
          active: activeFromRecord(
            { ...created, direction: 'outgoing', peer: created.peer || { id: userId, displayName: name, hasProfilePhoto: hasPhoto, photoVersion } },
            { phase: 'initiating' },
          ),
        })
        await get()._preparePeer(true)
      } catch (error) {
        await get()._cleanupPeer()
        set({
          active: {
            ...get().active,
            phase: error?.code === 'CALL_BUSY' ? 'busy' : 'failed',
            error: error.message,
          },
        })
        throw error
      }
    },

    async accept(callId) {
      const current = get().active
      if (!current || current.id !== callId || current.outgoing) return
      set({ active: { ...current, phase: 'connecting' } })
      try {
        await get()._ensureMic()
        await api.accept(callId)
        await get()._preparePeer(false)
      } catch (error) {
        if (error?.code === 'CALL_OWNED_BY_OTHER_DEVICE') {
          get()._finish('ended')
          return
        }
        const active = get().active
        set({ active: { ...active, phase: 'failed', error: error.message } })
      }
    },

    async reject(callId) {
      try {
        await api.reject(callId)
      } catch {
        /* hang up locally even if the API already ended the call */
      }
      await get()._finish('rejected', callId)
    },

    async cancel() {
      const current = get().active
      if (!current?.id) {
        await get()._finish('ended')
        return
      }
      const path = current.outgoing && current.phase !== 'connected' ? 'cancel' : 'end'
      try {
        await api[path](current.id)
      } catch {
        /* local cleanup still runs */
      }
      await get()._finish('ended')
    },

    async toggleMute() {
      const current = get().active
      if (!current) return
      const muted = !current.muted
      await peer?.setMuted(muted)
      set({ active: { ...current, muted } })
    },

    async toggleSpeaker() {
      const current = get().active
      if (!current) return
      const speaker = !current.speaker
      await peer?.setSpeaker(speaker)
      set({ active: { ...current, speaker } })
    },

    dismissTerminal() {
      const current = get().active
      if (current && LIVE.has(current.phase)) return
      set({ active: null })
    },

    handleEvent(event) {
      const name = event?.event
      const data = event?.data || {}
      if (name === 'call.invite') {
        get()._presentIncoming(data)
        return
      }
      if (name === 'call.offer') {
        pendingOffer = data
        if (peer) get()._applyOffer(data)
        return
      }
      if (name === 'call.answer') {
        if (peer && data.sdp) peer.setRemoteDescription('answer', data.sdp)
        return
      }
      if (name === 'call.ice_candidate') {
        if (peer) peer.addIceCandidate(data.candidate)
        else pendingIce.push(data.candidate)
        return
      }
      if (name === 'call.ringing') {
        const current = get().active
        if (current?.outgoing && current.id === data.callId && (current.phase === 'initiating' || current.phase === 'ringing')) {
          set({ active: { ...current, phase: 'ringing' } })
        }
        return
      }
      if (name === 'call.accept') {
        const current = get().active
        if (!current || current.id !== data.callId) return
        if (!current.outgoing) {
          if (current.phase === 'ringing') get()._finish('ended')
          return
        }
        set({ active: { ...current, phase: 'connecting' } })
        return
      }
      if (['call.end', 'call.reject', 'call.cancel', 'call.busy', 'call.timeout'].includes(name)) {
        const phase =
          name === 'call.busy' ? 'busy' : name === 'call.timeout' ? 'missed' : name === 'call.reject' ? 'rejected' : 'ended'
        get()._finish(phase, data.callId)
      }
    },

    async _ensureMic() {
      if (requestMicrophone) {
        const granted = await requestMicrophone()
        if (!granted) {
          throw Object.assign(new Error('Microphone permission is required for voice calls.'), { code: 'MIC_DENIED' })
        }
        return
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw Object.assign(new Error('Microphone permission is required for voice calls.'), { code: 'MIC_DENIED' })
      }
    },

    async _preparePeer(asOfferer) {
      const ice = await api.iceConfig()
      peer = await peerFactory(ice.iceServers || [])
      peer.iceCandidates.subscribe((candidate) => {
        const id = get().active?.id
        if (!id) return
        socket.send({ event: 'call.ice_candidate', data: { callId: id, candidate } })
      })
      peer.connectionState.subscribe((value) => {
        const current = get().active
        if (!current) return
        if (value.includes('connected') || value.includes('completed')) {
          if (current.phase !== 'connected') {
            set({ active: { ...current, phase: 'connected' } })
            api.connected(current.id).catch(() => {})
          }
        } else if (value.includes('disconnected') || value.includes('checking')) {
          if (current.phase === 'connected') set({ active: { ...current, phase: 'reconnecting' } })
        } else if (value.includes('failed') || value.includes('closed')) {
          if (LIVE.has(current.phase)) get()._finish('failed')
        }
      })
      if (asOfferer) {
        const sdp = await peer.createOffer()
        socket.send({ event: 'call.offer', data: { callId: get().active?.id, sdp } })
      } else if (pendingOffer) {
        await get()._applyOffer(pendingOffer)
      }
      for (const candidate of pendingIce) await peer.addIceCandidate(candidate)
      pendingIce = []
    },

    async _applyOffer(data) {
      if (!peer || !data?.sdp) return
      await peer.setRemoteDescription('offer', data.sdp)
      const answer = await peer.createAnswer()
      socket.send({ event: 'call.answer', data: { callId: get().active?.id, sdp: answer } })
      pendingOffer = null
    },

    _presentIncoming(record) {
      const current = get().active
      const id = record.callId || record.id
      if (current && LIVE.has(current.phase) && current.id !== id) {
        api.busy(id).catch(() => {})
        return
      }
      set({
        active: activeFromRecord(
          {
            id,
            callerId: record.callerId,
            calleeId: record.calleeId,
            direction: 'incoming',
            peer: record.caller || record.peer || { id: record.callerId, displayName: record.callerName },
          },
          { phase: 'ringing' },
        ),
      })
      socket.send({ event: 'call.ringing', data: { callId: id } })
    },

    async _cleanupPeer() {
      const current = peer
      peer = null
      pendingIce = []
      pendingOffer = null
      await current?.dispose?.()
    },

    async _finish(phase, callId) {
      await get()._cleanupPeer()
      const current = get().active
      if (!current) return
      if (callId && current.id !== callId) return
      set({ active: { ...current, phase } })
    },
  }))

  return store
}

export const useCallStore = createCallStore()
