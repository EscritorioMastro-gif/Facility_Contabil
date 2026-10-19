const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Faltam VITE_SUPABASE_URL e/ou VITE_SUPABASE_ANON_KEY. Copie frontend/.env.example para frontend/.env.',
  );
}

export const env = {
  supabaseUrl: url,
  supabaseAnonKey: anonKey,
  /** Vazio em dev (usa o proxy /api do Vite). */
  apiUrl: (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, ''),
  /** Endereço público do leitor — só pra acordá-lo no Render (lib/acordarLeitor.ts). Vazio em dev. */
  parserUrl: (import.meta.env.VITE_PARSER_URL ?? '').replace(/\/$/, ''),
} as const;
