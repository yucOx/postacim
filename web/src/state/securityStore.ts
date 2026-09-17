import { create } from 'zustand';
import { b64 } from '../crypto/bytes';
import { headFingerprint, syncKeyLog, type KeyLogHead } from '../lib/keytransparency';

// Anahtar defteri doğrulamasının UI yansıması: head damga olarak profilde
// durur, çelişki kırmızı uyarı olarak Shell'in en üstünde. Ağ/sunucu hatası
// güvenlik çelişkisi değildir — sessiz geçilir; yalnız doğrulama HATASI
// uyarı üretir.
interface SecurityState {
  /** defterin son kaydı — profilde 'anahtar defteri damgası' olarak gösterilir */
  keylogHead: KeyLogHead | null;
  /** damganın gözle okunur hali (entry_hash ilk 16 hex, 4'lü gruplu) */
  keylogStamp: string | null;
  /** zincir / own-key çelişkisi — boş değilse kırmızı uyarı */
  keylogWarning: string | null;
  /** dh_update self-update duyurusu imza doğrulamasını geçemedi (Faz 5d) —
   *  kırmızı bant; yalnız 'bad-signature' tetikler (bkz. dhupdate.bandFromIngest) */
  dhUpdateWarning: string | null;
  /** Faz 6: başka bir istemci farklı anahtar defteri head'i gördü —
   *  gözlemsel fork kanıtı. 'view-splitting' olasılığı. Daha düşük panik
   *  tonu (zincir bozulmasıyla karışmasın diye ayrı alan) */
  keylogForkWarning: string | null;
  runKeyLogCheck: (userId: string, publicKey: Uint8Array) => Promise<void>;
  flagDhUpdateRejected: (code: 'bad-signature') => void;
  flagKeylogFork: (code: string) => void;
  clearKeylogFork: () => void;
}

export const useSecurityStore = create<SecurityState>((set) => ({
  keylogHead: null,
  keylogStamp: null,
  keylogWarning: null,
  dhUpdateWarning: null,
  keylogForkWarning: null,

  flagDhUpdateRejected: (code) => {
    // konsola da düş: gözlemci, imzalı-geçersiz duyuru yayını fark etsin
    console.error('dh_update duyurusu reddedildi:', code);
    set({ dhUpdateWarning: code });
  },

  flagKeylogFork: (code) => {
    // konsola da düş: gözlemci, view-splitting olasılığını fark etsin
    console.error('anahtar defteri fork uyarısı:', code);
    set({ keylogForkWarning: code });
  },

  clearKeylogFork: () => set({ keylogForkWarning: null }),

  runKeyLogCheck: async (userId, publicKey) => {
    try {
      const r = await syncKeyLog({ myUserId: userId, myPublicKeyB64: b64(publicKey) });
      if (r.ok) {
        set({ keylogHead: r.head, keylogStamp: headFingerprint(r.head), keylogWarning: null });
      } else {
        // çelişki — konsola da düş: sunucu kanıtı değiştirmiş olabilir
        console.error('anahtar defteri uyarısı:', r.warning);
        set({ keylogWarning: r.warning });
      }
    } catch {
      // ağ hatası — uyarı üretme, sonraki boot yine dener
    }
  },
}));