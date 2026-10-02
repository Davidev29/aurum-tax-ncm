/**
 * Faixa tributária acessível da Consulta — hero enxuto de redução/alíquota.
 *
 * Problema resolvido: a redução vivia em pills pequenas (`BadgesReducao`),
 * com o mesmo peso visual de todo o resto — alíquota zero passava batida.
 *
 * Agora há UM veredito visual por cartão, com 3 variantes mutuamente
 * exclusivas (nunca empilhadas):
 * - `zero` — redução 100/100: faixa verde forte, ícone ● + texto grande;
 * - `reducao` — qualquer redução parcial/mista: faixa âmbar/violeta com % grande;
 * - `integral` — sem redução: faixa neutra slate, sem alarde.
 *
 * Acessibilidade (não só cor): ícone + palavra + percentual em texto,
 * contraste WCAG AA nos dois temas, `role="status"`, foco visível herdado,
 * e padrão listrado via CSS para daltônicos (ver `index.css` `.faixa-*`).
 * Nenhum número fiscal é calculado aqui — só DECORA `redIBS/redCBS/anexo`
 * já resolvidos pela base oficial (apresentação pura).
 */

import type { ReactElement } from 'react'

export type VarianteFaixa = 'zero' | 'reducao' | 'integral' | 'mista'

export function varianteFaixa(redIBS: number, redCBS: number): VarianteFaixa {
  const a = Number(redIBS) || 0
  const b = Number(redCBS) || 0
  if (a >= 99.995 && b >= 99.995) return 'zero'
  if (a <= 0 && b <= 0) return 'integral'
  if (Math.abs(a - b) >= 0.005) return 'mista'
  return 'reducao'
}

function fmtPct(n: number): string {
  return `${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`
}

export function FaixaTributaria({
  redIBS,
  redCBS,
  anexo,
  baseLegal,
}: {
  redIBS: number
  redCBS: number
  /** Anexo oficial da base (ex.: "1", "VII") ou derivado ("0","60","misto"). */
  anexo?: string | null
  baseLegal?: string | null
}): ReactElement {
  const v = varianteFaixa(redIBS, redCBS)
  const rotuloAnexo = anexo ? ` · Anexo ${anexo}` : ''

  if (v === 'zero') {
    return (
      <div className="faixa faixa--zero" role="status" aria-live="polite" aria-label="Alíquota zero: IBS 0%, CBS 0%">
        <span className="faixa-icone" aria-hidden="true">●</span>
        <div className="faixa-corpo">
          <div className="faixa-titulo">ALÍQUOTA ZERO</div>
          <div className="faixa-sub">
            IBS 0% · CBS 0%{rotuloAnexo}
            {baseLegal ? ` · ${baseLegal}` : ''}
          </div>
        </div>
        <span className="faixa-pct" aria-hidden="true">0%</span>
      </div>
    )
  }

  if (v === 'integral') {
    return (
      <div className="faixa faixa--integral" role="status" aria-label="Tributação integral, alíquota cheia">
        <span className="faixa-icone" aria-hidden="true">○</span>
        <div className="faixa-corpo">
          <div className="faixa-titulo">TRIBUTAÇÃO INTEGRAL</div>
          <div className="faixa-sub">Alíquota cheia IBS/CBS · sem redução vigente</div>
        </div>
      </div>
    )
  }

  const pctTexto = Math.abs(redIBS - redCBS) >= 0.005
    ? `IBS −${fmtPct(redIBS)} / CBS −${fmtPct(redCBS)}`
    : `−${fmtPct(Math.max(redIBS, redCBS))} IBS/CBS`
  return (
    <div
      className={`faixa ${v === 'mista' ? 'faixa--mista' : 'faixa--reducao'}`}
      role="status"
      aria-live="polite"
      aria-label={`Redução de alíquota: ${pctTexto}`}
    >
      <span className="faixa-icone" aria-hidden="true">◐</span>
      <div className="faixa-corpo">
        <div className="faixa-titulo">REDUÇÃO {pctTexto}</div>
        <div className="faixa-sub">
          sobre a alíquota de referência{rotuloAnexo}
          {baseLegal ? ` · ${baseLegal}` : ''}
        </div>
      </div>
    </div>
  )
}
