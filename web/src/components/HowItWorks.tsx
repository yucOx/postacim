import { useEffect, useState } from 'react';
import { ArrowDown, ArrowLeft, Headphones, KeyRound, Lock, Mic, Server, User, UserCheck } from 'lucide-react';
import { useT } from '../i18n/I18nProvider';
import LocalePicker from './LocalePicker';
import { PigeonMark, SealMark } from './Brand';

/** Giriş öncesi erişilebilen "nasıl çalışır?" sayfası — README'deki E2EE
 *  anlatımının web sürümü: animasyonlu mesaj yolculuğu, anahtar dağıtımı,
 *  SFrame ses akışı ve kim-ne-görüyor matrisi. Auth gerektirmez. */

const STEP_MS = 3400;
const STEP_KEYS = ['s1', 's2', 's3', 's4', 's5'] as const;
// zarfın tel üzerindeki yeri (sol %) — adım ilerledikçe Alice'den Bob'a kayar
const ENVELOPE_POS = [9, 13, 33, 50, 90];

function SectionTitle({ num, children }: { num: string; children: React.ReactNode }): React.ReactNode {
  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-xs text-lamp-500">{num}</span>
      <h2 className="font-display text-lg font-semibold uppercase tracking-[0.12em] text-paper-100">{children}</h2>
      <span className="h-px flex-1 bg-night-700" aria-hidden />
    </div>
  );
}

