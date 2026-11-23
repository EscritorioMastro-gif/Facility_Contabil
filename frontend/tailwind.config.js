/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta Facility Contábil — branco + verde-petróleo (a mesma do InteliSac).
        // Os nomes antigos (cream, brand, slate) continuam, só mudaram as cores:
        // assim as telas trocam de cor sem mexer em cada arquivo.
        cream: '#EEF4F3', // fundo das telas
        ink: '#17282B',
        brand: {
          50: '#E0F0F0', // avisos e hover (precisa destacar do fundo cream)
          100: '#DCEDEE',
          200: '#D9E3E4', // bordas de card e campo
          300: '#7FD1D6', // destaque claro (item ativo do menu)
          400: '#4FB8BF',
          500: '#1C8590',
          600: '#13707A', // links e filtros ativos
          700: '#0F5E66', // cor principal (botões)
          800: '#0C464C', // barra lateral
          900: '#08353A',
        },
        // Remapeia a escala `slate` do Tailwind pra cinzas levemente esverdeados —
        // os ~180 usos de slate-* no app seguem a paleta sem tocar em cada arquivo.
        slate: {
          50: '#F7FAFA',
          100: '#EDF2F2',
          200: '#E2E9EA',
          300: '#CFDADB',
          400: '#8A9A9C',
          500: '#5E7073',
          600: '#485A5D',
          700: '#2F4245',
          800: '#17282B', // texto
          900: '#0E1C1E',
        },
      },
      fontFamily: {
        // Visual 2026-11 (repaginação): Plus Jakarta Sans no texto, Sora nos
        // títulos e números grandes, JetBrains Mono nos códigos (conta, lote,
        // histórico) e rótulos técnicos. Segoe UI fica de reserva no Windows.
        sans: [
          '"Plus Jakarta Sans"',
          '"Segoe UI"',
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Roboto',
          'sans-serif',
        ],
        display: ['Sora', '"Plus Jakarta Sans"', '"Segoe UI"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      boxShadow: {
        // sombras em verde-petróleo (não preto): profundidade sem "sujar" o branco
        card: '0 1px 2px rgb(8 53 58 / 0.04), 0 10px 30px -14px rgb(8 53 58 / 0.14)',
        'card-hover': '0 2px 4px rgb(8 53 58 / 0.05), 0 18px 40px -16px rgb(8 53 58 / 0.22)',
        float: '0 24px 60px -20px rgb(8 53 58 / 0.35), 0 2px 6px rgb(8 53 58 / 0.06)',
        glow: '0 0 0 1px rgb(127 209 214 / 0.35), 0 8px 24px -8px rgb(28 133 144 / 0.55)',
        'glow-sm': '0 0 12px rgb(127 209 214 / 0.55)',
        'inner-top': 'inset 0 1px 0 rgb(255 255 255 / 0.18)',
      },
      borderRadius: {
        '4xl': '1.75rem',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.97)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'slide-in-left': { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(0)' } },
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(12px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        shimmer: { from: { backgroundPosition: '-200% 0' }, to: { backgroundPosition: '200% 0' } },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgb(127 209 214 / 0.6)' },
          '70%': { boxShadow: '0 0 0 8px rgb(127 209 214 / 0)' },
          '100%': { boxShadow: '0 0 0 0 rgb(127 209 214 / 0)' },
        },
        drift: {
          '0%, 100%': { transform: 'translate3d(0, 0, 0)' },
          '50%': { transform: 'translate3d(0, -10px, 0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 180ms ease-out both',
        'fade-up': 'fade-up 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
        'scale-in': 'scale-in 200ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
        'slide-in-left': 'slide-in-left 220ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
        'toast-in': 'toast-in 240ms cubic-bezier(0.2, 0.8, 0.2, 1) both',
        shimmer: 'shimmer 1.6s linear infinite',
        'pulse-ring': 'pulse-ring 2s ease-out infinite',
        drift: 'drift 9s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
