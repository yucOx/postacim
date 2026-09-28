import { useState } from 'react';
import { Users } from 'lucide-react';
import { useAppStore } from '../state/appStore';
import { useJoinStore } from '../state/joinStore';
import { toast } from './Toast';
import Modal from './Modal';
import { useT } from '../i18n/I18nProvider';

// Staff "üye ekle" artık zorla üyelik değil — hedef kullanıcıya WS ile
// davet gider, üyelik yalnız buradaki kabul ile basılır (consent).
export default function InvitePrompt(): React.ReactNode | null {
  const { t } = useT();
  const pending = useAppStore((s) => s.pendingInvite);
  const setPendingInvite = useAppStore((s) => s.setPendingInvite);
  const [busy, setBusy] = useState(false);

  if (!pending) return null;

  const accept = async (): Promise<void> => {
    setBusy(true);
    try {
      await useJoinStore.getState().start(pending.code, null);
      const st = useJoinStore.getState();
      if (st.status === 'needs_password') {
        // katılım şifreli topluluk — tam akış JoinScreen'de (şifre sorar)
        location.hash = `#/davet/${pending.code}`;
      } else if (st.status === 'ready') {
        await st.complete();
        if (useJoinStore.getState().status !== 'joined') {
          throw new Error(useJoinStore.getState().error ?? t('invitePrompt.error'));
        }
      } else {
        throw new Error(st.error ?? t('invitePrompt.error'));
      }
      setPendingInvite(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('invitePrompt.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('invitePrompt.title')} onClose={() => setPendingInvite(null)}>
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-brass-600/60 bg-night-800">
          <Users size={26} className="text-brass-500" aria-hidden />
        </div>
        <p className="text-sm text-paper-200">
          {t('invitePrompt.body', { name: pending.fromNick, community: pending.communityName })}
        </p>
        <p className="text-xs text-paper-500">{t('invitePrompt.hint')}</p>
        <div className="flex w-full gap-2">
          <button type="button" onClick={() => setPendingInvite(null)} className="btn-ghost flex-1">
            {t('invitePrompt.decline')}
          </button>
          <button type="button" onClick={() => void accept()} disabled={busy} className="btn-lamp flex-1">
            {t('invitePrompt.accept')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
