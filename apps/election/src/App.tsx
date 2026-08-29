import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Bell,
  BookOpenText,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileText,
  Flame,
  LayoutDashboard,
  LogOut,
  Menu,
  MoonStar,
  RefreshCw,
  Sparkles,
  UsersRound,
  X
} from 'lucide-react';
import { checkIn, checkOut, clearToken, fetchAttendance, fetchCurrentUser, fetchPoints, login, readToken } from '@/lib/api';
import { loadWeeklyReports } from '@/lib/reports';
import type { AttendanceSnapshot, ElectionUser, WeeklyReportFeed } from '@/types';

type View = 'dashboard' | 'reports' | 'team';

const formatDuration = (seconds = 0) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return [hours, minutes, remaining].map((part) => String(part).padStart(2, '0')).join(':');
};

const getWeekKey = () => {
  const now = new Date();
  const thursday = new Date(now.valueOf());
  thursday.setDate(now.getDate() + 3 - ((now.getDay() + 6) % 7));
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  const week = 1 + Math.round(((thursday.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
  return `${thursday.getFullYear()}-W${String(week).padStart(2, '0')}`;
};

export const App = () => {
  const [user, setUser] = useState<ElectionUser | null>(null);
  const [attendance, setAttendance] = useState<AttendanceSnapshot | null>(null);
  const [points, setPoints] = useState(0);
  const [reports, setReports] = useState<WeeklyReportFeed | null>(null);
  const [reportSourceConnected, setReportSourceConnected] = useState(false);
  const [view, setView] = useState<View>('dashboard');
  const [loading, setLoading] = useState(Boolean(readToken()));
  const [notice, setNotice] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const [nextUser, nextAttendance, nextPoints, reportResult] = await Promise.all([
        fetchCurrentUser(),
        fetchAttendance(),
        fetchPoints(),
        loadWeeklyReports().catch(() => ({ feed: null, connected: false }))
      ]);
      setUser(nextUser);
      setAttendance(nextAttendance);
      setPoints(nextPoints.totalPoints);
      setReports(reportResult.feed);
      setReportSourceConnected(reportResult.connected);
    } catch (error) {
      clearToken();
      setUser(null);
      setNotice(error instanceof Error ? error.message : '登录状态已失效');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (readToken()) {
      void refresh();
    }
  }, []);

  useEffect(() => {
    if (!attendance?.hasActiveSession) return;
    const ticker = window.setInterval(() => {
      setAttendance((current) =>
        current?.session
          ? { ...current, session: { ...current.session, elapsedSeconds: current.session.elapsedSeconds + 1 } }
          : current
      );
    }, 1000);
    return () => window.clearInterval(ticker);
  }, [attendance?.hasActiveSession]);

  const handleAttendance = async () => {
    try {
      if (attendance?.hasActiveSession) {
        await checkOut();
        setNotice('下卡成功，本次有效时长已由服务器确认。');
      } else {
        await checkIn();
        setNotice('上卡成功，开始记录专注时光。');
      }
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '打卡操作失败');
    }
  };

  if (!user) {
    return <LoginScreen loading={loading} notice={notice} onLogin={async (username, password) => { setLoading(true); try { setUser(await login(username, password)); await refresh(); } catch (error) { setNotice(error instanceof Error ? error.message : '登录失败'); setLoading(false); } }} />;
  }

  return (
    <main className="app-shell">
      <div className="aurora aurora-one" />
      <div className="aurora aurora-two" />
      <div className="noise" />
      <section className="desktop-frame">
        <Sidebar active={view} open={mobileOpen} onClose={() => setMobileOpen(false)} onSelect={(next) => { setView(next); setMobileOpen(false); }} user={user} onLogout={() => { clearToken(); setUser(null); }} />
        <div className="workspace">
          <header className="topbar">
            <button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="打开菜单"><Menu size={19} /></button>
            <div className="crumb"><span>LEC</span><ChevronRight size={14} /><strong>{view === 'dashboard' ? '工作台' : view === 'reports' ? '周报中心' : '团队动态'}</strong></div>
            <div className="topbar-actions">
              <button className="icon-button" aria-label="刷新数据" onClick={() => void refresh()}><RefreshCw size={18} /></button>
              <button className="icon-button notification" aria-label="通知"><Bell size={18} /><i /></button>
              <div className="profile-chip"><span>{user.displayName.slice(0, 1)}</span><div><strong>{user.displayName}</strong><small>{user.role === 'admin' ? '管理员' : '成员'}</small></div></div>
            </div>
          </header>

          {notice ? <div className="toast"><Check size={16} /><span>{notice}</span><button onClick={() => setNotice(null)} aria-label="关闭"><X size={15} /></button></div> : null}
          {loading ? <div className="loading-line" /> : null}
          {view === 'dashboard' ? <Dashboard user={user} attendance={attendance} points={points} reports={reports} reportSourceConnected={reportSourceConnected} onAttendance={() => void handleAttendance()} onReports={() => setView('reports')} /> : null}
          {view === 'reports' ? <ReportsPage reports={reports} connected={reportSourceConnected} /> : null}
          {view === 'team' ? <TeamPage reports={reports} /> : null}
        </div>
      </section>
    </main>
  );
};

