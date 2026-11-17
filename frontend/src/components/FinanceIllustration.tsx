/** Ilustração do hub — contabilidade + estatística financeira, na paleta da marca.
 *  Decorativa (não é um gráfico de dados real). */
export function FinanceIllustration({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 560 470"
      className={className}
      fill="none"
      role="img"
      aria-label="Ilustração de relatórios e estatísticas financeiras"
    >
      <defs>
        <linearGradient id="fc-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#13707A" stopOpacity="0.30" />
          <stop offset="1" stopColor="#13707A" stopOpacity="0" />
        </linearGradient>
        <filter id="fc-shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="14" stdDeviation="18" floodColor="#0C464C" floodOpacity="0.13" />
        </filter>
      </defs>

      {/* folha de relatório ao fundo */}
      <g transform="rotate(-7 190 240)">
        <rect
          x="64"
          y="86"
          width="224"
          height="300"
          rx="18"
          fill="#EEF6F6"
          stroke="#B9DCDF"
          strokeWidth="2"
          filter="url(#fc-shadow)"
        />
        <circle cx="92" cy="120" r="6" fill="#7FD1D6" />
        <line x1="108" y1="120" x2="232" y2="120" stroke="#CFDADB" strokeWidth="7" strokeLinecap="round" />
        <line x1="92" y1="150" x2="250" y2="150" stroke="#E2EEEF" strokeWidth="7" strokeLinecap="round" />
        <line x1="92" y1="172" x2="214" y2="172" stroke="#E2EEEF" strokeWidth="7" strokeLinecap="round" />
        <line x1="92" y1="194" x2="242" y2="194" stroke="#E2EEEF" strokeWidth="7" strokeLinecap="round" />
      </g>

      {/* card principal — barras */}
      <g filter="url(#fc-shadow)">
        <rect x="152" y="150" width="304" height="216" rx="22" fill="#FFFFFF" />
        <circle cx="180" cy="180" r="5.5" fill="#7FD1D6" />
        <rect x="194" y="175" width="96" height="10" rx="5" fill="#CFDADB" />
        <rect x="194" y="193" width="56" height="8" rx="4" fill="#E2EEEF" />

        {/* barras (crescem da linha de base y=338) */}
        <rect x="184" y="290" width="28" height="48" rx="6" fill="#0F5E66" />
        <rect x="226" y="262" width="28" height="76" rx="6" fill="#0F5E66" />
        <rect x="268" y="224" width="28" height="114" rx="6" fill="#7FD1D6" />
        <rect x="310" y="278" width="28" height="60" rx="6" fill="#0F5E66" />
        <rect x="352" y="246" width="28" height="92" rx="6" fill="#0F5E66" />
        <rect x="394" y="212" width="28" height="126" rx="6" fill="#0C464C" />

        <line x1="172" y1="339" x2="438" y2="339" stroke="#CFDADB" strokeWidth="2" />
      </g>

      {/* card sobreposto — tendência */}
      <g filter="url(#fc-shadow)" transform="translate(322 244)">
        <rect x="0" y="0" width="208" height="138" rx="18" fill="#DCEDEE" />
        <rect x="18" y="18" width="66" height="10" rx="5" fill="#7FD1D6" />
        <path d="M20 104 L56 82 L92 92 L128 54 L178 36 L178 116 L20 116 Z" fill="url(#fc-area)" />
        <path
          d="M20 104 L56 82 L92 92 L128 54 L178 36"
          stroke="#0C464C"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="178" cy="36" r="5.5" fill="#0C464C" stroke="#DCEDEE" strokeWidth="3" />
      </g>

      {/* donut */}
      <g transform="translate(452 92)">
        <circle r="46" fill="#FFFFFF" filter="url(#fc-shadow)" />
        <g transform="rotate(-90)" strokeWidth="15" fill="none">
          <circle r="46" stroke="#E2EEEF" />
          <circle r="46" stroke="#0C464C" strokeDasharray="141 148" />
          <circle r="46" stroke="#13707A" strokeDasharray="83 206" strokeDashoffset="-146" />
          <circle r="46" stroke="#7FD1D6" strokeDasharray="48 241" strokeDashoffset="-234" />
        </g>
      </g>

      {/* pilha de moedas */}
      <g transform="translate(112 386)">
        <ellipse cx="0" cy="30" rx="48" ry="16" fill="#1C8590" />
        <ellipse cx="0" cy="16" rx="48" ry="16" fill="#7FD1D6" />
        <ellipse cx="0" cy="2" rx="48" ry="16" fill="#DCEDEE" stroke="#7FD1D6" strokeWidth="2" />
        <ellipse cx="0" cy="2" rx="30" ry="9" fill="none" stroke="#7FD1D6" strokeWidth="2" opacity="0.7" />
      </g>

      {/* acentos flutuantes */}
      <path d="M486 316v18M477 325h18" stroke="#13707A" strokeWidth="3" strokeLinecap="round" />
      <circle cx="120" cy="120" r="4.5" fill="#7FD1D6" />
      <circle cx="520" cy="380" r="3.5" fill="#1C8590" />
    </svg>
  );
}
