import { RoomContext, useTracks, useLocalParticipant, ParticipantTile } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { useAppStore } from '../state/appStore';
import { useVoiceStore } from '../state/voiceStore';

function Grid(): React.ReactNode {
  const tracks = useTracks([Track.Source.Camera, Track.Source.Microphone], { onlySubscribed: false });
  const seen = new Set<string>();
  const tiles = tracks.filter((t) => {
    if (seen.has(t.participant.identity)) return false;
    if (t.source === Track.Source.Microphone && t.participant.isCameraEnabled) return false;
    seen.add(t.participant.identity);
    return true;
  });
  return (
    <div className="flex flex-1 items-center justify-center gap-4 p-4">
      {tiles.map((t) => (
        <div
          key={t.participant.identity}
          className="relative flex h-full max-h-[70vh] min-h-56 min-w-64 flex-1 items-center justify-center overflow-hidden rounded-xl bg-neutral-800"
        >
          <ParticipantTile trackRef={t} className="h-full w-full" />
          <span className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/50 px-2 py-0.5 text-xs text-neutral-200">
            {t.participant.name || t.participant.identity} {t.participant.isLocal && '(sen)'}
          </span>
        </div>
      ))}
    </div>
  );
}

function Controls(): React.ReactNode {
  const micOn = useVoiceStore((s) => s.micOn);
  const camOn = useVoiceStore((s) => s.camOn);
  const screenOn = useVoiceStore((s) => s.screenOn);
  const toggleMic = useVoiceStore((s) => s.toggleMic);
  const toggleCam = useVoiceStore((s) => s.toggleCam);
  const toggleScreen = useVoiceStore((s) => s.toggleScreen);
  const cancelCall = useVoiceStore((s) => s.cancelCall);
  const local = useLocalParticipant();

  return (
    <div className="flex items-center justify-center gap-3 border-t border-neutral-800/60 bg-neutral-900/60 px-4 py-3">
      <button
        onClick={() => void toggleMic()}
        className={`flex h-11 w-11 items-center justify-center rounded-full text-lg ${
          micOn ? 'bg-neutral-700 hover:bg-neutral-600' : 'bg-red-600/80 hover:bg-red-500'
        }`}
        title={micOn ? 'mikrofonu kapat' : 'mikrofonu aç'}
      >
        {micOn ? '🎙️' : '🔇'}
      </button>
      <button
        onClick={() => void toggleCam()}
        className={`flex h-11 w-11 items-center justify-center rounded-full text-lg ${
          camOn ? 'bg-neutral-700 hover:bg-neutral-600' : 'bg-red-600/80 hover:bg-red-500'
        }`}
        title={camOn ? 'kamerayı kapat' : 'kamerayı aç'}
      >
        {camOn ? '📹' : '🚫'}
      </button>
      <button
        onClick={() => void toggleScreen()}
        className={`flex h-11 w-11 items-center justify-center rounded-full text-lg ${
          screenOn ? 'bg-emerald-700 hover:bg-emerald-600' : 'bg-neutral-700 hover:bg-neutral-600'
        }`}
        title="ekran paylaş"
      >
        🖥️
      </button>
      <span className="ml-2 text-xs text-neutral-500">
        {local.isMicrophoneEnabled ? 'E2EE 🔒' : 'mikrofon kapalı'}
      </span>
      <button
        onClick={() => void cancelCall()}
        className="ml-4 rounded-full bg-red-600 px-4 py-2 text-sm font-medium hover:bg-red-500"
      >
        bitir
      </button>
    </div>
  );
}

/** 1:1 DM call surface — rendered as an overlay from Shell while isDmCall */
export default function CallView(): React.ReactNode {
  const room = useVoiceStore((s) => s.room);
  const callState = useVoiceStore((s) => s.callState);
  const dms = useAppStore((s) => s.dms);
  const error = useVoiceStore((s) => s.error);
  if (!callState) return null;
  const dm = dms.find((d) => d.id === callState.channelId);
  const peerNick = dm?.peer.nick ?? '?';

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950/95">
      <div className="border-b border-neutral-800/60 px-4 py-2 text-sm font-semibold text-neutral-300">
        📞 {peerNick}
        <span className="ml-2 text-[11px] font-normal text-emerald-500/80">
          uçtan uca şifreli arama ({callState.phase === 'ringing' ? 'çalıyor…' : callState.phase === 'ended' ? (callState.note ?? 'bitti') : 'aktif'})
        </span>
      </div>
      {error && <div className="bg-red-950/50 px-4 py-2 text-sm text-red-400">{error}</div>}
      {!room ? (
        <div className="flex flex-1 items-center justify-center text-sm text-neutral-600">bağlanıyor…</div>
      ) : (
        <RoomContext.Provider value={room}>
          <Grid />
          <Controls />
        </RoomContext.Provider>
      )}
    </div>
  );
}
