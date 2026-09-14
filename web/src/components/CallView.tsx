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
    // sol ray (sunucu + DM listesi) görüşme boyunca görünür kalır (Discord).
    // min-h-0 olmadan içerideki flex-1'ler viewport'u taşırıp scroll yaratır
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-night-950">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-night-700 bg-night-900/60 px-3 py-2">
        <span className="plate">GÖRÜŞME</span>
        <span className="font-display text-base font-semibold uppercase tracking-[0.08em] text-paper-50">{peerNick}</span>
        <span className="sealed-band">{status}</span>
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
      {error && <div className="shrink-0 border-b border-stamp-500/50 bg-stamp-100 px-4 py-2 text-sm text-stamp-400">{error}</div>}
      {!room ? (
        // bağlanmadan önce kompakt kutu — panel tüm yüksekliği kaplamasın
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-md border border-night-700 bg-night-900/40 px-6 py-10 text-paper-500">
            <PigeonMark size={30} className="text-brass-600" />
            <p className="text-sm">vagona bağlanıyor…</p>
          </div>
        </div>
      ) : (
        // CallStage + alt kontroller ana sütunda — CallStage flex-1 ile kalan
        // yüksekliği alır; min-h-0 kardeşler içermezse içerideki dikey
        // yerleşim viewport'a sığar
        <RoomContext.Provider value={room}>
          {/* kompakt çağrı paneli: panel tüm yüksekliği kaplamasın —
              ortalı, içerik ne olursa olsun sabit yükseklik; peer/akış
              olmasa bile çerçeve hep aynı boyutta (Discord). */}
          <div className="flex min-h-0 flex-1 items-stretch justify-center overflow-hidden p-4">
            <div className="flex w-full max-w-5xl min-h-0 flex-col overflow-hidden rounded-lg border border-night-700 bg-night-900/30">
              <CallStage />
              <CallQualityPicker />
              <CallControls variant="call" onEnd={() => void cancelCall()} endLabel="bitir" onMinimize={() => setPip(true)} />
            </div>
          </div>
        </RoomContext.Provider>
      )}
    </div>
  );
}
