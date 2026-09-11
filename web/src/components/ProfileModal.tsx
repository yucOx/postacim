import { useRef, useState } from 'react';
import { api } from '../api/client';
import { useAuthStore } from '../state/authStore';
import { processAvatarFile, invalidateAvatar } from '../lib/avatar';
import Avatar from './Avatar';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';

export default function ProfileModal({ onClose }: { onClose: () => void }): React.ReactNode {
  const user = useAuthStore((s) => s.user);
  const setAvatar = useAuthStore((s) => s.setAvatar);
  const clearAvatar = useAuthStore((s) => s.clearAvatar);
  const logout = useAuthStore((s) => s.logout);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewBytes, setPreviewBytes] = useState<number>(0);
  const [hasAvatar, setHasAvatar] = useState<boolean>(user?.avatar_updated_at != null);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
    <Modal title="Profil" onClose={onClose}>
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
                ? `${(previewBytes / 1024).toFixed(1)} KB · 64×64 JPEG`
                : hasAvatar
                  ? 'avatar yüklü'
                  : 'henüz avatar yok — harf avatarı kullanılıyor'}
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

        <div className="flex flex-wrap gap-2">
          <button onClick={onPick} disabled={busy} className="btn-ghost">
            dosya seç
          </button>
          {preview && (
            <button onClick={() => void onSave()} disabled={busy} className="btn-lamp">
              {busy ? 'kaydediliyor…' : 'kaydet'}
            </button>
          )}
          {hasAvatar && !preview && (
            <button onClick={() => void onClear()} disabled={busy} className="btn-ghost hover:!border-stamp-500/70 hover:!text-stamp-400">
              avatarı kaldır
            </button>
          )}
        </div>

        <p className="text-[11px] text-paper-500">
          resim seç veya yapıştır (Cmd/Ctrl+V) · 64×64 küçük JPEG olarak kaydedilir (~3-8KB)
        </p>
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          disabled={busy}
          className="mt-2 w-full rounded border border-stamp-500/60 px-3 py-1.5 text-xs text-stamp-400 transition-colors hover:bg-stamp-100"
        >
          hesabımı kalıcı sil
        </button>
        {error && <p className="text-sm text-stamp-400">{error}</p>}
        {confirmDelete && (
          <ConfirmDialog
            title="Hesabı sil"
            danger
            confirmLabel="kalıcı sil"
            message="Hesabın, yazdığın tüm mesajlar, DM'ler, kurduğun gruplar ve topluluklar kalıcı silinir. Bu işlem geri alınamaz — kurtarma ifaden bile eski hesabı getiremez."
            onConfirm={() => void onDeleteAccount()}
            onCancel={() => setConfirmDelete(false)}
          />
        )}
      </div>
    </Modal>
  );
}
