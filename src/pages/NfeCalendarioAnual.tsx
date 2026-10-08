/**
 * Calendário anual de documentos fiscais — meses com notas ganham a
 * `borda-cintilante` (animação padrão do sistema) para facilitar a
 * identificação. Escolher um mês filtra o período para aquele mês.
 */
import { useEffect, useState, type CSSProperties } from 'react'
import { contarMesesAno, listarAnosComNota } from '@/application/notas-xml'
import { useSessao } from '@/store/sessao'
import { useNfe } from '@/store/nfe'
import { Btn, IconeBadge, Modal } from '@/ui/kit'

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

export function periodoDoMes(ano: number, mes: number): { inicio: string; fim: string } {
  const mm = String(mes).padStart(2, '0')
  const ultimoDia = new Date(ano, mes, 0).getDate()
  return {
    inicio: `${ano}-${mm}-01`,
    fim: `${ano}-${mm}-${String(ultimoDia).padStart(2, '0')}`,
  }
}

export function CalendarioAnualModal({
  aberto,
  onFechar,
}: {
  aberto: boolean
  onFechar: () => void
}) {
  const ativaId = useSessao((s) => s.ativa?.id)
  const mesAno = useNfe((s) => s.mesAno)
  const setMes = useNfe((s) => s.setMes)
  const setFiltros = useNfe((s) => s.setFiltros)
  const [ano, setAno] = useState(() => mesAno || new Date().getFullYear())
  const [contas, setContas] = useState<Map<number, number>>(new Map())
  const [anos, setAnos] = useState<number[]>([])
  const [carregando, setCarregando] = useState(false)

  useEffect(() => {
    if (aberto) setAno(mesAno || new Date().getFullYear())
  }, [aberto, mesAno])

  useEffect(() => {
    if (!aberto || ativaId == null) {
      setContas(new Map())
      setAnos([])
      return
    }
    let vivo = true
    setCarregando(true)
    void Promise.all([contarMesesAno(ativaId, ano), listarAnosComNota(ativaId)])
      .then(([m, a]) => {
        if (!vivo) return
        setContas(m)
        setAnos(a)
      })
      .finally(() => {
        if (vivo) setCarregando(false)
      })
    return () => {
      vivo = false
    }
  }, [aberto, ativaId, ano])

  const escolher = (mes: number) => {
    const qtd = contas.get(mes) ?? 0
    if (!qtd) return
    const { inicio, fim } = periodoDoMes(ano, mes)
    setMes(ano, mes)
    setFiltros({ inicio, fim })
    onFechar()
  }

  const total = [...contas.values()].reduce((s, q) => s + q, 0)

  return (
    <Modal
      aberto={aberto}
      onFechar={onFechar}
      titulo="Calendário anual"
      subtitulo={carregando ? 'Contando documentos…' : total ? `${total} nota(s) em ${ano}` : `Sem notas em ${ano} — navegue pelos anos com movimento`}
      largura="max-w-2xl"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Btn tam="sm" onClick={() => setAno((a) => a - 1)} title="Ano anterior" aria-label="Ano anterior">‹</Btn>
          <span className="min-w-16 text-center font-mono text-sm font-black tabular-nums">{ano}</span>
          <Btn tam="sm" onClick={() => setAno((a) => a + 1)} title="Próximo ano" aria-label="Próximo ano">›</Btn>
        </div>
        {anos.length ? (
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Anos com documentos">
            {anos.slice(0, 6).map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAno(a)}
                aria-pressed={a === ano}
                className={`rounded-full px-2.5 py-1 font-mono text-[11px] font-bold transition ${
                  a === ano
                    ? 'bg-brand-600 text-white'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                {a}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4" role="listbox" aria-label={`Meses de ${ano}`}>
        {MESES.map((nome, i) => {
          const mes = i + 1
          const qtd = contas.get(mes) ?? 0
          const tem = qtd > 0
          return (
            <button
              key={nome}
              type="button"
              role="option"
              aria-selected={false}
              disabled={!tem}
              onClick={() => escolher(mes)}
              title={tem ? `${qtd} nota(s) em ${nome}/${ano} — clique para filtrar` : `Sem notas em ${nome}/${ano}`}
              style={tem ? ({ '--cor-borda': '#10b981', '--cor-brilho': '#6ee7b7' } as CSSProperties) : undefined}
              className={`rounded-xl p-3 text-left transition-all ${
                tem
                  ? 'borda-cintilante bg-emerald-50/60 hover:shadow-card dark:bg-emerald-950/20'
                  : 'border border-slate-200 bg-slate-50/50 opacity-50 dark:border-slate-700 dark:bg-slate-950/30'
              }`}
            >
              <span className="flex items-center gap-1.5 text-[13px] font-bold">
                <IconeBadge nome="calendario" tom={tem ? 'emerald' : 'slate'} tamanho="sm" />
                {nome}
              </span>
              <span className={`mt-1 block font-mono text-[11px] tabular-nums ${tem ? 'font-bold text-emerald-700 dark:text-emerald-300' : 'text-slate-400'}`}>
                {carregando ? '…' : tem ? `${qtd} nota(s)` : 'sem notas'}
              </span>
            </button>
          )
        })}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
        Meses com <strong>borda cintilante</strong> têm documentos fiscais — clique para filtrar o período.
      </p>
    </Modal>
  )
}
