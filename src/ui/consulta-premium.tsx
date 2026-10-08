/**
 * Consulta premium — herói compacto + excesso em modais glass.
 *
 * Princípio: UM veredito reina (NCM + confiança + 1 linha fiscal + CTA
 * primário). Todo o resto — NCMs analisados, raciocínio, JSON, auditoria,
 * detalhes fiscais, simulação — mora em botões que abrem o `Modal` padrão
 * do sistema (glassmorphism, `.glass-box`).
 *
 * O modal "NCMs analisados" marca a referência preferida da busca com selo +
 * linha cintilante em espectro (`LinhaPreferidaAurumAI`).
 */
import type { ReactNode } from 'react'
import type { Classificacao, NomenclaturaNcm } from '@/domain/entities'
import { fmtNbs, fmtNcm, fmtPct, norm } from '@/domain/services/format'
import { Modal, Pill } from './kit'
import { FontesAurumAI, IconeAurumPremium, LinhaPreferidaAurumAI } from './aurum-ai'
import { anexoOficial, observacoesFiscais } from '@/domain/services/calculo'
import { rotuloAnexoOficial } from '@/domain/constants/tributarios'
import { nomeCapitulo } from '@/domain/constants/capitulos'
import { Campo, Secao, SecaoInformacoesAdicionais } from './detalhes'
import { SeletorTributacao, useOpcaoTributacao } from './diferimento-opcoes'
import {
  AvisoIntegralFallback,
  AvisoManual,
  AvisoNcmExtinto,
  AvisoVigenciaCct,
  BotaoVerLegislacao,
  ChipCondicao,
  DocsHabilitados,
  ListaObservacoes,
  SelosPorSistema,
  SimuladorRapido,
  type BloqueioSistema,
} from './cartoes'

/* -------------------------------------------------- botão premium (glass) -- */

export function BotaoDetalhePremium({
  icone,
  rotulo,
  contagem,
  variante = 'padrão',
  titulo,
  onClick,
}: {
  icone: string
  rotulo: string
  contagem?: number
  variante?: 'padrão' | 'ia'
  titulo?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`btn-detalhe-premium${variante === 'ia' ? ' btn-detalhe-premium--ia' : ''}`}
      title={titulo ?? rotulo}
      onClick={onClick}
    >
      <span aria-hidden="true">{icone}</span>
      <span>{rotulo}</span>
      {typeof contagem === 'number' ? (
        <span className="btn-detalhe-premium-cont" aria-label={`${contagem} itens`}>
          {contagem}
        </span>
      ) : null}
    </button>
  )
}

/* -------------------------------------------------- NCMs analisados (modal) -- */

export interface ItemNcmAnalisado {
  codigo: string
  titulo: string
  subtitulo?: string
  selo?: string
}

