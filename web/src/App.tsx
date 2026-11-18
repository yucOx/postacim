import { useEffect, useState } from 'react';
import { useAuthStore } from './state/authStore';
import { useAppStore } from './state/appStore';
import { useVoiceStore } from './state/voiceStore';
import Login from './components/Login';
import Shell from './components/Shell';
import JoinScreen from './components/JoinScreen';
import { ToastContainer } from './components/Toast';
import { SealMark } from './components/Brand';
import { parseInviteLink, type ParsedInvite } from './crypto/invite';
import { writeRoute, isHowItWorksRoute, readRoute } from './router';
import HowItWorks from './components/HowItWorks';
import { I18nProvider } from './i18n/I18nProvider';
import { useI18nStore } from './i18n/store';

export default function App() {
  const status = useAuthStore((s) => s.status);
  const restore = useAuthStore((s) => s.restore);
  const [invite, setInvite] = useState<ParsedInvite | null>(() => parseInviteLink(location.hash));
  // "nasıl çalışır?" slug'ı (#/nasil-calisir) — README'den gelen link hem anon
  // hem authed kullanıcıda açılır; hash tek doğruluk kaynağı
  const [showHow, setShowHow] = useState(() => isHowItWorksRoute(location.hash));

  // mirror the in-app view into the URL slug — F5 (after re-auth) lands back
  // in the same conversation
  useEffect(
    () =>
      useAppStore.subscribe((s) =>
        writeRoute(s.view, s.activeDmId, s.activeChannelId),
      ),
    [],
  );

  useEffect(() => {
    void restore();
  }, [restore]);

  useEffect(() => {
    const onHash = (): void => {
      setInvite(parseInviteLink(location.hash));
      setShowHow(isHowItWorksRoute(location.hash));
      // çalışan uygulamada yapıştırılan derin bağlantı (#/kanal, #/dm) —
      // önceden yalnız davet/nasil izleniyordu, kanal linki hiç gezinmiyordu
      const s = useAppStore.getState();
      if (!s.loaded) return; // soğuk yükleme: Shell routeApplied halleder
      const r = readRoute();
      if (!r) return;
      if (r.view === 'dm') {
        if (s.dms.some((d) => d.id === r.dmId) || s.gdms.some((g) => g.id === r.dmId)) s.openDmChat(r.dmId);
      } else if (s.communities.some((c) => c.channels.some((ch) => ch.id === r.channelId))) {
        s.selectChannel(r.channelId);
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Shell ekran dışındayken (nasıl çalışır, davet ekranı, çıkış) arama odası
  // AÇIK kalıyordu — mikrofon sıcak ve yayında: kullanıcı aramadan çıktığını
  // sanırken karşı taraf duymaya devam ediyordu
  useEffect(() => {
    if (showHow || invite || status !== 'authed') {
      const v = useVoiceStore.getState();
      if (v.room || v.callState) v.teardownAll();
    }
  }, [showHow, invite, status]);

  // replaceState hashchange tetiklemez — hash'i temizlerken state'i elle düşür
  const closeHow = (): void => {
    history.replaceState(null, '', location.pathname + location.search);
    setShowHow(false);
  };

  let screen: React.JSX.Element;
  if (status === 'loading') {
    screen = (
      <div className="flex h-screen items-center justify-center bg-night-950">
        <div className="animate-pulse text-brass-600">
          <SealMark size={96} text="POSTACIM · GECE POSTASI · " />
        </div>
      </div>
    );
  } else if (showHow) {
    screen = <HowItWorks onBack={closeHow} />;
  } else if (status !== 'authed') {
    screen = <Login />;
  } else if (invite) {
    screen = <JoinScreen invite={invite} />;
  } else {
    screen = <Shell />;
  }
  // arayüz dili → <html lang> güncelle (ekran okuyucu + doğru font fallback)
  const locale = useI18nStore((s) => s.locale);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <I18nProvider>
      {screen}
      <ToastContainer />
    </I18nProvider>
  );
}
