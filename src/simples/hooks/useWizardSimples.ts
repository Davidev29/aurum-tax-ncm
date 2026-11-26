/**
 * Simples Nacional — estado e navegação do wizard.
 * Concentra o timer de "pensar" com cleanup, evitando disparo após troca de view.
 */
import { useEffect, useRef, useState, type RefObject } from 'react'
import { toast } from '@/store/ui'
import { fmtMoeda } from '@/domain/services/format'

export interface ParamsWizardSimples {
  podeVisualizar: boolean
  valoresOk: boolean
  segExcesso: boolean
  segSoma: number
  receitaMes: number
  estourado: boolean
  compararHibrido: boolean
  resultadoVisivel: boolean
  onCalcular: () => void
  onCompararHibrido: (v: boolean) => void
  onLimpar: () => void
}

export function useWizardSimples(p: ParamsWizardSimples) {
  const [etapa, setEtapa] = useState<1 | 2 | 3>(1)
  const [gerando, setGerando] = useState(false)
  const [forcarLista, setForcarLista] = useState(false)
  const [reparticaoAberta, setReparticaoAberta] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])

  const rolarPara = (ref: RefObject<HTMLDivElement | HTMLElement | null>) => {
    window.requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const visualizar = () => {
    if (!p.podeVisualizar) {
      if (p.segExcesso) {
        toast(`Segregação soma ${fmtMoeda(p.segSoma)} — ultrapassa a receita de ${fmtMoeda(p.receitaMes)}.`, 'warn')
      } else {
        toast('Confira os valores base e a folha 12m antes de calcular.', 'warn')
      }
      return
    }
    if (timer.current !== null) window.clearTimeout(timer.current)
    setReparticaoAberta(false)
    setGerando(true)
    setEtapa(3)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    timer.current = window.setTimeout(() => {
      p.onCalcular()
      setGerando(false)
      timer.current = null
    }, 750)
  }

  const irPara = (n: 1 | 2 | 3) => {
    if (gerando) return
    if (n === 3 && !p.resultadoVisivel) {
      toast('Calcule antes de ver o resultado.', 'warn')
      return
    }
    setEtapa(n)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const continuar1 = () => {
    if (!p.valoresOk) {
      toast('Informe RBT12, receita e folha 12m para continuar.', 'warn')
      return
    }
    if (p.estourado && !p.compararHibrido) p.onCompararHibrido(true)
    setEtapa(2)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const reiniciar = () => {
    p.onLimpar()
    setForcarLista(false)
    setReparticaoAberta(false)
    setEtapa(1)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    toast('Simulação reiniciada.', 'ok')
  }

  return {
    etapa, setEtapa, gerando, forcarLista, setForcarLista, reparticaoAberta, setReparticaoAberta,
    rolarPara, visualizar, irPara, continuar1, reiniciar,
  }
}
