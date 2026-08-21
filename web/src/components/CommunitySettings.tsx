import { useEffect, useState } from 'react';
import { api } from '../api/client';
import Modal from './Modal';

interface BanRow {
  user_id: string;
  nick: string;
  created_at: number;
}

export default function CommunitySettings({ communityId, onClose }: { communityId: string; onClose: () => void }) {
  const [bans, setBans] = useState<BanRow[] | null>(null);

  useEffect(() => {
    void api<{ bans: BanRow[] }>(`/communities/${communityId}/bans`).then((res) => setBans(res.bans));
  }, [communityId]);

  const unban = async (userId: string): Promise<void> => {
    await api(`/communities/${communityId}/bans/${userId}`, { method: 'DELETE' });
    setBans((prev) => prev?.filter((b) => b.user_id !== userId) ?? null);
  };

  return (
    <Modal title="Topluluk ayarları" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-neutral-500">BANLI KULLANICILAR</h3>
          {bans?.length === 0 && <p className="text-sm text-neutral-500">banlı yok</p>}
          {bans?.map((b) => (
            <div key={b.user_id} className="flex items-center gap-2 py-1">
              <span className="flex-1 truncate text-sm text-neutral-300">{b.nick}</span>
              <button
                onClick={() => void unban(b.user_id)}
                className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800"
              >
                banı kaldır
              </button>
            </div>
          ))}
        </div>
        <p className="text-xs text-neutral-600">
          üye işlemleri (atma, banlama, admin) sağdaki üye listesinden yapılır
        </p>
      </div>
    </Modal>
  );
}
