/**
 * Consulta enxuta — componentes compactos da tela de Consulta NCM.
 *
 * Princípio premium: UM herói comportado (faixa + NCM + 1 linha fiscal + ações
 * primárias) + excesso em botões que abrem modais glass padrão do sistema.
 * Nenhum `<details>` longo no herói — detalhes fiscais, simulação, redação e
 * observações moram em `ModalDetalheFiscal` (glassmorphism).
 *
 * Nenhum componente aqui decide regra fiscal — só apresenta `Classificacao`
 * já resolvida (apresentação pura, paridade com `cartoes.tsx`).
 */
import { useState, type ReactElement, type ReactNode } from 'react'
import type { Classificacao, NomenclaturaNcm } from '@/domain/entities'
import { fmtNbs, fmtNcm, norm } from '@/domain/services/format'
import { observacoesFiscais } from '@/domain/services/calculo'
import { FaixaTributaria } from './faixa-tributaria'
import { Btn } from './kit'
import { IconeAurumPremium, SeloAurumAI, LinhaPreferidaAurumAI } from './aurum-ai'
import { BotaoDetalhePremium, ModalDetalheFiscal } from './consulta-premium'
import { BotaoVerLegislacao, type BloqueioSistema } from './cartoes'
import { ListaObservacoes } from './cartoes'
import { PillAnexos } from './cartoes'
import { SeletorTributacao, useOpcaoTributacao } from './diferimento-opcoes'

/* ------------------------------------------------- cartão enxuto (1 por vez) -- */

