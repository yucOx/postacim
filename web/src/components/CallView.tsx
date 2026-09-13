import { RoomContext } from '@livekit/components-react';
import { Minimize2 } from 'lucide-react';
import { useAppStore } from '../state/appStore';
import { useVoiceStore } from '../state/voiceStore';
import { PigeonMark } from './Brand';
import CallControls from './CallControls';
import CallStage from './CallStage';
import CallQualityPicker from './CallQualityPicker';

/** 1:1 DM call surface — fullscreen overlay; minimize hands the room to the PiP corner
 *  so the chat underneath stays fully usable during the call. */
export default function CallView(): React.ReactNode {
  const room = useVoiceStore((s) => s.room);
  const callState = useVoiceStore((s) => s.callState);
  const error = useVoiceStore((s) => s.error);
  const setPip = useVoiceStore((s) => s.setPip);
  const cancelCall = useVoiceStore((s) => s.cancelCall);
  const dms = useAppStore((s) => s.dms);
  if (!callState) return null;
  const peerNick = dms.find((d) => d.id === callState.channelId)?.peer.nick ?? '?';
  const status =
    callState.phase === 'ringing' ? 'çalıyor…' : callState.phase === 'ended' ? (callState.note ?? 'bitti') : 'görüşme açık';

  return (
    // tam ekran overlay değil — ana flex satırına sığan panel; böylece
    // sol ray (sunucu + DM listesi) görüşme boyunca görünür kalır (Discord)
    <div className="flex min-w-0 flex-1 flex-col bg-night-950">
      <div className="flex items-center gap-3 border-b border-night-700 bg-night-900/60 px-4 py-2.5">
        <span className="plate">GÖRÜŞME</span>
        <span className="font-display text-lg font-semibold uppercase tracking-[0.08em] text-paper-50">{peerNick}</span>
        <span className="sealed-band">
          {status}
        </span>
        <button
          onClick={() => setPip(true)}
          className="btn-ghost ml-auto !px-2 !py-1"
          title="küçült — sohbete dön"
          aria-label="aramayı küçült"
        >
          <Minimize2 size={14} />
          küçült
        </button>
      </div>
      {error && <div className="border-b border-stamp-500/50 bg-stamp-100 px-4 py-2 text-sm text-stamp-400">{error}</div>}
      {!room ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-paper-500">
          <PigeonMark size={30} className="text-brass-600" />
          <p className="text-sm">vagona bağlanıyor…</p>
        </div>
      ) : (
        <RoomContext.Provider value={room}>
          <CallStage />
          <CallQualityPicker />
          <CallControls variant="call" onEnd={() => void cancelCall()} endLabel="bitir" onMinimize={() => setPip(true)} />
        </RoomContext.Provider>
      )}
    </div>
  );
}
