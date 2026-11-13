/**
 * Contexto do NCM — a "moldura" do código: seção do SH, família SH6,
 * breadcrumb da família (Cap. › Pos. › Sub › Item), vigência e ato oficial.
 *
 * Dois blocos reutilizáveis:
 * - `NcmBreadcrumb`: só a trilha (para listas e modais);
 * - `NcmContextoNcm`: bloco completo (cartão oficial/painel da Consulta).
 *
 * Dados disponíveis localmente: `NomenclaturaNcm` (código/descrição/
 * vigência/ato) + `trilhaNcm` (dígitos + nomes oficiais dos níveis, via
 * `obterTrilhaNcm` com cache). Nada inventado: níveis sem descrição na
 * base aparecem só com o prefixo.
 */
import { useEffect, useState, type ReactElement } from 'react'
import type { NomenclaturaNcm } from '@/domain/entities'
import {
  secaoDoNcm,
  trilhaNcm,
  type TrilhaSegmento,
} from '@/domain/services/hierarquia-fiscal'
import { fmtDataBr, limparTextoFiscal } from '@/domain/services/texto-fiscal'
import { fmtNcm, norm } from '@/domain/services/format'
import { obterTrilhaNcm } from '@/infrastructure/base/classificacao-repo'
import { CopiarTexto } from './CopiarTexto'

/** Trilha síncrona para montar já na 1ª pintura (upgrade com nomes no efeito). */
export function useTrilha(codigo: unknown): TrilhaSegmento[] {
  const digitos = norm(codigo)
  const [trilha, setTrilha] = useState<TrilhaSegmento[]>(() => trilhaNcm(digitos))
  useEffect(() => {
    if (digitos.length < 2) {
      setTrilha([])
      return undefined
    }
    setTrilha(trilhaNcm(digitos))
    let vivo = true
    obterTrilhaNcm(digitos)
      .then((t) => {
        if (vivo) setTrilha(t)
      })
      .catch(() => undefined)
    return () => {
      vivo = false
    }
  }, [digitos])
  return trilha
}

/** Breadcrumb visual: segmentos separados por `›`, último destacado. */
export function NcmBreadcrumb({
  codigo,
  comNomes = true,
}: {
  codigo: unknown
  /** `false` esconde as descrições (layout de lista ultradenso). */
  comNomes?: boolean
}): ReactElement | null {
  const trilha = useTrilha(codigo)
  if (!trilha.length) return null
  return (
    <ol className="ncm-breadcrumb" aria-label="Família do NCM — capítulo, posição e subposição">
      {trilha.map((s, i) => {
        const ultimo = i === trilha.length - 1
        const exibe = comNomes && s.descricao ? `${s.rotulo} · ${s.descricao}` : s.rotulo
        const titulo = s.descricao ? `${s.rotulo} — ${s.descricao}` : s.rotulo
        return (
          <li key={s.prefixo} className="ncm-breadcrumb-seg" title={titulo}>
            {i > 0 ? (
              <span aria-hidden="true" className="ncm-breadcrumb-sep">
                ›
              </span>
            ) : null}
            <span className={ultimo ? 'ncm-breadcrumb-atual' : undefined}>{exibe}</span>
          </li>
        )
      })}
    </ol>
  )
}

function vigenciaPillNcM(nomenclatura: NomenclaturaNcm | null | undefined): ReactElement | null {
  if (!nomenclatura) return null
  if (nomenclatura.dataFim) {
    return (
      <span className="ncm-selo ncm-selo-extinto" title={`Extinto em ${nomenclatura.dataFim}`}>
        ⛔ Extinto em {nomenclatura.dataFim}
      </span>
    )
  }
  return (
    <span className="ncm-selo ncm-selo-vigente" title="NCM vigente na nomenclatura oficial">
      ✓ Vigente
    </span>
  )
}

/**
 * Bloco completo de contexto para o cartão oficial:
 * Seção + família SH6 (eyebrow) → código NCM grande + vigência + copiar →
 * breadcrumb da família → meta de vigência/ato.
 */
export function NcmContextoNcm({
  nomenclatura,
}: {
  nomenclatura: NomenclaturaNcm | null | undefined
}): ReactElement | null {
  const codigo = norm(nomenclatura?.codigo ?? '')
  if (!nomenclatura || codigo.length !== 8) return null
  const secao = secaoDoNcm(codigo)
  const subposicao = codigo.slice(0, 6)
  const fmtSub = `${subposicao.slice(0, 4)}.${subposicao.slice(4)}`
  const inicio = fmtDataBr(nomenclatura.dataInicio)
  const ato = limparTextoFiscal(nomenclatura.ato)
  const atoFim = limparTextoFiscal(nomenclatura.atoFim)

  return (
    <div className="ncm-contexto">
      {/* Eyebrow: Seção do SH + família SH6 — moldura mental do NCM. */}
      <div className="ncm-contexto-eyebrow">
        {secao ? (
          <span className="ncm-eyebrow-chip" title={`Seção ${secao.numero} do Sistema Harmonizado`}>
            Seção {secao.numero} · {secao.nome}
          </span>
        ) : null}
        <span
          className="ncm-eyebrow-chip ncm-eyebrow-chip-familia"
          title="Família SH6 — como os anexos da LC 214/2025 listam as reduções"
        >
          <span aria-hidden="true">🧬</span> Família {fmtSub}
        </span>
      </div>

      {/* Linha principal: código hero + vigência + copiar. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <div className="font-mono text-xl font-black tracking-tight text-brand-700 dark:text-aurum-200">
          {fmtNcm(codigo)}
        </div>
        {vigenciaPillNcM(nomenclatura)}
        <CopiarTexto texto={fmtNcm(codigo)} rotulo={`Copiar NCM ${fmtNcm(codigo)}`} />
      </div>

      {/* Breadcrumb da família (Cap · Pos · Sub). */}
      <div className="mt-1.5">
        <NcmBreadcrumb codigo={codigo} />
      </div>

      {/* Meta de vigência/ato em uma linha. */}
      <div className="ncm-contexto-meta">
        {inicio ? <span>Vigente desde {inicio}</span> : null}
        {ato ? (
          <span className="min-w-0 truncate" title={`Ato: ${ato}`}>
            <span aria-hidden="true">📎</span> {ato}
          </span>
        ) : null}
        {atoFim ? (
          <span className="min-w-0 truncate" title={`Ato de extinção: ${atoFim}`}>
            <span aria-hidden="true">⛔</span> {atoFim}
          </span>
        ) : null}
      </div>
    </div>
  )
}
