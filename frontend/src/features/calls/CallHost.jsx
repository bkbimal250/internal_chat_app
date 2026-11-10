import { useEffect } from 'react'
import { Mic, MicOff, Phone, PhoneOff, Volume2 } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { useCallStore } from '@/features/calls/call-store'
import { UserAvatar } from '@/components/common/UserAvatar'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const LIVE = new Set(['initiating', 'ringing', 'connecting', 'connected', 'reconnecting'])

function statusLabel(call) {
  if (call.phase === 'ringing' || call.phase === 'initiating') return call.outgoing ? 'Calling…' : 'Incoming voice call'
  if (call.phase === 'connecting') return 'Connecting…'
  if (call.phase === 'connected') return 'Connected'
  if (call.phase === 'reconnecting') return 'Reconnecting…'
  if (call.phase === 'rejected') return 'Declined'
  if (call.phase === 'busy') return 'Busy'
  if (call.phase === 'missed') return call.outgoing ? 'No answer' : 'Missed call'
  if (call.phase === 'failed') return 'Call failed'
  if (call.phase === 'ended') return 'Call ended'
  return ''
}

export function CallHost({ children }) {
  const { isAuthenticated } = useAuth()
  const call = useCallStore((state) => state.active)

  useEffect(() => {
    useCallStore.getState().bindSocket()
    return () => useCallStore.getState().unbindSocket()
  }, [])

  useEffect(() => {
    if (isAuthenticated) useCallStore.getState().loadCapabilities()
    else useCallStore.getState().dismissTerminal()
  }, [isAuthenticated])

  const incoming = call && !call.outgoing && call.phase === 'ringing'
  const show = Boolean(call && (incoming || call.phase !== 'idle'))

  return (
    <>
      {children}
      {show ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/95 p-6 text-slate-50" data-testid="call-overlay">
          <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
            <p className="text-xs font-semibold tracking-[0.2em] text-amber-400">MICHAT</p>
            <UserAvatar
              userId={call.peerId}
              name={call.peerName}
              hasPhoto={call.hasPhoto}
              photoVersion={call.photoVersion}
              tooltip={false}
              className="size-28 text-2xl"
            />
            <div>
              <h2 className="text-2xl font-semibold">{call.peerName}</h2>
              <p className="mt-1 text-sm text-amber-300" data-testid="call-status">
                {statusLabel(call)}
              </p>
            </div>
            {incoming ? (
              <div className="flex gap-8">
                <Button
                  size="lg"
                  variant="destructive"
                  aria-label="Decline call"
                  className="rounded-full"
                  onClick={() => useCallStore.getState().reject(call.id)}
                >
                  <PhoneOff /> Decline
                </Button>
                <Button
                  size="lg"
                  aria-label="Accept call"
                  className="rounded-full bg-emerald-600 hover:bg-emerald-500"
                  onClick={() => useCallStore.getState().accept(call.id)}
                >
                  <Phone /> Accept
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <Button
                  size="icon"
                  variant={call.muted ? 'secondary' : 'ghost'}
                  aria-label={call.muted ? 'Unmute' : 'Mute'}
                  className="rounded-full"
                  onClick={() => useCallStore.getState().toggleMute()}
                >
                  {call.muted ? <MicOff /> : <Mic />}
                </Button>
                <Button
                  size="icon"
                  variant={call.speaker ? 'secondary' : 'ghost'}
                  aria-label="Speaker"
                  className={cn('rounded-full', call.speaker && 'bg-amber-500/20')}
                  onClick={() => useCallStore.getState().toggleSpeaker()}
                >
                  <Volume2 />
                </Button>
                {LIVE.has(call.phase) ? (
                  <Button
                    size="icon"
                    variant="destructive"
                    aria-label="End call"
                    className="rounded-full"
                    onClick={() => useCallStore.getState().cancel()}
                  >
                    <PhoneOff />
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={() => useCallStore.getState().dismissTerminal()}>
                    Close
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  )
}
