import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ProjectsListPage } from './pages/ProjectsListPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { IntegrationsPage } from './pages/IntegrationsPage';
import { RegistriesPage } from './pages/RegistriesPage';
import { NotFoundPage } from './pages/NotFoundPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ProjectsListPage />} />
        <Route path="/ui" element={<Navigate to="/" replace />} />
        <Route path="/ui/project" element={<ProjectDetailPage />} />
        <Route path="/ui/integrations" element={<IntegrationsPage />} />
        <Route path="/ui/registries" element={<RegistriesPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
