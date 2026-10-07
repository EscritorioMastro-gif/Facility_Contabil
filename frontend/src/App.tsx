import { Navigate, Route, Routes } from 'react-router-dom';
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
import { EquipePage } from '@/features/equipe/EquipePage';

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
        <Route path="/classificacao" element={<ClassificarPage />} />
        <Route path="/classificacao/revisao/:id" element={<ClassificacaoRevisaoPage />} />
        <Route path="/classificacao/historico" element={<ClassificacaoHistoricoPage />} />
        <Route path="/classificacao/categorias" element={<CategoriasPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
