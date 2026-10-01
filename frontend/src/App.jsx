import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { RequireAuth } from './components/RequireAuth';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Contacts from './pages/Contacts';
import Campaigns from './pages/Campaigns';
import CampaignBuilder from './pages/CampaignBuilder';
import CampaignAnalytics from './pages/CampaignAnalytics';
import Segments from './pages/Segments';
import SegmentDetail from './pages/SegmentDetail';
import Templates from './pages/Templates';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="contacts" element={<Contacts />} />
          <Route path="campaigns" element={<Campaigns />} />
          <Route path="campaigns/new" element={<CampaignBuilder />} />
          <Route path="campaigns/:id/edit" element={<CampaignBuilder />} />
          <Route path="campaigns/:id/analytics" element={<CampaignAnalytics />} />
          <Route path="segments" element={<Segments />} />
          <Route path="segments/:id" element={<SegmentDetail />} />
          <Route path="templates" element={<Templates />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
