// Arama kutusunun ortak yerleşim sabitleri.

/** Kontrol çubuğu + kalite seçici kutunun dikey payı (px). Kutunun oranı
 *  video oranına ek bu kadar yükseklik eklenerek hesaplanır — sabit
 *  çarpan (1.06 gibi) kaba bir tahmindi, ekran yüksekliğine göre
 *  değişmiyordu. */
export const CALL_CHROME_H = 116;

/** Kabuk çerçevesinin dikey payı (p-2 üst + alt) */
export const CALL_SHELL_PAD = 16;

/** kutu oranı = (kabuk genişliği × video oranı) / video alanı yüksekliği */
export function boxAspectFor(
  shellW: number,
  shellH: number,
  videoAspect: number,
): number {
  const videoH = Math.max(1, shellH - CALL_CHROME_H - CALL_SHELL_PAD);
  if (shellW <= 0 || videoH <= 0) return videoAspect;
  return Math.max(1, (shellW * videoAspect) / videoH);
}

/** Altta mutlak duran kontrol panelinin yüksekliği (px). CallStage bu
 *  kadar alt boşluk bırakır, yoksa video panelin arkasında kalır. */
export const CALL_DOCK_H = 100; // kalite seçici (~32) + kontrol çubuğu (~68)
