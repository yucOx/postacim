import { describe, expect, it } from 'vitest';
import { serverMsg } from './serverMsg';
import { useI18nStore } from '../i18n/store';

describe('serverMsg', () => {
  it('Türkçe locale ham mesajı aynen döndürür (anahtar zaten Türkçe)', () => {
    useI18nStore.setState({ locale: 'tr' });
    expect(serverMsg('kanal bulunamadı')).toBe('kanal bulunamadı');
  });

  it('bilinen mesajı seçili dile çevirir', () => {
    useI18nStore.setState({ locale: 'en' });
    expect(serverMsg('kanal bulunamadı')).toBe('channel not found');
    useI18nStore.setState({ locale: 'de' });
    expect(serverMsg('nick veya şifre hatalı')).toBe('falscher nick oder falsches passwort');
    useI18nStore.setState({ locale: 'fr' });
    expect(serverMsg('üye değilsin')).toBe("tu n'es pas membre");
    useI18nStore.setState({ locale: 'es' });
    expect(serverMsg('yetkin yok')).toBe('no tienes permiso');
  });

  it('tabloda olmayan mesaj olduğu gibi geçer — bozuk değil, çevrilmemiş', () => {
    useI18nStore.setState({ locale: 'en' });
    expect(serverMsg('hayal meyal bilinmeyen hata')).toBe('hayal meyal bilinmeyen hata');
  });
});
