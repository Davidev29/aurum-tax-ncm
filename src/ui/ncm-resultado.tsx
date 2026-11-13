/**
 * Card compacto da busca por nome — moldura rica para cada resultado:
 * Seção do SH + família SH6 (eyebrow), código NCM hero, selos de vigência e
 * de enquadramentos na Reforma, descrição oficial (clamp 2 linhas +
 * realce das palavras buscadas), breadcrumb da família e copiar código.
 *
 * Variante `option` (role="option" + data-indice) para a lista com seleção
 * por teclado em `Consulta` (listbox). Card completo por item é proposital:
 * a descrição é a informação — nunca trunca na horizontal.
 */
import type { ReactElement } from 'react'
import { secaoDoNcm } from '@/domain/services/hierarquia-fiscal'
import { limparTextoFiscal } from '@/domain/services/texto-fiscal'
import { fmtNcm } from '@/domain/services/format'
import type { ResultadoBuscaTexto } from '@/infrastructure/base/classificacao-repo'
import { CopiarTexto } from './CopiarTexto'
import { NcmBreadcrumb } from './ncm-contexto'
import { Destacar } from './destacar'

export interface NcmResultadoCardProps {
  item: ResultadoBuscaTexto
  /** Termo digitado (para realce e aria-label). */
  termo: string
  /** `true` quando é a opção ativa (teclado). */
  ativo: boolean
  /** Índice na lista (data-indice para foco/scroll por teclado). */
  indice: number
  onEscolher: (codigo: string) => void
}

export function NcmResultadoCard({
  item,
  termo,
  ativo,
  indice,
  onEscolher,
}: NcmResultadoCardProps): ReactElement {
  const digitos = item.codigo
  const fmt = fmtNcm(digitos)
  const secao = secaoDoNcm(digitos)
  const sub6 = `${digitos.slice(0, 4)}.${digitos.slice(4, 6)}`
  const ext = Boolean(item.dataFim)
  const vinculos = item.totalClassificacoes
  const estado: 'ok' | 'multi' | 'extinto' | 'geral' = ext ? 'extinto' : vinculos >= 2 ? 'multi' : vinculos === 1 ? 'ok' : 'geral'
  const descLimpa = limparTextoFiscal(item.descricao)

  const titulo = ext
    ? `Classificar ${fmt} oficialmente (NCM extinto)`
    : vinculos >= 2
      ? `Classificar ${fmt} oficialmente — há ${vinculos} enquadramentos oficiais`
      : `Classificar ${fmt} oficialmente`

  return (
    <div
      role="option"
      aria-selected={ativo}
      aria-label={`${fmt}: ${descLimpa}. ${ext ? `Extinto em ${item.dataFim}. ` : 'Vigente. '}${
        vinculos === 1
          ? '1 enquadramento na Reforma.'
          : vinculos >= 2
            ? `${vinculos} enquadramentos possíveis — escolher na classificação oficial.`
            : 'Sem vínculo — tributação integral (regra geral).'
      }`}
      data-indice={indice}
      data-extinto={ext || undefined}
      data-estado={estado}
      className="ncm-resultado group"
      onClick={() => onEscolher(digitos)}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          onEscolher(digitos)
        }
      }}
      tabIndex={0}
      title={titulo}
    >
      {/* Barra lateral de estado (vigente/vínculo/extinto) — escaneável a olho. */}
      <span aria-hidden="true" className="ncm-resultado-barra" />

      <span className="min-w-0 flex-1">
        {/* Eyebrow: Seção do SH + família SH6. */}
        <span className="ncm-resultado-eyebrow">
          {secao ? (
            <span className="truncate" title={`Seção ${secao.numero} do Sistema Harmonizado`}>
              Seção {secao.numero} · {secao.nome}
            </span>
          ) : null}
          <span className="ncm-chip-familia" title="Família SH6 — como a LC 214/2025 lista os anexos">
            <span aria-hidden="true">🧬</span> {sub6}
          </span>
        </span>

        {/* Código hero + selos (vigência · enquadramentos) + copiar. */}
        <span className="ncm-resultado-linha-codigo">
          <span className="ncm-codigo">{fmt}</span>
          {ext ? (
            <span className="ncm-selo ncm-selo-extinto" title={`Extinto em ${item.dataFim}`}>
              ⛔ {item.dataFim}
            </span>
          ) : (
            <span className="ncm-selo ncm-selo-vigente" title="NCM vigente">
              ✓ Vigente
            </span>
          )}
          {vinculos >= 2 ? (
            <span
              className="ncm-selo ncm-selo-multi"
              title={`${vinculos} enquadramentos oficiais — há escolha a fazer na classificação`}
            >
              {vinculos} enquadramentos
            </span>
          ) : vinculos === 1 ? (
            <span
              className="ncm-selo ncm-selo-ok"
              title="1 enquadramento oficial na Reforma"
            >
              1 enquadramento
            </span>
          ) : (
            <span
              className="ncm-selo ncm-selo-geral"
              title="Sem vínculo específico — cai na tributação integral (regra geral)"
            >
              Regra geral · integral
            </span>
          )}
          <CopiarTexto texto={fmt} rotulo={`Copiar NCM ${fmt}`} className="ml-auto" />
        </span>

        {/* Descrição oficial (item da TEC), realçando os termos buscados. */}
        <span className="mt-1 line-clamp-2 block text-xs font-medium leading-snug text-slate-700 dark:text-slate-200">
          <Destacar texto={descLimpa} termo={termo} />
        </span>

        {/* Breadcrumb da família: Cap. › Pos. › Subposição — sempre limpa. */}
        <span className="mt-1 block">
          <NcmBreadcrumb codigo={digitos} />
        </span>
      </span>
    </div>
  )
}
