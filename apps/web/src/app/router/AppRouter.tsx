import { createBrowserRouter, RouterProvider, Outlet } from 'react-router-dom';
import { AppProviders } from '../providers/AppProviders';
import { ToastContainer } from '@/shared/ui/toast';
import { ErrorBoundary } from '@/app/components/ErrorBoundary';
import { AuthLayout } from '../layouts/AuthLayout';
import { MainLayout } from '../layouts/MainLayout';
import { ProtectedRoute } from './ProtectedRoute';
import { AdminRoute } from './AdminRoute';
import { LoginPage } from '@/pages/login/LoginPage';
import { CallbackPage } from '@/pages/login/CallbackPage';
import { DashboardPage } from '@/pages/dashboard/DashboardPage';
import { RecordsPage } from '@/pages/records/RecordsPage';
import { MembersPage } from '@/pages/members/MembersPage';
import { MemberRecordsPage } from '@/pages/member-records/MemberRecordsPage';
import { WeeklyHistoryPage } from '@/pages/weekly-history/WeeklyHistoryPage';
import { EventsPage } from '@/pages/events/EventsPage';
import { ProfilePage } from '@/pages/profile/ProfilePage';
import { AdminMembersPage } from '@/pages/admin-members/AdminMembersPage';
import { AdminNetworkPolicyPage } from '@/pages/admin-network-policy/AdminNetworkPolicyPage';
import { AdminRecordsExportPage } from '@/pages/admin-records-export/AdminRecordsExportPage';
import { AdminMemberEligibilityPage } from '@/pages/admin-member-eligibility/AdminMemberEligibilityPage';
import { AdminEventsPage } from '@/pages/admin-events/AdminEventsPage';
import { AdminLedgerPage } from '@/pages/admin-ledger/AdminLedgerPage';
import { AdminDashboardPage } from '@/pages/admin-dashboard/AdminDashboardPage';

import { NotificationsPage } from '@/pages/notifications/NotificationsPage';
import { SubmitMessagePage } from '@/pages/messages/SubmitMessagePage';
import { AdminMessagesPage } from '@/pages/admin-messages/AdminMessagesPage';
import { AdminNoticesPage } from '@/pages/admin-notices/AdminNoticesPage';
import { AdminDurationPage } from '@/pages/admin-duration/AdminDurationPage';

// Root wrapper inside the router context — safe to use useNavigate here
const Root = () => (
  <AppProviders>
    <ErrorBoundary>
      <Outlet />
    </ErrorBoundary>
    <ToastContainer />
  </AppProviders>
);

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      {
        path: '/callback',
        element: (
          <AuthLayout>
            <CallbackPage />
          </AuthLayout>
        )
      },
      {
        path: '/login',
        element: (
          <AuthLayout>
            <LoginPage />
          </AuthLayout>
        )
      },
      {
        path: '/',
        element: <ProtectedRoute />,
        children: [
          {
            element: <MainLayout />,
            children: [
              { index: true, element: <DashboardPage /> },
              { path: 'notifications', element: <NotificationsPage /> },
              { path: 'messages/new', element: <SubmitMessagePage /> },
              { path: 'records', element: <RecordsPage /> },
              { path: 'members', element: <MembersPage /> },
              { path: 'members/:memberKey/records', element: <MemberRecordsPage /> },
              { path: 'weekly-history', element: <WeeklyHistoryPage /> },
              { path: 'events', element: <EventsPage /> },
              { path: 'profile', element: <ProfilePage /> },
              {
                path: 'admin',
                element: <AdminRoute />,
                children: [
                  { index: true, element: <AdminDashboardPage /> },
                  { path: 'duration-adjustments', element: <AdminDurationPage /> },
                  { path: 'messages', element: <AdminMessagesPage /> },
                  { path: 'notices', element: <AdminNoticesPage /> },
                  { path: 'members', element: <AdminMembersPage /> },
                  { path: 'events', element: <AdminEventsPage /> },
                  { path: 'ledger', element: <AdminLedgerPage /> },
                  { path: 'member-eligibility', element: <AdminMemberEligibilityPage /> },
                  { path: 'network-policy', element: <AdminNetworkPolicyPage /> },
                  { path: 'records-export', element: <AdminRecordsExportPage /> }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
]);

export const AppRouter = () => {
  return <RouterProvider router={router} />;
};