export function ModalNcmsAnalisados({
  aberto,
  onFechar,
  itens,
  codigoPreferido,
  titulo = 'NCMs analisados pela busca automática',
  subtitulo,
  rotuloCodigo: rotuloProp,
  onEscolher,
}: {
  aberto: boolean
  onFechar: () => void
  itens: ItemNcmAnalisado[]
  /** NCM que a busca usou como referência preferida — ganha selo + linha espectro. */
  codigoPreferido?: string | null
  titulo?: string
  subtitulo?: string
  /** Rótulo do código nos textos do modal (`NCM` no Consulta, `NBS` em Serviços). */
  rotuloCodigo?: 'NCM' | 'NBS'
  /** Opcional: sem ele, o clique só fecha (modo somente-leitura, ex.: cartões CNAE). */
  onEscolher?: (codigo: string) => void
}) {
  const norm = (c: string) => c.replace(/\D+/g, '')
  const rotulo = rotuloProp ?? (/NBS/i.test(titulo ?? '') ? 'NBS' : 'NCM')
  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo={`🔎 ${titulo}`}
      subtitulo={subtitulo ?? `A busca automática confrontou ${itens.length} hipótese(s) com a base oficial — a preferida está destacada.`}
      largura="max-w-2xl"
    >
      <div className="consulta-ncm-lista">
        {itens.map((it) => {
          const preferido = codigoPreferido != null && norm(it.codigo) === norm(codigoPreferido)
          return (
            <button
              key={it.codigo}
              type="button"
              onClick={() => {
                onEscolher?.(it.codigo)
                onFechar()
              }}
              className={`consulta-ncm-item${preferido ? ' consulta-ncm-item--preferido' : ''}`}
              title={preferido ? 'Referência preferida da busca' : onEscolher ? 'Clique para classificar oficialmente' : it.titulo}
            >
              <span className="consulta-ncm-item-topo">
                <span className="font-mono text-sm font-black text-brand-700 dark:text-aurum-200">
                  {it.titulo}
                </span>
                {preferido ? (
                  <span className="aurum-ai-selo-preferido" title={`A busca usou este ${rotulo} como referência preferida`}>
                    <IconeAurumPremium tamanho="sm" /> Referência preferida
                  </span>
                ) : it.selo ? (
                  <span className="shrink-0 rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-black text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    {it.selo}
                  </span>
                ) : null}
              </span>
              {it.subtitulo ? (
                <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400" title={it.subtitulo}>
                  {it.subtitulo}
                </span>
              ) : null}
              {preferido ? <LinhaPreferidaAurumAI /> : null}
            </button>
          )
        })}
        {!itens.length ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500 dark:border-slate-700">
            Nenhuma hipótese registrada para esta resposta.
          </p>
        ) : null}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
        Escolher um item ancora no painel oficial (0/1/N + regra geral) — a decisão final é sempre
        validada pelo resolvedor oficial, nunca só pela IA.
      </p>
    </Modal>
  )
}

/* -------------------------------------------------- raciocínio + JSON (modal) -- */

export function ModalRaciocinioIA({
  aberto,
  onFechar,
  justificativa,
  trilha,
  json,
  perguntas,
  onRefinar,
}: {
  aberto: boolean
  onFechar: () => void
  justificativa: string
  trilha: { etapa: string; detalhe: string }[]
  json: Record<string, unknown> | null
  perguntas?: string[]
  onRefinar?: () => void
}) {
  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo="🧠 Por que este NCM? — resultado automático"
      subtitulo="Raciocínio auditável da resposta, sem poluir o herói."
      largura="max-w-2xl"
    >
      <div className="space-y-3 text-xs leading-relaxed">
        <p className="rounded-xl border border-[var(--line)] bg-slate-50 p-3 text-slate-700 dark:bg-slate-950/40 dark:text-slate-200">
          {justificativa}
        </p>
        {trilha.length ? (
          <ol className="list-decimal space-y-1 rounded-xl border border-[var(--line)] p-3 pl-7 text-[11px] text-slate-600 dark:text-slate-300">
            {trilha.map((t, i) => (
              <li key={i}>
                <strong>{t.etapa}:</strong> {t.detalhe}
              </li>
            ))}
          </ol>
        ) : null}
        {perguntas?.length ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <strong>❓ Para refinar:</strong> {perguntas[0]}
            {onRefinar ? (
              <div className="mt-2">
                <button type="button" onClick={() => { onRefinar(); onFechar() }} className="font-bold underline">
                  Abrir refino (destinação, composição, uso)
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {json ? (
          <details className="rounded-xl border border-slate-200 bg-slate-950 p-3 dark:border-slate-800">
            <summary className="cursor-pointer text-[11px] font-bold text-slate-300">Ver JSON da predição</summary>
            <pre className="mt-2 overflow-x-auto font-mono text-[10px] leading-relaxed text-emerald-100">
              {JSON.stringify(json, null, 2)}
            </pre>
          </details>
        ) : null}
      </div>
    </Modal>
  )
}

/* -------------------------------------------------- auditoria (modal) -- */

export function ModalAuditoriaIA({
  aberto,
  onFechar,
  fontes,
  nota,
  extra,
}: {
  aberto: boolean
  onFechar: () => void
  fontes: string[]
  nota: string
  extra?: ReactNode
}) {
  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo="📚 Bases lidas e auditoria — resultado automático"
      subtitulo="Prova de lastro oficial da decisão."
      largura="max-w-2xl"
    >
      <div className="space-y-3 text-xs leading-relaxed">
        <FontesAurumAI fontes={fontes.length ? fontes : ['Nomenclatura vigente (TEC)', 'Vínculos oficiais da Reforma (CST × cClassTrib)']} />
        <p className="text-[11px] text-slate-500 dark:text-slate-400">{nota}</p>
        {extra}
      </div>
    </Modal>
  )
}

/* -------------------------------------------------- detalhe fiscal (modal) -- */

/** Remove tags HTML da nomenclatura oficial (`<i>Gallus…</i>`), entidades e excesso de espaço. */
function limparTextoFiscal(v: unknown): string {
  return String(v ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/^[-–—\s]+/, '')
    .trim()
}

/** `2025-05-05T00:00:00` / `2025-05-05` / `05/05/2025` → `05/05/2025`. Sentinela 9999 / vazio → null. */
function fmtDataBr(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!s || /9999|31\/12\/9999/i.test(s)) return null
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  const b = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (b) return `${b[1]}/${b[2]}/${b[3]}`
  return s || null
}

