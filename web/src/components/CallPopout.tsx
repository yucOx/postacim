import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RoomContext } from '@livekit/components-react';
import { Maximize2 } from 'lucide-react';
import { useT } from '../i18n/I18nProvider';
import { useAppStore } from '../state/appStore';
import { useVoiceStore } from '../state/voiceStore';
import { documentPip } from '../lib/documentPip';
import { PiPControls, PiPStage } from './PiPWidget';
import { toast } from './Toast';

/** Discord tarzı "her şeyin üstünde" arama penceresi — Document
 *  Picture-in-Picture. Açıkken köşedeki mini widget gizlenir (Discord'da
 *  popout varken küçük oynatıcı yoktur); pencere kapanınca widget geri döner.
 *  Ses ana sekmede çalmaya devam eder (GlobalCallAudio). */
export default function CallPopout(): React.ReactNode {
  const { t } = useT();
  const room = useVoiceStore((s) => s.room);
  const isDmCall = useVoiceStore((s) => s.isDmCall);
  const callState = useVoiceStore((s) => s.callState);
  const joinedVoiceChannel = useVoiceStore((s) => s.joinedChannelId);
  const setPopoutOpen = useVoiceStore((s) => s.setPopoutOpen);
  const dms = useAppStore((s) => s.dms);
  const selectChannel = useAppStore((s) => s.selectChannel);
  const channel = useAppStore((s) => s.communities.flatMap((c) => c.channels).find((ch) => ch.id === joinedVoiceChannel));

  const [pipDoc, setPipDoc] = useState<Window | null>(null);
  const winRef = useRef<Window | null>(null);

  const title = isDmCall
    ? dms.find((d) => d.id === callState?.channelId)?.peer.nick ?? '?'
    : channel?.name ?? t('pip.roomName');

  useEffect(() => {
    const api = documentPip();
    if (!api) {
      toast.error(t('pip.popoutUnsupported'));
      setPopoutOpen(false);
      return;
    }
    let alive = true;
    api
      .requestWindow({ width: 380, height: 300, disallowReturnToOpener: true })
      .then((w) => {
        if (!alive) {
          w.close();
          return;
        }
        winRef.current = w;
        // ana dokümanın stilleri (tailwind + fontsource dahil) popout'a kopyalanır
        for (const node of document.querySelectorAll('link[rel="stylesheet"], style')) {
          w.document.head.appendChild(document.importNode(node, true));
        }
        // stiller yüklenene dek beyaz flaş olmasın
        w.document.body.style.background = '#0b0e13';
        w.document.body.classList.add('overflow-hidden');
        // kullanıcı pencereyi X ile kapatınca köşe widget'ı geri döner
        w.addEventListener('pagehide', () => useVoiceStore.getState().setPopoutOpen(false));
        setPipDoc(w);
      })
      .catch(() => {
        toast.error(t('call.pipFailed'));
        useVoiceStore.getState().setPopoutOpen(false);
      });
    return () => {
      alive = false;
      // unmount = arama bitti ya da uygulamaya dönüldü — popout'u kapat
      try {
        winRef.current?.close();
      } catch {
        // zaten kapalı
      }
      winRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (pipDoc) pipDoc.document.title = title;
  }, [pipDoc, title]);

  if (!pipDoc || !room) return null;

  const onBack = (): void => {
    setPopoutOpen(false);
    if (isDmCall && callState) {
      useAppStore.getState().openDmChat(callState.channelId);
      useAppStore.setState({ view: 'dm' });
    } else if (joinedVoiceChannel) {
      selectChannel(joinedVoiceChannel);
      useAppStore.setState({ view: 'community', activeDmId: null });
    }
  };

  const onEnd = (): void => {
    if (isDmCall) void useVoiceStore.getState().cancelCall();
    else void useVoiceStore.getState().leave();
  };

  return createPortal(
    <div className="flex h-screen select-none flex-col bg-night-950 text-paper-100">
      <div className="flex items-center gap-2 border-b border-night-700 bg-night-900/80 px-3 py-2">
        <span className="plate !text-[10px]">{isDmCall ? t('call.plate') : t('pip.roomName')}</span>
        <span className="min-w-0 flex-1 truncate font-display text-sm font-semibold uppercase tracking-[0.08em] text-paper-50">
          {title}
        </span>
        <button
          onClick={onBack}
          className="rounded p-1 text-paper-400 transition-colors hover:bg-night-800 hover:text-paper-100"
          title={t('pip.maximize')}
          aria-label={t('pip.maximizeAria')}
        >
          <Maximize2 size={15} />
        </button>
      </div>
      <RoomContext.Provider value={room}>
        <div className="min-h-0 flex-1">
          <PiPStage expanded className="h-full" />
        </div>
        <PiPControls onEnd={onEnd} />
      </RoomContext.Provider>
    </div>,
    pipDoc.document.body,
  );
}
