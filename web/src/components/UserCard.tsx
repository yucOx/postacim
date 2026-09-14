import { useState } from 'react';
import { Crown, Key, MessageCircle, Star } from 'lucide-react';
import { useAppStore } from '../state/appStore';
import { useAuthStore } from '../state/authStore';
import Avatar from './Avatar';
import KeyFingerprintModal from './KeyFingerprintModal';
import Modal from './Modal';
import { useT } from '../i18n/I18nProvider';

/** Discord-style user popout: click an avatar/nick in chat to see who it is —
 *  big avatar, role in the active community, key fingerprint, quick DM. */
export default function UserCard({ userId, nick, onClose }: { userId: string; nick: string; onClose: () => void }): React.ReactNode {
  const { t } = useT();
  const me = useAuthStore((s) => s.user);
  const publicKey = useAppStore((s) => s.publicKeys[userId]);
  const role = useAppStore(
    (s) => s.communities.find((c) => c.id === s.activeCommunityId)?.members.find((m) => m.id === userId)?.role ?? null,
  );
  const isFriend = useAppStore((s) => s.friends.some((f) => f.id === userId));
  const openDm = useAppStore((s) => s.openDm);
  const [fingerprint, setFingerprint] = useState(false);
  const isMe = userId === me?.id;

  return (
    <>
      <Modal title={t('userCard.title')} onClose={onClose}>
        <div className="flex flex-col items-center gap-1 pb-3">
          <Avatar userId={userId} label={nick} size={64} className="!border-2" />
          <span className="mt-1 font-display text-base font-semibold text-paper-50">{nick}</span>
          {role && (
            <span className="flex items-center gap-1 text-xs text-paper-500">
              {role === 'owner' && <Crown size={11} className="text-lamp-500" aria-hidden />}
              {role === 'admin' && <Star size={10} className="text-brass-400" aria-hidden />}
              {role === 'owner' ? t('userCard.roleOwner') : role === 'admin' ? t('userCard.roleAdmin') : t('userCard.roleMember')}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={() => setFingerprint(true)} className="btn-ghost flex-1">
            <Key size={13} />
            {t('userCard.fingerprint')}
          </button>
          {!isMe && (
            <button
              onClick={() => {
                if (isFriend) {
                  void openDm(userId).finally(onClose);
                } else {
                  setFingerprint(true);
                }
              }}
              className="btn-lamp flex-1"
              title={isFriend ? t('userCard.openDm') : t('userCard.notFriend')}
            >
              <MessageCircle size={13} />
              {isFriend ? t('userCard.message') : t('userCard.notFriendBtn')}
            </button>
          )}
        </div>
        {isMe && <p className="mt-2 text-center text-xs text-paper-700">{t('userCard.isYou')}</p>}
      </Modal>
      {fingerprint && (
        <KeyFingerprintModal
          peerId={userId}
          peerNick={nick}
          peerPublicKeyB64={publicKey}
          onClose={() => setFingerprint(false)}
        />
      )}
    </>
  );
}