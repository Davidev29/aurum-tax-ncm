/**
 * Modal de conferência dos produtos do XML — funciona exatamente como a
 * importação em lote.
 *
 * Motivo: há produtos cujo NCM tem mais de uma regra (2+ tributações,
 * diferimento condicional, etc.). Nada é gravado sem o usuário conferir a
 * regra de cada produto e aceitar a revisão final.
 */
import { useEffect, useMemo, useState } from 'react'
import { fmtNcm } from '@/domain/services/format'
import { dividirLoteParaSalvamento, origemLinhaLote } from '@/domain/services/salvamento-lote'
import type { ItemConferenciaXml } from '@/application/xml-conferencia'
import type { ItemLote } from '@/infrastructure/parsers/lote'
import { useConferenciaXml } from '@/store/conferencia-xml'
import {
  AvisoDiferimento,
  AvisoManual,
  AvisoNcmExtinto,
  BotaoVerLegislacao,
} from '@/ui/cartoes'
import {
  BarraConfiancaAurumAI,
  FontesAurumAI,
  MolduraAurumAI,
  SeloAurumAI,
} from '@/ui/aurum-ai'
import { Btn, Check, Modal, Painel, Texto } from '@/ui/kit'
import { Campo, Olho, Secao, SecaoInformacoesAdicionais } from '@/ui/detalhes'

type Filtro = 'todos' | 'multiplas' | 'regra-geral' | 'invalidos' | 'unicas'

const FILTROS: { id: Filtro; rotulo: string; dica: string }[] = [
  { id: 'todos', rotulo: 'Todos', dica: 'Todos os produtos das notas filtradas' },
  { id: 'multiplas', rotulo: 'Escolha assistida', dica: 'NCM com 2+ tributações — a integral de segurança vem pré-selecionada e você escolhe' },
  { id: 'regra-geral', rotulo: 'Regra geral', dica: 'Sem vínculo oficial — tributação integral vigente' },
  { id: 'invalidos', rotulo: 'Inválidos', dica: 'NCM fora do padrão de 8 dígitos' },
  { id: 'unicas', rotulo: 'Únicas', dica: 'Tributação única confirmada' },
]

const POR_PAGINA = 50