const LoginScreen = ({ loading, notice, onLogin }: { loading: boolean; notice: string | null; onLogin: (username: string, password: string) => Promise<void> }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const submit = (event: FormEvent) => { event.preventDefault(); void onLogin(username, password); };
  return <main className="app-shell login-shell"><div className="aurora aurora-one" /><div className="aurora aurora-two" /><section className="login-card glass-card"><div className="brand-mark"><Sparkles size={23} /></div><p className="eyebrow">LECPUNCH / ELECTION</p><h1>回到你的<br /><em>专注宇宙。</em></h1><p className="muted">一处掌握打卡、积分和每周成长轨迹。</p><form onSubmit={submit}><label>用户名<input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="输入用户名" autoFocus /></label><label>密码<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="输入密码" /></label>{notice ? <p className="form-error">{notice}</p> : null}<button className="primary-button" disabled={loading}>{loading ? '正在连接...' : '进入工作台'}<ArrowUpRight size={18} /></button></form><small>桌面端通过 LecPunch 服务端安全校验打卡状态。</small></section></main>;
};

const Sidebar = ({ active, open, onClose, onSelect, user, onLogout }: { active: View; open: boolean; onClose: () => void; onSelect: (view: View) => void; user: ElectionUser; onLogout: () => void }) => {
  const items: Array<{ id: View; label: string; icon: typeof LayoutDashboard }> = [{ id: 'dashboard', label: '工作台', icon: LayoutDashboard }, { id: 'reports', label: '周报中心', icon: BookOpenText }, { id: 'team', label: '团队动态', icon: UsersRound }];
  return <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}><div className="sidebar-header"><div className="brand-mark"><Sparkles size={20} /></div><div><strong>lec<span>e</span>ction</strong><small>DESKTOP CLIENT</small></div><button className="icon-button sidebar-close" onClick={onClose}><X size={18} /></button></div><nav>{items.map(({ id, label, icon: Icon }) => <button key={id} className={active === id ? 'nav-active' : ''} onClick={() => onSelect(id)}><Icon size={19} /><span>{label}</span>{active === id ? <i /> : null}</button>)}</nav><div className="sidebar-bottom"><div className="version-card"><MoonStar size={17} /><span>沉浸模式<br /><small>今晚也要发光</small></span></div><button className="logout" onClick={onLogout}><LogOut size={17} />退出 {user.displayName}</button></div></aside>;
};

