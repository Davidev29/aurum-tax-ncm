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
import { useState, type ReactElement } from 'react'
import type { Classificacao, NomenclaturaNcm } from '@/domain/entities'
import { LINK_LC214 } from '@/domain/constants'
import { fmtNbs, fmtNcm, norm } from '@/domain/services/format'
import { observacoesFiscais } from '@/domain/services/calculo'
import { FaixaTributaria } from './faixa-tributaria'
import { Btn } from './kit'
import { IconeAurumPremium, SeloAurumAI } from './aurum-ai'
import { BotaoDetalhePremium, ModalDetalheFiscal } from './consulta-premium'
import { BotaoVerLegislacao, type BloqueioSistema } from './cartoes'
import { AvisoIntegralFallback, PillAnexos } from './cartoes'
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
  // O mesmo cartão serve a NCM (8 dígitos) e NBS (9 dígitos, tela Serviços):
  // rótulos e ficha acompanham o tipo do código.
  const ehNbs = norm(visivel.codigo).length === 9
  const url = r.urlLegislacao ?? visivel.referencia?.urlLegislacao ?? (ehNbs ? LINK_LC214 : null)
  const ehManual = visivel.manual != null
  const negado = bloqueios?.some((b) => b.permitido === false) ?? false
  const obs = observacoesFiscais(visivel.codigo, visivel, nomenclatura ?? null)
  const [fiscalAberto, setFiscalAberto] = useState(false)
  const rotuloCodigo = ehNbs ? 'NBS' : 'NCM'
  const codigoFormatado = visivel.codigoFormatado || (ehNbs ? fmtNbs(visivel.codigo) : fmtNcm(visivel.codigo))
  // Legenda do serviço (NBS): nome da atividade + item LC 116 + texto do item,
  // separados do significado tributário (que mora na faixa + CST/cClassTrib
  // abaixo). `descricaoNbs` é o "o que é este serviço" (ex.: "Serviços
  // cirúrgicos"); sem ele o cartão mostra só o juridiquês do vínculo.
  const legendaNbs = ehNbs ? (visivel.detalheNbs ?? null) : null

  return (
    <article className={`panel animate-fade-up p-4 sm:p-5 ${destaqueIA ? 'aurum-ai-destaque' : ''}`} aria-label={`${rotuloCodigo} ${codigoFormatado} — ${r.descricaoCClassTrib ?? 'classificação'}`}>
      {destaqueIA ? (
        <div className="mb-2 flex items-center gap-2">
          <SeloAurumAI variante="compacto" />
        </div>
      ) : null}
      <FaixaTributaria redIBS={redIBS} redCBS={redCBS} anexo={anexo} baseLegal={baseLegal} />

      {visivel.integralFallback ? (
        <div className="mt-3">
          <AvisoIntegralFallback cl={visivel} />
        </div>
      ) : null}

      <SeletorTributacao cl={cl} opcao={opcao} onChange={setOpcao} />

      <div className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="font-mono text-xl font-black tracking-tight text-brand-700 dark:text-aurum-200">
            {codigoFormatado}
          </div>
          {!ehNbs && nomenclatura ? (
            nomenclatura.dataFim ? (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-black text-red-800 dark:bg-red-950/60 dark:text-red-200">
                ⛔ Extinto em {nomenclatura.dataFim}
              </span>
            ) : (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
                ✓ Vigente
              </span>
            )
          ) : null}
        </div>
        {!ehNbs && nomenclatura?.descricao ? (
          <div
            className="mt-2 flex items-start gap-2 rounded-xl border border-brand-200/60 border-l-4 border-l-brand-500 bg-brand-50/70 px-3 py-2 dark:border-aurum-900/50 dark:border-l-aurum-400 dark:bg-brand-950/30"
            title="Descrição oficial do NCM na nomenclatura vigente"
          >
            <span aria-hidden="true" className="mt-0.5 shrink-0 text-base leading-none">📦</span>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-black uppercase tracking-wider text-brand-600/80 dark:text-aurum-200/70">
                Descrição do NCM pela tabela Siscomex
              </div>
              <p className="mt-0.5 text-[15px] font-semibold leading-relaxed text-brand-900 dark:text-brand-100">
                {nomenclatura.descricao}
              </p>
            </div>
          </div>
        ) : null}
        {(() => {
          const fiscal = (visivel.descricao || '').trim()
          const oficial = (!ehNbs && nomenclatura?.descricao ? nomenclatura.descricao : '').trim()
          if (!fiscal || (oficial && fiscal === oficial)) return null
          return (
            <div className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{visivel.descricao}</div>
          )
        })()}
        {ehNbs && legendaNbs && (legendaNbs.descricaoNbs || legendaNbs.lc || legendaNbs.descricaoLc) ? (
          <div
            className="mt-2 flex items-start gap-2 rounded-xl border border-brand-200/60 border-l-4 border-l-brand-500 bg-brand-50/70 px-3 py-2 dark:border-aurum-900/50 dark:border-l-aurum-400 dark:bg-brand-950/30"
            title="Descrição do NBS — nome da atividade (ponte LC 116 → NBS)"
          >
            <span aria-hidden="true" className="mt-0.5 shrink-0 text-base leading-none">🧾</span>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-black uppercase tracking-wider text-brand-600/80 dark:text-aurum-200/70">
                Descrição do NBS — nome da atividade
              </div>
              {legendaNbs.descricaoNbs ? (
                <p className="mt-0.5 text-[15px] font-semibold leading-relaxed text-brand-900 dark:text-brand-100">
                  {legendaNbs.descricaoNbs}
                </p>
              ) : null}
              {legendaNbs.lc || legendaNbs.descricaoLc ? (
                <p
                  className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400"
                  title={legendaNbs.descricaoLc || undefined}
                >
                  <span className="font-bold">LC 116{legendaNbs.lc ? ` — item ${legendaNbs.lc}` : ''}:</span>{' '}
                  {legendaNbs.descricaoLc}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
        {ehNbs && !visivel.detalheNbs && visivel.regraGeral ? (
          <div className="mt-1 text-[11px] leading-relaxed text-slate-400">
            NBS sem legenda na base — confira o código antes de escriturar.
          </div>
        ) : null}
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
