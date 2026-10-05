/**
 * Cartão visual do chat (Aurum AI) — gráfico 3D elegante + tabela customizada.
 *
 * Renderiza o `GraficoChat` planejado em `aurum-ai-graficos.ts` (puro):
 * - barra / pizza (rosca) / linha via Chart.js com gradientes, sombras e
 *   relevo — o "3D elegante" vem do conjunto (perspectiva sutil no CSS +
 *   fatias/barras com profundidade, hover com elevação, filete ouro);
 * - tabela customizada em HTML acessível (mesmos números do gráfico);
 * - alternador de modelo (pizza ↔ barras ↔ linha ↔ tabela) sem nova pergunta.
 *
 * Seguro por construção: só números já validados pelo motor; sem HTML injetado.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartOptions,
  type TooltipItem,
} from 'chart.js'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import type { GraficoChat, TipoGraficoChat } from '@/application/aurum-ai-graficos'

ChartJS.register(ArcElement, BarElement, CategoryScale, Filler, LinearScale, LineElement, PointElement, Tooltip, Legend)

/** Sombra elegante sob barras/fatias/pontos (relevo 3D). Registrado 1×. */
const PLUGIN_SOMBRA = {
  id: 'aurum-sombra-elegante',
  beforeDatasetsDraw(chart: { ctx: CanvasRenderingContext2D }) {
    try {
      const ctx = chart.ctx
      ctx.save()
      ctx.shadowColor = 'rgba(22, 35, 58, 0.28)'
      ctx.shadowBlur = 14
      ctx.shadowOffsetY = 7
    } catch {
      /* canvas indisponível (teste) — segue sem sombra */
    }
  },
  afterDatasetsDraw(chart: { ctx: CanvasRenderingContext2D }) {
    try {
      chart.ctx.restore()
    } catch {
      /* nada a restaurar */
    }
  },
}

try {
  const registrado = (ChartJS as unknown as { _aurumSombra?: boolean })._aurumSombra
  if (!registrado) {
    ChartJS.register(PLUGIN_SOMBRA as never)
    ;(ChartJS as unknown as { _aurumSombra?: boolean })._aurumSombra = true
  }
} catch {
  /* registro best-effort */
}

/** Paleta da marca (marinho + ouro + apoios) — fatias/séries do gráfico. */
const PALETA = [
  '#2b3f63', // marinho
  '#be9433', // ouro
  '#059669', // esmeralda
  '#7c3aed', // violeta
  '#0891b2', // ciano
  '#d97706', // âmbar
  '#dc2626', // vermelho
  '#16a34a', // verde
  '#475569', // ardósia
  '#eab308', // amarelo
  '#0ea5e9', // céu
  '#a855f7', // roxo claro
]

function cor(i: number, alpha = 'FF'): string {
  const base = PALETA[i % PALETA.length]
  return alpha === 'FF' ? base : `${base}${alpha}`
}

function fmtValor(v: number, unidade: GraficoChat['unidade']): string {
  const n = Number(v) || 0
  if (unidade === 'moeda') {
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 })
  }
  if (unidade === 'percent') return `${n.toFixed(2).replace('.', ',')}%`
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

/** Extrai o número do `parsed` (barra/linha usam `{x,y}`, rosca usa número). */
function numDoParsed(parsed: unknown): number {
  if (typeof parsed === 'number') return parsed
  if (parsed && typeof parsed === 'object') {
    const y = (parsed as { y?: unknown }).y
    if (typeof y === 'number') return y
  }
  return 0
}

const ROTULO_MODELO: Record<TipoGraficoChat, string> = {
  barra: 'Barras',
  pizza: 'Pizza',
  linha: 'Linha',
  tabela: 'Tabela',
}

const ICONE_MODELO: Record<TipoGraficoChat, string> = {
  barra: '📊',
  pizza: '🥧',
  linha: '📈',
  tabela: '📋',
}

/** Encurta o rótulo do eixo X para não sobrepor (tooltip mostra o completo). */
function rotuloEixo(s: string, max = 13): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

