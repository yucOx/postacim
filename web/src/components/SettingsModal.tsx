import { useState } from 'react';
import { Bell, BellOff, Check, MonitorUp } from 'lucide-react';
import Modal from './Modal';
import { useSettingsStore } from '../state/settingsStore';
import { useI18nStore } from '../i18n/store';
import { LOCALES, LOCALE_LABEL, LOCALE_FLAG, type Locale } from '../i18n/types';
import { useT } from '../i18n/I18nProvider';

/** Notification + language prefs. Sound is local WebAudio; desktop toasts
 *  need the browser's permission (and a secure context — plain HTTP on a
 *  LAN IP is not one, only localhost is). Per-community mute lives in the
 *  channel sidebar's community menu. Language picker writes to the i18n
 *  store and takes effect immediately (no reload). */
export default function SettingsModal({ onClose }: { onClose: () => void }): React.ReactNode {
  const { t } = useT();
  const soundOn = useSettingsStore((s) => s.soundOn);
  const desktopOn = useSettingsStore((s) => s.desktopOn);
  const toggleSound = useSettingsStore((s) => s.toggleSound);
  const [error, setError] = useState<string | null>(null);
  const locale = useI18nStore((s) => s.locale);
  const setLocale = useI18nStore((s) => s.setLocale);

  const toggleDesktop = async (): Promise<void> => {
    setError(null);
    if (desktopOn) {
      useSettingsStore.getState().disableDesktop();
      return;
    }
    if (typeof Notification === 'undefined') {
      setError(t('settings.notifUnsupported'));
      return;
    }
    if (Notification.permission === 'denied') {
      setError(t('settings.notifDenied'));
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === 'granted') useSettingsStore.getState().enableDesktop();
    else setError(t('settings.notifDeclined'));
  };

  return (
    <Modal title={t('settings.title')} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-paper-500">
            {t('settings.language')}
          </span>
          <span className="text-xs text-paper-500">{t('settings.languageHint')}</span>
          <div className="mt-1 flex flex-col gap-1">
            {LOCALES.map((l) => (
              <LocaleRow key={l} code={l} active={locale === l} onPick={setLocale} />
            ))}
          </div>
        </div>
        <hr className="border-night-700" />
        <button
          onClick={toggleSound}
          className="flex items-center gap-2.5 rounded px-2 py-2 text-left transition-colors hover:bg-night-800"
        >
          {soundOn ? <Bell size={16} className="text-lamp-500" /> : <BellOff size={16} className="text-paper-500" />}
          <span className="flex-1 text-sm text-paper-100">{t('settings.sound')}</span>
          <span
            className={`rounded px-1.5 py-0.5 font-display text-[10px] font-semibold uppercase tracking-[0.14em] ${
              soundOn ? 'bg-lamp-100 text-lamp-300' : 'bg-night-700 text-paper-500'
            }`}
          >
            {soundOn ? t('settings.on') : t('settings.off')}
          </span>
        </button>
        <button
          onClick={() => void toggleDesktop()}
          className="flex items-center gap-2.5 rounded px-2 py-2 text-left transition-colors hover:bg-night-800"
        >
          <MonitorUp size={16} className={desktopOn ? 'text-lamp-500' : 'text-paper-500'} />
          <span className="flex-1 text-sm text-paper-100">
            {t('settings.desktop')}
            <span className="block text-xs text-paper-500">{t('settings.desktopHint')}</span>
          </span>
          <span
            className={`rounded px-1.5 py-0.5 font-display text-[10px] font-semibold uppercase tracking-[0.14em] ${
              desktopOn ? 'bg-lamp-100 text-lamp-300' : 'bg-night-700 text-paper-500'
            }`}
          >
            {desktopOn ? t('settings.on') : t('settings.off')}
          </span>
        </button>
        {error && <p className="text-sm text-stamp-400">{error}</p>}
        <p className="text-xs text-paper-700">{t('settings.perCommunityHint')}</p>
      </div>
    </Modal>
  );
}

function LocaleRow({
  code,
  active,
  onPick,
}: {
  code: Locale;
  active: boolean;
  onPick: (l: Locale) => void;
}): React.ReactNode {
  return (
    <button
      type="button"
      onClick={() => onPick(code)}
      aria-pressed={active}
      className={`flex items-center gap-2.5 rounded border px-2.5 py-1.5 text-left text-sm transition-colors ${
        active
          ? 'border-lamp-500/70 bg-lamp-100/40 text-paper-50'
          : 'border-night-700 text-paper-300 hover:border-brass-600 hover:bg-night-800'
      }`}
    >
      <span aria-hidden className="text-base leading-none">
        {LOCALE_FLAG[code]}
      </span>
      <span className="flex-1">{LOCALE_LABEL[code]}</span>
      {active && <Check size={14} className="text-lamp-300" aria-hidden />}
    </button>
  );
}