export function ModalConferenciaXml() {
  const aberto = useConferenciaXml((s) => s.aberto)
  const fechar = useConferenciaXml((s) => s.fechar)
  const resumo = useConferenciaXml((s) => s.resumo)
  const escolher = useConferenciaXml((s) => s.escolher)
  const salvar = useConferenciaXml((s) => s.salvar)
  const qtdNotas = useConferenciaXml((s) => s.qtdNotas)

  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [pagina, setPagina] = useState(1)
  const [expandidos, setExpandidos] = useState<Set<number>>(new Set())
  const [detalhe, setDetalhe] = useState<{ item: ItemLote; indiceOriginal: number } | null>(null)
  const [revisaoAberta, setRevisaoAberta] = useState(false)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (aberto) {
      setBusca('')
      setFiltro('todos')
      setPagina(1)
      setExpandidos(new Set())
      setDetalhe(null)
      setRevisaoAberta(false)
    }
  }, [aberto])

  useEffect(() => {
    setPagina(1)
  }, [busca, filtro])

  const cont = useMemo(() => {
    const itens = resumo?.itens ?? []
    return {
      todos: itens.length,
      multiplas: itens.filter((i) => i.analiseIA?.situacao === 'multipla').length,
      'regra-geral': itens.filter((i) => i.regraGeral).length,
      invalidos: itens.filter((i) => i.ncm.length !== 8).length,
      unicas: itens.filter((i) => i.analiseIA?.situacao === 'unica').length,
    } as Record<Filtro, number>
  }, [resumo])

  const linhas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return (resumo?.itens ?? [])
      .map((item, indiceOriginal) => ({ item, indiceOriginal }))
      .filter(({ item }) => {
        if (filtro === 'multiplas' && item.analiseIA?.situacao !== 'multipla') return false
        if (filtro === 'regra-geral' && !item.regraGeral) return false
        if (filtro === 'invalidos' && item.ncm.length === 8) return false
        if (filtro === 'unicas' && item.analiseIA?.situacao !== 'unica') return false
        if (!q) return true
        return `${item.codigo} ${item.nome} ${item.ncm}`.toLowerCase().includes(q)
      })
  }, [resumo, busca, filtro])

  const totalPag = Math.max(1, Math.ceil(linhas.length / POR_PAGINA))
  const pg = Math.min(Math.max(1, pagina), totalPag)
  const inicio = (pg - 1) * POR_PAGINA
  const visiveis = linhas.slice(inicio, inicio + POR_PAGINA)

  const aoConfirmar = async () => {
    setSalvando(true)
    try {
      await salvar()
    } finally {
      setSalvando(false)
    }
  }

  return (
    <>
      <Modal
        aberto={aberto}
        onFechar={fechar}
        titulo="Conferir produtos das notas"
        subtitulo={
          resumo
            ? `${resumo.itens.length} produto(s) de ${qtdNotas} nota(s) · ${cont.multiplas} com escolha necessária${resumo.comRegraDoCadastro ? ` · ${resumo.comRegraDoCadastro} com regra do cadastro` : ''} · nada é salvo sem sua revisão`
            : ''
        }
        largura="max-w-6xl"
        rodape={
          <>
            <Btn tam="sm" onClick={fechar}>
              Fechar
            </Btn>
            <Btn
              variante="primary"
              tam="sm"
              onClick={() => setRevisaoAberta(true)}
              title="Abre a revisão completa antes de salvar — nada é gravado sem o seu aceite"
            >
              💾 Revisar e salvar…
            </Btn>
          </>
        }
      >
        {!resumo ? null : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-48 flex-1">
                <Texto
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="🔍 Buscar SKU, produto ou NCM…"
                  aria-label="Buscar por SKU, produto ou NCM"
                  className="field-sm"
                />
              </div>
              <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filtrar produtos">
                {FILTROS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="tab"
                    aria-selected={filtro === f.id}
                    title={f.dica}
                    onClick={() => setFiltro(f.id)}
                    className={`lote-filtro${filtro === f.id ? ' is-ativo' : ''}`}
                  >
                    {f.rotulo}
                    <span className="lote-filtro-num num">{cont[f.id] ?? 0}</span>
                  </button>
                ))}
              </div>
            </div>
            <p className="lote-toolbar-dica">
              ✨ Com 1 tributação o oficial já vem <strong>fixado</strong>; com 2+ a{' '}
              <strong>integral de segurança já vem pré-selecionada</strong> — abra a linha, leia o
              porquê e escolha pela operação real. SKU com <strong>📦 regra do cadastro</strong> já
              traz a sua escolha salva pré-selecionada.{' '}
              <strong>Nada é salvo sem a sua revisão e aceite — e o salvo passa a valer na apuração.</strong>
            </p>
            <Painel className="lote-tabela overflow-hidden">
              <div className="lote-tabela-rolagem max-h-[56vh] overflow-auto">
                <table className="tbl lote-tbl w-full">
                  <thead>
                    <tr>
                      <th>SKU · Produto · NCM</th>
                      <th>Tributação</th>
                      <th>✨ Automático</th>
                      <th className="th-r">Detalhe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiveis.map(({ item, indiceOriginal }, i) => (
                      <LinhaConferencia
                        key={`${item.codigo}-${indiceOriginal}`}
                        item={item}
                        indiceOriginal={indiceOriginal}
                        aberto={expandidos.has(indiceOriginal)}
                        atraso={Math.min(i * 25, 400)}
                        onAlternar={() =>
                          setExpandidos((ant) => {
                            const nx = new Set(ant)
                            if (nx.has(indiceOriginal)) nx.delete(indiceOriginal)
                            else nx.add(indiceOriginal)
                            return nx
                          })
                        }
                        onDetalhe={() => setDetalhe({ item, indiceOriginal })}
                        onEscolher={escolher}
                      />
                    ))}
                    {linhas.length > POR_PAGINA ? (
                      <tr>
                        <td colSpan={4} className="px-0 py-0">
                          <div className="lote-paginacao">
                            <span className="lote-paginacao-cont num">
                              Mostrando {inicio + 1}–{Math.min(inicio + visiveis.length, linhas.length)} de{' '}
                              {linhas.length} produtos
                            </span>
                            <span className="lote-paginacao-nav">
                              <button type="button" className="lote-paginacao-btn" disabled={pg <= 1} onClick={() => setPagina(pg - 1)}>
                                ‹ Anterior
                              </button>
                              <span className="lote-paginacao-pag num">
                                Página {pg} de {totalPag}
                              </span>
                              <button type="button" className="lote-paginacao-btn" disabled={pg >= totalPag} onClick={() => setPagina(pg + 1)}>
                                Próxima ›
                              </button>
                            </span>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr>
                        <td colSpan={4} className="px-3 py-3 text-center text-[11px] text-slate-500">
                          Exibindo {linhas.length} produto(s). A seta abre a análise; 👁 abre CFOP · CST · PIS · COFINS e Reforma.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Painel>
          </div>
        )}
      </Modal>

      <ModalDetalhe item={detalhe?.item ?? null} indiceOriginal={detalhe?.indiceOriginal ?? 0} onFechar={() => setDetalhe(null)} onEscolher={escolher} />

      {resumo ? (
        <ModalRevisao
          aberto={revisaoAberta}
          nomeOrigem={resumo.nomeOrigem}
          itens={resumo.itens}
          salvando={salvando}
          onFechar={() => !salvando && setRevisaoAberta(false)}
          onConfirmar={() => void aoConfirmar()}
        />
      ) : null}
    </>
  )
}

