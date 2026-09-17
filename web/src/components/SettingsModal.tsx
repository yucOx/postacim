import { useEffect, useState } from 'react';
import {
  Bell,
  BellOff,
  Check,
  Fingerprint,
  KeyRound,
  MonitorUp,
  RefreshCcw,
  ShieldCheck,
  User,
  X,
} from 'lucide-react';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';
import ProfileModal from './ProfileModal';
import { useSettingsStore } from '../state/settingsStore';
import { useI18nStore } from '../i18n/store';
import { LOCALES, LOCALE_LABEL, LOCALE_FLAG, type Locale } from '../i18n/types';
import { useT } from '../i18n/I18nProvider';
import { useAuthStore } from '../state/authStore';
import { useAppStore } from '../state/appStore';
import { useSecurityStore } from '../state/securityStore';
import { wsSend } from '../ws/socket';
import { newDhEphemeral } from '../crypto/dhratchet';
import { encodeDhUpdatePayload } from '../lib/dhupdate';
import { generateMnemonic, quizPositions } from '../crypto/bip39';
import { deviceUnlockSupported, hasDeviceUnlock } from '../crypto/devicekey';

type Tab = 'account' | 'security' | 'notifications';

/** Kapsamlı ayarlar: Hesap (profil özet + anahtar defteri durumu), Güvenlik
 *  (passkey, kurtarma ifadesi, şifre değiştir), Bildirimler (ses, masaüstü,
 *  dil). Header'daki ⚙️ butonu bu modalı açar. Passkey yönetimi aynı
 *  zamanda ProfileModal'da da var — iki yol erişim, sıfır gizli alan. */
export default function SettingsModal({ onClose }: { onClose: () => void }): React.ReactNode {
  const { t } = useT();
  const [tab, setTab] = useState<Tab>('account');
  return (
    <Modal title={t('settings.title')} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="flex shrink-0 gap-1 border-b border-night-700">
          <TabBtn id="account" current={tab} onPick={setTab} icon={<User size={13} />}>
            {t('settings.tabs.account')}
          </TabBtn>
          <TabBtn id="security" current={tab} onPick={setTab} icon={<ShieldCheck size={13} />}>
            {t('settings.tabs.security')}
          </TabBtn>
          <TabBtn id="notifications" current={tab} onPick={setTab} icon={<Bell size={13} />}>
            {t('settings.tabs.notifications')}
          </TabBtn>
        </div>
        {tab === 'account' && <AccountTab />}
        {tab === 'security' && <SecurityTab />}
        {tab === 'notifications' && <NotificationsTab />}
      </div>
    </Modal>
  );
}

