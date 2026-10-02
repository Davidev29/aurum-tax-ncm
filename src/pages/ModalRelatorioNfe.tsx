/**
 * Modal "Gerar relatório" — o usuário escolhe o que entra no PDF.
 *
 * O relatório nasce aqui, no início da seção de XML: conteúdo (produtos,
 * lojas que geram crédito, lojas do Simples com verificação de crédito),
 * período, movimento (compras/vendas) e conta final (completa, só crédito
 * ou só débito). O layout do PDF se adapta ao que foi marcado.
 */
import { useEffect, useMemo, useState } from 'react'
import type { NotaXml, OpcoesRelatorioNfe, ResumoRelatorioNfe, DirecaoRelatorioNfe } from '@/infrastructure/nfe/tipos'
import { OPCOES_RELATORIO_CHEIO } from '@/infrastructure/nfe/tipos'
import { Btn, Campo, Modal, Texto } from '@/ui/kit'

export interface EscolhaRelatorio {
  opcoes: OpcoesRelatorioNfe
  inicio: string
  fim: string
}

const noPeriodo = (data: string, inicio: string, fim: string): boolean =>
  (!inicio || data >= inicio) && (!fim || data <= fim)

function Caixa({
  marcado,
  aoMudar,
  titulo,
  descricao,
}: {
  marcado: boolean
  aoMudar: (v: boolean) => void
  titulo: string
  descricao: string
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-all ${
        marcado
          ? 'border-brand-500 bg-brand-50/70 shadow-card dark:bg-brand-950/30'
          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-950/40'
      }`}
    >
      <input
        type="checkbox"
        checked={marcado}
        onChange={(e) => aoMudar(e.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 accent-emerald-600"
      />
      <span>
        <span className="block text-xs font-bold">{titulo}</span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
          {descricao}
        </span>
      </span>
    </label>
  )
}

function Segmento<T extends string>({
  opcoes,
  valor,
  aoMudar,
  rotulo,
}: {
  opcoes: { valor: T; rotulo: string }[]
  valor: T
  aoMudar: (v: T) => void
  rotulo: string
}) {
  return (
    <div>
      <span className="field-label">{rotulo}</span>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={rotulo}>
        {opcoes.map((o) => (
          <Btn
            key={o.valor}
            tam="sm"
            variante={valor === o.valor ? 'primary' : 'ghost'}
            onClick={() => aoMudar(o.valor)}
            aria-pressed={valor === o.valor}
          >
            {o.rotulo}
          </Btn>
        ))}
      </div>
    </div>
  )
}

export function ModalRelatorioNfe({
  aberto,
  onFechar,
  onGerar,
  gerando,
  notas,
  inicioPadrao,
  fimPadrao,
}: {
  aberto: boolean
  onFechar: () => void
  onGerar: (escolha: EscolhaRelatorio) => void
  gerando: boolean
  /** Notas do recorte atual da tela (o modal refina por cima). */
  notas: NotaXml[]
  inicioPadrao: string
  fimPadrao: string
}) {
  const [produtos, setProdutos] = useState(true)
  const [itensFluxo, setItensFluxo] = useState(true)
  const [lojas, setLojas] = useState(true)
  const [simples, setSimples] = useState(true)
  const [direcao, setDirecao] = useState<DirecaoRelatorioNfe>('todas')
  const [resumo, setResumo] = useState<ResumoRelatorioNfe>('completo')
  const [inicio, setInicio] = useState(inicioPadrao)
  const [fim, setFim] = useState(fimPadrao)

  // Sempre abre com o padrão + período atual da tela.
  useEffect(() => {
    if (!aberto) return
    setProdutos(OPCOES_RELATORIO_CHEIO.produtos)
    setItensFluxo(OPCOES_RELATORIO_CHEIO.itensFluxo)
    setLojas(OPCOES_RELATORIO_CHEIO.lojas)
    setSimples(OPCOES_RELATORIO_CHEIO.simples)
    setDirecao(OPCOES_RELATORIO_CHEIO.direcao)
    setResumo(OPCOES_RELATORIO_CHEIO.resumo)
    setInicio(inicioPadrao)
    setFim(fimPadrao)
  }, [aberto, inicioPadrao, fimPadrao])

  const qtdRecorte = useMemo(() => {
    let qtd = 0
    for (const n of notas ?? []) {
      if (!noPeriodo(n.dataEmissao, inicio, fim)) continue
      if (direcao !== 'todas' && n.direcao !== direcao) continue
      qtd++
    }
    return qtd
  }, [notas, inicio, fim, direcao])

  const nadaMarcado = !produtos && !lojas && !simples

  const gerar = () => {
    if (gerando || nadaMarcado || qtdRecorte === 0) return
    onGerar({ opcoes: { produtos, itensFluxo, lojas, simples, direcao, resumo }, inicio, fim })
  }

  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo="📕 Gerar relatório"
      subtitulo="Escolha o que entra no PDF — o layout se adapta sozinho."
      largura="max-w-2xl"
      rodape={
        <>
          <Btn onClick={onFechar} disabled={gerando}>Cancelar</Btn>
          <Btn variante="primary" carregando={gerando} onClick={gerar} disabled={nadaMarcado || qtdRecorte === 0}>
            {gerando ? 'Gerando…' : '📕 Gerar PDF'}
          </Btn>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <span className="field-label">O que entra no relatório</span>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Caixa
              marcado={produtos}
              aoMudar={setProdutos}
              titulo="Produtos"
              descricao="Nome, NCM e imposto de cada um, com as particularidades — inclui a relação completa do que foi vendido."
            />
            <Caixa
              marcado={itensFluxo}
              aoMudar={setItensFluxo}
              titulo="Separar compras e vendas"
              descricao="Mostra os itens de entrada e de saída em listas próprias."
            />
            <Caixa
              marcado={lojas}
              aoMudar={setLojas}
              titulo="Lojas que geram crédito"
              descricao="Quem mais gerou crédito, com o produto que mais ajudou."
            />
            <Caixa
              marcado={simples}
              aoMudar={setSimples}
              titulo="Lojas do Simples"
              descricao="O sistema verifica loja por loja se há crédito disponível."
            />
          </div>
          {nadaMarcado ? (
            <p className="mt-2 text-[11px] font-bold text-red-500">
              Marque ao menos um conteúdo para gerar o relatório.
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo label="Período — de" dica="Vale o recorte atual da tela.">
            <Texto type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
          </Campo>
          <Campo label="Período — até">
            <Texto type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
          </Campo>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Segmento<DirecaoRelatorioNfe>
            rotulo="Notas"
            valor={direcao}
            aoMudar={setDirecao}
            opcoes={[
              { valor: 'todas', rotulo: 'Todas' },
              { valor: 'entrada', rotulo: 'Só compras' },
              { valor: 'saida', rotulo: 'Só vendas' },
            ]}
          />
          <Segmento<ResumoRelatorioNfe>
            rotulo="Conta final"
            valor={resumo}
            aoMudar={setResumo}
            opcoes={[
              { valor: 'completo', rotulo: 'Completa' },
              { valor: 'credito', rotulo: 'Só crédito' },
              { valor: 'debito', rotulo: 'Só débito' },
            ]}
          />
        </div>

        <p className={`text-[11px] ${qtdRecorte === 0 ? 'font-bold text-red-500' : 'text-slate-500 dark:text-slate-400'}`}>
          {qtdRecorte === 0
            ? 'Nenhuma nota entra neste recorte — ajuste o período ou as notas.'
            : `${qtdRecorte} nota(s) entram neste recorte.`}
        </p>
      </div>
    </Modal>
  )
}
