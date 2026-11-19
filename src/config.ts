import 'dotenv/config';

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name} (revisa backend/.env).`);
  return value;
};

const list = (value: string | undefined, fallback: string[]) =>
  value ? value.split(',').map((v) => v.trim()).filter(Boolean) : fallback;

const supabaseUrl = required('SUPABASE_URL').replace(/\/$/, '');

export const config = {
  port: Number(process.env.PORT ?? 3000),
  /** Orígenes del frontend permitidos (CORS). */
  frontendUrls: list(process.env.FRONTEND_URL, ['http://localhost:5173', 'http://localhost:4173']),
  supabase: {
    url: supabaseUrl,
    /** Emisor de los JWT de Supabase Auth. */
    issuer: `${supabaseUrl}/auth/v1`,
    /** Llaves públicas (ES256) con las que Supabase firma los JWT. */
    jwksUrl: `${supabaseUrl}/auth/v1/.well-known/jwks.json`,
    /** Solo backend: Auth Admin (invitaciones) y Storage. Nunca va al frontend. */
    secretKey: required('SUPABASE_SECRET_KEY'),
  },
};