export function CartaoEnxuto({
  cl,
  nomenclatura,
  bloqueios,
  destaqueIA = false,
  onSalvar,
  onAddCalc,
  onReclassificar,
}: {
  cl: Classificacao
  nomenclatura?: NomenclaturaNcm | null
  bloqueios?: BloqueioSistema[] | null
  destaqueIA?: boolean
  /** Recebe a classificação ATIVA (respeita a opção de diferimento escolhida). */
  onSalvar?: (cl: Classificacao) => void
  /** Recebe a classificação ATIVA (respeita a opção de diferimento escolhida). */
  onAddCalc?: (cl: Classificacao) => void
  onReclassificar?: () => void
}): ReactElement {
  // Anexo IX condicional: o cartão ganha a 2ª opção (diferimento, 0%) e
  // TUDO abaixo decorre da ativa — faixa, CST/cClassTrib, fiscal, simulador.
  const { opcao, setOpcao, ativa } = useOpcaoTributacao(cl)
  const visivel = ativa ?? cl
  const r = visivel.resumo
  const cct = visivel.cstClassTribDetalhes
  const redIBS = Number(r.percentualReducaoIBS ?? cct?.pRedIBS ?? 0)
  const redCBS = Number(r.percentualReducaoCBS ?? cct?.pRedCBS ?? 0)
  const anexo = r.anexo ?? visivel.referencia?.anexo ?? null
  const baseLegal = cct?.lcRef || visivel.baseLegal || null
  const url = r.urlLegislacao ?? visivel.referencia?.urlLegislacao ?? null
  const ehManual = visivel.manual != null
  const negado = bloqueios?.some((b) => b.permitido === false) ?? false
  const obs = observacoesFiscais(visivel.codigo, visivel, nomenclatura ?? null)
  const [fiscalAberto, setFiscalAberto] = useState(false)
  // O mesmo cartão serve a NCM (8 dígitos) e NBS (9 dígitos, tela Serviços):
  // rótulos e ficha acompanham o tipo do código.
  const ehNbs = norm(visivel.codigo).length === 9
  const rotuloCodigo = ehNbs ? 'NBS' : 'NCM'
  const codigoFormatado = visivel.codigoFormatado || (ehNbs ? fmtNbs(visivel.codigo) : fmtNcm(visivel.codigo))

  return (
    <article className={`panel animate-fade-up p-4 sm:p-5 ${destaqueIA ? 'aurum-ai-destaque' : ''}`} aria-label={`${rotuloCodigo} ${codigoFormatado} — ${r.descricaoCClassTrib ?? 'classificação'}`}>
      {destaqueIA ? (
        <div className="mb-2 flex items-center gap-2">
          <SeloAurumAI variante="compacto" />
        </div>
      ) : null}
      <FaixaTributaria redIBS={redIBS} redCBS={redCBS} anexo={anexo} baseLegal={baseLegal} />

      <SeletorTributacao cl={cl} opcao={opcao} onChange={setOpcao} />

      <div className="mt-3">
        <div className="font-mono text-xl font-black tracking-tight text-brand-700 dark:text-aurum-200">
          {codigoFormatado}
        </div>
        <div className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{visivel.descricao || nomenclatura?.descricao || '—'}</div>
      </div>
      <p className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">
        CST {visivel.cst || '000'} · cClassTrib {visivel.cClassTrib || '000001'}
        {opcao === 'diferimento' ? ' · ⏳ com diferimento' : ''}
        {negado ? ' · ⛔ negado em DFe' : ''}
        {ehManual ? ' · 👤 manual' : ''}
      </p>
      <PillAnexos codigo={visivel.codigo} />

      <div className="mt-3 flex flex-wrap gap-2">
        {onSalvar ? (
          <Btn variante="primary" tam="sm" onClick={() => onSalvar(visivel)}>💾 Salvar</Btn>
        ) : null}
        {onAddCalc ? (
          <Btn tam="sm" onClick={() => onAddCalc(visivel)}>🧮 Calculadora</Btn>
        ) : null}
        {onReclassificar ? (
          <Btn tam="sm" onClick={onReclassificar}>✋ Reclassificar</Btn>
        ) : null}
      </div>

      {/* Excesso comportado: botões premium → modais glass padrão. */}
      <div className="aurum-ai-acoes" role="group" aria-label="Detalhes da classificação">
        <BotaoDetalhePremium
          icone="📋"
          rotulo="Detalhes fiscais"
          contagem={obs.length || undefined}
          titulo={ehNbs
            ? 'Ficha completa do serviço: NBS, enquadramento, condições, documentos, observações, simulação e redação — abre em modal glass'
            : 'Ficha completa do produto: NCM, enquadramento, condições, documentos, DFe, observações, simulação e redação — abre em modal glass'}
          onClick={() => setFiscalAberto(true)}
        />
        {url ? (
          <BotaoVerLegislacao url={url} titulo={baseLegal ?? 'Legislação'} referencia={baseLegal} texto={r.descricaoCClassTrib ?? null} rotulo="Legislação" className="btn-detalhe-premium" />
        ) : null}
      </div>

      <ModalDetalheFiscal
        aberto={fiscalAberto}
        onFechar={() => setFiscalAberto(false)}
        cl={cl}
        nomenclatura={nomenclatura}
        bloqueios={bloqueios}
      />
    </article>
  )
}

/* ------------------------------------------------- alternativas compactas -- */

export interface ItemAlternativa {
  codigo: string
  titulo: string
  subtitulo?: string
  selo?: string
}

