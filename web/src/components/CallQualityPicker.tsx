import { useVoiceStore } from '../state/voiceStore';
import type { CallQuality } from '../state/voiceStore';

const LEVELS: { id: CallQuality; label: string }[] = [
  { id: 'hizli', label: 'hızlı' },
  { id: 'dengeli', label: 'dengeli' },
  { id: 'yuksek', label: 'yüksek' },
];

/** kalite seçici — hızlı/dengeli/yüksek. Publish preset olarak kameraya ve ekran
 *  paylaşımına uygulanır; sürerken seçilirse sonraki paylaşımda geçerli. */
export default function CallQualityPicker(): React.ReactNode {
  const quality = useVoiceStore((s) => s.quality);
  const setQuality = useVoiceStore((s) => s.setQuality);
  const staleShare = useVoiceStore((s) => s.screenOn && s.screenQuality !== null && s.screenQuality !== s.quality);

  return (
    <div className="flex items-center justify-center gap-1.5 pb-1">
      <span className="plate !text-[10px]">kalite</span>
      {LEVELS.map((l) => (
        <button
          key={l.id}
          onClick={() => setQuality(l.id)}
          aria-pressed={quality === l.id}
          title={`kalite: ${l.label}`}
          className={
            quality === l.id
              ? 'sealed-band cursor-default'
              : 'rounded-sm border border-transparent px-1.5 py-0.5 font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-paper-500 transition-colors hover:text-paper-100'
          }
        >
          {l.label}
        </button>
      ))}
      {staleShare && <span className="text-[10px] text-paper-500">sonraki paylaşımda geçerli</span>}
    </div>
  );
}
