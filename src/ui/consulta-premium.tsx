/**
 * Consulta premium — herói compacto + excesso em modais glass.
 *
 * Princípio: UM veredito reina (NCM + confiança + 1 linha fiscal + CTA
 * primário). Todo o resto — NCMs analisados, raciocínio, JSON, auditoria,
 * detalhes fiscais, simulação — mora em botões que abrem o `Modal` padrão
 * do sistema (glassmorphism, `.glass-box`).
 *
 * O modal "NCMs analisados" marca a referência preferida da IA com selo +
 * linha cintilante em espectro (`LinhaPreferidaAurumAI`).
 */
import { useState, type ReactNode } from 'react'
import type { Classificacao, NomenclaturaNcm } from '@/domain/entities'
import { fmtNcm, fmtPct } from '@/domain/services/format'
import { NOME_IA } from '@/domain/aurum-ai'
import { Modal, Pill } from './kit'
import { FontesAurumAI, IconeAurumPremium, LinhaPreferidaAurumAI } from './aurum-ai'
import { anexoOficial, observacoesFiscais } from '@/domain/services/calculo'
import { rotuloAnexoOficial } from '@/domain/constants/tributarios'
import { Campo, Secao, SecaoInformacoesAdicionais } from './detalhes'
import {
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
  titulo = 'NCMs analisados pela Aurum AI',
  subtitulo,
  onEscolher,
}: {
  aberto: boolean
  onFechar: () => void
  itens: ItemNcmAnalisado[]
  /** NCM que a IA usou como referência preferida — ganha selo + linha espectro. */
  codigoPreferido?: string | null
  titulo?: string
  subtitulo?: string
  onEscolher: (codigo: string) => void
}) {
  const norm = (c: string) => c.replace(/\D+/g, '')
  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo={`🔎 ${titulo}`}
      subtitulo={subtitulo ?? `A ${NOME_IA} confrontou ${itens.length} hipótese(s) com a base oficial — a preferida está destacada.`}
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
                onEscolher(it.codigo)
                onFechar()
              }}
              className={`consulta-ncm-item${preferido ? ' consulta-ncm-item--preferido' : ''}`}
              title={preferido ? 'Referência preferida da IA — clique para classificar oficialmente' : 'Clique para classificar oficialmente'}
            >
              <span className="consulta-ncm-item-topo">
                <span className="font-mono text-sm font-black text-brand-700 dark:text-aurum-200">
                  {it.titulo}
                </span>
                {preferido ? (
                  <span className="aurum-ai-selo-preferido" title={`A ${NOME_IA} usou este NCM como referência preferida`}>
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
      titulo={`🧠 Por que este NCM? — ${NOME_IA}`}
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
      titulo={`📚 Bases lidas e auditoria — ${NOME_IA}`}
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

/**
 * Ficha fiscal completa do produto (modal "Detalhes fiscais").
 *
 * Visão detalhada de quem clicou para inspecionar: identificação do NCM,
 * enquadramento da Reforma, condições tributárias, documentos/DFe,
 * informações adicionais, simulação, redação legal e observações.
 * Apresentação pura — nenhum dado aqui altera a `Classificacao` resolvida.
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
  const r = cl.resumo
  const cst = cl.cstDetalhes
  const cct = cl.cstClassTribDetalhes
  const ref = cl.referencia
  const vinc = cl.vinculo
  const redIBS = Number(r.percentualReducaoIBS ?? cct?.pRedIBS ?? 0)
  const redCBS = Number(r.percentualReducaoCBS ?? cct?.pRedCBS ?? 0)
  const url = r.urlLegislacao ?? cl.referencia?.urlLegislacao ?? null
  const baseLegal = cct?.lcRef || cl.baseLegal || null
  const redacao = cct?.lcRedacao ?? null
  const obsFiscais = observacoesFiscais(cl.codigo, cl, nomenclatura ?? null)
  const digitos = String(cl.codigo ?? '').replace(/\D+/g, '')
  const capitulo = digitos.length >= 2 ? digitos.slice(0, 2) : '—'
  const posicao = digitos.length >= 4 ? digitos.slice(0, 4) : '—'
  const anexo = anexoOficial(cl)
  const descricaoNcm = nomenclatura?.descricao || cl.descricao || '—'
  const extinto = Boolean(nomenclatura?.dataFim)
  const origem = cl.manual ? 'Manual (usuário)' : cl.regraGeral ? 'Regra geral' : 'Base oficial'
  const vigenciaCct =
    cct?.inicioVigencia || cct?.fimVigencia
      ? `${cct?.inicioVigencia ?? '—'} → ${cct?.fimVigencia ?? 'vigente'}`
      : '—'
  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo={`📋 ${titulo}`}
      subtitulo={`${fmtNcm(cl.codigo)} · CST ${cl.cst || '000'} · cClassTrib ${cl.cClassTrib || '000001'}`}
      largura="max-w-2xl"
    >
      <div className="space-y-4 text-xs">
        {nomenclatura?.dataFim ? <AvisoNcmExtinto nomenclatura={nomenclatura} /> : null}
        {cl.manual ? (
          <AvisoManual
            compact
            fonteDescricao={cl.manual?.fonteDescricao}
            fonteUrl={cl.manual?.fonteUrl}
          />
        ) : null}
        {cct?.inicioVigencia || cct?.fimVigencia ? <AvisoVigenciaCct cct={cct} /> : null}

        <div className="flex flex-wrap gap-1.5">
          <Pill cor={cl.regraGeral ? 'amber' : 'brand'}>
            {cl.regraGeral ? '⚠ Regra geral' : '✓ Enquadramento oficial'}
          </Pill>
          {cl.manual ? <Pill cor="amber">👤 Manual</Pill> : null}
          {cl.revogado ? <Pill cor="red">⛔ Revogado</Pill> : null}
          {extinto ? <Pill cor="red">⛔ NCM extinto</Pill> : <Pill cor="emerald">✓ NCM vigente</Pill>}
        </div>

        <Secao titulo="Produto / NCM" icone="📦">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
            <Campo rotulo="NCM" valor={fmtNcm(cl.codigo)} mono forte />
            <Campo rotulo="Código (dígitos)" valor={digitos || '—'} mono />
            <Campo rotulo="Capítulo" valor={capitulo} mono />
            <Campo rotulo="Posição" valor={posicao} mono />
            <Campo rotulo="Situação" valor={extinto ? `Extinto em ${nomenclatura?.dataFim}` : 'Vigente'} />
            <Campo rotulo="Origem" valor={origem} />
            <Campo rotulo="Início vigência NCM" valor={nomenclatura?.dataInicio ?? '—'} mono />
            <Campo rotulo="Fim vigência NCM" valor={nomenclatura?.dataFim ?? '—'} mono />
          </div>
          <p className="mt-3 text-xs font-semibold leading-relaxed text-slate-700 dark:text-slate-200" title={descricaoNcm}>
            {descricaoNcm}
          </p>
          {nomenclatura?.ato ? (
            <p className="mt-1.5 text-[10px] leading-relaxed text-slate-400" title={nomenclatura.ato}>
              📎 {nomenclatura.ato}
            </p>
          ) : null}
          {nomenclatura?.atoFim ? (
            <p className="mt-1.5 text-[10px] leading-relaxed text-slate-400" title={nomenclatura.atoFim}>
              ⛔ Ato de extinção: {nomenclatura.atoFim}
            </p>
          ) : null}
        </Secao>

        <Secao titulo="Enquadramento — Reforma (LC 214/2025)" icone="💠">
          <div className="grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-3">
            <Campo rotulo="CST" valor={cl.cst || '000'} mono forte titulo={cst?.descricao} />
            <Campo rotulo="cClassTrib" valor={cl.cClassTrib || '000001'} mono forte titulo={cct?.nome ?? cct?.descricao ?? undefined} />
            <Campo rotulo="Tipo alíquota" valor={cct?.tipoAliquota ?? '—'} />
            <Campo rotulo="Redução IBS" valor={fmtPct(redIBS)} mono />
            <Campo rotulo="Redução CBS" valor={fmtPct(redCBS)} mono />
            <Campo rotulo="Vigência cClassTrib" valor={vigenciaCct} mono />
            <Campo largo rotulo="Anexo oficial" valor={anexo ? `${anexo} · ${rotuloAnexoOficial(anexo)}` : '—'} titulo={anexo ?? undefined} />
            <Campo largo rotulo="Base legal" valor={baseLegal ?? '—'} titulo={baseLegal ?? undefined} />
            <Campo largo rotulo="Crédito para" valor={cct?.creditoPara ?? '—'} />
            <Campo rotulo="Atualizado em" valor={cct?.atualizadoEm ?? '—'} mono />
          </div>
          {cst?.descricao || cct?.nome || cct?.descricao || r.descricaoCClassTrib || vinc ? (
            <div className="mt-3 space-y-2 border-t border-dashed border-slate-200 pt-3 dark:border-slate-700">
              {cst?.descricao ? (
                <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400" title={cst.descricao}>
                  <strong>CST:</strong> {cst.descricao}
                </p>
              ) : null}
              {cct?.nome || cct?.descricao ? (
                <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400" title={[cct?.nome, cct?.descricao].filter(Boolean).join(' — ')}>
                  <strong>cClassTrib:</strong> {[cct?.nome, cct?.descricao].filter(Boolean).join(' — ') || '—'}
                </p>
              ) : null}
              {r.descricaoCClassTrib ? (
                <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400" title={r.descricaoCClassTrib}>
                  <strong>Classificação:</strong> {r.descricaoCClassTrib}
                </p>
              ) : null}
              {vinc ? (
                <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400" title={vinc.descricao || vinc.baseLegal}>
                  <strong>Vínculo oficial:</strong> {vinc.descricao || vinc.baseLegal || '—'}
                  {vinc.reducao != null ? ` · redução ${fmtPct(vinc.reducao)}` : ''}
                  {vinc.aliquotaIBS != null || vinc.aliquotaCBS != null
                    ? ` · alíq. IBS ${vinc.aliquotaIBS ?? '—'} / CBS ${vinc.aliquotaCBS ?? '—'}`
                    : ''}
                </p>
              ) : null}
            </div>
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
            <ChipCondicao rotulo="Trib. regular" valor={cct?.indTribRegular} />
            <ChipCondicao rotulo="Transf. crédito" valor={cst?.indTransferenciaCredito} />
            <ChipCondicao rotulo="IBS/CBS" valor={cst?.indIBSCBS} />
            <ChipCondicao rotulo="IBS/CBS mono" valor={cst?.indIBSCBSMono} />
          </div>
        </Secao>

        <DocsHabilitados docs={r.documentosHabilitados ?? cl.referencia?.documentos} />
        <SelosPorSistema bloqueios={bloqueios} />
        <SecaoInformacoesAdicionais
          ncm={cl.codigo}
          temCredito={
            cl.referencia?.creditoPresumido === true ||
            cl.referencia?.creditoPresumido === 'Sim' ||
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

/* -------------------------------------------------- estado local dos modais -- */

export type ModalConsultaPremium = 'ncms' | 'raciocinio' | 'auditoria' | 'fiscal' | 'simulacao' | null

export function useModalPremium() {
  const [qual, setQual] = useState<ModalConsultaPremium>(null)
  return {
    qual,
    abrir: (m: Exclude<ModalConsultaPremium, null>) => setQual(m),
    fechar: () => setQual(null),
    aberto: (m: Exclude<ModalConsultaPremium, null>) => qual === m,
  }
}