function LinhaConferencia({
  item,
  indiceOriginal,
  aberto,
  atraso,
  onAlternar,
  onDetalhe,
  onEscolher,
}: {
  item: ItemLote
  indiceOriginal: number
  aberto: boolean
  atraso: number
  onAlternar: () => void
  onDetalhe: () => void
  onEscolher: (linha: number, opcao: number) => void
}) {
  const analise = item.analiseIA
  const c = item.escolhida
  const sugerida = analise ? analise.maisProvavelIndice : 0
  const indiceEscolhido = Math.max(0, item.classificacoes.findIndex((x) => x.id === c?.id && x.cst === c?.cst))
  const trocouSugestao = analise && analise.totalOpcoes > 1 && indiceEscolhido !== sugerida
  const precisaRevisao =
    item.ncm.length !== 8 || analise?.situacao === 'multipla' || (analise?.situacao === 'unica' && analise.alertas.length > 0)
  const extra = item as ItemLote & { ocorrencias?: number; quantidade?: number } & Pick<ItemConferenciaXml, 'usouRegraDoCadastro' | 'regraDoCadastro'>

  return (
    <>
      <tr className={`lote-linha${aberto ? ' is-aberta' : ''}${precisaRevisao ? ' precisa-revisao' : ''}`} style={{ animationDelay: `${atraso}ms` }}>
        <td className="min-w-[220px]">
          <button type="button" onClick={onAlternar} className="lote-expansor" aria-expanded={aberto} title={aberto ? 'Recolher análise' : 'Expandir análise'}>
            <span className={`lote-chevron${aberto ? ' is-aberto' : ''}`} aria-hidden="true">▸</span>
            <span className="min-w-0 text-left">
              <span className="block truncate font-mono text-[11px] font-black">{item.codigo || '—'}</span>
              <span className="block max-w-[260px] truncate text-xs font-semibold" title={item.nome}>{item.nome || '—'}</span>
              <span className="block font-mono text-[10px] text-slate-500">NCM {fmtNcm(item.ncm) || item.ncm || '—'}</span>
              {extra.usouRegraDoCadastro && extra.regraDoCadastro ? (
                <span
                  className="mt-0.5 inline-block rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold text-brand-800 dark:bg-brand-950/60 dark:text-brand-300"
                  title={`Regra salva no cadastro do produto — pré-selecionada. Trocar aqui e salvar atualiza o cadastro e a apuração assistida.`}
                >
                  📦 regra do cadastro · {extra.regraDoCadastro.cst}·{extra.regraDoCadastro.cClassTrib}
                </span>
              ) : null}
              {extra.ocorrencias && extra.ocorrencias > 1 ? (
                <span className="block text-[10px] text-slate-400">{extra.ocorrencias} ocorrências nas notas</span>
              ) : null}
            </span>
          </button>
        </td>
        <td onClick={(e) => e.stopPropagation()} className="min-w-[190px]">
          {celula(item, indiceOriginal, onEscolher)}
        </td>
        <td className="min-w-[170px]">
          <CelulaIA item={item} indiceEscolhido={indiceEscolhido} trocouSugestao={Boolean(trocouSugestao)} />
        </td>
        <td className="text-right" onClick={(e) => e.stopPropagation()}>
          <Olho onClick={onDetalhe} titulo="Ver todos os tributos do produto + análise" />
        </td>
      </tr>
      {aberto ? (
        <tr className="lote-expansao">
          <td colSpan={4}>
            <PainelAnalise item={item} indiceOriginal={indiceOriginal} indiceEscolhido={indiceEscolhido} onDetalhe={onDetalhe} onEscolher={onEscolher} />
          </td>
        </tr>
      ) : null}
    </>
  )
}