function Chip({
  icon,
  label,
  tone = 'plain',
}: {
  icon: React.ReactNode;
  label: string;
  tone?: 'lamp' | 'plain';
}): React.ReactNode {
  return (
    <span
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] ${
        tone === 'lamp' ? 'border-lamp-500/60 bg-lamp-100/50 text-lamp-300' : 'border-brass-700/60 bg-night-800 text-paper-300'
      }`}
    >
      {icon}
      {label}
    </span>
  );
}

function FlowCard({
  on,
  icon,
  name,
  role,
}: {
  on: boolean;
  icon: React.ReactNode;
  name: string;
  role: string;
}): React.ReactNode {
  return (
    <div
      className={`relative z-[5] flex w-24 flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition-all duration-500 sm:w-36 sm:p-4 ${
        on
          ? 'border-lamp-500/70 bg-night-800 shadow-[0_0_28px_-8px_rgba(244,191,84,0.35)]'
          : 'border-night-700 bg-night-900 opacity-45'
      }`}
    >
      <span className={on ? 'text-lamp-400' : 'text-paper-500'}>{icon}</span>
      <span className="font-display text-sm font-semibold uppercase tracking-[0.12em] text-paper-100">{name}</span>
      <span className="text-[10px] leading-snug text-paper-400 sm:text-[11px]">{role}</span>
    </div>
  );
}

export default function HowItWorks({ onBack }: { onBack: () => void }): React.ReactNode {
  const { t } = useT();
  const [step, setStep] = useState(0);

  // adımlar kendiliğinden oynar; kullanıcı bir noktaya tıklayınca seçer,
  // sayaç kaldığı yerden döngüye devam eder
  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % STEP_KEYS.length), STEP_MS);
    return () => clearInterval(id);
  }, []);

  const steps = STEP_KEYS.map((k) => ({
    title: t(`how.${k}t`),
    desc: t(`how.${k}d`),
  }));

  const aliceOn = step <= 2;
  const serverOn = step === 2 || step === 3;
  const bobOn = step === 4;

  const matrix: [string, string, string][] = [
    [t('how.mNet'), t('how.mNetSees'), t('how.mNetNo')],
    [t('how.mSrv'), t('how.mSrvSees'), t('how.mSrvNo')],
    [t('how.mSfu'), t('how.mSfuSees'), t('how.mSfuNo')],
    [t('how.mKick'), t('how.mKickSees'), t('how.mKickNo')],
  ];

  return (
    <div className="min-h-screen bg-night-950 text-paper-100">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-night-700 bg-night-950/90 px-4 py-3 backdrop-blur">
        <button onClick={onBack} className="btn-ghost !px-3 !py-1.5 !text-xs">
          <span className="flex items-center gap-1.5">
            <ArrowLeft size={14} />
            {t('how.back')}
          </span>
        </button>
        <div className="text-brass-400" aria-hidden>
          <SealMark size={26} />
        </div>
        <span className="plate !text-sm">{t('how.title')}</span>
        <div className="ml-auto">
          <LocalePicker variant="full" />
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-12 px-4 py-10 sm:py-14">
        {/* hero — postane vaadi */}
        <section className="flex flex-col items-center gap-4 text-center">
          <div className="animate-seal-in text-brass-400" aria-hidden>
            <SealMark size={80} />
          </div>
          <h1 className="max-w-xl font-display text-2xl font-bold uppercase leading-snug tracking-[0.05em] text-paper-50 sm:text-3xl">
            {t('how.hero')}
          </h1>
          <p className="max-w-lg text-sm leading-relaxed text-paper-400">{t('how.heroSub')}</p>
        </section>

        {/* 1 — mesajın yolculuğu: tel üzerinde kayan zarf */}
        <section className="flex flex-col gap-4">
          <SectionTitle num="01">{t('how.jTitle')}</SectionTitle>
          <p className="text-[11px] text-paper-500">{t('how.jHint')}</p>
          <div className="overflow-x-auto pb-1">
            <div className="min-w-[520px]">
              {/* tel + zarf */}
              <div className="relative h-11" aria-hidden>
                <div className="absolute inset-x-[4%] top-1/2 border-t-2 border-dashed border-brass-700/50" />
                <div
                  className="absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 transition-[left] duration-700 ease-in-out motion-reduce:transition-none"
                  style={{ left: `${ENVELOPE_POS[step]}%` }}
                >
                  <div className="flex items-center gap-1.5 rounded-md border border-brass-600/80 bg-night-950 px-2.5 py-1.5 shadow-[0_6px_20px_-6px_rgba(0,0,0,0.8)]">
                    <Lock size={13} className="text-lamp-400" />
                    <span className="font-mono text-[10px] tracking-tight text-paper-400">c8e2b41d77a0…</span>
                  </div>
                </div>
              </div>
              {/* aktörler */}
              <div className="flex items-stretch justify-between gap-2 sm:gap-4">
                <FlowCard on={aliceOn} icon={<User size={22} />} name="Alice" role={t('how.cardAlice')} />
                <FlowCard on={serverOn} icon={<Server size={22} />} name={t('how.cardServerName')} role={t('how.cardServer')} />
                <FlowCard on={bobOn} icon={<UserCheck size={22} />} name="Bob" role={t('how.cardBob')} />
              </div>
            </div>
          </div>
          {/* adım seçimi + açıklama */}
          <div className="grid grid-cols-5 gap-1">
            {steps.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setStep(i)}
                aria-pressed={step === i}
                className={`group flex flex-col items-center gap-1.5 rounded-md border px-1 py-2 text-center transition-colors ${
                  step === i ? 'border-lamp-500/60 bg-lamp-100/40' : 'border-transparent hover:border-night-700'
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full transition-colors ${
                    step === i ? 'bg-lamp-400' : 'bg-night-700 group-hover:bg-night-600'
                  }`}
                />
                <span className={`text-[10px] leading-tight sm:text-[11px] ${step === i ? 'text-lamp-300' : 'text-paper-500'}`}>
                  {s.title}
                </span>
              </button>
            ))}
          </div>
          <p className="min-h-16 rounded-md border border-night-700 bg-night-900 px-4 py-3 text-sm leading-relaxed text-paper-300">
            {steps[step].desc}
          </p>
        </section>

        {/* 2 — anahtarlar tarayıcıdan çıkmaz */}
        <section className="flex flex-col gap-4">
          <SectionTitle num="02">{t('how.kTitle')}</SectionTitle>
          <div className="grid gap-4 md:grid-cols-2">
            {/* Argon2id bölünmesi */}
            <div className="flex flex-col gap-2.5 rounded-lg border border-night-700 bg-night-900 p-4">
              <p className="text-center font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-paper-500">
                {t('how.kArgonT')}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Chip icon={<KeyRound size={13} />} label={t('how.kPw')} />
                <span className="text-brass-600">→</span>
                <Chip icon={<Lock size={13} />} label={t('how.kArgon')} tone="lamp" />
              </div>
              <ArrowDown size={15} className="mx-auto text-brass-600" aria-hidden />
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded border border-night-700 bg-night-800 p-2.5 text-[11px] leading-snug text-paper-400">
                  {t('how.kProof')}
                </div>
                <div className="rounded border border-lamp-500/60 bg-lamp-100/50 p-2.5 text-[11px] leading-snug text-lamp-300">
                  {t('how.kKek')}
                </div>
              </div>
              <p className="text-[11px] leading-snug text-paper-500">{t('how.kBlob')}</p>
            </div>
            {/* sealed-box dağıtımı */}
            <div className="flex flex-col gap-2.5 rounded-lg border border-night-700 bg-night-900 p-4">
              <p className="text-center font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-paper-500">
                {t('how.kDistT')}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Chip icon={<KeyRound size={13} />} label={t('how.kChan')} tone="lamp" />
                <span className="text-brass-600">→</span>
                <Chip icon={<Lock size={13} />} label={t('how.kSeal')} />
              </div>
              <ArrowDown size={15} className="mx-auto text-brass-600" aria-hidden />
              <div className="grid grid-cols-3 gap-1.5">
                <div className="rounded border border-night-700 bg-night-800 p-2 text-[10px] leading-snug text-paper-300">
                  {t('how.kM1')}
                </div>
                <div className="rounded border border-night-700 bg-night-800 p-2 text-[10px] leading-snug text-paper-300">
                  {t('how.kM2')}
                </div>
                <div className="rounded border border-dashed border-brass-700/70 bg-night-800 p-2 text-[10px] leading-snug text-paper-300">
                  {t('how.kNew')}
                </div>
              </div>
              <p className="rounded border border-stamp-500/50 bg-stamp-100/60 px-2.5 py-2 text-[11px] leading-snug text-stamp-400">
                {t('how.kKick')}
              </p>
            </div>
          </div>
        </section>

        {/* 3 — ses aynı hattı izler */}
        <section className="flex flex-col gap-4">
          <SectionTitle num="03">{t('how.vTitle')}</SectionTitle>
          <div className="flex flex-wrap items-center justify-center gap-2 rounded-lg border border-night-700 bg-night-900 p-5">
            <Chip icon={<Mic size={13} />} label={t('how.vMic')} />
            <span className="text-brass-600" aria-hidden>→</span>
            <Chip icon={<Lock size={13} />} label={t('how.vEnc')} tone="lamp" />
            <span className="text-brass-600" aria-hidden>→</span>
            <Chip icon={<Server size={13} />} label={t('how.vSfu')} />
            <span className="text-brass-600" aria-hidden>→</span>
            <Chip icon={<Headphones size={13} />} label={t('how.vEar')} />
          </div>
          <p className="text-center font-mono text-[11px] leading-relaxed text-paper-500">{t('how.vKey')}</p>
        </section>

        {/* 4 — kim ne görüyor */}
        <section className="flex flex-col gap-4">
          <SectionTitle num="04">{t('how.mTitle')}</SectionTitle>
          <div className="overflow-x-auto rounded-lg border border-night-700">
            <table className="w-full min-w-[560px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-night-700 bg-night-900">
                  <th className="px-3 py-2.5 font-display text-[10px] font-semibold uppercase tracking-[0.15em] text-paper-500">
                    {t('how.mWho')}
                  </th>
                  <th className="px-3 py-2.5 font-display text-[10px] font-semibold uppercase tracking-[0.15em] text-lamp-400">
                    {t('how.mSees')}
                  </th>
                  <th className="px-3 py-2.5 font-display text-[10px] font-semibold uppercase tracking-[0.15em] text-stamp-400">
                    {t('how.mCannot')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {matrix.map(([who, sees, cannot]) => (
                  <tr key={who} className="border-b border-night-800 last:border-0">
                    <td className="px-3 py-2.5 font-semibold text-paper-200">{who}</td>
                    <td className="px-3 py-2.5 leading-snug text-paper-400">{sees}</td>
                    <td className="px-3 py-2.5 leading-snug text-stamp-400">{cannot}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* kanıt + DB'deki hali */}
        <section className="flex flex-col gap-3">
          <div className="rounded-lg border border-lamp-600/50 bg-lamp-100/50 p-4 text-[13px] leading-relaxed text-lamp-300">
            {t('how.proof')}
          </div>
          <div className="rounded-lg border border-night-700 bg-night-900 p-4">
            <p className="font-display text-[10px] font-semibold uppercase tracking-[0.15em] text-paper-500">
              {t('how.dbLabel')}
            </p>
            <div className="mt-2 overflow-x-auto rounded border border-night-800 bg-night-950 p-3 font-mono text-xs text-paper-300">
              {`{ nonce: '9f3a1c…', ciphertext: 'c8e2b41d77a0f6…' }`}
            </div>
          </div>
        </section>

        <button type="button" onClick={onBack} className="btn-lamp mx-auto flex items-center gap-2 !px-8">
          <PigeonMark size={16} className="text-night-950" />
          {t('how.cta')}
        </button>
      </main>
    </div>
  );
}
