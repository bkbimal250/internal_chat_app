export async function startVoiceRecording() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new Error('Voice notes are not supported in this browser')
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) =>
    MediaRecorder.isTypeSupported(type),
  )
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks = []
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data)
  }
  recorder.start()
  return {
    startedAt: Date.now(),
    async stop() {
      if (recorder.state === 'inactive') {
        stream.getTracks().forEach((track) => track.stop())
        return null
      }
      const blob = await new Promise((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }))
        recorder.stop()
      })
      stream.getTracks().forEach((track) => track.stop())
      if (!blob.size) return null
      const extension = blob.type.includes('mp4') ? 'm4a' : 'webm'
      return new File([blob], `voice-${Date.now()}.${extension}`, { type: blob.type || 'audio/webm' })
    },
    cancel() {
      if (recorder.state !== 'inactive') recorder.stop()
      stream.getTracks().forEach((track) => track.stop())
    },
  }
}