function CelulaIA({ item, indiceEscolhido, trocouSugestao }: { item: ItemLote; indiceEscolhido: number; trocouSugestao: boolean }) {
  const a = item.analiseIA
  if (!a) return <span className="text-[11px] text-slate-400">—</span>
  if (a.situacao === 'invalida') return <span className="lote-ia lote-ia--erro" title={a.resumo}>⛔ corrigir NCM</span>
  if (a.situacao === 'extinta') return <span className="lote-ia lote-ia--erro" title={a.resumo}>⛔ NCM extinto</span>
  if (a.situacao === 'manual') return <span className="lote-ia lote-ia--manual" title={a.resumo}>👤 sua regra</span>
  if (a.situacao === 'regra-geral') return <span className="lote-ia lote-ia--geral" title={a.resumo}>⚡ regra geral</span>
  if (a.situacao === 'unica')
    return (
      <span className="lote-ia lote-ia--ok" title={a.resumo}>
        ✓ única · confirmada
        <BarraConfiancaAurumAI valor={a.confianca} compact />
      </span>
    )
  return (
    <span className="lote-ia lote-ia--multi" title={a.resumo}>
      🛡 integral sugerida · Opção {a.maisProvavelIndice + 1}/{a.totalOpcoes}
      <BarraConfiancaAurumAI valor={a.confianca} compact />
      {trocouSugestao ? (
        <span className="lote-ia-trocou">você optou pela {indiceEscolhido + 1}</span>
      ) : (
        <span className="lote-ia-ok">escolha sua ⚠</span>
      )}
    </span>
  )
}

