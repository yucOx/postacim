// Dummy trafik (noise) — metadata zamanlama gizlemesinin ilk adımı.
// Giriş yapmış istemci arada rastgele boyutta anlamsız blob POST eder;
// bu route içeriği doğrulamaz, saklamaz, loglamaz — yalnız 204 döner.
// Amaç: "kullanıcı ne zaman gerçek mesaj gönderiyor" sinyalini gürültüye
// gömmek. Saklanmaz çünkü saklanan her satır zamanlamayı yeniden ifşa
// ederdi. Oturum global auth hook'undan zorunlu (PUBLIC_PATHS'te değil →
// anonim istek 401).
import type { FastifyInstance } from 'fastify';

const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const MAX_BYTES = 8192;

export async function noiseRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/noise',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      // yalnız biçim/boyut kontrolü — içerik asla incelenmez
      const b = (req.body as { b?: unknown } | undefined)?.b;
      if (
        typeof b !== 'string' ||
        b.length % 4 !== 0 ||
        !B64_RE.test(b) ||
        Buffer.from(b, 'base64').length > MAX_BYTES
      ) {
        return reply.code(400).send({ error: 'geçersiz blob' });
      }
      return reply.code(204).send();
    },
  );
}
