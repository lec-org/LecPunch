import { NavLink, useNavigate } from 'react-router-dom';
import { Clock, LayoutDashboard, Users, History, CalendarDays, CalendarClock, WalletCards, LogOut, Shield, Wifi, Download, UserCheck } from 'lucide-react';
import { Button } from '@lecpunch/ui';
import { useAuthStore } from '../store/auth-store';
import { signOut } from '@/shared/auth/logto';

const navItems = [
  { label: '通知中心', to: '/notifications', icon: Clock },
  { label: '联系管理员', to: '/messages/new', icon: UserCheck },
  { label: '工作台', to: '/', icon: LayoutDashboard },
  { label: '团队活动', to: '/events', icon: CalendarClock },
  { label: '团队成员', to: '/members', icon: Users },
  { label: '我的记录', to: '/records', icon: History },
  { label: '周历史', to: '/weekly-history', icon: CalendarDays }
];

export const Sidebar = () => {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const user = useAuthStore((s) => s.auth.user);

  const handleLogout = async () => {
    setAuth({ token: null, user: null });
    await signOut();
    navigate('/login');
  };

  return (
    <aside className="w-64 bg-white border-r border-gray-200 h-full flex flex-col z-20 flex-shrink-0">
      <div className="h-16 flex items-center px-6 border-b border-gray-100">
        <Clock className="w-6 h-6 text-blue-600 mr-2 flex-shrink-0" />
        <span className="text-lg font-bold text-gray-900 tracking-tight">FocusTeam</span>
      </div>
      <div className="flex-1 py-6 px-4 space-y-1 overflow-y-auto">
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-2">主菜单</div>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `w-full flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`
            }
          >
            <item.icon className="w-5 h-5 mr-3 flex-shrink-0" />
            {item.label}
          </NavLink>
        ))}

        {user?.role === 'admin' ? (
          <>
            <NavLink className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100" to="/admin/duration-adjustments">增减时长</NavLink>
            <NavLink className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100" to="/admin/messages">成员消息收件箱</NavLink>
            <NavLink className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100" to="/admin/notices">发布通知与已读状态</NavLink>
            <div className="mt-6 mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-gray-400">管理</div>
            <NavLink
              to="/admin"
              end
              className={({ isActive }) =>
                `w-full flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`
              }
            >
              <Shield className="w-5 h-5 mr-3 flex-shrink-0" />
              管理总览
            </NavLink>
            <NavLink
              to="/admin/members"
              className={({ isActive }) =>
                `w-full flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`
              }
            >
              <Users className="w-5 h-5 mr-3 flex-shrink-0" />
              成员管理
            </NavLink>
            <NavLink
              to="/admin/network-policy"
              className={({ isActive }) =>
                `w-full flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`
              }
            >
              <Wifi className="w-5 h-5 mr-3 flex-shrink-0" />
              网络策略
            </NavLink>
            <NavLink
              to="/admin/member-eligibility"
              className={({ isActive }) =>
                `w-full flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`
              }
            >
              <UserCheck className="w-5 h-5 mr-3 flex-shrink-0" />
              准入名单
            </NavLink>
            <NavLink
              to="/admin/events"
              className={({ isActive }) =>
                `w-full flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`
              }
            >
              <CalendarClock className="w-5 h-5 mr-3 flex-shrink-0" />
              团队日程
            </NavLink>
            <NavLink
              to="/admin/ledger"
              className={({ isActive }) =>
                `w-full flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`
              }
            >
              <WalletCards className="w-5 h-5 mr-3 flex-shrink-0" />
              团费流水
            </NavLink>
            <NavLink
              to="/admin/records-export"
              className={({ isActive }) =>
                `w-full flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`
              }
            >
              <Download className="w-5 h-5 mr-3 flex-shrink-0" />
              记录导出
            </NavLink>
          </>
        ) : null}
      </div>
      <div className="p-4 border-t border-gray-100">
        <Button variant="danger" size="md" className="w-full" onClick={handleLogout}>
          <LogOut className="w-4 h-4" />
          退出登录
        </Button>
      </div>
    </aside>
  );
};
