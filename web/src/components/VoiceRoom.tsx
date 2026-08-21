import { useEffect } from 'react';
import {
  RoomContext,
  useTracks,
  useLocalParticipant,
  ParticipantTile,
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import { useVoiceStore } from '../state/voiceStore';

function Controls() {
  const micOn = useVoiceStore((s) => s.micOn);
  const camOn = useVoiceStore((s) => s.camOn);
  const screenOn = useVoiceStore((s) => s.screenOn);
  const toggleMic = useVoiceStore((s) => s.toggleMic);
  const toggleCam = useVoiceStore((s) => s.toggleCam);
  const toggleScreen = useVoiceStore((s) => s.toggleScreen);
  const leave = useVoiceStore((s) => s.leave);
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
        title={screenOn ? 'ekran paylaşımını durdur' : 'ekran paylaş'}
      >
        🖥️
      </button>
      <span className="ml-2 text-xs text-neutral-500">
        {local.isMicrophoneEnabled ? 'E2EE aktif 🔒' : 'mikrofon kapalı — açmak için 🎙️'}
      </span>
      <button
        onClick={() => void leave()}
        className="ml-4 rounded-full bg-red-600 px-4 py-2 text-sm font-medium hover:bg-red-500"
      >
        ayrıl
      </button>
    </div>
  );
}

function Grid() {
  const tracks = useTracks([Track.Source.Camera, Track.Source.Microphone], { onlySubscribed: false });
  const seen = new Set<string>();
  const tiles = tracks.filter((t) => {
    // one tile per participant (camera preferred, mic-only participants kept)
    if (seen.has(t.participant.identity)) return false;
    if (t.source === Track.Source.Microphone && t.participant.isCameraEnabled) return false;
    seen.add(t.participant.identity);
    return true;
  });
  if (tiles.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-neutral-600">
        odada yalnızca sensin — mikrofon/kamera aç, başkaları katılınca burada görünecekler
      </div>
    );
  }
  return (
    <div
      className="grid flex-1 auto-rows-fr content-start gap-3 overflow-y-auto p-4"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}
    >
      {tiles.map((t) => (
        <div
          key={t.participant.identity}
          className="relative flex min-h-48 items-center justify-center overflow-hidden rounded-xl bg-neutral-800"
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

export default function VoiceRoom({ channelId, channelName }: { channelId: string; channelName: string }) {
  const room = useVoiceStore((s) => s.room);
  const joined = useVoiceStore((s) => s.joinedChannelId);
  const error = useVoiceStore((s) => s.error);
  const join = useVoiceStore((s) => s.join);

  useEffect(() => {
    if (joined !== channelId) void join(channelId).catch(() => {});
  }, [channelId, joined, join]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-neutral-800/60 px-4 py-2 text-sm font-semibold text-neutral-300">
        🔊 {channelName}
        <span className="ml-2 text-[11px] font-normal text-emerald-500/80">
          uçtan uca şifreli (SFrame)
        </span>
      </div>
      {error && <div className="bg-red-950/50 px-4 py-2 text-sm text-red-400">{error}</div>}
      {!room ? (
        <div className="flex flex-1 items-center justify-center text-sm text-neutral-600">
          odaya bağlanıyor…
        </div>
      ) : (
        <RoomContext.Provider value={room}>
          <Grid />
          <Controls />
        </RoomContext.Provider>
      )}
    </div>
  );
}
