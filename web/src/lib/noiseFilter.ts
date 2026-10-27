// RNNoise tabanlı mikrofon gürültü engelleyici (tamamen tarayıcıda çalışır —
// ses sunucuya şifreli ve işlenmiş hâlde gider; SFrame E2EE etkilenmez).
//
// Mimari: LiveKit track processor — LocalAudioTrack.setProcessor() işlenmiş
// track'i yalnız yayına (RTCRtpSender) bağlar; yerel monitor ham mikrofonu
// duymaya devam eder (kendi kulaklıkta gecikme/parazit hissedilmez).
//
// WASM binary + worklet script'i Vite ?url ile asset olarak üretilir;
// postacim-cli pinned bundle'ı hash manifest'iyle taşır (yeni dosya adı
// manifest'e otomatik girer).

import {
  RnnoiseWorkletNode,
  loadRnnoise,
} from '@sapphi-red/web-noise-suppressor';
import type { AudioProcessorOptions, TrackProcessor } from 'livekit-client';
import { Track } from 'livekit-client';
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';

export type NoiseFilterProcessor = TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>;

let cachedBinary: Promise<ArrayBuffer> | null = null;

function rnnoiseBinary(): Promise<ArrayBuffer> {
  cachedBinary ??= loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdWasmUrl });
  return cachedBinary;
}

/** @sapphi-red/web-noise-suppressor RnnoiseWorkletNode → LiveKit audio track
 *  processor adaptörü. RNNoise 48 kHz varsayar; LiveKit'in AudioContext'i
 *  (acquireAudioContext, latencyHint:'interactive') Chrome/Linux'ta donanım
 *  mix hızıyla açılır — uyumsuzsampleRate'te worklet sessiz kalır, bu yüzden
 *  init'te düşürmek yerine 48k'ya eviren yedek bağlam kullanılır. */
export function createRnnoiseProcessor(): NoiseFilterProcessor {
  let ctx: AudioContext | null = null;
  let ownCtx = false;
  let source: MediaStreamAudioSourceNode | null = null;
  let node: RnnoiseWorkletNode | null = null;
  let dest: MediaStreamAudioDestinationNode | null = null;
  let origTrack: MediaStreamTrack | null = null;
  let origSettings: MediaTrackSettings | null = null;
  const self: NoiseFilterProcessor = {
    name: 'rnnoise-noise-filter',
    async init({ track, audioContext }: AudioProcessorOptions): Promise<void> {
      // Tarayıcının kendi gürültü engelleyicisi (LiveKit varsayılanı:
      // noiseSuppression + voiceIsolation) RNNoise ile ÇİFT işleme yapmasın —
      // ikincisi daha agresif, çift katman sesi "bottle" gibi yapar. Yankı
      // engelleme (echoCancellation) KORUNUR: hoparlörden dönen ses hâlâ
      // kendi mikrofonunu besliyor.
      origSettings = track.getSettings();
      origTrack = track;
      try {
        await track.applyConstraints({
          noiseSuppression: false,
          voiceIsolation: false,
        } as MediaTrackConstraints);
      } catch {
        // kısıt desteklenmiyor — çift işlemeye katlanır
      }
      // RNNoise 48 kHz varsayar; worklet çıktısını orijinal context'e
      // geri bağlarız. 48 kHz değilse: ara bağlam + evirme yerine her
      // context zaten MediaStream kaynağını kendi hızında çeker — ancak
      // worklet buffer'ı 128 frame (örnekleme hızı = bağlam hızı) olduğu
      // için filtreyi mutlaka 48k bağlamda çalıştırıp çıkışı orijinal
      // bağlama çevirmek gerekmez: MediaStreamDestination track'i LiveKit
      // sender'a doğrudan bağlanır, hız dönüşümünü tarayıcı yapar.
      if (audioContext.sampleRate === 48000) {
        ctx = audioContext;
        ownCtx = false;
      } else {
        ctx = new AudioContext({ sampleRate: 48000 });
        ownCtx = true;
      }
      await ctx.audioWorklet.addModule(rnnoiseWorkletUrl);
      source = ctx.createMediaStreamSource(new MediaStream([track]));
      node = new RnnoiseWorkletNode(ctx, {
        wasmBinary: await rnnoiseBinary(),
        maxChannels: 1,
      });
      dest = ctx.createMediaStreamDestination();
      source.connect(node);
      node.connect(dest);
      self.processedTrack = dest.stream.getAudioTracks()[0];
    },
    async restart(opts: AudioProcessorOptions): Promise<void> {
      await self.destroy();
      await self.init(opts);
    },
    async destroy(): Promise<void> {
      try {
        node?.destroy();
        source?.disconnect();
        node?.disconnect();
        dest?.disconnect();
      } catch {
        // zaten kopmuş
      }
      source = node = dest = null;
      // tarayıcının kendi engelleyicisini geri aç (filtre kapanınca)
      if (origSettings && origTrack) {
        try {
          await origTrack.applyConstraints({
            noiseSuppression: origSettings.noiseSuppression,
            voiceIsolation: (origSettings as MediaTrackSettings & { voiceIsolation?: boolean }).voiceIsolation,
          } as MediaTrackConstraints);
        } catch {
          // track zaten kapanmış olabilir
        }
      }
      origSettings = null;
      origTrack = null;
      // yalnız KENDİ açtığımız 48k bağlamı kapat; LiveKit'in bağlamına dokunma
      if (ownCtx && ctx) void ctx.close().catch(() => undefined);
      ctx = null;
      ownCtx = false;
      self.processedTrack = undefined;
    },
  };
  return self;
}
