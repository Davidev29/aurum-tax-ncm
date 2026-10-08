/**
 * Registro único do Chart.js — todas as telas usam este módulo.
 *
 * - `NfeXml.tsx`, `Graficos.tsx`, `SimuladorSegregacao.tsx`: só
 *   `garantirChartsRegistrados()` (elementos via este registro central);
 * - `grafico-chat.tsx`: idem + plugin local `aurum-sombra-elegante`
 *   (efeito visual do chat, registrado 1× com guarda, mantido no arquivo).
 *
 * NÃO importar este módulo no boot (`main.tsx`): puxaria o `chart.js` para o
 * chunk inicial e anularia o code-splitting das telas lazy.
 */
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
} from 'chart.js'

export { ChartJS }

let registrado = false

/** Registra elementos+escalas uma única vez (idempotente, nunca lança). */
export function garantirChartsRegistrados(): void {
  if (registrado) return
  try {
    ChartJS.register(
      ArcElement,
      BarElement,
      CategoryScale,
      Filler,
      LinearScale,
      LineElement,
      PointElement,
      Tooltip,
      Legend,
    )
    registrado = true
  } catch {
    /* canvas/registro indisponível (teste): segue sem gráfico */
  }
}
