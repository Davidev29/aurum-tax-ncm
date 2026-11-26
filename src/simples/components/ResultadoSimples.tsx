/**
 * Simples Nacional — etapa 3 redesenhada.
 * Ordem fixa no DOM e na leitura: Veredito → Memória → Composição → Cenários → Ações.
 */
import { calcularConvencional } from '../calculo'
import { ANEXO_LABEL } from '../tabelas'
import { GraficosDAS } from '../Graficos'
import { fmtCarga, fmtMoeda } from '@/domain/services/format'
import type { ResultadoValidacaoFatorR } from '@/domain/simples/validacao'
import { Btn, Icone, Painel, Pill } from '@/ui/kit'
import { Secao } from '@/ui/motion'
import type { CenaSimples, SimplesState } from '../types'
import { BarraReparticao } from './BarraReparticao'
import { CartaoVeredito } from './CartaoVeredito'
import { LimiteErroGrafico } from './LimiteErroGrafico'

interface Props {
  s: SimplesState
  cena: CenaSimples
  validacao: ResultadoValidacaoFatorR
  reparticaoAberta: boolean
  setReparticaoAberta: (v: boolean | ((anterior: boolean) => boolean)) => void
  relatorioDisponivel: boolean
  onEditar: () => void
  onDas: () => void
  onInsights: () => void
  onPdf: () => void
  pdfCarregando: boolean
  onCsv: () => void
  onJson: () => void
  onDividir: () => void
  onReiniciar: () => void
}

