import type { ReactNode } from 'react';
import { useState } from 'react';
import { Layout } from '@/ui/Layout';
import { AssistenteInstalacao } from '@/ui/TermoAceite';
import { lerAceite } from '@/domain/contrato';
import { useUi } from '@/store/ui';
import { Calculadora } from '@/pages/Calculadora';
import { Consulta } from '@/pages/Consulta';
import { DebugIA } from '@/pages/DebugIA';
import { Lote } from '@/pages/Lote';
import { NfeXml } from '@/pages/NfeXml';
import { Produtos } from '@/pages/Produtos';
import { Auxiliares } from '@/pages/Auxiliares';
import { Legislacao } from '@/pages/Legislacao';

/**
 * Troca de views do shell. Cada página é pura apresentação sobre as stores.
 */
export function App() {
  const view = useUi((s) => s.view);
  // Portão de aceite local: exibido antes de qualquer tela até o aceite v1.
  const [aceito, setAceito] = useState(() => lerAceite() !== null);

  let pagina: ReactNode;
  switch (view) {
    case 'consulta':
      pagina = <Consulta />;
      break;
    case 'lote':
      pagina = <Lote />;
      break;
    case 'nfe':
      pagina = <NfeXml />;
      break;
    case 'produtos':
      pagina = <Produtos />;
      break;
    case 'auxiliares':
      pagina = <Auxiliares />;
      break;
    case 'legislacao':
      pagina = <Legislacao />;
      break;
    case 'debugia':
      pagina = <DebugIA />;
      break;
    default:
      pagina = <Calculadora />;
  }

  return (
    <Layout>
      {pagina}
      {!aceito ? <AssistenteInstalacao onConcluido={() => setAceito(true)} /> : null}
    </Layout>
  );
}
