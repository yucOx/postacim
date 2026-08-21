import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    /** set by the auth guard hook for every non-public /api route */
    user: { id: string; nick: string };
    sessionToken: string;
  }
}
