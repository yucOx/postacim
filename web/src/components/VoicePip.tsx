import { Mic, MicOff, PhoneOff, Volume2 } from 'lucide-react';
import { useAppStore } from '../state/appStore';
import { useVoiceStore } from '../state/voiceStore';

const NO_PARTICIPANTS: { user_id: string; nick: string }[] = [];

/** The community-call corner widget — stays over the chat while you browse
 *  other rooms (Discord-style). Mic control, participant list, one click back
 *  to the full room, or hang up. */
export default function VoicePip(): React.ReactNode {
  const channelId = useVoiceStore((s) => s.joinedChannelId);
  const micOn = useVoiceStore((s) => s.micOn);
  const presence = useVoiceStore((s) => (channelId ? s.presence[channelId] : undefined)) ?? NO_PARTICIPANTS;
  const toggleMic = useVoiceStore((s) => s.toggleMic);
  const leave = useVoiceStore((s) => s.leave);
  const channel = useAppStore((s) =>
    s.communities.flatMap((c) => c.channels).find((ch) => ch.id === channelId),
  );

  if (!channelId) return null;

  const backToRoom = (): void => {
    useAppStore.getState().selectChannel(channelId);
    useAppStore.setState({ view: 'community', activeDmId: null });
  };

  const round = (extra: string): string =>
    `flex h-8 w-8 items-center justify-center rounded-full border transition-colors ${extra}`;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-64 rounded-lg border border-brass-600/70 bg-night-900 p-3 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.85)]">
      <div className="flex items-center gap-2">
        <Volume2 size={14} className="shrink-0 text-lamp-500" aria-hidden />
        <button
          onClick={backToRoom}
          className="min-w-0 flex-1 truncate text-left font-display text-sm font-semibold uppercase tracking-[0.08em] text-paper-50 transition-colors hover:text-lamp-400"
          title="sesli odaya dön"
        >
          {channel?.name ?? 'sesli oda'}
        </button>
        <span className="shrink-0 font-display text-[10px] font-semibold text-lamp-400">
          {presence.length}
        </span>
      </div>
      {presence.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-paper-500">
          {presence.map((p) => (
            <span key={p.user_id} className="truncate">
              {p.nick}
            </span>
          ))}
        </div>
      )}
      <div className="mt-2.5 flex items-center gap-2 border-t border-night-700 pt-2.5">
        <button
          onClick={() => void toggleMic()}
          className={round(
            micOn
              ? 'border-brass-600/60 bg-night-700 text-paper-50 hover:border-brass-500'
              : 'border-stamp-500/70 bg-stamp-500 text-white hover:bg-stamp-400',
          )}
          title={micOn ? 'mikrofonu kapat' : 'mikrofonu aç'}
          aria-label={micOn ? 'mikrofonu kapat' : 'mikrofonu aç'}
          aria-pressed={micOn}
        >
          {micOn ? <Mic size={15} /> : <MicOff size={15} />}
        </button>
        <button onClick={backToRoom} className="btn-ghost flex-1 !py-1.5 !text-xs" title="sesli odaya dön">
          odaya dön
        </button>
        <button
          onClick={() => void leave()}
          className={round('border-stamp-500/70 bg-stamp-100 text-stamp-400 hover:bg-stamp-500 hover:text-white')}
          title="sesli odadan ayrıl"
          aria-label="sesli odadan ayrıl"
        >
          <PhoneOff size={14} />
        </button>
      </div>
    </div>
  );
}