export function AlternativasCompactas({
  itens,
  onEscolher,
  rotulo,
  codigoPreferido,
}: {
  itens: ItemAlternativa[]
  onEscolher: (codigo: string) => void
  rotulo: string
  /** NCM preferido da IA — ganha linha cintilante em espectro abaixo. */
  codigoPreferido?: string | null
}): ReactElement | null {
  if (!itens.length) return null
  const norm = (c: string) => c.replace(/\D+/g, '')
  const visiveis = itens.slice(0, 5)
  const restantes = itens.length - visiveis.length
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-2 dark:border-slate-800 dark:bg-slate-950/40">
      <div className="px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">{rotulo}</div>
      <ul className="space-y-1">
        {visiveis.map((it) => {
          const preferido = codigoPreferido != null && norm(it.codigo) === norm(codigoPreferido)
          return (
            <li key={it.codigo}>
              <button
                type="button"
                onClick={() => onEscolher(it.codigo)}
                title={preferido ? 'Referência preferida da IA' : it.titulo}
                className="block w-full rounded-lg px-2 py-1.5 text-left text-xs transition hover:bg-brand-50 dark:hover:bg-brand-900/30"
              >
                <span className="flex w-full items-center gap-2">
                  <span className="shrink-0 font-mono font-bold text-brand-700 dark:text-aurum-200">{it.titulo}</span>
                  {it.subtitulo ? (
                    <span className="min-w-0 flex-1 truncate text-slate-500 dark:text-slate-400">{it.subtitulo}</span>
                  ) : null}
                  {preferido ? (
                    <span className="aurum-ai-selo-preferido">
                      <IconeAurumPremium tamanho="sm" /> IA
                    </span>
                  ) : it.selo ? (
                    <span className="shrink-0 rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-black text-slate-500 dark:bg-slate-800 dark:text-slate-400">{it.selo}</span>
                  ) : null}
                </span>
                {preferido ? <LinhaPreferidaAurumAI /> : null}
              </button>
            </li>
          )
        })}
      </ul>
      {restantes > 0 ? (
        <div className="px-2 py-1 text-[10px] text-slate-400">+ {restantes} alternativa{restantes > 1 ? 's' : ''} na busca completa…</div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------- detalhes colapsáveis -- */

export function DetalhesEnxutos({ titulo, children }: { titulo: string; children: ReactNode }): ReactElement {
  return (
    <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
      <summary className="cursor-pointer font-bold">{titulo}</summary>
      <div className="mt-2 space-y-2">{children}</div>
    </details>
  )
}

/** Observações legais em bloco único colapsado (evita N cartões de aviso). */
export function ObservacoesEnxutas({ itens }: { itens: Parameters<typeof ListaObservacoes>[0]['itens'] }): ReactElement | null {
  if (!itens.length) return null
  return (
    <DetalhesEnxutos titulo={`Observações legais (${itens.length})`}>
      <ListaObservacoes itens={itens} />
    </DetalhesEnxutos>
  )
}

/* ------------------------------------------------- fora de escopo (recusa) -- */

/**
 * Cartão de recusa fixa — a ÚNICA resposta para pedidos externos ao sistema
 * (conhecimento geral, tarefas de escrita/código, jailbreak…).
 *
 * Anti-alucinação por construção: texto 100% estático (prop `mensagem` com
 * valor padrão fixo), sem NCM, sem CST, sem cálculo, sem candidatos e sem
 * chamada a worker/LLM. Abaixo da mensagem, 3 exemplos do que a IA atende
 * (texto puro, sem botões que disparem classificação).
 */
export function CartaoForaDeEscopo({ mensagem }: { mensagem: string }): ReactElement {
  return (
    <div
      className="rounded-2xl border-2 border-slate-300 bg-slate-50 p-4 dark:border-slate-600 dark:bg-slate-900"
      role="alert"
      aria-live="assertive"
      aria-label="Pedido fora do escopo do sistema"
    >
      <div className="flex items-center gap-2 text-sm font-black text-slate-700 dark:text-slate-200">
        <IconeAurumPremium tamanho="md" />
        <span>Fora do meu escopo</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-200">{mensagem}</p>
      <div className="mt-3 rounded-xl bg-white/70 p-2.5 text-xs text-slate-500 dark:bg-slate-950/50 dark:text-slate-400">
        <strong>Posso ajudar com:</strong> NCM de um produto (ex.: “queijo parmesão”) · código de 8 dígitos
        (ex.: 0201.10.00) · nome comercial (ex.: “air fryer”, “whey protein”).
      </div>
    </div>
  )
}
