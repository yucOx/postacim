import { useEffect, useRef, useState } from 'react';
import { RoomContext } from '@livekit/components-react';
import { Maximize2, MessageSquare, Minimize2, Phone } from 'lucide-react';
import { useT } from '../i18n/I18nProvider';
import { useAppStore } from '../state/appStore';
import { useVoiceStore } from '../state/voiceStore';
import { PigeonMark } from './Brand';
import CallControls from './CallControls';
import CallStage from './CallStage';
import CallQualityPicker from './CallQualityPicker';

/** 1:1 DM call surface — sabit kutu, kalan alanı kaplar (Discord). Sohbet
 *  paneli varsayılan kapalı; düğmeyle açılır ve sağda görünür. Küçült
 *  PiP köşesine devreder, sohbet tamamen kullanılabilir kalır. */
export default function CallView({
  showChat,
  onToggleChat,
}: {
  showChat: boolean;
  onToggleChat: () => void;
}): React.ReactNode {
  const { t } = useT();
  const room = useVoiceStore((s) => s.room);
  const callState = useVoiceStore((s) => s.callState);
  const error = useVoiceStore((s) => s.error);
  const setPip = useVoiceStore((s) => s.setPip);
  const cancelCall = useVoiceStore((s) => s.cancelCall);
  const recallCall = useVoiceStore((s) => s.recallCall);
  const dms = useAppStore((s) => s.dms);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));

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
    // Discord mantığı: sabit max-w YOK — kutu kalan alanı kaplar, video
    // oranını (aspectRatio) koruyarak küçülür. max-w-4xl + min-h koyduğumda
    // sohbet açılınca alan daralıyor ama kutu sabit kalıp videoyu eziyordu.
    // min-h de yok: kısa ekranda kontrol çubuğu görünür kalmalı, video
    // alanı doğal olarak küçülür (CallStage zaten oranla sığdırıyor).
    <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-2">
      <div
        ref={containerRef}
        className="flex max-h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border border-night-700 bg-night-950 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.85)]"
      >
      <div className="flex shrink-0 items-center gap-2.5 border-b border-night-700 bg-night-900/60 px-3 py-2">
        <span className="plate">{t('call.plate')}</span>
        <span className="font-display text-base font-semibold uppercase tracking-[0.08em] text-paper-50">{peerNick}</span>
        <span className="sealed-band">{status}</span>
        <button
          type="button"
          onClick={onToggleChat}
          className={`btn-ghost ml-auto !px-2 !py-1 ${showChat ? 'border-brass-600 bg-night-800 text-paper-50' : ''}`}
          title={showChat ? t('call.chatHide') : t('call.chatShow')}
          aria-label={showChat ? t('call.chatHide') : t('call.chatShow')}
          aria-pressed={showChat}
        >
          <MessageSquare size={14} />
          <span className="hidden sm:inline text-xs">{showChat ? t('call.chatHide') : t('call.chatShow')}</span>
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
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <CallStage />
            {callState.phase === 'ended' ? (
              <div className="flex flex-wrap items-center justify-center gap-2 border-t border-night-700 bg-night-900/80 px-4 py-3">
                <span className="text-xs text-paper-500">
                  {callState.note ?? t('call.statusEnded')}
                </span>
                <button
                  type="button"
                  onClick={() => void recallCall()}
                  className="btn-lamp !text-xs"
                  title={t('call.recall')}
                >
                  <Phone size={14} />
                  {t('call.recall')}
                </button>
                <button
                  type="button"
                  onClick={() => void cancelCall()}
                  className="btn-ghost !text-xs"
                >
                  {t('call.close')}
                </button>
              </div>
            ) : (
              <>
                <CallQualityPicker />
                <CallControls variant="call" onEnd={() => void cancelCall()} endLabel={t('call.end')} onMinimize={() => setPip(true)} />
              </>
            )}
          </div>
        </RoomContext.Provider>
      )}
      </div>
    </div>
  );
}
