import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { RequireAuth, SoEscritorio } from '@/auth/RequireAuth';
import { LoginPage } from '@/pages/LoginPage';
import { DefinirSenhaPage } from '@/pages/DefinirSenhaPage';
import { HubPage } from '@/pages/HubPage';
import { ClientsPage } from '@/features/clients/ClientsPage';
import { ImportPage } from '@/features/import/ImportPage';
import { ExcelImportPage } from '@/features/import/excel/ExcelImportPage';
import { RevisaoPage } from '@/features/revisao/RevisaoPage';
import { HistoricoPage } from '@/features/historico/HistoricoPage';
import { MemoriaPage } from '@/features/rules/MemoriaPage';
import { ClassificarPage } from '@/features/classificacao/ClassificarPage';
import { ClassificacaoRevisaoPage } from '@/features/classificacao/ClassificacaoRevisaoPage';
import { ClassificacaoHistoricoPage } from '@/features/classificacao/ClassificacaoHistoricoPage';
import { CategoriasPage } from '@/features/classificacao/CategoriasPage';
import { ListaGeralPage } from '@/features/classificacao/ListaGeralPage';
import { DashboardPage } from '@/features/classificacao/DashboardPage';
import { EquipePage } from '@/features/equipe/EquipePage';
import { ConferenciaShopeePage } from '@/features/marketplaces/ConferenciaShopeePage';
import { TarifasShopeePage } from '@/features/marketplaces/TarifasShopeePage';
import { ChamadosShopeePage } from '@/features/marketplaces/ChamadosShopeePage';
import { CustosShopeePage } from '@/features/marketplaces/CustosShopeePage';

/** /classificacao/shopee/custos (endereço antigo) → /marketplaces/shopee/custos */
function RedirecionaShopee() {
  const { tela } = useParams();
  return <Navigate to={`/marketplaces/shopee/${tela ?? ''}`} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* link do e-mail de convite / nova senha — a sessão vem no próprio link */}
      <Route path="/definir-senha" element={<DefinirSenhaPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<HubPage />} />
        <Route path="/clientes" element={<SoEscritorio><ClientsPage /></SoEscritorio>} />
        <Route path="/equipe" element={<SoEscritorio><EquipePage /></SoEscritorio>} />
        <Route path="/memoria" element={<SoEscritorio><MemoriaPage /></SoEscritorio>} />
        <Route path="/importar" element={<SoEscritorio><ImportPage /></SoEscritorio>} />
        <Route path="/importar/excel" element={<SoEscritorio><ExcelImportPage /></SoEscritorio>} />
        <Route path="/revisao/:id" element={<SoEscritorio><RevisaoPage /></SoEscritorio>} />
        <Route path="/historico" element={<SoEscritorio><HistoricoPage /></SoEscritorio>} />
        <Route path="/classificacao/dashboard" element={<DashboardPage />} />
        <Route path="/classificacao" element={<ClassificarPage />} />
        <Route path="/classificacao/revisao/:id" element={<ClassificacaoRevisaoPage />} />
        <Route path="/classificacao/historico" element={<ClassificacaoHistoricoPage />} />
        <Route path="/classificacao/categorias" element={<CategoriasPage />} />
        {/* Conferência Marketplaces: módulo próprio, liberado pro cliente como a Classificação */}
        <Route path="/marketplaces" element={<Navigate to="/marketplaces/shopee" replace />} />
        <Route path="/marketplaces/shopee" element={<ConferenciaShopeePage />} />
        <Route path="/marketplaces/shopee/custos" element={<CustosShopeePage />} />
        <Route path="/marketplaces/shopee/chamados" element={<ChamadosShopeePage />} />
        <Route path="/marketplaces/shopee/tarifas" element={<TarifasShopeePage />} />
        {/* endereços antigos (dentro da Classificação) */}
        <Route path="/classificacao/shopee" element={<Navigate to="/marketplaces/shopee" replace />} />
        <Route path="/classificacao/shopee/:tela" element={<RedirecionaShopee />} />
        <Route path="/classificacao/lista-geral" element={<SoEscritorio><ListaGeralPage /></SoEscritorio>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