function PainelAnalise({
  item,
  indiceOriginal,
  indiceEscolhido,
  onDetalhe,
  onEscolher,
}: {
  item: ItemLote
  indiceOriginal: number
  indiceEscolhido: number
  onDetalhe: () => void
  onEscolher: (linha: number, opcao: number) => void
}) {
  const a = item.analiseIA
  if (!a) return null
  const sugerida = a.maisProvavelIndice
  const doCadastro = (item as Partial<ItemConferenciaXml>).usouRegraDoCadastro === true
  const regraSalva = (item as Partial<ItemConferenciaXml>).regraDoCadastro
  return (
    <div className="lote-analise" aria-label={`Análise para ${item.codigo || 'item'}`}>
      <div className="lote-analise-cab">
        <SeloAurumAI variante="compacto" />
        <span className="text-[11px] font-black uppercase tracking-wide">{a.titulo}</span>
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <BarraConfiancaAurumAI valor={a.confianca} />
          <button type="button" onClick={onDetalhe} className="lote-link">👁 cartão completo</button>
        </span>
      </div>
      {doCadastro && regraSalva ? (
        <p className="rounded-xl border border-brand-200 bg-brand-50/70 px-3 py-2 text-[11px] leading-relaxed text-brand-800 dark:border-brand-900 dark:bg-brand-950/30 dark:text-brand-300">
          📦 Este SKU já tem regra salva no cadastro (<strong className="font-mono">{regraSalva.cst} · {regraSalva.cClassTrib}</strong>) — ela veio
          pré-selecionada abaixo. Trocar aqui e salvar atualiza o cadastro e a apuração assistida.
        </p>
      ) : null}
      <p className="lote-analise-resumo">{a.resumo}</p>
      {a.porqueMultiplas ? (
        <div className="lote-porque">
          <div className="lote-porque-titulo">💬 Por que {a.totalOpcoes} tributações?</div>
          <p>{a.porqueMultiplas}</p>
        </div>
      ) : null}
      {a.alertas.length ? (
        <ul className="lote-alertas">
          {a.alertas.map((al, i) => (
            <li key={i}>⚠ {al}</li>
          ))}
        </ul>
      ) : null}
      {a.opcoes.length > 1 ? (
        <div className="lote-opcoes" role="radiogroup" aria-label={`Opções oficiais para o NCM ${fmtNcm(item.ncm)}`}>
          {a.opcoes.map((op) => {
            const selecionada = op.indice === indiceEscolhido
            const ehSugerida = op.indice === sugerida
            const ehFallback = item.classificacoes[op.indice]?.integralFallback === true
            const ehIntegral = ehFallback || (op.cst === '000' && op.cClassTrib === '000001')
            return (
              <div
                key={op.indice}
                role="radio"
                aria-checked={selecionada}
                tabIndex={0}
                onClick={() => onEscolher(indiceOriginal, op.indice)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onEscolher(indiceOriginal, op.indice)
                  }
                }}
                className={`lote-opcao${selecionada ? ' is-selecionada' : ''}${ehSugerida ? ' is-sugerida' : ''}${ehFallback ? ' lote-opcao--fallback' : ''}`}
              >
                <span className="lote-opcao-topo">
                  <span className="lote-opcao-radio" aria-hidden="true">{selecionada ? '●' : '○'}</span>
                  <span className="font-mono text-[11px] font-black">Opção {op.indice + 1} · {op.cst} · {op.cClassTrib}</span>
                  {ehFallback ? <span className="lote-opcao-selo lote-opcao-selo--fallback">🛡 integral · segurança</span>
                    : ehSugerida && ehIntegral ? <span className="lote-opcao-selo lote-opcao-selo--fallback">🛡 integral sugerida · escolha sua</span>
                      : ehSugerida ? <span className="lote-opcao-selo">✨ sugestão automática</span> : null}
                  {selecionada && !ehSugerida && !ehIntegral ? <span className="lote-opcao-selo lote-opcao-selo--sua">sua escolha · benefício ⚠</span> : null}
                </span>
                <span className="lote-opcao-comentario">{op.comentario}</span>
              </div>
            )
          })}
        </div>
      ) : null}
      <p className="lote-orientacao">🧭 {a.orientacaoEscolha}</p>
      <FontesAurumAI fontes={a.fontes} />
    </div>
  )
}

