import { useEffect } from 'react';
import { RoomContext } from '@livekit/components-react';
import { AlertTriangle, Volume2 } from 'lucide-react';
import { useT } from '../i18n/I18nProvider';
import { useAppStore } from '../state/appStore';
import { useVoiceStore } from '../state/voiceStore';
import { CALL_DOCK_H } from '../lib/callLayout';
import CallControls from './CallControls';
import CallStage from './CallStage';
import CallQualityPicker from './CallQualityPicker';

export default function VoiceRoom({ channelId, channelName }: { channelId: string; channelName: string }) {
  const { t } = useT();
  const room = useVoiceStore((s) => s.room);
  const joined = useVoiceStore((s) => s.joinedChannelId);
  const leftChannelId = useVoiceStore((s) => s.leftChannelId);
  const error = useVoiceStore((s) => s.error);
  const join = useVoiceStore((s) => s.join);
  // görüntülenen video oranı — kutu buna göre boyutlanır
  const leave = useVoiceStore((s) => s.leave);
  const needsRekey = useAppStore(
    (s) =>
      !!s.communities
        .find((c) => c.id === s.activeCommunityId)
        ?.channels.find((ch) => ch.id === channelId)?.needs_rekey,
  );

  // auto-join covers landing on the room (sidebar click already joins
  // explicitly; this catches F5/route-restore) — but never the room the user
  // just manually left; the sidebar's explicit join clears leftChannelId.
  useEffect(() => {
    if (!needsRekey && joined !== channelId && leftChannelId !== channelId) {
      void join(channelId).catch(() => {});
    }
  }, [channelId, joined, leftChannelId, join, needsRekey]);

  return (
    // Oda başlığı + sabit kutu. DM aramasıyla aynı mantık: kutu ortalanır,
    // CallStage'in kendi paddingi 1.5 birim — video kameranın sınırına
    // dayanır, altında/üstünde boşluk kalmaz.
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-night-700 bg-night-900/40 px-4 py-2.5">
        <Volume2 size={17} className="text-brass-500" aria-hidden />
        <span className="font-display text-lg font-semibold uppercase tracking-[0.08em] text-paper-50">
          {channelName}
        </span>
        <span className="sealed-band">{t('call.roomE2EE')}</span>
      </div>
      {needsRekey && (
        <div className="flex items-center gap-2 border-b border-lamp-600/40 bg-lamp-100/70 px-4 py-2 text-sm text-lamp-300">
          <AlertTriangle size={14} className="shrink-0 text-lamp-500" />
          {t('call.roomRekey')}
        </div>
      )}
      {error && <div className="border-b border-stamp-500/50 bg-stamp-100 px-4 py-2 text-sm text-stamp-400">{error}</div>}
      {!room ? (
        <div className="flex flex-1 items-center justify-center text-sm text-paper-500">{t('call.roomConnecting')}</div>
      ) : (
        // video tüm alanı kaplar, kontrol paneli mutlak olarak en alta
        // dock edilir (DM aramasıyla aynı)
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <RoomContext.Provider value={room}>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <CallStage emptyLabel={t('call.roomEmpty')} dockH={CALL_DOCK_H} />
            </div>
            <div className="absolute inset-x-0 bottom-0 z-20">
              <CallQualityPicker />
              <CallControls variant="room" onEnd={() => void leave()} endLabel={t('call.leave')} />
            </div>
          </RoomContext.Provider>
        </div>
      )}
    </div>
  );
}
