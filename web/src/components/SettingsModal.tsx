import { useEffect, useState } from 'react';
import {
  Bell,
  BellOff,
  Check,
  Fingerprint,
  KeyRound,
  MonitorUp,
  Monitor,
  Play,
  RefreshCcw,
  ShieldCheck,
  Trash2,
  User,
  Video,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';
import ProfileModal from './ProfileModal';
import CallQualityPicker from './CallQualityPicker';
import { DeviceSettingsBlock } from './DeviceMenu';
import { playSound } from '../lib/sound';
import { useSettingsStore, type SoundKey } from '../state/settingsStore';
import { useI18nStore } from '../i18n/store';
import { LOCALES, LOCALE_LABEL, LOCALE_FLAG, type Locale } from '../i18n/types';
import { useT } from '../i18n/I18nProvider';
import { useAuthStore } from '../state/authStore';
import { useAppStore } from '../state/appStore';
import { useSecurityStore } from '../state/securityStore';
import { useDeviceStore, type DeviceInfo } from '../state/deviceStore';
import { wsSend } from '../ws/socket';
import { newDhEphemeral } from '../crypto/dhratchet';
import { encodeDhUpdatePayload } from '../lib/dhupdate';
import { generateMnemonic, quizPositions } from '../crypto/bip39';
import { deviceUnlockSupported, hasDeviceUnlock } from '../crypto/devicekey';
import { generateIdentity, generateSignIdentity, sealIdentityBlob } from '../crypto/identity';
import { b64, unb64 } from '../crypto/bytes';
import { shortFingerprint } from '../crypto/fingerprint';

type Tab = 'account' | 'security' | 'devices' | 'notifications' | 'media';

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
          <TabBtn id="devices" current={tab} onPick={setTab} icon={<Monitor size={13} />}>
            {t('settings.tabs.devices')}
          </TabBtn>
          <TabBtn id="notifications" current={tab} onPick={setTab} icon={<Bell size={13} />}>
            {t('settings.tabs.notifications')}
          </TabBtn>
          <TabBtn id="media" current={tab} onPick={setTab} icon={<Video size={13} />}>
            {t('settings.tabs.media')}
          </TabBtn>
        </div>
        {tab === 'account' && <AccountTab />}
        {tab === 'security' && <SecurityTab />}
        {tab === 'devices' && <DevicesTab />}
        {tab === 'notifications' && <NotificationsTab />}
        {tab === 'media' && <MediaTab />}
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

// ---------- Cihazlar sekmesi ----------

function DevicesTab(): React.ReactNode {
  const { t } = useT();
  const devices = useDeviceStore((s) => s.devices);
  const pendingLink = useDeviceStore((s) => s.pendingLink);
  const ownLinkInProgress = useDeviceStore((s) => s.ownLinkInProgress);
  const loadDevices = useDeviceStore((s) => s.loadDevices);
  const revokeDevice = useDeviceStore((s) => s.revokeDevice);
  const [linkMode, setLinkMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<DeviceInfo | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (devices.length === 0) void loadDevices();
  }, [devices.length, loadDevices]);

  // primary onay/red modalı otomatik açılır
  useEffect(() => {
    if (pendingLink) setLinkMode(true);
  }, [pendingLink]);

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-md border border-night-700 bg-night-900 p-3 text-sm">
        <div className="flex items-start gap-2.5">
          <Monitor size={18} className="mt-0.5 shrink-0 text-lamp-500" />
          <div className="flex-1">
            <div className="text-sm text-paper-100">{t('settings.devices.title')}</div>
            <p className="mt-0.5 text-[11px] text-paper-500">{t('settings.devices.hint')}</p>
          </div>
        </div>
      </div>

      {error && (
        <p className="rounded border border-stamp-500/60 bg-stamp-100 px-2 py-1 text-xs text-stamp-400">
          {error}
        </p>
      )}
      {success && (
        <p className="rounded border border-lamp-500/60 bg-lamp-100/40 px-2 py-1 text-xs text-lamp-300">
          {success}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        {devices.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-paper-500">{t('settings.devices.noDevices')}</p>
        ) : (
          devices.map((d) => (
            <DeviceRow
              key={d.id}
              device={d}
              onRevoke={(dev) => setRevoking(dev)}
            />
          ))
        )}
      </div>

      <button
        type="button"
        onClick={() => setLinkMode(true)}
        disabled={ownLinkInProgress || busy}
        className="btn-lamp !text-xs"
      >
        {ownLinkInProgress ? t('settings.devices.linkInProgress') : t('settings.devices.linkBtn')}
      </button>

      {linkMode && (
        <LinkModal
          onClose={() => {
            setLinkMode(false);
            useDeviceStore.getState().setPendingLink(null);
          }}
          onError={(e) => setError(e)}
        />
      )}
      {revoking && (
        <RevokeConfirm
          device={revoking}
          onConfirm={async () => {
            setBusy(true);
            setError(null);
            try {
              await revokeDevice(revoking.id);
              setSuccess(t('settings.devices.revokeDone'));
            } catch (e) {
              setError(e instanceof Error ? e.message : t('settings.devices.revokeFailed'));
            } finally {
              setBusy(false);
              setRevoking(null);
            }
          }}
          onCancel={() => setRevoking(null)}
          busy={busy}
        />
      )}
    </div>
  );
}