function TabBtn({
  id,
  current,
  onPick,
  icon,
  children,
}: {
  id: Tab;
  current: Tab;
  onPick: (t: Tab) => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}): React.ReactNode {
  const active = id === current;
  return (
    <button
      type="button"
      onClick={() => onPick(id)}
      className={`flex items-center gap-1.5 border-b-2 px-2.5 py-1.5 text-xs transition-colors ${
        active
          ? 'border-lamp-500 text-paper-50'
          : 'border-transparent text-paper-500 hover:text-paper-200'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

// ---------- Hesap sekmesi ----------

function AccountTab(): React.ReactNode {
  const { t } = useT();
  const user = useAuthStore((s) => s.user);
  const keylogStamp = useSecurityStore((s) => s.keylogStamp);
  const keylogWarning = useSecurityStore((s) => s.keylogWarning);
  const [profileOpen, setProfileOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-night-700 bg-night-900 p-3 text-sm text-paper-200">
        <div className="font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-paper-500">
          {t('settings.account.profileBtn')}
        </div>
        <p className="mt-0.5 text-xs text-paper-500">{t('settings.account.profileHint')}</p>
        <div className="mt-2 flex items-center gap-2 text-sm text-paper-200">
          <User size={14} className="text-paper-500" />
          <span className="font-mono">{user?.nick}</span>
        </div>
        <button
          type="button"
          onClick={() => setProfileOpen(true)}
          className="btn-ghost mt-3 !text-xs"
        >
          {t('settings.account.profileBtn')}
        </button>
      </div>
      <div className="rounded-md border border-night-700 bg-night-900 p-3 text-sm">
        <div className="font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-paper-500">
          {t('settings.account.keylogTitle')}
        </div>
        {keylogWarning ? (
          <p className="mt-1 text-xs text-stamp-400">{keylogWarning}</p>
        ) : (
          <p className="mt-1 text-xs text-lamp-300">
            {keylogStamp ? t('settings.account.keylogOk') : '—'}
          </p>
        )}
      </div>
      {profileOpen && (
        <ProfileModalInline onClose={() => setProfileOpen(false)} />
      )}
    </div>
  );
}

// ProfileModal'ı içeri gömüyoruz — Hesap sekmesinden "Profili düzenle"
// basınca ProfileModal açılır, kapatınca Hesap sekmesine döner.
function ProfileModalInline({ onClose }: { onClose: () => void }): React.ReactNode {
  return <ProfileModal onClose={onClose} />;
}

// ---------- Güvenlik sekmesi ----------

function SecurityTab(): React.ReactNode {
  const { t } = useT();
  const [section, setSection] = useState<'main' | 'recovery' | 'password'>('main');
  if (section === 'recovery') return <RecoveryInline onBack={() => setSection('main')} />;
  if (section === 'password') return <PasswordInline onBack={() => setSection('main')} />;
  return (
    <div className="flex flex-col gap-3">
      <PasskeyBlock />
      <hr className="border-night-700" />
      <DhIdBlock />
      <button
        type="button"
        onClick={() => setSection('recovery')}
        className="flex items-center gap-2.5 rounded border border-night-700 bg-night-900 px-3 py-2 text-left transition-colors hover:border-brass-600"
      >
        <ShieldCheck size={16} className="text-paper-500" />
        <span className="flex-1">
          <span className="block text-sm text-paper-100">{t('settings.security.recoveryBtn')}</span>
          <span className="block text-xs text-paper-500">{t('settings.security.recoveryHint')}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => setSection('password')}
        className="flex items-center gap-2.5 rounded border border-night-700 bg-night-900 px-3 py-2 text-left transition-colors hover:border-brass-600"
      >
        <KeyRound size={16} className="text-paper-500" />
        <span className="flex-1">
          <span className="block text-sm text-paper-100">{t('settings.security.passwordBtn')}</span>
          <span className="block text-xs text-paper-500">{t('settings.security.passwordHint')}</span>
        </span>
      </button>
    </div>
  );
}

function PasskeyBlock(): React.ReactNode {
  const { t } = useT();
  const enrollDeviceUnlock = useAuthStore((s) => s.enrollDeviceUnlock);
  const removeDeviceUnlock = useAuthStore((s) => s.removeDeviceUnlock);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [active, setActive] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!(await deviceUnlockSupported())) {
        if (alive) setSupported(false);
        return;
      }
      if (!alive) return;
      setSupported(true);
      setActive(await hasDeviceUnlock());
    })();
    return () => {
      alive = false;
    };
  }, []);

  const onToggle = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (active) await removeDeviceUnlock();
      else await enrollDeviceUnlock();
      setActive(!active);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('deviceLock.fail'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-night-700 bg-night-900 p-3">
      <div className="flex items-start gap-2.5">
        <Fingerprint size={18} className="mt-0.5 shrink-0 text-lamp-500" />
        <div className="flex-1">
          <div className="text-sm text-paper-100">{t('settings.security.passkeyTitle')}</div>
          <p className="mt-0.5 text-[11px] text-paper-500">
            {t('settings.security.passkeyHint')}
          </p>
        </div>
      </div>
      {supported === false && (
        <p className="mt-2 text-[11px] text-paper-500">{t('settings.security.passkeyUnsupported')}</p>
      )}
      {supported && (
        <div className="mt-3 flex items-center gap-2">
          <span
            className={`rounded px-1.5 py-0.5 font-display text-[10px] font-semibold uppercase tracking-[0.14em] ${
              active ? 'bg-lamp-100 text-lamp-300' : 'bg-night-700 text-paper-500'
            }`}
          >
            {active ? t('settings.on') : t('settings.off')}
          </span>
          <span className="flex-1 text-xs text-paper-300">
            {active ? t('settings.security.passkeyOn') : t('settings.security.passkeyOff')}
          </span>
          <button
            type="button"
            onClick={() => void onToggle()}
            disabled={busy}
            className={active ? 'btn-ghost !text-xs' : 'btn-lamp !text-xs'}
          >
            {busy ? '…' : active ? t('settings.security.passkeyRemove') : t('settings.security.passkeyEnroll')}
          </button>
        </div>
      )}
      {error && (
        <p className="mt-2 rounded border border-stamp-500/60 bg-stamp-100 px-2 py-1 text-xs text-stamp-400">
          {error}
        </p>
      )}
    </div>
  );
}

// Faz 5d — self-update: ele geçirilme şüphesinde yeni bir DH anahtarı üretilip
// tüm DM/grup DM/kanal bağlamlarına Ed25519 imzalı dh_update duyurusu olarak
// yayınlanır (WS opak relay). Alıcılar doğrulayıp TOFU pin'ler — duyuru
// sonrasındaki DH adımları eski (ele geçirilmiş) cihazın anahtarına bağlı kalmaz.
function DhIdBlock(): React.ReactNode {
  const { t } = useT();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const publish = (): void => {
    setBusy(true);
    setError(null);
    try {
      const auth = useAuthStore.getState();
      if (!auth.user || !auth.signPrivateKey) throw new Error(t('settings.security.dhIdNoSignKey'));
      const app = useAppStore.getState();
      const targets = [
        ...app.dms.map((d) => ({ id: d.id, version: d.key_version })),
        ...app.gdms.map((g) => ({ id: g.id, version: g.key_version })),
        ...app.communities.flatMap((c) => c.channels.map((ch) => ({ id: ch.id, version: ch.key_version }))),
      ];
      // tek taze ephemeral, tüm bağlamlarda aynı kimlik — karşı tarafın pin'i
      // tutarlı olur; private yarım duyurulan an atılır (asla kaydedilmez)
      const pub = newDhEphemeral().publicKey;
      for (const tg of targets) {
        wsSend({
          type: 'dh_update',
          channel_id: tg.id,
          payload: encodeDhUpdatePayload(tg.id, tg.version, pub, auth.signPrivateKey),
        });
      }
      setSent(targets.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.security.dhIdFail'));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div className="rounded-md border border-night-700 bg-night-900 p-3">
      <div className="flex items-start gap-2.5">
        <RefreshCcw size={18} className="mt-0.5 shrink-0 text-lamp-500" />
        <div className="flex-1">
          <div className="text-sm text-paper-100">{t('settings.security.dhIdTitle')}</div>
          <p className="mt-0.5 text-[11px] text-paper-500">{t('settings.security.dhIdHint')}</p>
        </div>
      </div>
      {sent != null && (
        <p className="mt-2 rounded border border-lamp-500/60 bg-lamp-100/40 px-2 py-1 text-xs text-lamp-300">
          {t('settings.security.dhIdDone', { count: sent })}
        </p>
      )}
      {error && (
        <p className="mt-2 rounded border border-stamp-500/60 bg-stamp-100 px-2 py-1 text-xs text-stamp-400">
          {error}
        </p>
      )}
      <button type="button" onClick={() => setConfirming(true)} disabled={busy} className="btn-ghost mt-3 !text-xs">
        {t('settings.security.dhIdBtn')}
      </button>
      {confirming && (
        <DhIdConfirm
          onConfirm={publish}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

// hedef sayısı onay metninde görünür — ne yayinlanacağı onaydan önce bellidir
function DhIdConfirm({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }): React.ReactNode {
  const { t } = useT();
  const app = useAppStore.getState();
  const count =
    app.dms.length + app.gdms.length + app.communities.reduce((n, c) => n + c.channels.length, 0);
  return (
    <ConfirmDialog
      title={t('settings.security.dhIdConfirmTitle')}
      message={t('settings.security.dhIdConfirmMsg', { count })}
      confirmLabel={t('settings.security.dhIdBtn')}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

// Kurtarma ifadesi — Shell'teki RecoveryModal'ın iç mantığı (aynı 3 faz)
function RecoveryInline({ onBack }: { onBack: () => void }): React.ReactNode {
  const { t } = useT();
  const setupRecovery = useAuthStore((s) => s.setupRecovery);
  const [phase, setPhase] = useState<'show' | 'quiz' | 'done'>('show');
  const [words, setWords] = useState<string[] | null>(null);
  useEffect(() => {
    void generateMnemonic().then(setWords);
  }, []);
  const [quiz] = useState(() => quizPositions());
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const quizOk =
    !!words && quiz.every((i) => (answers[i] ?? '').trim().toLowerCase() === words[i]?.toLowerCase());

  const download = (): void => {
    if (!words) return;
    const txt =
      `postacim kurtarma ifadesi\n\n${words.join(' ')}\n\n` +
      `Bu 12 kelime hesabını geri getiren tek şeydir. Kimselerle paylaşma,\n` +
      `ekran görüntüsü alma. Kağıda yaz, kilitli bir yerde sakla.\n`;
    const url = URL.createObjectURL(new Blob([txt], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'postacim-kurtarma.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const finish = async (): Promise<void> => {
    if (!words) return;
    setBusy(true);
    setError(null);
    try {
      await setupRecovery(words);
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('recovery.fail'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 self-start text-xs text-paper-500 transition-colors hover:text-paper-200"
        title={t('recovery.backToWords')}
      >
        <X size={12} /> {t('settings.tabs.security')}
      </button>
      {phase === 'show' && (
        <>
          <p className="text-xs text-paper-500">{t('recovery.intro')}</p>
          <div className="grid grid-cols-3 gap-1.5">
            {(words ?? Array.from({ length: 12 }, () => '…')).map((w, i) => (
              <div
                key={i}
                className="flex items-baseline gap-1 rounded-sm border border-brass-700/40 bg-paper-50 px-1.5 py-1 text-night-950"
              >
                <span className="font-display text-[9px] font-semibold text-brass-700">{i + 1}</span>
                <span className="select-all font-mono text-xs font-medium">{w}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={download} className="btn-ghost flex-1">{t('recovery.download')}</button>
            <button onClick={() => setPhase('quiz')} disabled={!words} className="btn-lamp flex-1">
              {t('recovery.savedContinue')}
            </button>
          </div>
        </>
      )}
      {phase === 'quiz' && (
        <>
          <p className="text-sm text-paper-300">{t('recovery.positionsPrompt', { positions: quiz.map((i) => i + 1).join(', ') })}</p>
          {quiz.map((i) => (
            <label key={i} className="flex items-center gap-2 text-sm">
              <span className="w-14 shrink-0 text-paper-500">{t('recovery.wordLabel', { n: i + 1 })}</span>
              <input
                value={answers[i] ?? ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [i]: e.target.value }))}
                className="input font-mono"
                spellCheck={false}
              />
            </label>
          ))}
          <button onClick={() => void finish()} disabled={!quizOk || busy} className="btn-lamp">
            {busy ? t('recovery.saving') : t('recovery.save')}
          </button>
          <button onClick={() => setPhase('show')} className="text-xs text-paper-500 transition-colors hover:text-paper-300">
            {t('recovery.backToWords')}
          </button>
        </>
      )}
      {phase === 'done' && (
        <>
          <p className="text-sm text-lamp-300">{t('recovery.success')}</p>
          <button onClick={onBack} className="btn-lamp">{t('recovery.ok')}</button>
        </>
      )}
      {error && <p className="text-sm text-stamp-400">{error}</p>}
    </div>
  );
}

function PasswordInline({ onBack }: { onBack: () => void }): React.ReactNode {
  const { t } = useT();
  const changePassword = useAuthStore((s) => s.changePassword);
  const logout = useAuthStore((s) => s.logout);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (): Promise<void> => {
    if (newPw !== newPw2) {
      setError(t('settings.security.passwordMismatch'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changePassword(oldPw, newPw);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'hata');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 self-start text-xs text-paper-500 transition-colors hover:text-paper-200"
      >
        <X size={12} /> {t('settings.tabs.security')}
      </button>
      {done ? (
        <>
          <p className="text-sm text-lamp-300">{t('settings.security.passwordSuccess')}</p>
          <button onClick={() => void logout().finally(onBack)} className="btn-lamp">
            {t('settings.security.passwordBackToLogin')}
          </button>
        </>
      ) : (
        <>
          <input
            type="password"
            autoFocus
            value={oldPw}
            onChange={(e) => setOldPw(e.target.value)}
            placeholder={t('settings.security.passwordOld')}
            className="input"
          />
          <input
            type="password"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            placeholder={t('settings.security.passwordNew')}
            minLength={6}
            className="input"
          />
          <input
            type="password"
            value={newPw2}
            onChange={(e) => setNewPw2(e.target.value)}
            placeholder={t('settings.security.passwordNewRepeat')}
            minLength={6}
            className="input"
          />
          {error && <p className="text-sm text-stamp-400">{error}</p>}
          <button
            onClick={() => void submit()}
            disabled={busy || !oldPw || newPw.length < 6}
            className="btn-lamp"
          >
            {busy ? t('settings.security.passwordBusy') : t('settings.security.passwordSubmit')}
          </button>
        </>
      )}
    </div>
  );
}

// ---------- Bildirimler sekmesi ----------

function NotificationsTab(): React.ReactNode {
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