export function ResultadoSimples({
  s, cena, validacao, reparticaoAberta, setReparticaoAberta, relatorioDisponivel,
  onEditar, onDas, onInsights, onPdf, pdfCarregando, onCsv, onJson, onDividir, onReiniciar,
}: Props) {
  const conv = cena.convExib!
  const rep = cena.repExib!
  const reparticaoVisiveis = reparticaoAberta ? cena.reparticaoItens : cena.reparticaoItens.slice(0, 4)

  const cenarioIII = (() => {
    if (!validacao.aplicavel || !cena.fr || cena.fr.anexo !== 'V' || !(s.rbt12 > 0)) return null
    try {
      return calcularConvencional({ anexoId: 'III', rbt12: s.rbt12, receitaMes: s.receitaMes, rba: s.rbt12 })
    } catch {
      return null
    }
  })()

  return (
    <Secao className="animate-slide-in mt-2 space-y-4" aria-label="Resultado do Simples Nacional">
      <nav aria-label="Seções do resultado" className="sticky top-0 z-20 flex flex-wrap gap-1.5 rounded-xl border border-[var(--line)] bg-[var(--surface-2)]/95 px-2 py-2 backdrop-blur">
        {[
          ['veredito', '1 · Veredito'],
          ['memoria', '2 · Memória'],
          ['composicao', '3 · Composição'],
          ['cenarios', '4 · Cenários'],
          ['acoes', '5 · Ações'],
        ].map(([id, rotulo]) => (
          <a
            key={id}
            href={`#simples-${id}`}
            className="btn-press min-h-11 rounded-lg px-3 py-1.5 text-[13px] font-bold text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {rotulo}
          </a>
        ))}
      </nav>

      <div id="simples-veredito" className="scroll-mt-20">
        <CartaoVeredito
          cena={cena}
          rbt12={s.rbt12}
          folha12={s.folha12}
          aplicavelFatorR={validacao.aplicavel}
          onEditar={onEditar}
          onDas={onDas}
        />
      </div>

      {/* 2 · MEMÓRIA DE CÁLCULO */}
      <section id="simples-memoria" className="scroll-mt-20 space-y-3" aria-labelledby="simples-memoria-titulo">
        <Painel>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-3">
            <h2 id="simples-memoria-titulo" className="text-xl font-extrabold tracking-tight">2 · Memória de cálculo</h2>
            <Pill cor="brand">{cena.segResultado ? `Segregado ${cena.segResultado.anexos.join(' + ')}` : ANEXO_LABEL[conv.anexoId]}</Pill>
          </div>
          <ol className="space-y-2.5 px-4 py-4 text-[13px] leading-relaxed">
            {validacao.aplicavel && s.folha12 > 0 ? (
              <li className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-slate-50/70 px-2 py-1.5 dark:bg-slate-950/40">
                <span><strong>0 · Fator R</strong> — folha ÷ RBT12</span>
                <span className="font-mono font-bold">{fmtMoeda(s.folha12)} ÷ {fmtMoeda(s.rbt12)} = {fmtCarga(cena.fr?.indice ? cena.fr.indice * 100 : 0)} → Anexo {cena.fr?.anexo ?? '—'}</span>
              </li>
            ) : null}
            <li className="flex flex-wrap items-baseline justify-between gap-2">
              <span><strong>1 · RBT12</strong> — receita dos 12 meses</span>
              <span className="font-mono font-bold">{fmtMoeda(s.rbt12)}</span>
            </li>
            <li className="flex flex-wrap items-baseline justify-between gap-2">
              <span><strong>2 · Receita do mês</strong> — base do DAS</span>
              <span className="font-mono font-bold">{fmtMoeda(s.receitaMes)}</span>
            </li>
            <li className="flex flex-wrap items-baseline justify-between gap-2">
              <span><strong>3 · Alíquota efetiva</strong> — tabela do anexo</span>
              <span className="font-mono font-bold text-brand-700 dark:text-aurum-200">
                {fmtCarga((conv.aliquotaEfetivaGuia ?? conv.aliquotaEfetiva) * 100)}{conv.excedeSublimite ? ' (guia)' : ''}
              </span>
            </li>
            {cena.segResultado ? (
              <li className="flex flex-wrap items-baseline justify-between gap-2">
                <span><strong>4 · Segregação e ST</strong> — soma das parcelas</span>
                <span className="font-mono">{cena.segResultado.parcelas.length} parcela(s){cena.stResumo ? ` · − ${fmtMoeda(cena.stResumo.deducao)}` : ''}</span>
              </li>
            ) : null}
            <li className="flex flex-wrap items-baseline justify-between gap-2 border-t border-[var(--line)] pt-2.5 font-black">
              <span>Total da guia</span>
              <span className="font-mono">{fmtMoeda(cena.dasExib)}</span>
            </li>
          </ol>
          {cena.segResultado ? (
            <details className="border-t border-[var(--line)] px-4 py-3">
              <summary className="cursor-pointer text-[13px] font-black uppercase tracking-wider text-slate-600">Desmembramentos e fechamento</summary>
              <div className="mt-2 space-y-2">
                {cena.segResultado.parcelas.map((d, i) => (
                  <div key={`${d.anexoId}-${i}`} className="rounded-xl bg-slate-50/70 px-3 py-2 text-[13px] dark:bg-slate-950/40">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong>
                        {d.anexoCalculado !== d.escolhido ? `Anexo ${d.escolhido} → ${d.anexoCalculado}` : d.resto ? `Restante · Anexo ${d.anexoId}` : `Anexo ${d.anexoId}`}
                        {d.anexoCalculado !== d.escolhido ? <Pill cor="amber">Fator R</Pill> : null}
                        {d.st && d.deducaoST > 0 ? <Pill cor="amber">ST {d.tributoST}</Pill> : null}
                      </strong>
                      <span className="font-mono">
                        {d.st && d.deducaoST > 0 ? <span className="mr-1.5 text-slate-600 line-through">{fmtMoeda(d.dasBrutoGuia)}</span> : null}
                        <strong>{fmtMoeda(d.dasGuia)}</strong>
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap justify-between font-mono text-[13px] text-slate-600">
                      <span>Receita {fmtMoeda(d.receitaMes)}</span><span>{d.faixa}ª faixa</span>
                    </div>
                  </div>
                ))}
                <p className="text-[13px] text-slate-600">Cada parcela usa a RBT12 total na sua tabela; o DAS é a soma.</p>
              </div>
            </details>
          ) : null}
          <div className="border-t border-[var(--line)] px-4 py-2">
            <button type="button" onClick={onEditar} className="min-h-11 text-[13px] font-bold text-brand-700 underline dark:text-aurum-200">
              Editar estes dados
            </button>
          </div>
        </Painel>
      </section>

      {/* 3 · COMPOSIÇÃO (uma só casa para a repartição) */}
      <section id="simples-composicao" className="scroll-mt-20" aria-labelledby="simples-composicao-titulo">
        <Painel>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-3">
            <h2 id="simples-composicao-titulo" className="flex items-center gap-2 text-xl font-extrabold tracking-tight">
              <Icone nome="rosca" className="h-5 w-5 text-brand-700 dark:text-aurum-200" /> 3 · Composição do DAS
            </h2>
            <span className="text-[13px] text-slate-600">Para onde vai cada tributo</span>
          </div>
          <div className="space-y-3 p-4">
            <BarraReparticao
              partes={[
                { rotulo: 'IRPJ', valor: rep.IRPJ, classe: 'calc-bar-ibs', cor: '#2b3f63' },
                { rotulo: 'CSLL', valor: rep.CSLL, classe: 'calc-bar-ibs', cor: '#475569' },
                { rotulo: 'CBS', valor: rep.CBS, classe: 'calc-bar-cbs', cor: '#be9433' },
                { rotulo: 'IBS', valor: rep.IBS, classe: 'calc-bar-ibs', cor: '#eab308' },
                { rotulo: 'CPP', valor: rep.CPP, classe: 'calc-bar-cbs', cor: '#047857' },
                { rotulo: 'ICMS/IPI/ISS', valor: rep.ICMS + rep.IPI + rep.ISS, classe: 'calc-bar-ibs', cor: '#0284c7' },
              ]}
            />
            <ul className="space-y-1 text-[13px]">
              {reparticaoVisiveis.map((t) => {
                const dedST = cena.deducaoSTPorTributo[t as 'ICMS' | 'ISS'] ?? 0
                return (
                  <li key={t} className="flex items-center justify-between gap-2">
                    <span className="text-slate-600">
                      {t}{dedST > 0 ? <Pill cor="amber">ST</Pill> : null}
                    </span>
                    <span className="font-mono font-semibold">
                      {fmtMoeda(rep[t])}
                      {dedST > 0 ? <span className="ml-1.5 text-amber-700 line-through" title={`ST: − ${fmtMoeda(dedST)}`}>− {fmtMoeda(dedST)}</span> : null}
                    </span>
                  </li>
                )
              })}
            </ul>
            {cena.reparticaoItens.length > 4 ? (
              <button type="button" onClick={() => setReparticaoAberta(!reparticaoAberta)} className="min-h-11 text-[13px] font-bold text-brand-700 dark:text-aurum-200">
                {reparticaoAberta ? '▾ Recolher' : `▸ Ver todos os ${cena.reparticaoItens.length} tributos`}
              </button>
            ) : null}
            {conv.excedenteISS > 0 ? (
              <p className="rounded-lg bg-amber-50 px-2 py-1 text-[13px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">ISS travado em 5% (excedente redistribuído).</p>
            ) : null}
            {conv.excedeSublimite ? (
              <div className="space-y-1 rounded-lg bg-amber-50 px-2 py-1.5 text-[13px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                <p className="font-bold">Fora da guia (sublimite)</p>
                <div className="flex justify-between"><span>ICMS / ISS / IBS</span><span className="font-mono">{fmtMoeda(cena.convExib!.foraSublimite.total)}</span></div>
                <div className="flex justify-between border-t border-amber-200 pt-1 font-bold"><span>Carga total do mês</span><span className="font-mono">{fmtMoeda(cena.cargaTotalExib)}</span></div>
              </div>
            ) : null}
            <div key={`graf-${cena.dasExib}-${cena.stResumo?.deducao ?? 0}`} className="min-w-0 overflow-hidden rounded-xl">
              <LimiteErroGrafico>
                <GraficosDAS
                  final={rep}
                  bruta={cena.segResultado?.temST ? cena.segResultado.reparticaoBrutaGuia : undefined}
                  dasBruto={cena.segResultado?.dasBrutoGuia ?? cena.dasExib}
                  dasFinal={cena.dasExib}
                  temST={!!cena.stResumo}
                />
              </LimiteErroGrafico>
            </div>
          </div>
        </Painel>
      </section>

      {/* 4 · CENÁRIOS */}
      <section id="simples-cenarios" className="scroll-mt-20 space-y-3" aria-labelledby="simples-cenarios-titulo">
        <h2 id="simples-cenarios-titulo" className="text-xl font-extrabold tracking-tight">4 · Cenários e comparativos</h2>
        {s.compararHibrido && cena.hibExib ? (
          <Painel>
            <div className="border-b border-[var(--line)] px-3 py-2">
              <h3 className="text-[13px] font-black text-slate-600">⚖ Convencional × Híbrido{cena.segResultado ? ' (seg.)' : ''}</h3>
            </div>
            <div className="space-y-1.5 p-3 text-[13px]">
              <div className="flex justify-between"><span className="text-slate-600">Guia convencional</span><strong className="font-mono">{fmtMoeda(cena.dasExib)}</strong></div>
              <div className="flex justify-between"><span className="text-slate-600">DAS reduzido (guia s/ CBS)</span><strong className="font-mono">{fmtMoeda(cena.hibExib.dasReduzido)}</strong></div>
              <div className="flex justify-between"><span className="text-slate-600">CBS fora</span><strong className="font-mono">{fmtMoeda(cena.hibExib.cbsFora)}</strong></div>
              <div className="flex justify-between border-t border-[var(--line)] pt-1.5"><span className="font-bold">Total híbrido (guia)</span><strong className="font-mono">{fmtMoeda(cena.hibExib.total)}</strong></div>
              <div className={`rounded-xl px-2.5 py-1.5 text-center font-bold ${
                cena.hibExib.melhor === 'hibrido' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200'
                  : cena.hibExib.melhor === 'convencional' ? 'bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200'
                    : 'bg-slate-100 text-slate-600'}`}>
                {cena.hibExib.melhor === 'empate' ? 'Empate técnico' : `${cena.hibExib.melhor === 'hibrido' ? 'Híbrido' : 'Convencional'} − ${fmtMoeda(Math.abs(cena.hibExib.economiaVsConvencional))}`}
              </div>
            </div>
          </Painel>
        ) : null}
        {cenarioIII ? (
          <Painel>
            <div className="border-b border-[var(--line)] px-3 py-2">
              <h3 className="text-[13px] font-black text-slate-600">🔁 E se a folha chegasse a 28%?</h3>
            </div>
            <p className="p-3 text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
              Com a folha atual o enquadramento é o Anexo V. Atingindo 28%, o Anexo III teria DAS de{' '}
              <strong className="font-mono text-slate-900 dark:text-white">{fmtMoeda(cenarioIII.dasGuia ?? cenarioIII.das)}</strong>.
              Simulação ilustrativa — não altera o cálculo acima.
            </p>
          </Painel>
        ) : null}
        {s.modo === 'cnpj' && s.empresaNome && s.cnaeEscolhido ? (
          <Painel>
            <div className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="min-w-0">
                <h3 className="text-[13px] font-black text-slate-600">✂ Dividir em 2</h3>
                <p className="text-[13px] text-slate-600">Simule mãe × nova empresa com o mesmo faturamento.</p>
              </div>
              <Btn tam="sm" variante="primary" onClick={onDividir}>Abrir simulação</Btn>
            </div>
          </Painel>
        ) : null}
      </section>

      {/* 5 · AÇÕES (barra única) */}
      <section id="simples-acoes" className="scroll-mt-20 sticky bottom-0 z-10" aria-label="Ações">
        <div className="flex flex-wrap gap-1.5 rounded-xl border border-[var(--line)] bg-[var(--surface-2)]/95 p-2 backdrop-blur">
          <Btn tam="sm" onClick={onCsv}>CSV</Btn>
          <Btn tam="sm" onClick={onJson}>JSON</Btn>
          <Btn tam="sm" onClick={onDas}>Guia DAS</Btn>
          <Btn tam="sm" onClick={onReiniciar}>↺ Reiniciar</Btn>
          {relatorioDisponivel ? (
            <Btn tam="sm" onClick={onInsights}>✦ Relatório analítico</Btn>
          ) : null}
          <Btn tam="sm" variante="primary" carregando={pdfCarregando} onClick={onPdf}>
            {pdfCarregando ? 'Gerando…' : 'PDF analítico'}
          </Btn>
        </div>
      </section>

      <p className="px-1 text-[13px] leading-relaxed text-slate-600">
        Planilhas 2027–2028 · confirme com o contador.
      </p>
      <span className="sr-only" aria-live="polite">
        Resultado: DAS de {fmtMoeda(cena.dasExib)}, anexo {conv.anexoId}, Fator R {cena.fr ? fmtCarga(cena.fr.indice * 100) : 'não calculado'}.
      </span>
    </Secao>
  )
}
