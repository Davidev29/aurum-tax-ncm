/**
 * AurinhaAvatar — foto de perfil da Aurinha (tela de comunicação com a IA).
 *
 * SVG 100% vetorial, sem assets externos: carinha amigável da mascote
 * (orelhinhas, óculos verde-petróleo, olhos kawaii, focinho creme, blush)
 * com micro-animações em CSS puro:
 * - respiração (escala suave do conjunto);
 * - piscada a cada ~4,6 s (scaleY nos olhos);
 * - flutuação da cabeça;
 * - brilhos cintilantes;
 * - anel pulsante quando `digitando` (a IA está respondendo).
 *
 * Respeita `prefers-reduced-motion` (ver `.aurinha-avatar` no `index.css`).
 */
export function AurinhaAvatar({
  tamanho = 36,
  digitando = false,
  className = '',
  titulo = 'Aurinha — assistente Aurum AI',
}: {
  /** Diâmetro em px. */
  tamanho?: number
  /** `true` enquanto a IA digita: anel pulsante + balanço mais vivo. */
  digitando?: boolean
  className?: string
  titulo?: string
}) {
  return (
    <span
      className={`aurinha-avatar ${digitando ? 'is-digitando' : ''} ${className}`}
      style={{ width: tamanho, height: tamanho }}
      data-digitando={digitando ? 'true' : 'false'}
      role="img"
      aria-label={titulo}
      title={titulo}
    >
      <svg
        className="aurinha-avatar-svg"
        viewBox="0 0 64 64"
        width={tamanho}
        height={tamanho}
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <radialGradient id="aurinha-fundo" cx="38%" cy="30%" r="78%">
            <stop offset="0%" stopColor="#3e587e" />
            <stop offset="55%" stopColor="#2b3f63" />
            <stop offset="100%" stopColor="#16233a" />
          </radialGradient>
          <linearGradient id="aurinha-anel" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ead79e" />
            <stop offset="50%" stopColor="#d2a94e" />
            <stop offset="100%" stopColor="#9a771f" />
          </linearGradient>
          <radialGradient id="aurinha-lente" cx="38%" cy="32%" r="72%">
            <stop offset="0%" stopColor="#d9f6f6" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#bfe9ef" stopOpacity="0.45" />
          </radialGradient>
        </defs>

        {/* base + anel ouro */}
        <circle cx="32" cy="32" r="30" fill="url(#aurinha-fundo)" />
        <circle cx="32" cy="32" r="30" fill="none" stroke="url(#aurinha-anel)" strokeWidth="2.5" />
        <circle cx="32" cy="32" r="27.5" fill="none" stroke="#ffffff" strokeOpacity="0.16" strokeWidth="1" />

        {/* brilhos de fundo (cintilam) */}
        <g className="aurinha-twinkle" opacity="0.9">
          <path d="M12 14l1.1 2.6L15.7 17.7l-2.6 1.1L12 21.4l-1.1-2.6-2.6-1.1 2.6-1.1z" fill="#ead79e" />
        </g>
        <g className="aurinha-twinkle aurinha-twinkle--2" opacity="0.85">
          <path d="M51 10l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" fill="#fff7e0" />
        </g>
        <g className="aurinha-twinkle aurinha-twinkle--3" opacity="0.7">
          <circle cx="54" cy="46" r="1.6" fill="#ead79e" />
        </g>

        {/* conjunto que respira */}
        <g className="aurinha-respira">
          {/* orelhinhas */}
          <g>
            <ellipse cx="17.5" cy="20" rx="6.2" ry="7" fill="#7c4a2d" stroke="#241610" strokeWidth="1.4" transform="rotate(-18 17.5 20)" />
            <ellipse cx="17.5" cy="20.5" rx="2.8" ry="3.4" fill="#a8703f" transform="rotate(-18 17.5 20.5)" />
            <ellipse cx="46.5" cy="20" rx="6.2" ry="7" fill="#7c4a2d" stroke="#241610" strokeWidth="1.4" transform="rotate(18 46.5 20)" />
            <ellipse cx="46.5" cy="20.5" rx="2.8" ry="3.4" fill="#a8703f" transform="rotate(18 46.5 20.5)" />
          </g>

          {/* cabeça */}
          <g className="aurinha-cabeca">
            <ellipse cx="32" cy="36" rx="19" ry="17" fill="#a8703f" stroke="#241610" strokeWidth="1.6" />
            {/* touquinha de lontra */}
            <path d="M14.5 30 Q16 17.5 32 16.5 Q48 17.5 49.5 30 Q44 24.5 32 24 Q20 24.5 14.5 30 Z" fill="#7c4a2d" opacity="0.95" />
            {/* focinho creme */}
            <ellipse cx="32" cy="43" rx="10.5" ry="7.5" fill="#fbeed3" />
            {/* blush */}
            <ellipse className="aurinha-blush" cx="20.5" cy="40" rx="3.4" ry="2.2" fill="#e8938a" opacity="0.75" />
            <ellipse className="aurinha-blush" cx="43.5" cy="40" rx="3.4" ry="2.2" fill="#e8938a" opacity="0.75" />

            {/* óculos */}
            <g fill="url(#aurinha-lente)" stroke="#22a8a8" strokeWidth="2">
              <circle cx="24.5" cy="34" r="6.4" />
              <circle cx="39.5" cy="34" r="6.4" />
            </g>
            <line x1="30.9" y1="34" x2="33.1" y2="34" stroke="#22a8a8" strokeWidth="2" strokeLinecap="round" />

            {/* olhos kawaii (piscam via CSS) */}
            <g className="aurinha-olho">
              <ellipse cx="24.5" cy="34.5" rx="3.1" ry="3.6" fill="#ffffff" />
              <circle cx="24.9" cy="35.1" r="1.9" fill="#22344d" />
              <circle cx="25.6" cy="34.3" r="0.7" fill="#ffffff" />
            </g>
            <g className="aurinha-olho">
              <ellipse cx="39.5" cy="34.5" rx="3.1" ry="3.6" fill="#ffffff" />
              <circle cx="39.9" cy="35.1" r="1.9" fill="#22344d" />
              <circle cx="40.6" cy="34.3" r="0.7" fill="#ffffff" />
            </g>

            {/* nariz + sorriso */}
            <ellipse cx="32" cy="41.2" rx="1.7" ry="1.3" fill="#5b3a26" />
            <path
              className="aurinha-sorriso"
              d="M28.5 44 Q30.5 46.2 32 46.2 Q33.5 46.2 35.5 44"
              fill="none"
              stroke="#5b3a26"
              strokeWidth="1.6"
              strokeLinecap="round"
            />

            {/* selo dourado Aurum na testa */}
            <g transform="translate(32 26.5)">
              <g className="aurinha-selo">
                <path d="M0 -3.2 L1.1 -1.1 L3.2 0 L1.1 1.1 L0 3.2 L-1.1 1.1 L-3.2 0 L-1.1 -1.1 Z" fill="#d2a94e" stroke="#8a6d1f" strokeWidth="0.6" />
              </g>
            </g>
          </g>

          {/* lupinha dourada na patinha */}
          <g transform="translate(45.5 44) rotate(-18)">
            <g className="aurinha-lupa">
              <circle cx="0" cy="0" r="4.6" fill="#bfe9ef" fillOpacity="0.55" stroke="#d2a94e" strokeWidth="1.8" />
              <circle cx="-1.2" cy="-1.2" r="1.1" fill="#ffffff" opacity="0.9" />
              <rect x="2.8" y="2.8" width="5.4" height="2.2" rx="1.1" fill="#3c4450" transform="rotate(45 5.5 3.9)" />
            </g>
          </g>
        </g>
      </svg>

      {/* pontinho de presença: verde online · âmbar pulsante digitando */}
      <span className="aurinha-presenca" aria-hidden="true" />
    </span>
  )
}