function ModalDetalhe({
  item,
  indiceOriginal,
  onFechar,
  onEscolher,
}: {
  item: ItemLote | null
  indiceOriginal: number
  onFechar: () => void
  onEscolher: (linha: number, opcao: number) => void
}) {
  const c = item?.escolhida
  const a = item?.analiseIA
  const indiceEscolhido = item ? Math.max(0, item.classificacoes.findIndex((x) => x.id === c?.id && x.cst === c?.cst)) : 0
  return (
    <Modal
      aberto={item !== null}
      onFechar={onFechar}
      titulo={item ? `${item.codigo || '—'} · ${item.nome || '—'}` : ''}
      subtitulo={item ? `NCM ${fmtNcm(item.ncm) || item.ncm || '—'} · CST ${c?.cst || '—'} · cClassTrib ${c?.cClassTrib || '—'}` : ''}
      largura="max-w-2xl"
      rodape={null}
    >
      {item && a ? (
        <div className="space-y-3">
          <AvisoNcmExtinto nomenclatura={item.nomenclatura} />
          <MolduraAurumAI detalhe={a.titulo}>
            <p className="text-xs leading-relaxed">{a.resumo}</p>
            {a.porqueMultiplas ? <p className="mt-2 text-xs leading-relaxed"><strong>💬 Por que {a.totalOpcoes}?</strong> {a.porqueMultiplas}</p> : null}
            {a.opcoes.length > 1 ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold">Trocar enquadramento:</span>
                <select className="field field-sm field-mono max-w-full" value={indiceEscolhido} onChange={(e) => onEscolher(indiceOriginal, Number(e.target.value))}>
                  {item.classificacoes.map((op, j) => (
                    <option key={`${op.id}-${j}`} value={j}>
                      {op.integralFallback ? '🛡 ' : j === a.maisProvavelIndice ? '✨ ' : ''}Opção {j + 1}: {op.cst} · {op.cClassTrib}
                    </option>
                  ))}
                </select>
                <BarraConfiancaAurumAI valor={a.confianca} compact />
              </div>
            ) : null}
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">🧭 {a.orientacaoEscolha}</p>
            <FontesAurumAI fontes={a.fontes} />
          </MolduraAurumAI>
          <Secao titulo="Regime anterior" icone="🧾">
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
              <Campo rotulo="CFOP" valor={item.cfop || '—'} mono />
              <Campo rotulo="CST ICMS" valor={item.cstIcms || '—'} mono />
              <Campo rotulo="PIS" valor={item.pis || '—'} mono />
              <Campo rotulo="COFINS" valor={item.cofins || '—'} mono />
            </div>
          </Secao>
          <Secao titulo="Reforma" icone="💠">
            {c?.manual ? <div className="mb-2"><AvisoManual compact fonteDescricao={c.manual.fonteDescricao} fonteUrl={c.manual.fonteUrl} /></div> : null}
            {c ? <div className="mb-2"><AvisoDiferimento cl={c} /></div> : null}
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
              <Campo rotulo="CST" valor={c?.cst || '—'} mono />
              <Campo rotulo="cClassTrib" valor={c?.cClassTrib || '—'} mono />
              <Campo rotulo="NCM sugerido" valor={c?.codigo ? fmtNcm(c.codigo) : '—'} mono />
            </div>
            {c?.resumo?.urlLegislacao || c?.referencia?.urlLegislacao ? (
              <BotaoVerLegislacao url={c.resumo?.urlLegislacao ?? c.referencia?.urlLegislacao} titulo={`Base legal — CST ${c.cst}/${c.cClassTrib}`} referencia={c.baseLegal} texto={c.resumo?.descricaoCClassTrib ?? null} rotulo="Visualizar legislação no trecho citado" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline cursor-pointer" />
            ) : null}
            {c ? <SecaoInformacoesAdicionais ncm={c.codigo || item.ncm} temCredito={c.referencia?.creditoPresumido === true || c.cstClassTribDetalhes?.indCredPres === 1} /> : null}
          </Secao>
        </div>
      ) : null}
    </Modal>
  )
}

