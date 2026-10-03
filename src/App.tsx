import type { ReactNode } from 'react';
import { useState } from 'react';
import { Layout } from '@/ui/Layout';
import { AssistenteInstalacao } from '@/ui/TermoAceite';
import { lerAceite } from '@/domain/contrato';
import { useUi } from '@/store/ui';
import { Calculadora } from '@/pages/Calculadora';
import { SimplesNacional } from '@/simples/page';
import { Consulta } from '@/pages/Consulta';
import { ConsultaServicos } from '@/pages/ConsultaServicos';
import { DebugIA } from '@/pages/DebugIA';
import { Lote } from '@/pages/Lote';
import { NfeXml } from '@/pages/NfeXml';
import { NfeXmlPolida } from '@/pages/NfeXmlPolida';
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
    case 'simples':
      pagina = <SimplesNacional />;
      break;
    case 'consulta':
      pagina = <Consulta />;
      break;
    case 'servicos':
      pagina = <ConsultaServicos />;
      break;
    case 'lote':
      pagina = <Lote />;
      break;
    case 'nfe':
      pagina =
        typeof localStorage !== 'undefined' && localStorage.getItem('xml-layout') === 'polida' ? (
          <NfeXmlPolida />
        ) : (
          <NfeXml />
        );
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
