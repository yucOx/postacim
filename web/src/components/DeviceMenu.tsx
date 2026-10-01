import { useEffect, useRef, useState } from 'react';
import { Camera, Check, Mic, MonitorSpeaker, Settings2, Video } from 'lucide-react';
import { useMediaStore, speakerSupported, type DeviceKind } from '../state/mediaStore';
import { useVoiceStore } from '../state/voiceStore';
import { useT } from '../i18n/I18nProvider';
import Modal from './Modal';

const ICONS: Record<DeviceKind, typeof Mic> = {
  audioinput: Mic,
  videoinput: Camera,
  audiooutput: MonitorSpeaker,
};

const TITLES: Record<DeviceKind, 'devices.mic' | 'devices.cam' | 'devices.speaker'> = {
  audioinput: 'devices.mic',
  videoinput: 'devices.cam',
  audiooutput: 'devices.speaker',
};

/** Cihaz seçim listesi. `variant="bar"` çağrı kontrol çubuğundaki
 *  Discord tarzı düğmeye açılan popover, `variant="modal"` ayarlardaki
 *  tam ekran liste. Aynı veriyi iki yerden gösterir. */
export default function DeviceMenu({
  variant = 'bar',
  onClose,
}: {
  variant?: 'bar' | 'modal';
  onClose?: () => void;
}): React.ReactNode {
  const { t } = useT();
  const devices = useMediaStore((s) => s.devices);
  const selected = useMediaStore((s) => s.selected);
  const permissionDenied = useMediaStore((s) => s.permissionDenied);
  const loadDevices = useMediaStore((s) => s.loadDevices);
  const switchDevice = useVoiceStore((s) => s.switchDevice);
  const inCall = useVoiceStore((s) => s.room !== null);
  const [busy, setBusy] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadDevices();
    // cihaz takılıp çıkarılınca liste bayat kalmasın
    const onChange = (): void => void loadDevices();
    navigator.mediaDevices?.addEventListener('devicechange', onChange);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', onChange);
  }, [loadDevices]);

  // bar varyantı: dışarı tıklayınca kapansın
  useEffect(() => {
    if (variant !== 'bar' || !onClose) return;
    const onDoc = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [variant, onClose]);

  const pick = async (k: DeviceKind, deviceId: string): Promise<void> => {
    if (busy) return;
    setBusy(k);
    try {
      await switchDevice(k, deviceId);
      if (variant === 'bar') onClose?.();
    } finally {
      setBusy(null);
    }
  };

  const body = (
    <div className="flex flex-col gap-2.5">
      {(['audioinput', 'videoinput', ...(speakerSupported() ? (['audiooutput'] as const) : [])] as DeviceKind[]).map(
        (k) => {
          const Icon = ICONS[k];
          const rows = devices[k];
          const activeId = k === 'audioinput' ? selected.mic : k === 'videoinput' ? selected.cam : selected.speaker;
          return (
            <div key={k} className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-paper-500">
                <Icon size={12} aria-hidden />
                {t(TITLES[k])}
              </span>
              {rows.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-paper-500">
                  {permissionDenied ? t('devices.denied') : t('devices.empty')}
                </p>
              ) : (
                rows.map((d, i) => {
                  // seçim yokken ilk satır sistem varsayılanıdır
                  const isDefault = activeId ? d.deviceId === activeId : i === 0;
                  return (
                    <button
                      key={d.deviceId}
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void pick(k, isDefault ? '' : d.deviceId)}
                      aria-pressed={isDefault}
                      title={d.label}
                      className={`flex items-center gap-2.5 rounded border px-2.5 py-1.5 text-left text-sm transition-colors disabled:opacity-50 ${
                        isDefault
                          ? 'border-lamp-500/70 bg-lamp-100/40 text-paper-50'
                          : 'border-night-700 text-paper-300 hover:border-brass-600 hover:bg-night-800'
                      }`}
                    >
                      <span className="flex-1 truncate">
                        {d.label}
                        {!activeId && i === 0 && (
                          <span className="ml-1.5 text-[10px] text-paper-500">({t('devices.systemDefault')})</span>
                        )}
                      </span>
                      {isDefault && <Check size={14} className="shrink-0 text-lamp-300" aria-hidden />}
                    </button>
                  );
                })
              )}
            </div>
          );
        },
      )}
      {inCall && <p className="text-[11px] text-paper-700">{t('devices.liveHint')}</p>}
    </div>
  );

  if (variant === 'modal') return <>{body}</>;

  return (
    <div
      ref={rootRef}
      role="menu"
      aria-label={t('devices.title')}
      className="absolute bottom-full left-1/2 z-30 mb-2 w-72 -translate-x-1/2 rounded-md border border-night-700 bg-night-950/95 p-2.5 shadow-lg"
    >
      {body}
      <button
        type="button"
        onClick={() => onClose?.()}
        className="mt-2 flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-paper-500 transition-colors hover:bg-night-800 hover:text-paper-100"
      >
        <Settings2 size={13} aria-hidden />
        {t('devices.moreInSettings')}
      </button>
    </div>
  );
}

/** Ayarların "Ses ve Video" sekmesindeki cihaz bloğu — başlıklı, kendi
 *  modali olan tam liste. */
export function DeviceSettingsBlock(): React.ReactNode {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex flex-col gap-1">
        <span className="font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-paper-500">
          {t('devices.title')}
        </span>
        <span className="text-xs text-paper-500">{t('devices.hint')}</span>
        <button type="button" onClick={() => setOpen(true)} className="btn-ghost mt-1 self-start !text-xs">
          <Video size={13} aria-hidden />
          {t('devices.pick')}
        </button>
      </div>
      {open && (
        <Modal title={t('devices.title')} onClose={() => setOpen(false)}>
          <DeviceMenu variant="modal" />
        </Modal>
      )}
    </>
  );
}
