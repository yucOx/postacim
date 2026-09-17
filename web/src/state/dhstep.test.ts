// 5b hotfix v2 regresyonu: DM çapa çifti sender kimliğinden DEĞİL, DM
// üyeliğinden gelir. İlk hotfix'te okuma yolu [ben, sender] hesaplamıştı —
// kendi mesajımızda sender=ben olduğundan çift [ben, ben] çıkıyor ve
// gönderim çapasından farklı türeyip "bu zarf açılamadı" veriyordu.
import { describe, expect, it, beforeEach } from 'vitest';
import { dmAnchorIds } from './dhstep';
import { useAuthStore } from './authStore';
import { useAppStore } from './appStore';

describe('dmAnchorIds — okuma/gönderim çift kaynağı', () => {
  beforeEach(() => {
    useAuthStore.setState({
      status: 'authed',
      user: { id: 'usr_bob', nick: 'bob', avatar_updated_at: null },
    });
    useAppStore.setState({
      dms: [
        {
          id: 'dm_1',
          peer: { id: 'usr_alice', nick: 'alice' },
          key_version: 1,
          my_wrapped_key: null,
          last_message_at: null,
        },
      ],
    });
  });

  it('çift [ben, peer] — DM üyeliğinden, sender_id girdisi yok', () => {
    // yardımcı sender parametresi ALMAZ: kendi mesajında da çift değişmez
    expect(dmAnchorIds('dm_1')).toEqual(['usr_alice', 'usr_bob']);
  });

  it('bilinmeyen kanal → null', () => {
    expect(dmAnchorIds('dm_yok')).toBeNull();
  });

  it('oturum yok → null', () => {
    useAuthStore.setState({ user: null });
    expect(dmAnchorIds('dm_1')).toBeNull();
  });

  it('DM haritada yok → null', () => {
    useAppStore.setState({ dms: [] });
    expect(dmAnchorIds('dm_1')).toBeNull();
  });
});
