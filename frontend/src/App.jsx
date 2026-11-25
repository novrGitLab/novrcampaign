import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { RequireAuth } from './components/RequireAuth';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Analytics from './pages/Analytics';
import Contacts from './pages/Contacts';
import Suppressions from './pages/Suppressions';
import Feed from './pages/Feed';
import PulseToday from './pages/PulseToday';
import PulseWizard from './pages/PulseWizard';
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
          <Route path="analytics" element={<Analytics />} />
          <Route path="contacts" element={<Contacts />} />
          <Route path="suppressions" element={<Suppressions />} />
          <Route path="feed" element={<Feed />} />

          {/* Pulse — ONE screen: today's news, today's email. The old Inbox,
              Writer and Front Page all redirect to /pulse. */}
          <Route path="pulse" element={<PulseToday />} />
          {/* The 3-step AI edition builder, opened from Today. */}
          <Route path="pulse/build" element={<PulseWizard />} />
          <Route path="pulse/wire" element={<Navigate to="/pulse" replace />} />
          <Route path="pulse/desk" element={<Navigate to="/pulse" replace />} />
          <Route path="pulse/inbox/:eventId/canvas" element={<Navigate to="/pulse" replace />} />

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
