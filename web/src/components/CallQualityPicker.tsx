import { useT } from '../i18n/I18nProvider';
import { useVoiceStore } from '../state/voiceStore';
import type { CallQuality } from '../state/voiceStore';

const LEVEL_IDS: CallQuality[] = ['hizli', 'dengeli', 'yuksek'];
const LEVEL_KEYS: Record<CallQuality, 'call.speed' | 'call.balanced' | 'call.high'> = {
  hizli: 'call.speed',
  dengeli: 'call.balanced',
  yuksek: 'call.high',
};

/** kalite seçici — hızlı/dengeli/yüksek. Publish preset olarak kameraya ve ekran
 *  paylaşımına uygulanır; sürerken seçilirse sonraki paylaşımda geçerli. */
export default function CallQualityPicker(): React.ReactNode {
  const { t } = useT();
  const quality = useVoiceStore((s) => s.quality);
  const setQuality = useVoiceStore((s) => s.setQuality);
  const staleShare = useVoiceStore((s) => s.screenOn && s.screenQuality !== null && s.screenQuality !== s.quality);

  return (
    <div className="flex items-center justify-center gap-1.5 pb-1">
      <span className="plate !text-[10px]">{t('call.quality')}</span>
      {LEVEL_IDS.map((id) => {
        const label = t(LEVEL_KEYS[id]);
        return (
          <button
            key={id}
            onClick={() => setQuality(id)}
            aria-pressed={quality === id}
            title={t('call.qualityTitle', { name: label })}
            className={
              quality === id
                ? 'sealed-band cursor-default'
                : 'rounded-sm border border-transparent px-1.5 py-0.5 font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-paper-500 transition-colors hover:text-paper-100'
            }
          >
            {label}
          </button>
        );
      })}
      {staleShare && <span className="text-[10px] text-paper-500">{t('call.qualityStale')}</span>}
      <span className="hidden md:inline text-[10px] text-paper-700">{t('call.cam720Note')}</span>
    </div>
  );
}
