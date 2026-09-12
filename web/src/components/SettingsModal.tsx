import { useState } from 'react';
import { Bell, BellOff, MonitorUp } from 'lucide-react';
import Modal from './Modal';
import { useSettingsStore } from '../state/settingsStore';

/** Notification prefs. Sound is local WebAudio; desktop toasts need the
 *  browser's permission (and a secure context — plain HTTP on a LAN IP is
 *  not one, only localhost is). Per-community mute lives in the channel
 *  sidebar's community menu. */
export default function SettingsModal({ onClose }: { onClose: () => void }): React.ReactNode {
  const soundOn = useSettingsStore((s) => s.soundOn);
  const desktopOn = useSettingsStore((s) => s.desktopOn);
  const toggleSound = useSettingsStore((s) => s.toggleSound);
  const [error, setError] = useState<string | null>(null);

  const toggleDesktop = async (): Promise<void> => {
    setError(null);
    if (desktopOn) {
      useSettingsStore.getState().disableDesktop();
      return;
    }
    if (typeof Notification === 'undefined') {
      setError('bu tarayıcıda masaüstü bildirimi yok — güvenli bağlantı gerekir (https veya localhost)');
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === 'granted') useSettingsStore.getState().enableDesktop();
    else setError('izin verilmedi — tarayıcının adres çubuğundaki kilitten izin verebilirsin');
  };

  return (
    <Modal title="Bildirimler" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <button
          onClick={toggleSound}
          className="flex items-center gap-2.5 rounded px-2 py-2 text-left transition-colors hover:bg-night-800"
        >
          {soundOn ? <Bell size={16} className="text-lamp-500" /> : <BellOff size={16} className="text-paper-500" />}
          <span className="flex-1 text-sm text-paper-100">bildirim sesi</span>
          <span
            className={`rounded px-1.5 py-0.5 font-display text-[10px] font-semibold uppercase tracking-[0.14em] ${
              soundOn ? 'bg-lamp-100 text-lamp-300' : 'bg-night-700 text-paper-500'
            }`}
          >
            {soundOn ? 'açık' : 'kapalı'}
          </span>
        </button>
        <button
          onClick={() => void toggleDesktop()}
          className="flex items-center gap-2.5 rounded px-2 py-2 text-left transition-colors hover:bg-night-800"
        >
          <MonitorUp size={16} className={desktopOn ? 'text-lamp-500' : 'text-paper-500'} />
          <span className="flex-1 text-sm text-paper-100">
            masaüstü bildirimi
            <span className="block text-xs text-paper-500">sekme arkadayken — içerik gösterilmez, sadece gönderen</span>
          </span>
          <span
            className={`rounded px-1.5 py-0.5 font-display text-[10px] font-semibold uppercase tracking-[0.14em] ${
              desktopOn ? 'bg-lamp-100 text-lamp-300' : 'bg-night-700 text-paper-500'
            }`}
          >
            {desktopOn ? 'açık' : 'kapalı'}
          </span>
        </button>
        {error && <p className="text-sm text-stamp-400">{error}</p>}
        <p className="text-xs text-paper-700">
          tek tek sunucuları susturmak için: topluluk menüsü (⋮) → bildirimleri sustur
        </p>
      </div>
    </Modal>
  );
}