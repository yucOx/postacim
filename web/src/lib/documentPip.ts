/** Document Picture-in-Picture (Chrome/Edge 116+) — Discord'un "popout call"
 *  mantığı: işletim sistemi seviyesinde HER ŞEYİN üstünde duran, içine istediğimiz
 *  HTML'i çizebildiğimiz ayrı pencere. Video-only PiP'den farkı: başlık, kontroller,
 *  avatar — aramanın tamamı pencerede yaşar ve aynı JS bağlamında çalışır. */
interface DocumentPictureInPictureApi {
  window: Window | null;
  requestWindow(options?: {
    width?: number;
    height?: number;
    /** "sekmeye dön" düğmesini gizle — geri dönüş bizim kendi düğümüzden */
    disallowReturnToOpener?: boolean;
    preferInitialWindowPlacement?: boolean;
  }): Promise<Window>;
}

/** null = bu tarayıcı desteklemiyor (Firefox/Safari; güvenli olmayan http) */
export function documentPip(): DocumentPictureInPictureApi | null {
  if (typeof window === 'undefined') return null;
  const api = (window as Window & { documentPictureInPicture?: DocumentPictureInPictureApi })
    .documentPictureInPicture;
  return api ?? null;
}
