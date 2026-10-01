import { useEffect, useRef, useState } from 'react';
import { RoomContext, AudioTrack, useTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { Bell, LogOut, Menu, Settings as SettingsIcon } from 'lucide-react';
import { useAppStore } from '../state/appStore';
import { useAuthStore } from '../state/authStore';
import { wsConnect, wsDisconnect, onWsStatus, lastCloseInfo, type WsStatus } from '../ws/socket';
import ServerRail from './ServerRail';
import ChannelSidebar from './ChannelSidebar';
import MemberList from './MemberList';
import ChatView from './ChatView';
import VoiceRoom from './VoiceRoom';
import DmHome from './DmHome';
import DmSidebar from './DmSidebar';
import DmChat from './DmChat';
import IncomingCall from './IncomingCall';
import CallView from './CallView';
import PiPWidget from './PiPWidget';
import VoicePip from './VoicePip';
import SettingsModal from './SettingsModal';
import LocalePicker from './LocalePicker';
import { PigeonMark } from './Brand';
import Avatar from './Avatar';
import ProfileModal from './ProfileModal';
import DeviceLockModal from './DeviceLockModal';
import InvitePrompt from './InvitePrompt';
import { deviceOfferDeclined, deviceUnlockSupported, hasDeviceUnlock } from '../crypto/devicekey';
import { useChatStore } from '../state/chatStore';
import { useDmChatStore } from '../state/dmChatStore';
import { useTypingStore } from '../state/typingStore';
import { useUnreadStore, unreadCount } from '../state/unreadStore';
import { useSettingsStore } from '../state/settingsStore';
import { useT } from '../i18n/I18nProvider';
import { useVoiceStore } from '../state/voiceStore';
import { useSecurityStore } from '../state/securityStore';
import { readRoute } from '../router';

function GlobalCallAudio(): React.ReactNode {
  const tracks = useTracks([Track.Source.Microphone, Track.Source.ScreenShareAudio], { onlySubscribed: true });
  const volume = useVoiceStore((s) => s.volume);
  const deafened = useVoiceStore((s) => s.deafened);
  return (
    <div style={{ display: 'none' }}>
      {tracks
        .filter((t) => !t.participant.isLocal)
        .map((t) => (
          <AudioTrack
            key={t.participant.identity + '-' + t.source}
            trackRef={t}
            volume={deafened ? 0 : volume}
            muted={deafened}
          />
        ))}
    </div>
  );
}

export default function Shell() {
  const { t } = useT();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [profileModal, setProfileModal] = useState(false);
  const [settingsModal, setSettingsModal] = useState(false);
  const [deviceOffer, setDeviceOffer] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const loaded = useAppStore((s) => s.loaded);
  const loadBootstrap = useAppStore((s) => s.loadBootstrap);
  const wireEvents = useAppStore((s) => s.wireEvents);
  const channel = useAppStore((s) => s.activeChannel());
  const view = useAppStore((s) => s.view);
  const activeChannelId = useAppStore((s) => s.activeChannelId);
  const activeDm = useAppStore((s) => (s.activeDmId ? s.dms.find((d) => d.id === s.activeDmId) ?? null : null));
  const room = useVoiceStore((s) => s.room);
  const isDmCall = useVoiceStore((s) => s.isDmCall);
  const callState = useVoiceStore((s) => s.callState);
  const callDmId = callState?.channelId ?? null;
  const joinedVoiceChannel = useVoiceStore((s) => s.joinedChannelId);
  const pip = useVoiceStore((s) => s.pip);
  const isCallMinimized = isDmCall && !!room && (pip || view !== 'dm' || activeDm?.id !== callDmId);
  // arama sırasında sohbet paneli — varsayılan kapalı (Discord: video önce)
  const [showCallChat, setShowCallChat] = useState(false);
  const isCommunityVoiceMinimized =
    !isDmCall &&
    !!joinedVoiceChannel &&
    !!room &&
    !(view === 'community' && channel?.type === 'voice' && activeChannelId === joinedVoiceChannel);
  const showPiP = isCallMinimized || isCommunityVoiceMinimized;
  const dms = useAppStore((s) => s.dms);
  const gdms = useAppStore((s) => s.gdms);
  const openDmChat = useAppStore((s) => s.openDmChat);
  const selectChannel = useAppStore((s) => s.selectChannel);
  const dmMessages = useDmChatStore((s) => s.messages);
  useUnreadStore((s) => s.readMap);
  const keylogWarning = useSecurityStore((s) => s.keylogWarning);
  const keylogForkWarning = useSecurityStore((s) => s.keylogForkWarning);
  const dhUpdateWarning = useSecurityStore((s) => s.dhUpdateWarning);

  // browser-tab badge: total unread DMs
  const dmUnreadTotal = dms.reduce((n, d) => n + unreadCount(d.id, dmMessages[d.id]), 0);
  useEffect(() => {
    document.title = dmUnreadTotal > 0 ? t('shell.tabTitleUnread', { count: dmUnreadTotal }) : t('shell.tabTitle');
  }, [dmUnreadTotal, t]);

  // "bu cihazda hatırla" teklifi — bir kez: desteklenen cihazda, kayıt yoksa ve
  // daha önce reddedilmemişse çıkar. Destek yoksa hiç görünmez.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        if (!(await deviceUnlockSupported())) return;
        if (deviceOfferDeclined()) return;
        if (await hasDeviceUnlock()) return;
        if (alive) setDeviceOffer(true);
      } catch {
        /* destek algısı başarısız → teklif yok, her şey eskisi gibi */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    wireEvents();
    useChatStore.getState().wire();
    useDmChatStore.getState().wire();
    useTypingStore.getState().wire();
    useVoiceStore.getState().wire();
    wsConnect();
    void loadBootstrap();
    return () => wsDisconnect();
  }, [wireEvents, loadBootstrap]);

  // anahtar defteri doğrulaması — Shell mount'unda bir kez (giriş/kayıt
  // sonrası): defteri çek, zinciri doğrula, kendi kaydını kontrol et
  useEffect(() => {
    const { user, publicKey } = useAuthStore.getState();
    if (user && publicKey) void useSecurityStore.getState().runKeyLogCheck(user.id, publicKey);
  }, []);

  // live connection badge — the socket retries forever; this says when it's down
  const [wsStat, setWsStat] = useState<WsStatus>('offline');
  useEffect(() => onWsStatus(setWsStat), []);

  // one-time desktop-notification ask (Discord-style): only while the browser
  // would still show its own prompt ('default'), never twice
  const [notifPrompt, setNotifPrompt] = useState(false);
  const [notifHint, setNotifHint] = useState<string | null>(null);
  useEffect(() => {
    if (!loaded || !user) return;
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'default') return;
    if (useSettingsStore.getState().desktopAsked) return;
    setNotifPrompt(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // F5 restore: once bootstrap is in, the URL slug decides where you land
  // (the re-auth card sits in front of this — after the password you're back
  // in the same conversation). Unknown ids fall through to the default view.
  const routeApplied = useRef(false);
  useEffect(() => {
    if (!loaded || routeApplied.current) return;
    routeApplied.current = true;
    const r = readRoute();
    if (r?.view === 'dm') {
      if (dms.some((d) => d.id === r.dmId) || gdms.some((g) => g.id === r.dmId)) openDmChat(r.dmId);
    } else if (r?.view === 'community') {
      if (useAppStore.getState().communities.some((c) => c.channels.some((ch) => ch.id === r.channelId)))
        selectChannel(r.channelId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const closeNav = (): void => setNavOpen(false);

  return (
    <div className="flex h-screen flex-col bg-night-950 text-paper-100">
      {/* rota plakası — the wagon header */}
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-night-700 bg-night-900 px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            onClick={() => setNavOpen(true)}
            aria-label={t('shell.menu')}
            className="rounded p-1 text-paper-300 transition-colors hover:bg-night-800 hover:text-paper-100 lg:hidden"
          >
            <Menu size={18} />
          </button>
          <PigeonMark size={19} className="shrink-0 text-lamp-500" />
          <span className="plate !text-sm !tracking-[0.22em] text-paper-100">{t('shell.brand')}</span>
          {wsStat !== 'open' && (
            <span
              className={`ml-1 rounded-sm border px-1.5 py-px font-display text-[10px] font-semibold uppercase tracking-[0.16em] ${
                wsStat === 'connecting'
                  ? 'border-lamp-600/70 bg-lamp-100 text-lamp-300'
                  : 'border-stamp-500/70 bg-stamp-100 text-stamp-400'
              }`}
              // kopma teşhisi: hata kodu + kısa açıklama — "ara ara atıyor"
              // şikayetinde 1006 (ağ/suspend/sunucu terminate) ile 4003 (oturum)
              // ayırt edilir
              title={
                wsStat === 'offline' && lastCloseInfo()
                  ? `${lastCloseInfo()!.code} ${lastCloseInfo()!.reason}`.trim()
                  : undefined
              }
            >
              {wsStat === 'connecting' ? t('shell.connecting') : t('shell.offline')}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-sm">
          <button
            onClick={() => setProfileModal(true)}
            className="flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-paper-300 transition-colors hover:bg-night-800 hover:text-paper-100"
            title={t('shell.profile')}
            aria-label={t('shell.profile')}
          >
            {user && <Avatar userId={user.id} label={user.nick} size={22} srcOverride={user.avatar_updated_at ? undefined : null} />}
            <span className="hidden sm:inline">{user?.nick}</span>
          </button>
          <button
            onClick={() => setSettingsModal(true)}
            className="btn-ghost !px-2 !py-1 !text-xs"
            title={t('settings.title')}
            aria-label={t('settings.title')}
          >
            <SettingsIcon size={13} />
            <span className="hidden md:inline">{t('settings.title')}</span>
          </button>
          <LocalePicker variant="icon" />
          <button onClick={() => void logout()} className="btn-ghost !px-2 !py-1 !text-xs" title={t('shell.logoutTitle')}>
            <LogOut size={13} />
            <span className="hidden md:inline">{t('shell.logout')}</span>
          </button>
        </div>
      </header>

      {/* tek seferlik masaüstü bildirim teklifi — tarayıcı kendi prompt'unu
          gösterebileceği ('default') durumda sorulur, bir daha asla */}
      {notifPrompt && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-brass-600/40 bg-lamp-100/70 px-3 py-2">
          <Bell size={14} className="shrink-0 text-lamp-500" aria-hidden />
          <span className="min-w-0 flex-1 text-sm text-lamp-300">
            {notifHint ?? t('shell.notifAsk')}
          </span>
          {!notifHint && (
            <>
              <button
                onClick={() => {
                  void Notification.requestPermission().then((perm) => {
                    useSettingsStore.getState().markDesktopAsked();
                    if (perm === 'granted') {
                      useSettingsStore.getState().enableDesktop();
                      setNotifPrompt(false);
                    } else {
                      setNotifHint(t('shell.notifNotGranted'));
                    }
                  });
                }}
                className="btn-lamp !py-1 !text-xs"
              >
                {t('shell.notifYes')}
              </button>
              <button
                onClick={() => {
                  useSettingsStore.getState().markDesktopAsked();
                  setNotifPrompt(false);
                }}
                className="btn-ghost !py-1 !text-xs"
              >
                {t('shell.notifLater')}
              </button>
            </>
          )}
          {notifHint && (
            <button onClick={() => setNotifPrompt(false)} className="btn-ghost !py-1 !text-xs">
              {t('shell.notifOk')}
            </button>
          )}
        </div>
      )}

      {/* anahtar defteri çelişkisi — zincir kopmuş / yeniden yazılmış /
          kimliğimiz başka anahtarla yayınlanıyor: bariz kırmızı */}
      {keylogWarning && (
        <div className="shrink-0 border-b border-stamp-500/70 bg-stamp-100 px-3 py-1.5">
          <p className="text-xs font-semibold text-stamp-400">
            {t('shell.keylogWarning', { message: keylogWarning })}
          </p>
        </div>
      )}

      {/* dh_update self-update duyurusu imza doğrulamasını geçemedi (Faz 5d) —
          aynı kırmızı bant altyapısı */}
      {dhUpdateWarning && (
        <div className="shrink-0 border-b border-stamp-500/70 bg-stamp-100 px-3 py-1.5">
          <p className="text-xs font-semibold text-stamp-400">{t('shell.dhUpdateWarning')}</p>
        </div>
      )}

      {/* Faz 6: başka bir istemci farklı anahtar defteri head'i gördü —
          fork kanıtı (gözlemsel). Daha düşük panik tonu, farklı eylem
          önerisi (bant dışı damga karşılaştırması) */}
      {keylogForkWarning && (
        <div className="shrink-0 border-b border-stamp-500/70 bg-stamp-100 px-3 py-1.5">
          <p className="text-xs font-semibold text-stamp-400">{t('shell.keylogForkWarning')}</p>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* desktop rails */}
        <div className="hidden lg:flex">
          <ServerRail />
          {view === 'community' && <ChannelSidebar />}
          {view === 'dm' && <DmSidebar />}
        </div>

        {view === 'dm' ? (
          <main className={`flex min-w-0 flex-1 ${isDmCall && !isCallMinimized && showCallChat ? 'flex-row' : 'flex-col'}`}>
            {isDmCall && !isCallMinimized ? (
              // Discord mantığı: sohbet varsayılan KAPALI — video önceliklidir.
              // Kullanıcı CallView'daki düğmeyle açınca sağda belirir.
              <>
                <CallView showChat={showCallChat} onToggleChat={() => setShowCallChat((v) => !v)} />
                {showCallChat && activeDm && (
                  <div className="hidden w-80 shrink-0 flex-col border-l border-night-700 md:flex">
                    <DmChat dmId={activeDm.id} />
                  </div>
                )}
              </>
            ) : activeDm ? (
              <DmChat dmId={activeDm.id} />
            ) : (
              <DmHome />
            )}
          </main>
        ) : (
          <main className="flex min-w-0 flex-1 flex-col">
            {!loaded ? (
              <div className="flex flex-1 items-center justify-center text-paper-500">{t('shell.loading')}</div>
            ) : channel ? (
              channel.type === 'text' ? (
                <ChatView channelId={channel.id} channelName={channel.name} />
              ) : (
                <VoiceRoom channelId={channel.id} channelName={channel.name} />
              )
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-paper-500">
                {t('shell.selectCommunity')}
              </div>
            )}
          </main>
        )}
        {view === 'community' && (
          <div className="hidden xl:flex">
            <MemberList />
          </div>
        )}
      </div>

      {/* mobile drawer — rail + channels as one pull-out sorting tray */}
      {navOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="presentation">
          <div className="absolute inset-0 bg-night-950/80" onClick={closeNav} />
          <div className="absolute inset-y-0 left-0 flex animate-seal-in border-r border-brass-700/70 bg-night-900 shadow-[0_0_60px_rgba(0,0,0,0.7)]">
            <ServerRail onNavigate={closeNav} />
            {view === 'community' && <ChannelSidebar onNavigate={closeNav} />}
            {view === 'dm' && <DmSidebar onNavigate={closeNav} />}
          </div>
        </div>
      )}

      {profileModal && <ProfileModal onClose={() => setProfileModal(false)} />}
      {settingsModal && <SettingsModal onClose={() => setSettingsModal(false)} />}
      {deviceOffer && <DeviceLockModal onClose={() => setDeviceOffer(false)} />}
      <InvitePrompt />
      {showPiP && <PiPWidget />}
      {room && (
        <RoomContext.Provider value={room}>
          <GlobalCallAudio />
        </RoomContext.Provider>
      )}
      <IncomingCall />
    </div>
  );
}
