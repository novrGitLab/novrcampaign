import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Layout } from './components/Layout';
import { RequireAuth } from './components/RequireAuth';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Analytics from './pages/Analytics';
import Contacts from './pages/Contacts';
import Suppressions from './pages/Suppressions';
import Feed from './pages/Feed';
import PulseReview from './pages/PulseReview';
import EditorialCanvas from './pages/EditorialCanvas';
import PulseFrontPage from './pages/PulseFrontPage';
import Campaigns from './pages/Campaigns';
import CampaignBuilder from './pages/CampaignBuilder';
import CampaignAnalytics from './pages/CampaignAnalytics';
import Segments from './pages/Segments';
import SegmentDetail from './pages/SegmentDetail';
import Templates from './pages/Templates';

/**
 * Scopes the dark "newsroom" theme to the Pulse surface. The `.theme-pulse`
 * class overrides the semantic design tokens for this subtree only (see
 * index.css), so every Pulse route renders dark navy while the rest of the app
 * (campaigns, contacts, …) stays on the light theme.
 */
function PulseTheme() {
  return (
    <div className="theme-pulse min-h-screen bg-background text-foreground">
      <Outlet />
    </div>
  );
}

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

          {/* Pulse — dark-scoped. The Front Page (today's edition) is HOME;
              the Wire is reached from it; the old Desk redirects to /pulse. */}
          <Route element={<PulseTheme />}>
            <Route path="pulse" element={<PulseFrontPage />} />
            <Route path="pulse/wire" element={<PulseReview />} />
            <Route path="pulse/desk" element={<Navigate to="/pulse" replace />} />
            <Route path="pulse/inbox/:eventId/canvas" element={<EditorialCanvas />} />
          </Route>

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