function celula(item: ItemLote, indice: number, escolher: (linha: number, opcao: number) => void) {
  const c = item.escolhida
  const r = c?.resumo
  const a = item.analiseIA
  const indiceEscolhido = Math.max(0, item.classificacoes.findIndex((x) => x.id === c?.id && x.cst === c?.cst))
  if (item.ncm.length !== 8) return <span className="lote-invalido">⛔ NCM inválido — confira no XML</span>
  const seloExtinto = item.nomenclatura?.dataFim ? <div className="mt-1 inline-block rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-black text-red-800">⛔ extinto — só histórico</div> : null
  if (item.manual && c) {
    return (
      <div className="lote-celula lote-celula--manual">
        <div className="font-mono text-[11px] font-bold text-amber-800">{c.cst} · {c.cClassTrib} ✋</div>
        <div className="text-[10px] text-amber-700">Manual · usuário — isenta o sistema</div>
        {seloExtinto}
      </div>
    )
  }
  if (item.regraGeral) {
    return (
      <div className="lote-celula lote-celula--geral">
        <div className="font-mono text-[11px] font-bold text-amber-800">CST 000 · 000001</div>
        <div className="text-[10px] text-amber-700">⚡ {r?.descricaoCClassTrib || 'Tributação integral'}</div>
        {seloExtinto}
      </div>
    )
  }
  if ((item.classificacoes.length === 1 || a?.situacao === 'unica') && c) {
    const temAlternativa = item.classificacoes.length > 1
    const naIntegral = temAlternativa && indiceEscolhido !== (a?.maisProvavelIndice ?? 0)
    return (
      <div className="lote-celula min-w-[170px]">
        <div className="font-mono text-[11px] font-bold">
          {c.cst} · {c.cClassTrib} {naIntegral ? <span className="lote-sugere">sua escolha · integral</span> : <span className="lote-ok">✓ auto</span>}
        </div>
        <div className="truncate text-[10px] text-slate-500" title={r?.descricaoCClassTrib}>{r?.descricaoCClassTrib || c.baseLegal}</div>
        {temAlternativa ? (
          <select className="field field-sm field-mono lote-select mt-1 w-full" value={indiceEscolhido} onChange={(e) => escolher(indice, Number(e.target.value))}>
            {item.classificacoes.map((op, j) => (
              <option key={`${op.id}-${j}`} value={j}>Opção {j + 1}: {op.cst} · {op.cClassTrib}</option>
            ))}
          </select>
        ) : null}
        {seloExtinto}
      </div>
    )
  }
  if (c) {
    return (
      <div className="lote-celula min-w-[170px]">
        <div className="font-mono text-[11px] font-bold">{c.cst} · {c.cClassTrib}</div>
        <select className="field field-sm field-mono lote-select mt-1 w-full" value={indiceEscolhido} onChange={(e) => escolher(indice, Number(e.target.value))}>
          {item.classificacoes.map((op, j) => (
            <option key={`${op.id}-${j}`} value={j}>
              {op.integralFallback ? '🛡 ' : j === a?.maisProvavelIndice ? '✨ ' : ''}Opção {j + 1}: {op.cst} · {op.cClassTrib}
            </option>
          ))}
        </select>
        {seloExtinto}
      </div>
    )
  }
  return <span className="text-[11px] text-slate-400">—</span>
}

