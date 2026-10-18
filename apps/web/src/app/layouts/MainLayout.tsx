import { NotificationProvider } from '@/features/notifications/NotificationProvider';
import { Outlet } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
import { AppHeader } from '../components/AppHeader';

export const MainLayout = () => {
  return (
    <NotificationProvider><div className="w-full h-screen bg-gray-50 font-sans text-gray-900 overflow-hidden flex">
      <Sidebar />
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <AppHeader />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div></NotificationProvider>
  );
};