export function GraficoChatView({ grafico }: { grafico: GraficoChat }) {
  // Reativo: o cartão deriva do payload da mensagem. Quando os dados mudam
  // (nova pergunta, novo escopo, conversa restaurada), o tipo e as séries
  // precisam acompanhar — sem isso o modelo ficava preso no estado inicial.
  const modelos = useMemo<TipoGraficoChat[]>(() => {
    const lista = [grafico.tipo, ...(grafico.alternativas ?? [])]
    const base = [...new Set(lista)].filter((m): m is TipoGraficoChat => m === 'barra' || m === 'pizza' || m === 'linha' || m === 'tabela')
    // Sem sinal numérico, garante a tabela como saída (o canvas ficaria vazio).
    let soma = 0
    let max = 0
    for (const s of grafico.series ?? []) {
      for (const v of s.valores ?? []) {
        const n = Math.abs(Number(v) || 0)
        soma += Number(v) || 0
        if (n > max) max = n
      }
    }
    if (!(max > 0.005) && !base.includes('tabela')) return [...base, 'tabela']
    return base.length ? base : (['tabela'] as TipoGraficoChat[])
  }, [grafico])
  const [modelo, setModelo] = useState<TipoGraficoChat>(grafico.tipo)

  // Novo payload (nova pergunta/escopo) volta ao modelo planejado; a troca
  // manual do usuário é preservada entre re-renders do mesmo payload.
  const idGrafico = `${grafico.titulo}|${grafico.tipo}|${grafico.labels.length}|${(grafico.series[0]?.valores ?? []).slice(0, 8).join(',')}`
  useEffect(() => {
    setModelo(grafico.tipo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idGrafico])

  // Aviso honesto quando o visual atual não tem o que desenhar (ex.: pizza
  // com tudo zerado). A tabela continua disponível no alternador.
  const semSinal = useMemo(() => {
    let max = 0
    for (const s of grafico.series ?? []) {
      for (const v of s.valores ?? []) {
        const n = Math.abs(Number(v) || 0)
        if (n > max) max = n
      }
    }
    return !(max > 0.005)
  }, [grafico])

  const rotuloBarra = (item: TooltipItem<'bar'>): string => {
    const ds = item.dataset.label ? `${item.dataset.label}: ` : ''
    return `${ds}${fmtValor(numDoParsed(item.parsed), grafico.unidade)}`
  }
  const rotuloRosca = (item: TooltipItem<'doughnut'>): string => {
    const ds = item.dataset.label ? `${item.dataset.label}: ` : ''
    return `${ds}${fmtValor(numDoParsed(item.parsed), grafico.unidade)}`
  }
  const rotuloLinha = (item: TooltipItem<'line'>): string => {
    const ds = item.dataset.label ? `${item.dataset.label}: ` : ''
    return `${ds}${fmtValor(numDoParsed(item.parsed), grafico.unidade)}`
  }

  const baseOptions = useMemo<ChartOptions<'bar'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: grafico.series.length > 1,
          position: 'bottom' as const,
          labels: { boxWidth: 12, boxHeight: 12, padding: 12, font: { size: 10 } },
        },
        tooltip: {
          callbacks: {
            label: rotuloBarra,
            title: (itens) => {
              const i = itens[0]?.dataIndex ?? 0
              return String(grafico.labels[i] ?? '')
            },
          },
          padding: 10,
          cornerRadius: 10,
        },
      },
      scales: {
        x: {
          ticks: {
            font: { size: 9 },
            maxRotation: 45,
            minRotation: 45,
            autoSkip: false,
            maxTicksLimit: 6,
            callback: function (v, i) {
              const lab = String(grafico.labels[Number(i)] ?? v)
              return rotuloEixo(lab)
            },
          },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          grace: '12%',
          ticks: {
            font: { size: 10 },
            maxTicksLimit: 5,
            callback: (v) => fmtValor(Number(v), grafico.unidade),
          },
          grid: { color: 'rgba(100, 116, 139, 0.16)' },
        },
      },
      animation: { duration: 650 },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grafico.unidade, grafico.series.length, grafico.labels],
  )

  const dadosBarra = useMemo(
    () => ({
      labels: grafico.labels,
      datasets: grafico.series.map((s, i) => ({
        label: s.nome,
        data: s.valores,
        backgroundColor: grafico.series.length > 1 ? cor(i, 'E6') : grafico.labels.map((_, j) => cor(j, 'E6')),
        borderColor: grafico.series.length > 1 ? cor(i) : grafico.labels.map((_, j) => cor(j)),
        borderWidth: 1.5,
        borderRadius: 6,
        borderSkipped: 'start' as const,
        maxBarThickness: 44,
        // Valores muito pequenos (ex.: R$ 0,05 num eixo até R$ 1,00) geravam
        // barras de 1–2px invisíveis com raio grande — mínimo garante o filete.
        minBarLength: 3,
      })),
    }),
    [grafico],
  )

  const dadosPizza = useMemo(() => {
    const serie = grafico.series[0] ?? { nome: '', valores: [] }
    return {
      labels: grafico.labels,
      datasets: [
        {
          label: serie.nome,
          data: serie.valores,
          backgroundColor: grafico.labels.map((_, j) => cor(j, 'E6')),
          borderColor: '#ffffff',
          borderWidth: 2.5,
          hoverOffset: 12,
          spacing: 2,
          borderRadius: 6,
        },
      ],
    }
  }, [grafico])

  const dadosLinha = useMemo(
    () => ({
      labels: grafico.labels,
      datasets: grafico.series.map((s, i) => ({
        label: s.nome,
        data: s.valores,
        borderColor: cor(i),
        backgroundColor: cor(i, '33'),
        fill: i === 0,
        tension: 0.42,
        borderWidth: 2.5,
        pointRadius: 3.5,
        pointHoverRadius: 6,
        pointBackgroundColor: '#ffffff',
        pointBorderColor: cor(i),
        pointBorderWidth: 2,
      })),
    }),
    [grafico],
  )

  const opcoesPizza = useMemo<ChartOptions<'doughnut'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      cutout: '56%',
      radius: '96%',
      rotation: -30,
      plugins: {
        legend: { position: 'bottom' as const, labels: { boxWidth: 12, boxHeight: 12, padding: 10, font: { size: 10 } } },
        tooltip: { callbacks: { label: rotuloRosca }, padding: 10, cornerRadius: 10 },
      },
      animation: { animateRotate: true, duration: 700 },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grafico.unidade],
  )

  const opcoesLinha = useMemo<ChartOptions<'line'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'bottom' as const, labels: { boxWidth: 12, boxHeight: 12, padding: 12, font: { size: 10 } } },
        tooltip: {
          callbacks: {
            label: rotuloLinha,
            title: (itens) => {
              const i = itens[0]?.dataIndex ?? 0
              return String(grafico.labels[i] ?? '')
            },
          },
          padding: 10,
          cornerRadius: 10,
        },
      },
      scales: {
        x: {
          ticks: {
            font: { size: 9 },
            maxRotation: 45,
            minRotation: 0,
            autoSkip: false,
            maxTicksLimit: 8,
            callback: function (v, i) {
              return rotuloEixo(String(grafico.labels[Number(i)] ?? v))
            },
          },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          grace: '12%',
          ticks: {
            font: { size: 10 },
            maxTicksLimit: 5,
            callback: (v) => fmtValor(Number(v), grafico.unidade),
          },
          grid: { color: 'rgba(100, 116, 139, 0.16)' },
        },
      },
      animation: { duration: 650 },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grafico.unidade, grafico.labels],
  )

  return (
    <figure className="grafico-3d" role="img" aria-label={`${grafico.titulo}${grafico.subtitulo ? ` — ${grafico.subtitulo}` : ''}`}>
      <div className="grafico-3d-inner">
        <figcaption className="grafico-3d-cabeca">
          <div className="min-w-0">
            <div className="grafico-3d-titulo">{grafico.titulo}</div>
            {grafico.subtitulo ? <div className="grafico-3d-sub">{grafico.subtitulo}</div> : null}
          </div>
          {modelos.length > 1 ? (
            <div className="grafico-3d-troca" role="group" aria-label="Alternar modelo do gráfico">
              {modelos.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModelo(m)}
                  aria-pressed={modelo === m}
                  title={`Ver como ${ROTULO_MODELO[m]}`}
                  className={`grafico-3d-pilula${modelo === m ? ' is-ativo' : ''}`}
                >
                  {ICONE_MODELO[m]} {ROTULO_MODELO[m]}
                </button>
              ))}
            </div>
          ) : null}
        </figcaption>

        <div className="grafico-3d-corpo">
          {semSinal && modelo !== 'tabela' ? (
            <p className="grafico-3d-vazio" role="status">
              Sem valores para desenhar neste modelo (tudo zerado) — veja a tabela com os números ou troque o modelo acima.
            </p>
          ) : null}
          {modelo === 'tabela' || (modelo !== 'barra' && modelo !== 'pizza' && modelo !== 'linha') ? (
            <TabelaChat colunas={grafico.colunas ?? []} linhas={grafico.linhasTabela ?? []} unidade={grafico.unidade} />
          ) : modelo === 'pizza' ? (
            <div className="grafico-3d-canvas">
              <Doughnut key={`pizza-${grafico.titulo}-${grafico.labels.length}`} data={dadosPizza} options={opcoesPizza} />
            </div>
          ) : modelo === 'linha' ? (
            <div className="grafico-3d-canvas">
              <Line key={`linha-${grafico.titulo}-${grafico.labels.length}`} data={dadosLinha} options={opcoesLinha} />
            </div>
          ) : (
            <div className="grafico-3d-canvas">
              <Bar key={`barra-${grafico.titulo}-${grafico.labels.length}`} data={dadosBarra} options={baseOptions} />
            </div>
          )}
        </div>

        {grafico.insight ? <p className="grafico-3d-insight">💡 {grafico.insight}</p> : null}
      </div>
    </figure>
  )
}

function TabelaChat({ colunas, linhas, unidade }: { colunas: string[]; linhas: string[][]; unidade: GraficoChat['unidade'] }) {
  if (!colunas.length || !linhas.length) {
    return <p className="grafico-3d-vazio">Sem linhas para exibir nesta tabela.</p>
  }
  void unidade
  return (
    <div className="grafico-3d-tabela-wrap scroll-elegante">
      <table className="tbl tbl-compacta grafico-3d-tabela">
        <thead>
          <tr>
            {colunas.map((c, i) => (
              <th key={i} className={i > 0 ? 'th-r' : undefined} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((lin, i) => (
            <tr key={i}>
              {lin.map((cel, j) => (
                <td key={j} className={j > 0 ? 'num text-right font-mono' : undefined}>
                  {cel}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
