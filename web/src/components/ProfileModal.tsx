import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useAuthStore } from '../state/authStore';
import { processAvatarFile, invalidateAvatar } from '../lib/avatar';
import { deviceUnlockSupported, hasDeviceUnlock } from '../crypto/devicekey';
import { useSecurityStore } from '../state/securityStore';
import Avatar from './Avatar';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';
import { SponsorNote } from './SponsorNote';
import { useT } from '../i18n/I18nProvider';

export default function ProfileModal({ onClose }: { onClose: () => void }): React.ReactNode {
  const { t } = useT();
  const user = useAuthStore((s) => s.user);
  // anahtar defteri damgası — head'in kısa parmak izi (bant dışı karşılaştırma için)
  const keylogStamp = useSecurityStore((s) => s.keylogStamp);
  const setAvatar = useAuthStore((s) => s.setAvatar);
  const clearAvatar = useAuthStore((s) => s.clearAvatar);
  const logout = useAuthStore((s) => s.logout);
  const enrollDeviceUnlock = useAuthStore((s) => s.enrollDeviceUnlock);
  const removeDeviceUnlock = useAuthStore((s) => s.removeDeviceUnlock);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewBytes, setPreviewBytes] = useState<number>(0);
  const [hasAvatar, setHasAvatar] = useState<boolean>(user?.avatar_updated_at != null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // cihaz kilidi: destek yoksa bölüm hiç render edilmez
  const [deviceSupported, setDeviceSupported] = useState(false);
  const [deviceActive, setDeviceActive] = useState<boolean | null>(null);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!(await deviceUnlockSupported())) return;
      if (!alive) return;
      setDeviceSupported(true);
      setDeviceActive(await hasDeviceUnlock());
    })();
    return () => {
      alive = false;
    };
  }, []);

  const onDeviceToggle = async (): Promise<void> => {
    setDeviceBusy(true);
    setDeviceError(null);
    try {
      if (deviceActive) await removeDeviceUnlock();
      else await enrollDeviceUnlock();
      setDeviceActive(!deviceActive);
    } catch (err) {
      setDeviceError(err instanceof Error ? err.message : 'işlem başarısız');
    } finally {
      setDeviceBusy(false);
    }
  };

  if (!user) return null;

  const onDeleteAccount = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api('/users/me', { method: 'DELETE' });
      await logout();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'silinemedi');
      setBusy(false);
    }
  };

  const onPick = (): void => fileRef.current?.click();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const processed = await processAvatarFile(file);
      setPreview(processed.dataUrl);
      setPreviewBytes(processed.bytes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'işlenemedi');
    } finally {
      setBusy(false);
    }
  };

  const onPaste = async (e: React.ClipboardEvent<HTMLDivElement>): Promise<void> => {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'));
    if (!item) return;
    const file = item.getAsFile();
    if (!file) return;
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const processed = await processAvatarFile(file);
      setPreview(processed.dataUrl);
      setPreviewBytes(processed.bytes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'işlenemedi');
    } finally {
      setBusy(false);
    }
  };

  const onSave = async (): Promise<void> => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      await setAvatar(preview);
      invalidateAvatar(user.id);
      setHasAvatar(true);
      setPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'kaydedilemedi');
    } finally {
      setBusy(false);
    }
  };

  const onClear = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await clearAvatar();
      invalidateAvatar(user.id);
      setHasAvatar(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'silinemedi');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('profile.title')} onClose={onClose}>
      <div className="flex w-80 flex-col gap-4" onPaste={onPaste}>
        <div className="flex items-center gap-3">
          {preview ? (
            <img
              src={preview}
              alt=""
              width={64}
              height={64}
              className="shrink-0 rounded-sm border border-brass-700/40 object-cover"
            />
          ) : (
            <Avatar userId={user.id} label={user.nick} size={64} srcOverride={hasAvatar ? undefined : null} />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-base font-semibold uppercase tracking-[0.08em] text-paper-50">
              {user.nick}
            </p>
            <p className="text-[11px] text-paper-500">
              {preview
                ? t('profile.avatarSize', { kb: (previewBytes / 1024).toFixed(1) })
                : hasAvatar
                  ? t('profile.avatarLoaded')
                  : t('profile.noAvatar')}
            </p>
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={(e) => void onFile(e)}
          className="hidden"
        />

        {keylogStamp && (
          <div className="rounded-sm border border-brass-700/40 bg-night-950/70 px-3 py-2">
            <p className="font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-paper-500">
              {t('profile.keylogStamp')}
            </p>
            <p className="select-all font-mono text-sm font-semibold tracking-[0.08em] text-lamp-300">
              {keylogStamp}
            </p>
            <p className="mt-0.5 text-[11px] text-paper-500">
              {t('profile.keylogHint')}
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button onClick={onPick} disabled={busy} className="btn-ghost">
            {t('profile.pickFile')}
          </button>
          {preview && (
            <button onClick={() => void onSave()} disabled={busy} className="btn-lamp">
              {busy ? t('profile.saving') : t('profile.save')}
            </button>
          )}
          {hasAvatar && !preview && (
            <button onClick={() => void onClear()} disabled={busy} className="btn-ghost hover:!border-stamp-500/70 hover:!text-stamp-400">
              {t('profile.removeAvatar')}
            </button>
          )}
        </div>

        <p className="text-[11px] text-paper-500">
          {t('profile.pasteHint')}
        </p>

        {deviceSupported && deviceActive !== null && (
          <div className="mt-2 border-t border-night-700 pt-3">
            <button
              type="button"
              onClick={() => void onDeviceToggle()}
              disabled={deviceBusy}
              className={
                deviceActive
                  ? 'w-full rounded border border-stamp-500/60 px-3 py-1.5 text-xs text-stamp-400 transition-colors hover:bg-stamp-100'
                  : 'w-full rounded border border-lamp-600/50 bg-lamp-100/60 px-3 py-1.5 text-xs text-lamp-300 transition-colors hover:bg-lamp-100'
              }
            >
              {deviceBusy ? t('profile.deviceBusy') : deviceActive ? t('profile.deviceRemove') : t('profile.deviceEnroll')}
            </button>
            <p className="mt-1 text-[11px] text-paper-500">
              {deviceActive
                ? t('profile.deviceRemoveHint')
                : t('profile.deviceEnrollHint')}
            </p>
            {deviceError && <p className="mt-1 text-xs text-stamp-400">{deviceError}</p>}
          </div>
        )}
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          disabled={busy}
          className="mt-2 w-full rounded border border-stamp-500/60 px-3 py-1.5 text-xs text-stamp-400 transition-colors hover:bg-stamp-100"
        >
          {t('profile.deleteAccount')}
        </button>
        {error && <p className="text-sm text-stamp-400">{error}</p>}
        {confirmDelete && (
          <ConfirmDialog
            title={t('profile.deleteTitle')}
            danger
            confirmLabel={t('profile.deleteConfirm')}
            message={t('profile.deleteMessage')}
            onConfirm={() => void onDeleteAccount()}
            onCancel={() => setConfirmDelete(false)}
          />
        )}
        <div className="mt-2 border-t border-night-700 pt-3">
          <SponsorNote />
        </div>
      </div>
    </Modal>
  );
}
