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
        // Segoe UI no Windows (igual ao InteliSac); Inter nos demais
        sans: [
          '"Segoe UI"',
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Roboto',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