function vigenciaCctTexto(inicio: unknown, fim: unknown): string | null {
  const i = fmtDataBr(inicio)
  const f = fmtDataBr(fim)
  if (!i && !f) return null
  if (i && f) return `${i} → ${f}`
  if (i) return `a partir de ${i}`
  return `vigente até ${f}`
}

/**
 * Ficha fiscal completa do produto (modal "Detalhes fiscais").
 *
 * Layout refinado (pós-auditoria multi-agente):
 * 1) **O que é** — NCM herói + descrição abaixo + 1 linha de metadados
 *    (`Cap. 01 · Animais vivos · Pos. 0105 · Vigente desde …`);
 * 2) **Quanto paga** — CST/cClassTrib em destaque + reduções em badges
 *    grandes + 1 parágrafo único de significado (sem triplicar);
 * 3) **Condições** — chips; 4) **Prova** — docs/simulação/observações.
 * Campos vazios (`—`) nunca renderizam no modal; detalhe técnico vai para
 * `<details>Dedados técnicos</details>`. Apresentação pura.
 */
export function ModalDetalheFiscal({
  aberto,
  onFechar,
  cl,
  nomenclatura,
  bloqueios,
  titulo = 'Detalhes fiscais e observações',
}: {
  aberto: boolean
  onFechar: () => void
  cl: Classificacao
  nomenclatura?: NomenclaturaNcm | null
  bloqueios?: BloqueioSistema[] | null
  titulo?: string
}) {
  // Anexo IX condicional: a ficha ganha a 2ª opção (diferimento, 0%) e o
  // enquadramento + simulador decorrem da ativa.
  const { opcao, setOpcao, ativa } = useOpcaoTributacao(cl)
  const visivel = ativa ?? cl
  const r = visivel.resumo
  const cst = visivel.cstDetalhes
  const cct = visivel.cstClassTribDetalhes
  const ref = visivel.referencia
  const vinc = visivel.vinculo
  const redIBS = Number(r.percentualReducaoIBS ?? cct?.pRedIBS ?? 0)
  const redCBS = Number(r.percentualReducaoCBS ?? cct?.pRedCBS ?? 0)
  const url = r.urlLegislacao ?? visivel.referencia?.urlLegislacao ?? null
  const baseLegal = cct?.lcRef || visivel.baseLegal || null
  const redacao = cct?.lcRedacao ?? null
  const obsFiscais = observacoesFiscais(visivel.codigo, visivel, nomenclatura ?? null)
  const digitos = String(visivel.codigo ?? '').replace(/\D+/g, '')
  // NBS (9 dígitos) tem ficha própria: sem capítulo/posição, sem vigência de
  // NCM e sem selo de extinção — a conferência é CST/cClassTrib + reduções +
  // anexo + base legal da LC 214/2025.
  const ehNbs = norm(visivel.codigo).length === 9
  const rotuloCodigo = ehNbs ? 'NBS' : 'NCM'
  const codigoFormatado = ehNbs ? fmtNbs(visivel.codigo) : fmtNcm(visivel.codigo)
  const capNum = digitos.length >= 2 ? digitos.slice(0, 2) : ''
  const nomeCap = capNum ? nomeCapitulo(capNum) : ''
  const posicao = digitos.length >= 4 ? digitos.slice(0, 4) : ''
  const anexo = anexoOficial(visivel)
  // Bloco 1 (Produto/NCM) é EXCLUSIVO do produto: só a descrição Siscomex
  // (`nomenclatura.descricao`, ex.: "Outros"). Nunca cai para
  // `visivel.descricao` — esse é o texto do enquadramento da Reforma e mora
  // no bloco 2 (significado). Sem nomenclatura, exibe aviso em vez de
  // misturar os textos.
  const descricaoNcm = limparTextoFiscal(nomenclatura?.descricao || '')
  const temDescricaoNcm = descricaoNcm.trim().length > 0 && descricaoNcm.trim() !== '—'
  const descricaoServico = limparTextoFiscal(visivel.descricao || '—')
  const extinto = !ehNbs && Boolean(nomenclatura?.dataFim)
  const inicioNcm = !ehNbs ? fmtDataBr(nomenclatura?.dataInicio) : null
  const fimNcm = !ehNbs ? fmtDataBr(nomenclatura?.dataFim) : null
  const vigenciaCct = vigenciaCctTexto(cct?.inicioVigencia, cct?.fimVigencia)
  const atualizadoEm = fmtDataBr(cct?.atualizadoEm)
  // Descrição única do enquadramento: prioriza o texto mais específico e
  // descarta repetições (cct ≈ resumo ≈ vínculo na maioria dos casos).
  const significado = (() => {
    const candidatos = [cct?.descricao || cct?.nome, r.descricaoCClassTrib, cst?.descricao].map((t) =>
      limparTextoFiscal(t || ''),
    )
    const normaliza = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim()
    const vistos = new Set<string>()
    const unicos = candidatos.filter((t) => {
      if (!t) return false
      const k = normaliza(t)
      if (vistos.has(k)) return false
      vistos.add(k)
      return true
    })
    if (!unicos.length) return null
    // Se o 2º texto só repete o 1º com outro prefixo, mantém só o 1º.
    if (unicos.length > 1 && (unicos[1].includes(unicos[0]) || unicos[0].includes(unicos[1]))) return unicos[0]
    return unicos[0]
  })()
  const vinculoExtra =
    vinc && (vinc.reducao != null || vinc.aliquotaIBS != null || vinc.aliquotaCBS != null)
      ? `Vínculo oficial${vinc.reducao != null ? ` · redução ${fmtPct(vinc.reducao)}` : ''}${
          vinc.aliquotaIBS != null || vinc.aliquotaCBS != null
            ? ` · alíq. IBS ${vinc.aliquotaIBS ?? '—'} / CBS ${vinc.aliquotaCBS ?? '—'}`
            : ''
        }`
      : null
  const temReducao = redIBS > 0 || redCBS > 0
  const reducaoTexto =
    Math.abs(redIBS - redCBS) < 0.005 ? `−${fmtPct(Math.max(redIBS, redCBS))}` : `IBS −${fmtPct(redIBS)} / CBS −${fmtPct(redCBS)}`
  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo={`📋 ${titulo}`}
      subtitulo={`${rotuloCodigo} ${codigoFormatado} · CST ${visivel.cst || '000'} · cClassTrib ${visivel.cClassTrib || '000001'}${opcao === 'diferimento' ? ' · ⏳ com diferimento' : ''}`}
      largura="max-w-2xl"
    >
      <div className="space-y-4 text-xs">
        <SeletorTributacao cl={cl} opcao={opcao} onChange={setOpcao} />
        {!ehNbs && nomenclatura?.dataFim ? <AvisoNcmExtinto nomenclatura={nomenclatura} /> : null}
        {visivel.integralFallback ? <AvisoIntegralFallback cl={visivel} /> : null}
        {visivel.manual ? (
          <AvisoManual
            compact
            fonteDescricao={visivel.manual?.fonteDescricao}
            fonteUrl={visivel.manual?.fonteUrl}
          />
        ) : null}
        {cct?.inicioVigencia || cct?.fimVigencia ? <AvisoVigenciaCct cct={cct} /> : null}

        <div className="flex flex-wrap gap-1.5">
          <Pill cor={visivel.regraGeral ? 'amber' : 'brand'}>
            {visivel.regraGeral ? '⚠ Regra geral' : '✓ Enquadramento oficial'}
          </Pill>
          {visivel.integralFallback ? <Pill cor="slate">🛡 Integral · última opção</Pill> : null}
          {opcao === 'diferimento' ? <Pill cor="brand">⏳ Com diferimento</Pill> : null}
          {visivel.manual ? <Pill cor="amber">👤 Manual</Pill> : null}
          {visivel.revogado ? <Pill cor="red">⛔ Revogado</Pill> : null}
          {ehNbs ? (
            visivel.regraGeral ? null : <Pill cor="emerald">✓ NBS oficial</Pill>
          ) : extinto ? (
            <Pill cor="red">⛔ NCM extinto</Pill>
          ) : (
            <Pill cor="emerald">✓ NCM vigente</Pill>
          )}
        </div>

        {ehNbs ? (
          <Secao titulo="Serviço / NBS — o que é" icone="🧾">
            <div className="font-mono text-lg font-black tracking-tight text-slate-900 dark:text-white" title={digitos}>
              {codigoFormatado}
            </div>
            <p className="mt-1 text-xs font-semibold leading-relaxed text-slate-700 dark:text-slate-200" title={descricaoServico}>
              {descricaoServico}
            </p>
            {visivel.detalheNbs && (visivel.detalheNbs.descricaoNbs || visivel.detalheNbs.lc || visivel.detalheNbs.descricaoLc) ? (
              <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-950/40">
                {visivel.detalheNbs.descricaoNbs ? (
                  <p className="text-xs font-black leading-relaxed text-slate-700 dark:text-slate-200" title="Nome da atividade (ponte LC 116 → NBS)">
                    🧾 {visivel.detalheNbs.descricaoNbs}
                  </p>
                ) : null}
                <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                  📖 LC 116{visivel.detalheNbs.lc ? ` — item ${visivel.detalheNbs.lc}` : ''}
                </p>
                {visivel.detalheNbs.descricaoLc ? (
                  <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400" title={visivel.detalheNbs.descricaoLc}>
                    {visivel.detalheNbs.descricaoLc}
                  </p>
                ) : null}
                <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
                  Legenda do serviço (ponte LC 116 → NBS) — o enquadramento IBS/CBS está na seção abaixo.
                </p>
              </div>
            ) : visivel.regraGeral ? (
              <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                NBS sem legenda na base — confira o código antes de escriturar. O enquadramento abaixo é a regra geral.
              </p>
            ) : null}
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              {visivel.regraGeral ? 'Regra geral' : 'Vínculo oficial'}
              {visivel.manual ? ' · Classificado por você' : ''}
            </p>
          </Secao>
        ) : (
          <Secao titulo="Produto / NCM" icone="📦">
            <div className="font-mono text-lg font-black tracking-tight text-slate-900 dark:text-white" title={digitos ? `Dígitos: ${digitos}` : undefined}>
              {codigoFormatado}
            </div>
            {temDescricaoNcm ? (
              <p className="mt-1 text-xs font-semibold leading-relaxed text-slate-700 dark:text-slate-200" title={descricaoNcm}>
                {descricaoNcm}
              </p>
            ) : (
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                Descrição do NCM indisponível na tabela Siscomex — o enquadramento da Reforma está na seção abaixo.
              </p>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              {capNum ? `Cap. ${capNum}${nomeCap ? ` · ${nomeCap}` : ''}` : ''}
              {posicao ? ` · Pos. ${posicao}` : ''}
              {extinto && fimNcm ? ` · Extinto em ${fimNcm}` : inicioNcm ? ` · Vigente desde ${inicioNcm}` : ' · Vigente'}
            </p>
            {nomenclatura?.ato ? (
              <p className="mt-1 text-[10px] leading-relaxed text-slate-400" title={nomenclatura.ato}>
                📎 {nomenclatura.ato}
              </p>
            ) : null}
            {nomenclatura?.atoFim ? (
              <p className="mt-1 text-[10px] leading-relaxed text-slate-400" title={nomenclatura.atoFim}>
                ⛔ Ato de extinção: {nomenclatura.atoFim}
              </p>
            ) : null}
            <details className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
              <summary className="cursor-pointer font-semibold">Dados técnicos do código</summary>
              <p className="mt-1 font-mono" title={digitos}>Dígitos: {digitos || '—'}</p>
              {inicioNcm || fimNcm ? (
                <p className="mt-0.5 font-mono">
                  Vigência NCM: {inicioNcm ?? '?'} → {fimNcm ?? 'vigente'}
                </p>
              ) : null}
            </details>
          </Secao>
        )}

        <Secao titulo="Enquadramento — Reforma (LC 214/2025)" icone="💠">
          <div className="flex flex-wrap items-stretch gap-2">
            <div
              className="min-w-[7rem] flex-1 rounded-xl bg-slate-950 px-3 py-2 text-white dark:bg-white dark:text-slate-950"
              title="CST — Código de Situação Tributária do IBS/CBS. Diz qual regime de tributação se aplica a esta operação."
            >
              <div className="text-[10px] font-bold uppercase opacity-60">CST</div>
              <div className="font-mono text-lg font-black leading-tight" title={cst?.descricao}>{visivel.cst || '000'}</div>
              <div className="mt-0.5 text-[10px] font-semibold normal-case leading-tight opacity-70">
                Situação tributária IBS/CBS
              </div>
            </div>
            <div
              className="min-w-[7rem] flex-1 rounded-xl bg-slate-950 px-3 py-2 text-white dark:bg-white dark:text-slate-950"
              title="cClassTrib — Classificação tributária. Detalha o tipo da operação dentro da Reforma (ex.: venda com benefício, regra geral)."
            >
              <div className="text-[10px] font-bold uppercase opacity-60">cClassTrib</div>
              <div className="font-mono text-lg font-black leading-tight" title={cct?.nome ?? cct?.descricao ?? undefined}>{visivel.cClassTrib || '000001'}</div>
              <div className="mt-0.5 text-[10px] font-semibold normal-case leading-tight opacity-70">
                Tipo da operação na Reforma
              </div>
            </div>
            <div
              className={`flex flex-1 items-center justify-center rounded-xl px-3 py-2 text-center font-black ${temReducao ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}
              title={temReducao ? `Redução de alíquota aplicada sobre a alíquota cheia: IBS −${fmtPct(redIBS)} / CBS −${fmtPct(redCBS)}. −100% = alíquota zero.` : 'Sem redução — vale a alíquota cheia do IBS/CBS (regra geral).'}
            >
              <span title={`Redução IBS ${fmtPct(redIBS)} / CBS ${fmtPct(redCBS)}`}>
                {temReducao ? reducaoTexto : 'Alíquota cheia'}
                <span className="block text-[10px] font-bold uppercase opacity-80">IBS/CBS</span>
                <span className="mt-0.5 block text-[10px] font-semibold normal-case leading-tight opacity-80">
                  {temReducao ? 'Redução da alíquota' : 'Sem redução aplicada'}
                </span>
              </span>
            </div>
          </div>
          {significado ? (
            <p className="mt-3 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300" title={significado}>
              {significado}
            </p>
          ) : null}
          {vinculoExtra ? (
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{vinculoExtra}</p>
          ) : null}
          <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
            {anexo ? (
              <Campo largo rotulo="Anexo oficial" valor={`${anexo} · ${rotuloAnexoOficial(anexo)}`} titulo={anexo ?? undefined} />
            ) : null}
            {baseLegal ? <Campo largo rotulo="Base legal" valor={baseLegal} titulo={baseLegal ?? undefined} /> : null}
          </div>
          {cct?.tipoAliquota || vigenciaCct || cct?.creditoPara || atualizadoEm ? (
            <details className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
              <summary className="cursor-pointer font-semibold">Dados técnicos do enquadramento</summary>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-3">
                {cct?.tipoAliquota ? <Campo rotulo="Tipo alíquota" valor={cct.tipoAliquota} /> : null}
                {vigenciaCct ? <Campo rotulo="Vigência cClassTrib" valor={vigenciaCct} mono /> : null}
                {cct?.creditoPara ? <Campo largo rotulo="Crédito para" valor={cct.creditoPara} /> : null}
                {atualizadoEm ? <Campo rotulo="Atualizado em" valor={atualizadoEm} mono /> : null}
              </div>
            </details>
          ) : null}
        </Secao>

        <Secao titulo="Condições tributárias" icone="🏷️">
          <div className="flex flex-wrap gap-2">
            <ChipCondicao rotulo="Redução alíquota" valor={ref?.reducaoAliquota ?? cst?.indReducao} />
            <ChipCondicao rotulo="Redução BC" valor={ref?.reducaoBcCst ?? cct?.indRedutorBC} />
            <ChipCondicao rotulo="Monofásica" valor={ref?.monofasica ?? (cct?.indMono === 1 ? 1 : 0)} />
            <ChipCondicao rotulo="Mono retenção" valor={cct?.indMonoReten} />
            <ChipCondicao rotulo="Mono retida" valor={cct?.indMonoRet} />
            <ChipCondicao rotulo="Mono diferimento" valor={cct?.indMonoDif} />
            <ChipCondicao rotulo="Crédito presumido" valor={ref?.creditoPresumido ?? (cct?.indCredPres === 1 ? 1 : 0)} />
            <ChipCondicao rotulo="Diferimento" valor={ref?.diferimento ?? cst?.indDiferimento} />
          </div>
        </Secao>

        <DocsHabilitados docs={r.documentosHabilitados ?? visivel.referencia?.documentos} />
        <SelosPorSistema bloqueios={bloqueios} />
        <SecaoInformacoesAdicionais
          ncm={visivel.codigo}
          temCredito={
            visivel.referencia?.creditoPresumido === true ||
            visivel.referencia?.creditoPresumido === 'Sim' ||
            cct?.indCredPres === 1
          }
        />
        <SimuladorRapido redIBS={redIBS} redCBS={redCBS} />
        {redacao ? (
          <details className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950/40">
            <summary className="cursor-pointer font-bold">📖 Redação legal — {baseLegal ?? 'LC 214/2025'}</summary>
            <pre className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">{redacao}</pre>
          </details>
        ) : null}
        {url ? (
          <div>
            <BotaoVerLegislacao
              url={url}
              titulo={baseLegal ?? 'Legislação'}
              referencia={baseLegal}
              texto={r.descricaoCClassTrib ?? null}
              rotulo="Visualizar legislação no trecho citado"
              className="text-xs font-semibold text-brand-600 hover:underline dark:text-aurum-200 cursor-pointer"
            />
          </div>
        ) : null}
        {obsFiscais.length ? <ListaObservacoes itens={obsFiscais} /> : null}
      </div>
    </Modal>
  )
}

/* -------------------------------------------------- simulação (modal) -- */

export function ModalSimulacaoIA({
  aberto,
  onFechar,
  titulo = 'Simulação exemplificativa',
  children,
  nota,
}: {
  aberto: boolean
  onFechar: () => void
  titulo?: string
  children: ReactNode
  nota?: string
}) {
  return (
    <Modal aberto={aberto} onFechar={onFechar} titulo={`🧮 ${titulo}`} subtitulo="Exemplo didático — não é o cálculo da operação." largura="max-w-2xl">
      <div className="space-y-3 text-xs">{children}</div>
      {nota ? <p className="text-[11px] text-slate-500 dark:text-slate-400">{nota}</p> : null}
    </Modal>
  )
}