function DeviceRow({ device, onRevoke }: { device: DeviceInfo; onRevoke: (d: DeviceInfo) => void }): React.ReactNode {
  const { t } = useT();
  return (
    <div className="flex items-center gap-2.5 rounded border border-night-700 bg-night-900 px-3 py-2">
      <Monitor size={16} className="shrink-0 text-paper-500" />
      <div className="flex-1 text-sm">
        <div className="text-paper-100">
          {device.name}
          {device.is_primary === 1 && (
            <span className="ml-1.5 rounded bg-lamp-100 px-1 py-0.5 font-display text-[9px] font-semibold uppercase tracking-[0.14em] text-lamp-300">
              {t('settings.devices.primary')}
            </span>
          )}
        </div>
        <div className="text-[10px] text-paper-500">
          {shortFingerprint(unb64(device.x25519_public_key))} ·{' '}
          {t('settings.devices.linkedAt', { when: new Date(device.linked_at).toLocaleDateString() })}
        </div>
      </div>
      {device.is_primary !== 1 && (
        <button
          type="button"
          onClick={() => onRevoke(device)}
          className="btn-ghost !text-xs"
          aria-label={t('settings.devices.revokeBtn')}
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}

// Primary cihazda: device:link_request WS event'i tetikler, bu modal otomatik
// açılır (pendingLink state). Joinee tarafında: yeni cihaz butonu modal açar,
// yeni keypair üretip sunucuya /devices/link/start gönderir, sonra
// device:link_approved event'ini dinler.
function LinkModal({ onClose, onError }: { onClose: () => void; onError: (e: string) => void }): React.ReactNode {
  const { t } = useT();
  const pendingLink = useDeviceStore((s) => s.pendingLink);
  const approveLink = useDeviceStore((s) => s.approveLink);
  const declineLink = useDeviceStore((s) => s.declineLink);
  const finishLink = useDeviceStore((s) => s.finishLink);
  const auth = useAuthStore.getState();
  const loadBootstrap = useAppStore((s) => s.loadBootstrap);
  const [phase, setPhase] = useState<'idle' | 'starting' | 'waiting' | 'approved' | 'completed'>(
    pendingLink ? 'approved' : 'idle',
  );
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [approved, setApproved] = useState<{ link_token: string; approval: string } | null>(null);
  const [completed, setCompleted] = useState<string | null>(null);

  // primary onay akışı: pendingLink göründüğünde otomatik onay butonu aç
  if (pendingLink && phase === 'idle') setPhase('approved');

  // joinee: başlat butonu
  const start = async (): Promise<void> => {
    setPhase('starting');
    onError('');
    try {
      // 1) yeni cihaz keypair + deviceId üret
      const id = generateIdentity();
      const sign = generateSignIdentity();
      const newDeviceId = window.crypto.getRandomValues(new Uint8Array(16));
      // joinee'in kimliğini client-side üretiyoruz; sunucuya yalnız
      // public key'leri + link_token yazacağız
      // ephemeral keypair linking için
      const eph = newDhEphemeral();
      const r = await fetch('/api/devices/link/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.user ? '' : ''}`, // cookie tabanlı
        },
        body: JSON.stringify({ name: 'new device', ephemeral_pub: b64(eph.publicKey) }),
        credentials: 'same-origin',
      });
      if (!r.ok) throw new Error(`link start: ${r.status}`);
      const j = (await r.json()) as { link_token: string };
      setLinkToken(j.link_token);
      // joinee'in kendi public key'lerini geçici sakla (finish'te kullanılacak)
      sessionStorage.setItem(
        'pgv:device-link',
        JSON.stringify({
          link_token: j.link_token,
          x25519_pub: b64(id.publicKey),
          ed25519_pub: b64(sign.signPublicKey),
          x25519_priv: b64(id.privateKey),
          ed25519_priv: b64(sign.signPrivateKey),
          device_id: b64(newDeviceId),
          eph_priv: b64(eph.privateKey),
        }),
      );
      setPhase('waiting');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'link start failed');
      setPhase('idle');
    }
  };

  // joinee: device:link_approved event'ini dinle
  useEffect(() => {
    if (phase !== 'waiting') return;
    const handler = (ev: Event): void => {
      const detail = (ev as CustomEvent<{ link_token: string; approval: string }>).detail;
      setApproved(detail);
      setPhase('approved');
    };
    window.addEventListener('pgv:device-link-approved', handler);
    return () => window.removeEventListener('pgv:device-link-approved', handler);
  }, [phase]);

  // joinee: approval geldi → finishLink
  useEffect(() => {
    if (phase !== 'approved' || !approved || pendingLink) return;
    void (async () => {
      try {
        const stored = sessionStorage.getItem('pgv:device-link');
        if (!stored) throw new Error('link state lost');
        const parsed = JSON.parse(stored) as {
          link_token: string;
          x25519_pub: string;
          ed25519_pub: string;
        };
        if (parsed.link_token !== approved.link_token) return;
        const j = await finishLink({
          link_token: approved.link_token,
          x25519_public_key: parsed.x25519_pub,
          ed25519_public_key: parsed.ed25519_pub,
        });
        setCompleted(j.device_id);
        setPhase('completed');
        await loadBootstrap();
      } catch (e) {
        onError(e instanceof Error ? e.message : 'finish failed');
        setPhase('idle');
      }
    })();
  }, [phase, approved, pendingLink, finishLink, loadBootstrap, onError]);

  // primary: pendingLink göründüğünde approval üret
  const approve = async (): Promise<void> => {
    if (!pendingLink) return;
    // primary kendi X25519 private + joinee ephemeral pub → shared secret;
    // Ed25519 imzasıyla approval üret. MVP: basit imza.
    // (Production: shared secret'i HKDF ile türet, imzaya nonce ekle.)
    try {
      const myPriv = auth.privateKey;
      const mySign = auth.signPrivateKey;
      if (!myPriv || !mySign) throw new Error('imza anahtarı yok');
      const ephPub = unb64(pendingLink.ephemeral_pub);
      // shared secret türet
      const { sodium } = await import('../crypto/sodium');
      await sodium;
      const shared = sodium.crypto_scalarmult(myPriv, ephPub);
      // approval = sign(shared || ephemeral_pub)
      const enc = new TextEncoder();
      const msg = enc.encode(b64(shared) + pendingLink.ephemeral_pub);
      const sig = sodium.crypto_sign_detached(msg, mySign);
      // primary'ın kendi public key'ini de ekleyelim ki joinee DH'yi türetebilsin
      const myPub = auth.publicKey;
      if (!myPub) throw new Error('public key yok');
      const approval = b64(sig) + '.' + b64(myPub);
      await approveLink(pendingLink.device_id, approval);
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'approve failed');
    }
  };

  if (pendingLink) {
    // primary onay modu
    return (
      <Modal title={t('settings.devices.linkRequestTitle')} onClose={onClose}>
        <div className="flex w-80 flex-col gap-3 text-sm text-paper-200">
          <p>{t('settings.devices.linkRequestBody', { name: pendingLink.device_name })}</p>
          <p className="text-[11px] text-paper-500">{t('settings.devices.linkRequestHint')}</p>
          <div className="rounded border border-night-700 bg-night-950 px-3 py-2 font-mono text-xs text-lamp-300">
            {shortFingerprint(unb64(pendingLink.ephemeral_pub))}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost flex-1">{t('settings.devices.linkDecline')}</button>
            <button
              onClick={() => void approve()}
              className="btn-lamp flex-1"
            >
              {t('settings.devices.linkApprove')}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  // joinee akışı
  if (phase === 'idle') {
    return (
      <Modal title={t('settings.devices.linkBtn')} onClose={onClose}>
        <div className="flex w-80 flex-col gap-3 text-sm text-paper-200">
          <p className="text-[11px] text-paper-500">
            Bu cihazda yeni bir hesap bağlantısı başlatılır. Diğer cihazınızda bu hesap zaten açık olmalı.
          </p>
          <button onClick={() => void start()} className="btn-lamp">{t('settings.devices.linkBtn')}</button>
          <button onClick={onClose} className="btn-ghost">{t('settings.devices.linkDecline')}</button>
        </div>
      </Modal>
    );
  }
  if (phase === 'starting' || phase === 'waiting') {
    return (
      <Modal title={t('settings.devices.linkBtn')} onClose={onClose}>
        <div className="flex w-80 flex-col gap-3 text-sm text-paper-200">
          <p>{t('settings.devices.linkInProgress')}…</p>
        </div>
      </Modal>
    );
  }
  if (phase === 'completed') {
    return (
      <Modal title={t('settings.devices.linkApprovedTitle')} onClose={onClose}>
        <div className="flex w-80 flex-col gap-3 text-sm text-paper-200">
          <p className="text-lamp-300">{t('settings.devices.linkApprovedBody', { name: 'new device' })}</p>
          <button onClick={onClose} className="btn-lamp">OK</button>
        </div>
      </Modal>
    );
  }
  return null;
}

function RevokeConfirm({
  device,
  onConfirm,
  onCancel,
  busy,
}: {
  device: DeviceInfo;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}): React.ReactNode {
  const { t } = useT();
  return (
    <ConfirmDialog
      title={t('settings.devices.revokeTitle', { name: device.name })}
      message={t('settings.devices.revokeMsg')}
      confirmLabel={busy ? '…' : t('settings.devices.revokeConfirm')}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

// ---------- Bildirimler sekmesi ----------

// ---------- Ses anahtarları ----------

const SOUND_ROWS: { key: SoundKey; label: 'settings.sndMessage' | 'settings.sndMention' | 'settings.sndCall' | 'settings.sndInvite' | 'settings.sndFriend' }[] = [
  { key: 'message', label: 'settings.sndMessage' },
  { key: 'mention', label: 'settings.sndMention' },
  { key: 'call', label: 'settings.sndCall' },
  { key: 'invite', label: 'settings.sndInvite' },
  { key: 'friend', label: 'settings.sndFriend' },
];

/** Her olay için ayrı ses anahtarı + önizleme düğmesi. */
function SoundKeyList(): React.ReactNode {
  const { t } = useT();
  const soundKeys = useSettingsStore((s) => s.soundKeys);
  const toggleSoundKey = useSettingsStore((s) => s.toggleSoundKey);
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-night-700 bg-night-900/60 p-2.5">
      <div>
        <div className="font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-paper-500">
          {t('settings.sounds')}
        </div>
        <p className="text-[11px] text-paper-500">{t('settings.soundsHint')}</p>
      </div>
      {SOUND_ROWS.map(({ key, label }) => (
        <div key={key} className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => toggleSoundKey(key)}
            className="flex flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-night-800"
          >
            {soundKeys[key] ? (
              <Volume2 size={15} className="shrink-0 text-lamp-500" />
            ) : (
              <VolumeX size={15} className="shrink-0 text-paper-500" />
            )}
            <span className="flex-1 text-paper-100">{t(label)}</span>
            <span
              className={`rounded px-1.5 py-0.5 font-display text-[10px] font-semibold uppercase tracking-[0.14em] ${
                soundKeys[key] ? 'bg-lamp-100 text-lamp-300' : 'bg-night-700 text-paper-500'
              }`}
            >
              {soundKeys[key] ? t('settings.on') : t('settings.off')}
            </span>
          </button>
          <button
            type="button"
            onClick={() => playSound(key, true)}
            className="btn-ghost shrink-0 !px-2 !py-1 !text-[10px]"
            title={t('settings.sndTest')}
            aria-label={t('settings.sndTest')}
          >
            <Play size={11} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------- Ses ve Video sekmesi ----------

/** Cihaz seçimi + yayın kalitesi. Çağrı sırasındaki kontrol çubuğundaki
 *  menüyle aynı veriyi gösterir; buradan seçim kalıcıdır. */
function MediaTab(): React.ReactNode {
  const { t } = useT();
  return (
    <div className="flex flex-col gap-3">
      <DeviceSettingsBlock />
      <hr className="border-night-700" />
      <div className="flex flex-col gap-1">
        <span className="font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-paper-500">
          {t('call.quality')}
        </span>
        <span className="text-xs text-paper-500">{t('call.qualityHint')}</span>
        <CallQualityPicker align="start" />
      </div>
    </div>
  );
}

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
      {soundOn && <SoundKeyList />}
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
