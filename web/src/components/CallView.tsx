import { useEffect, useRef, useState } from 'react';
import { RoomContext } from '@livekit/components-react';
import { Maximize2, MessageSquare, Minimize2 } from 'lucide-react';
import { useT } from '../i18n/I18nProvider';
import { useAppStore } from '../state/appStore';
import { useVoiceStore } from '../state/voiceStore';
import { PigeonMark } from './Brand';
import CallControls from './CallControls';
import CallStage from './CallStage';
import CallQualityPicker from './CallQualityPicker';
import DmChat from './DmChat';

/** 1:1 DM call surface — fullscreen overlay; minimize hands the room to the PiP corner
 *  so the chat underneath stays fully usable during the call. */
export default function CallView(): React.ReactNode {
  const { t } = useT();
  const room = useVoiceStore((s) => s.room);
  const callState = useVoiceStore((s) => s.callState);
  const error = useVoiceStore((s) => s.error);
  const setPip = useVoiceStore((s) => s.setPip);
  const cancelCall = useVoiceStore((s) => s.cancelCall);
  const dms = useAppStore((s) => s.dms);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));
  const [showChat, setShowChat] = useState(false);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (containerRef.current) {
        await containerRef.current.requestFullscreen();
      }
    } catch {
      // ignore
    }
  };

  if (!callState) return null;
  const peerNick = dms.find((d) => d.id === callState.channelId)?.peer.nick ?? '?';
  const status =
    callState.phase === 'ringing'
      ? t('call.statusRinging')
      : callState.phase === 'ended'
        ? (callState.note ?? t('call.statusEnded'))
        : t('call.statusOpen');

  return (
    // tam ekran overlay değil — ana flex satırına sığan panel; böylece
    // sol ray (sunucu + DM listesi) görüşme boyunca görünür kalır (Discord).
    // min-h-0 olmadan içerideki flex-1'ler viewport'u taşırıp scroll yaratır
    <div ref={containerRef} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-night-950">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-night-700 bg-night-900/60 px-3 py-2">
        <span className="plate">{t('call.plate')}</span>
        <span className="font-display text-base font-semibold uppercase tracking-[0.08em] text-paper-50">{peerNick}</span>
        <span className="sealed-band">{status}</span>
        <button
          onClick={() => setShowChat((v) => !v)}
          className={`btn-ghost ml-auto !px-2 !py-1 ${showChat ? 'bg-night-800 text-paper-50 border-brass-600' : ''}`}
          title={showChat ? 'Sohbeti Gizle' : 'Sohbeti Göster'}
          aria-label={showChat ? 'Sohbeti Gizle' : 'Sohbeti Göster'}
        >
          <MessageSquare size={14} />
          <span className="hidden sm:inline text-xs">{showChat ? 'Sohbeti Gizle' : 'Sohbet'}</span>
        </button>
        <button
          onClick={() => void toggleFullscreen()}
          className="btn-ghost !px-2 !py-1"
          title={isFullscreen ? 'Tam ekrandan çık' : 'Tam ekran'}
          aria-label={isFullscreen ? 'Tam ekrandan çık' : 'Tam ekran'}
        >
          {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <button
          onClick={() => setPip(true)}
          className="btn-ghost !px-2 !py-1"
          title={t('call.minimizeTitle')}
          aria-label={t('call.minimizeAria')}
        >
          <Minimize2 size={14} />
          {t('call.minimize')}
        </button>
      </div>
      {error && <div className="shrink-0 border-b border-stamp-500/50 bg-stamp-100 px-4 py-2 text-sm text-stamp-400">{error}</div>}
      {!room ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-paper-500">
          <PigeonMark size={30} className="text-brass-600" />
          <p className="text-sm">{t('call.connecting')}</p>
        </div>
      ) : (
        <RoomContext.Provider value={room}>
          <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <CallStage />
              <CallQualityPicker />
              <CallControls variant="call" onEnd={() => void cancelCall()} endLabel={t('call.end')} onMinimize={() => setPip(true)} />
            </div>
            {showChat && (
              <div className="flex w-80 md:w-96 shrink-0 flex-col border-l border-night-700 bg-night-900 overflow-hidden">
                <DmChat dmId={callState.channelId} />
              </div>
            )}
          </div>
        </RoomContext.Provider>
      )}
    </div>
  );
}