function ModalRevisao({
  aberto,
  nomeOrigem,
  itens,
  salvando,
  onFechar,
  onConfirmar,
}: {
  aberto: boolean
  nomeOrigem: string
  itens: ItemLote[]
  salvando: boolean
  onFechar: () => void
  onConfirmar: () => void
}) {
  const [aceite, setAceite] = useState(false)
  useEffect(() => {
    if (aberto) setAceite(false)
  }, [aberto, nomeOrigem])
  const { gravaveis, ignorados } = useMemo(() => dividirLoteParaSalvamento(itens), [itens])
  const comCadastro = useMemo(
    () => gravaveis.filter((i) => (i as Partial<ItemConferenciaXml>).usouRegraDoCadastro === true).length,
    [gravaveis],
  )
  const alertas = useMemo(() => {
    const extintos = gravaveis.filter((i) => i.nomenclatura?.dataFim)
    const regraGeral = gravaveis.filter((i) => i.regraGeral)
    const naIntegral = gravaveis.filter((i) => {
      const a = i.analiseIA
      if (!a || a.situacao !== 'multipla') return false
      const esc = i.escolhida
      return Boolean(esc && (esc.integralFallback || (esc.cst === '000' && esc.cClassTrib === '000001')))
    })
    const trocadas = gravaveis.filter((i) => {
      const a = i.analiseIA
      if (!a || a.situacao !== 'multipla') return false
      const idx = Math.max(0, i.classificacoes.findIndex((x) => x.id === i.escolhida?.id && x.cst === i.escolhida?.cst))
      return idx !== a.maisProvavelIndice
    })
    return { extintos, regraGeral, trocadas, naIntegral }
  }, [gravaveis])
  const preview = gravaveis.slice(0, 8)
  const ignoradosPreview = ignorados.slice(0, 8)

  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo="Revisar antes de salvar"
      subtitulo={`${nomeOrigem} · ${gravaveis.length} para salvar · ${ignorados.length} ficarão de fora`}
      largura="max-w-2xl"
      rodape={
        <>
          <Btn tam="sm" onClick={onFechar} disabled={salvando}>Voltar e revisar</Btn>
          <Btn variante="primary" tam="sm" disabled={!aceite || !gravaveis.length} carregando={salvando} onClick={onConfirmar}>
            {salvando ? 'Salvando…' : `✓ Confirmar e salvar ${gravaveis.length}`}
          </Btn>
        </>
      }
    >
      <div className="lote-confirm space-y-3">
        <div className="lote-confirm-nums">
          <span className="lote-confirm-num lote-confirm-num--ok">✓ {gravaveis.length} serão salvos</span>
          <span className="lote-confirm-num lote-confirm-num--fora">{ignorados.length} ficarão de fora</span>
          <span className="lote-confirm-num">{itens.length} produtos nas notas</span>
        </div>
        {!gravaveis.length ? (
          <p className="lote-confirm-vazio">⛔ Nada para salvar: todos estão sem SKU ou sem classificação válida.</p>
        ) : (
          <div className="lote-confirm-bloco">
            <div className="lote-confirm-titulo">📦 O que será salvo ({gravaveis.length})</div>
            <div className="max-h-56 overflow-auto rounded-xl border border-slate-200">
              <table className="tbl w-full">
                <thead><tr><th>SKU</th><th>Produto</th><th>NCM</th><th>CST · cClassTrib</th><th>Origem</th></tr></thead>
                <tbody>
                  {preview.map((it) => (
                    <tr key={`${it.indice}-${it.codigo}`}>
                      <td className="whitespace-nowrap font-mono font-bold">{it.codigo}</td>
                      <td className="max-w-[180px] truncate" title={it.nome}>{it.nome || '—'}</td>
                      <td className="whitespace-nowrap font-mono">{fmtNcm(it.ncm)}</td>
                      <td className="whitespace-nowrap font-mono text-[11px]">{it.escolhida?.cst} · {it.escolhida?.cClassTrib}</td>
                      <td className="text-[11px]">{origemLinhaLote(it)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {gravaveis.length > preview.length ? <p className="lote-confirm-mais">…e mais {gravaveis.length - preview.length} com o mesmo padrão.</p> : null}
          </div>
        )}
        {ignorados.length ? (
          <div className="lote-confirm-bloco">
            <div className="lote-confirm-titulo">🚫 O que ficará de fora ({ignorados.length})</div>
            <ul className="lote-confirm-lista">
              {ignoradosPreview.map(({ item, motivo }) => (
                <li key={`${item.indice}-${item.codigo || 'sem-sku'}`}>
                  <span className="font-mono font-bold">{item.codigo || `(linha ${item.indice})`}</span> · {item.nome ? `${item.nome.slice(0, 50)} · ` : ''}{motivo}
                </li>
              ))}
            </ul>
            {ignorados.length > ignoradosPreview.length ? <p className="lote-confirm-mais">…e mais {ignorados.length - ignoradosPreview.length} ignoradas.</p> : null}
          </div>
        ) : null}
        {comCadastro || alertas.extintos.length || alertas.regraGeral.length || alertas.trocadas.length || alertas.naIntegral.length ? (
          <div className="lote-confirm-bloco lote-confirm-bloco--alerta">
            <div className="lote-confirm-titulo">⚠ Pontos de atenção antes de confirmar</div>
            <ul className="lote-confirm-lista">
              {comCadastro ? <li>📦 {comCadastro} com a regra salva no cadastro — ao confirmar, a apuração assistida passa a usar estas regras.</li> : null}
              {alertas.extintos.length ? <li>⛔ {alertas.extintos.length} com NCM extinto — só referência histórica.</li> : null}
              {alertas.regraGeral.length ? <li>⚡ {alertas.regraGeral.length} em regra geral (integral vigente).</li> : null}
              {alertas.naIntegral.length ? <li>🛡 {alertas.naIntegral.length} com 2+ tributações salvos na integral de segurança — nenhum benefício fixado.</li> : null}
              {alertas.trocadas.length ? <li>✨ {alertas.trocadas.length} onde você escolheu um benefício em vez da integral — vale a sua escolha.</li> : null}
            </ul>
          </div>
        ) : null}
        <Check label={`Revisei os ${gravaveis.length} produtos acima (CST · cClassTrib · origem) e autorizo salvar — ${ignorados.length} ficarão de fora.`} checked={aceite} onChange={(e) => setAceite(e.target.checked)} />
        <p className="lote-confirm-nota">Upsert por SKU: se o SKU já existir no cadastro, ele será atualizado com a classificação exibida.</p>
      </div>
    </Modal>
  )
}
