export async function createWebVoicePeer(iceServers, { getUserMedia, PeerConnection, AudioElement } = {}) {
  const RTCPeer = PeerConnection || globalThis.RTCPeerConnection
  const media = getUserMedia || navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices)
  if (!RTCPeer || !media) {
    throw new Error('WebRTC audio is not available in this browser')
  }
  const pc = new RTCPeer({ iceServers, iceCandidatePoolSize: 4 })
  const local = await media({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  })
  for (const track of local.getAudioTracks()) {
    pc.addTrack(track, local)
  }
  const remoteAudio = new (AudioElement || globalThis.Audio)()
  remoteAudio.autoplay = true
  const iceListeners = new Set()
  const stateListeners = new Set()

  pc.onicecandidate = (event) => {
    if (!event.candidate?.candidate) return
    const payload = {
      candidate: event.candidate.candidate,
      sdpMid: event.candidate.sdpMid,
      sdpMLineIndex: event.candidate.sdpMLineIndex,
    }
    for (const listener of iceListeners) listener(payload)
  }
  const emitState = () => {
    const label = `${pc.connectionState || ''} ${pc.iceConnectionState || ''}`.toLowerCase()
    for (const listener of stateListeners) listener(label)
  }
  pc.onconnectionstatechange = emitState
  pc.oniceconnectionstatechange = emitState
  pc.ontrack = (event) => {
    remoteAudio.srcObject = event.streams?.[0] || new MediaStream([event.track])
  }

  return {
    iceCandidates: {
      subscribe(listener) {
        iceListeners.add(listener)
        return () => iceListeners.delete(listener)
      },
    },
    connectionState: {
      subscribe(listener) {
        stateListeners.add(listener)
        return () => stateListeners.delete(listener)
      },
    },
    async createOffer() {
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false })
      await pc.setLocalDescription(offer)
      return offer.sdp
    },
    async createAnswer() {
      const answer = await pc.createAnswer({ offerToReceiveAudio: true, offerToReceiveVideo: false })
      await pc.setLocalDescription(answer)
      return answer.sdp
    },
    setRemoteDescription(type, sdp) {
      return pc.setRemoteDescription({ type, sdp })
    },
    addIceCandidate(candidate) {
      return pc.addIceCandidate(candidate)
    },
    async setMuted(muted) {
      for (const track of local.getAudioTracks()) track.enabled = !muted
    },
    async setSpeaker(speaker) {
      remoteAudio.volume = speaker ? 1 : 0.85
      if (typeof remoteAudio.setSinkId === 'function') {
        try {
          await remoteAudio.setSinkId(speaker ? 'default' : 'communications')
        } catch {
          /* browsers without a communications sink keep the default output */
        }
      }
    },
    async dispose() {
      for (const track of local.getAudioTracks()) track.stop()
      local.getTracks?.().forEach((track) => track.stop())
      remoteAudio.srcObject = null
      pc.close()
    },
  }
}