const Dashboard = ({ user, attendance, points, reports, reportSourceConnected, onAttendance, onReports }: { user: ElectionUser; attendance: AttendanceSnapshot | null; points: number; reports: WeeklyReportFeed | null; reportSourceConnected: boolean; onAttendance: () => void; onReports: () => void }) => {
  const elapsed = attendance?.session?.elapsedSeconds ?? 0;
  const active = Boolean(attendance?.hasActiveSession);
  const weeklyReports = reports?.members ?? [];
  const completedReports = weeklyReports.filter((item) => item.status === 'generated').length;
  return <div className="page dashboard-page"><section className="welcome-row"><div><p className="eyebrow">FRIDAY, 29 AUGUST</p><h1>下午好，{user.displayName} <span>✦</span></h1><p>保持节奏，让每一小时都留下值得回看的光。</p></div><div className="week-pill"><CalendarDays size={17} /><span>{reports?.weekKey ?? getWeekKey()}</span><i /></div></section><section className="dashboard-grid"><article className={`focus-card glass-card ${active ? 'is-active' : ''}`}><div className="focus-card-top"><div><span className="live-dot" />{active ? '正在专注' : '准备开始'}</div><small>{active ? '服务端持续确认中' : '由服务器确认有效时长'}</small></div><div className="timer">{formatDuration(elapsed)}</div><p>{active ? '保持专注，所有有效分钟都会沉淀成新的积分。' : '点击开始，开启一段清晰、专注的学习时光。'}</p><button className="attendance-button" onClick={onAttendance}>{active ? '结束专注' : '开始专注'}<ArrowUpRight size={19} /></button><div className="focus-orb orb-one" /><div className="focus-orb orb-two" /></article><article className="points-card glass-card"><div className="card-label"><CircleDollarSign size={18} />成长积分</div><div className="points-value"><span>{points.toLocaleString()}</span><small>PTS</small></div><div className="points-foot"><Flame size={17} /><span>有效专注每满一分钟 +1</span></div><div className="mini-bars">{[34, 57, 41, 72, 54, 83, 66].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div></article><article className="moment-card glass-card"><div className="card-label"><Sparkles size={18} />今日灵感</div><blockquote>“持续不是把每件事做满，而是让真正重要的事每天前进一点。”</blockquote><footer><span>日常提醒</span><ArrowUpRight size={15} /></footer></article></section><section className="lower-grid"><article className="report-card glass-card"><div className="section-head"><div><p className="eyebrow">WEEKLY REFLECTION</p><h2>本周成长报告</h2></div><button onClick={onReports}>查看全部 <ChevronRight size={16} /></button></div><div className="report-progress"><div className="progress-ring"><span>{reportSourceConnected ? `${completedReports}/${weeklyReports.length || 0}` : '—'}</span><small>周报</small></div><div><strong>{reportSourceConnected ? '统一报告源已连接' : '等待统一报告源'}</strong><p>{reportSourceConnected ? '报告由本地管理软件汇总，Election 只负责展示。' : '配置 VITE_REPORTS_MANIFEST_URL 后即可显示 GitHub 周报。'}</p><div className="report-tags"><span><FileText size={14} /> 日报汇总</span><span><Sparkles size={14} /> AI 总结</span></div></div></div></article><article className="activity-card glass-card"><div className="section-head"><div><p className="eyebrow">TODAY'S RHYTHM</p><h2>专注节奏</h2></div><Clock3 size={19} /></div><div className="activity-list"><Activity time="09:30" title="本周计划已同步" color="purple" /><Activity time="13:00" title={active ? '正在累计有效专注时长' : '等待下一次专注'} color="blue" /><Activity time="20:30" title="日报写作窗口开启" color="pink" /></div></article></section></div>;
};

const Activity = ({ time, title, color }: { time: string; title: string; color: string }) => <div className="activity-item"><time>{time}</time><i className={color} /><span>{title}</span></div>;

const ReportsPage = ({ reports, connected }: { reports: WeeklyReportFeed | null; connected: boolean }) => <div className="page reports-page"><section className="welcome-row"><div><p className="eyebrow">REPORT ARCHIVE</p><h1>本周成长<span>报告</span></h1><p>系统只读取统一报告清单，博客原文仍保留在各自的 GitHub 仓库。</p></div><div className="week-pill"><CalendarDays size={17} /><span>{reports?.weekKey ?? getWeekKey()}</span><i /></div></section>{connected && reports ? <section className="report-list">{reports.members.map((report) => <article className="member-report glass-card" key={report.studentId}><div className="report-avatar">{report.displayName.slice(0, 1)}</div><div className="member-report-main"><div><p className="eyebrow">{report.studentId}</p><h2>{report.displayName}</h2></div><p>{report.summary}</p><div className="report-meta"><span><FileText size={14} />{report.dailyCount} 篇日报</span><span className={`status-${report.status}`}>{report.status === 'generated' ? '已生成' : report.status === 'missing' ? '缺少日报' : '等待处理'}</span></div></div>{report.url ? <a href={report.url} target="_blank" rel="noreferrer" className="open-report">打开报告 <ArrowUpRight size={16} /></a> : <span className="open-report disabled">报告尚未发布</span>}</article>)}</section> : <EmptyReportState />}</div>;

const EmptyReportState = () => <section className="empty-report glass-card"><div className="empty-icon"><FileText size={30} /></div><p className="eyebrow">REPORT SOURCE NOT CONNECTED</p><h2>等待本地周报管理软件发布清单</h2><p>配置统一 GitHub 管理仓库中的 <code>overview/current.json</code> 地址后，这里会自动显示本周汇总。</p><div className="manifest-code">VITE_REPORTS_MANIFEST_URL=https://raw.githubusercontent.com/...</div></section>;

const TeamPage = ({ reports }: { reports: WeeklyReportFeed | null }) => {
  const stats = useMemo(() => ({ generated: reports?.members.filter((member) => member.status === 'generated').length ?? 0, total: reports?.members.length ?? 0 }), [reports]);
  return <div className="page team-page"><section className="welcome-row"><div><p className="eyebrow">TEAM PULSE</p><h1>团队<span>动态</span></h1><p>来自统一报告清单的轻量状态，不读取或复制学员原始博客。</p></div></section><section className="team-hero glass-card"><div><span className="live-dot" />本周报告状态</div><strong>{stats.generated}<small> / {stats.total || '—'} 已汇总</small></strong><p>每位成员的文章继续由自己的 GitHub 博客保存。Election 只展示管理软件发布的摘要、状态和跳转链接。</p></section></div>;
};
