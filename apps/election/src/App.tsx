import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Bell, BellRing, BookOpenText, CalendarDays, Check, ChevronRight, CircleDollarSign, Crown, EyeOff, Flame, LayoutDashboard, LogOut, Menu, Minimize2, Moon, RefreshCw, Sparkles, Trophy, UsersRound, VolumeX, X } from 'lucide-react';
import { checkIn, checkOut, clearToken, fetchAttendance, fetchCurrentUser, fetchPoints, fetchTeamWeeklyStats, getApiBaseUrl, login, readToken } from '@/lib/api';
import { loadWeeklyReports } from '@/lib/reports';
import type { AttendanceSnapshot, ElectionUser, TeamWeeklyStat, WeeklyReportFeed } from '@/types';

type View = 'dashboard' | 'ranking' | 'team' | 'reports';
type QuickTask = { title: string; time: string };

const REMINDER_STORAGE_KEY = 'lecpunch.election.reminders-enabled';
const IMMERSIVE_STORAGE_KEY = 'lecpunch.election.immersive-enabled';
const QUICK_TASK_STORAGE_KEY = 'lecpunch.election.quick-task';
const reminderTimes = [
  { hour: 9, minute: 0, title: '开始今天的专注', body: '打开 LecPunch，开始一段有记录的学习时间。' },
  { hour: 13, minute: 0, title: '午后专注提醒', body: '休息结束后，继续完成今天最重要的一件事。' },
  { hour: 20, minute: 30, title: '日报写作窗口开启', body: '记下今天的进展，为本周成长报告留下素材。' }
];

const formatDuration = (seconds = 0) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return [hours, minutes, remaining].map((part) => String(part).padStart(2, '0')).join(':');
};

const formatStudyDuration = (seconds = 0) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}小时${minutes}分` : `${minutes}分钟`;
};

const getWeekKey = () => {
  const now = new Date();
  const thursday = new Date(now.valueOf());
  thursday.setDate(now.getDate() + 3 - ((now.getDay() + 6) % 7));
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  const week = 1 + Math.round(((thursday.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
  return `${thursday.getFullYear()}-W${String(week).padStart(2, '0')}`;
};

const formatToday = () => new Intl.DateTimeFormat('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
const readStoredBoolean = (key: string, fallback: boolean) => localStorage.getItem(key) === null ? fallback : localStorage.getItem(key) === 'true';
const readQuickTask = (): QuickTask | null => {
  try {
    const task = JSON.parse(localStorage.getItem(QUICK_TASK_STORAGE_KEY) || 'null') as QuickTask | null;
    return task?.title && /^\d{2}:\d{2}$/.test(task.time) ? task : null;
  } catch {
    return null;
  }
};

export const App = () => {
  const [user, setUser] = useState<ElectionUser | null>(null);
  const [attendance, setAttendance] = useState<AttendanceSnapshot | null>(null);
  const [points, setPoints] = useState(0);
  const [teamStats, setTeamStats] = useState<TeamWeeklyStat[]>([]);
  const [reports, setReports] = useState<WeeklyReportFeed | null>(null);
  const [reportSourceConnected, setReportSourceConnected] = useState(false);
  const [view, setView] = useState<View>('dashboard');
  const [loading, setLoading] = useState(Boolean(readToken()));
  const [notice, setNotice] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [remindersEnabled, setRemindersEnabled] = useState(() => readStoredBoolean(REMINDER_STORAGE_KEY, true));
  const [immersive, setImmersive] = useState(() => readStoredBoolean(IMMERSIVE_STORAGE_KEY, false));
  const [quickTask, setQuickTask] = useState<QuickTask | null>(readQuickTask);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  useEffect(() => {
    document.body.classList.toggle('desktop-main-body', Boolean(window.lecpunchDesktop?.isDesktop));
    return () => document.body.classList.remove('desktop-main-body');
  }, []);

  const showDesktopReminder = async (title: string, body: string) => {
    if (!immersive) await window.lecpunchDesktop?.notify({ title, body });
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const [nextUser, nextAttendance, nextPoints, nextTeamStats, reportResult] = await Promise.all([
        fetchCurrentUser(),
        fetchAttendance(),
        fetchPoints().catch(() => null),
        fetchTeamWeeklyStats().then((result) => result.items).catch(() => []),
        loadWeeklyReports().catch(() => ({ feed: null, connected: false }))
      ]);
      setUser(nextUser);
      setAttendance(nextAttendance);
      setPoints(nextPoints?.totalPoints ?? 0);
      setTeamStats(nextTeamStats);
      setReports(reportResult.feed);
      setReportSourceConnected(reportResult.connected);
      if (!nextPoints) setNotice('已登录。积分服务尚未部署，暂以 0 分显示。');
    } catch (error) {
      clearToken();
      setUser(null);
      setNotice(error instanceof Error ? error.message : '登录状态已失效');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (readToken()) void refresh(); }, []);
  useEffect(() => { localStorage.setItem(REMINDER_STORAGE_KEY, String(remindersEnabled)); }, [remindersEnabled]);
  useEffect(() => { localStorage.setItem(IMMERSIVE_STORAGE_KEY, String(immersive)); }, [immersive]);
  useEffect(() => window.lecpunchDesktop?.onMainImmersive((enabled) => setImmersive(enabled)), []);
  useEffect(() => {
    if (quickTask) localStorage.setItem(QUICK_TASK_STORAGE_KEY, JSON.stringify(quickTask));
    else localStorage.removeItem(QUICK_TASK_STORAGE_KEY);
  }, [quickTask]);

  useEffect(() => {
    if (!attendance?.hasActiveSession) return;
    const ticker = window.setInterval(() => setAttendance((current) => current?.session ? { ...current, session: { ...current.session, elapsedSeconds: current.session.elapsedSeconds + 1 } } : current), 1000);
    return () => window.clearInterval(ticker);
  }, [attendance?.hasActiveSession]);

  useEffect(() => {
    if (!remindersEnabled || immersive) return;
    const tryReminder = () => {
      const now = new Date();
      const customReminder = quickTask ? (() => {
        const [hour, minute] = quickTask.time.split(':').map(Number);
        return { hour, minute, title: quickTask.title, body: `定时任务「${quickTask.title}」现在开始。` };
      })() : null;
      const reminder = [...reminderTimes, ...(customReminder ? [customReminder] : [])].find((item) => item.hour === now.getHours() && item.minute === now.getMinutes());
      if (!reminder) return;
      const key = `${now.toDateString()}-${reminder.hour}-${reminder.minute}`;
      if (localStorage.getItem('lecpunch.election.last-reminder') === key) return;
      localStorage.setItem('lecpunch.election.last-reminder', key);
      void showDesktopReminder(reminder.title, reminder.body);
    };
    tryReminder();
    const timer = window.setInterval(tryReminder, 30_000);
    return () => window.clearInterval(timer);
  }, [immersive, quickTask, remindersEnabled]);

  useEffect(() => {
    const stopListening = window.lecpunchDesktop?.onMainAction((action) => {
      if (action === 'refresh') {
        void refresh();
      } else if (action === 'schedule') {
        setScheduleOpen(true);
      } else {
        setNotice('小猫商城正在筹备中，敬请期待。');
      }
    });
    return () => stopListening?.();
  }, []);

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

  const toggleImmersive = () => {
    const next = !immersive;
    if (!window.lecpunchDesktop) {
      setImmersive(next);
      setNotice('浏览器模式只会静音 LecPunch 自身提醒。');
      return;
    }
    void window.lecpunchDesktop.setImmersive(next).then((result) => {
      setImmersive(next && result.enabled);
      setNotice(result.message);
    });
  };

  const hideToTray = async () => {
    if (!window.lecpunchDesktop) return setNotice('当前为浏览器模式，只有 Windows 桌面端支持最小化到托盘。');
    await window.lecpunchDesktop.hideToTray();
  };

  if (!user) return <LoginScreen loading={loading} notice={notice} onLogin={async (username, password) => { setLoading(true); try { setUser(await login(username, password)); await refresh(); } catch (error) { setNotice(error instanceof Error ? error.message : '登录失败'); setLoading(false); } }} />;

  const labels: Record<View, string> = { dashboard: '工作台', ranking: '打卡排行', team: '团队成员', reports: '成长报告' };
  return <main className={`app-shell ${immersive ? 'is-immersive' : ''}`}><div className="blue-orb blue-orb-one" /><div className="blue-orb blue-orb-two" /><section className="desktop-frame"><Sidebar active={view} open={mobileOpen} onClose={() => setMobileOpen(false)} onSelect={(next) => { setView(next); setMobileOpen(false); }} user={user} onLogout={() => { clearToken(); setUser(null); }} immersive={immersive} onToggleImmersive={toggleImmersive} /><div className="workspace"><header className="topbar"><button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="打开菜单"><Menu size={19} /></button><div className="crumb"><span>LEC / ELECTION</span><ChevronRight size={14} /><strong>{labels[view]}</strong></div><div className="topbar-actions"><button className="icon-button" aria-label="测试系统提醒" onClick={() => { void showDesktopReminder('LecPunch 提醒测试', 'Windows 原生提醒已准备就绪。'); setNotice(immersive ? '沉浸模式中不会弹出提醒。' : '已发送 Windows 原生提醒测试。'); }}><Bell size={18} /></button><button className="icon-button" aria-label="最小化到系统托盘" onClick={() => void hideToTray()}><Minimize2 size={18} /></button><button className="icon-button" aria-label="刷新数据" onClick={() => void refresh()}><RefreshCw size={18} /></button><div className="profile-chip"><span>{user.displayName.slice(0, 1)}</span><div><strong>{user.displayName}</strong><small>{user.role === 'admin' ? '管理员' : '成员'}</small></div></div></div></header>{notice ? <div className="toast"><Check size={16} /><span>{notice}</span><button onClick={() => setNotice(null)} aria-label="关闭"><X size={15} /></button></div> : null}{loading ? <div className="loading-line" /> : null}{view === 'dashboard' ? <Dashboard user={user} attendance={attendance} points={points} teamStats={teamStats} remindersEnabled={remindersEnabled} onToggleReminders={() => setRemindersEnabled((current) => !current)} onAttendance={() => void handleAttendance()} onRanking={() => setView('ranking')} /> : null}{view === 'ranking' ? <RankingPage teamStats={teamStats} /> : null}{view === 'team' ? <TeamPage teamStats={teamStats} /> : null}{view === 'reports' ? <ReportsPage reports={reports} connected={reportSourceConnected} /> : null}</div></section>{scheduleOpen ? <QuickSchedule initialTask={quickTask} onClose={() => setScheduleOpen(false)} onSave={(task) => { setQuickTask(task); setRemindersEnabled(true); setScheduleOpen(false); setNotice(`已设置「${task.title}」：每天 ${task.time} 提醒。`); }} /> : null}</main>;
};

const LoginScreen = ({ loading, notice, onLogin }: { loading: boolean; notice: string | null; onLogin: (username: string, password: string) => Promise<void> }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  return <main className="app-shell login-shell"><div className="blue-orb blue-orb-one" /><div className="blue-orb blue-orb-two" /><section className="login-card blue-card"><div className="brand-mark"><Sparkles size={23} /></div><p className="eyebrow">LECPUNCH / ELECTION</p><h1>把每一次专注<br /><em>留在成长里。</em></h1><p className="muted">打卡、团队节奏和成长报告，在同一个蓝白空间里完成。</p><form onSubmit={(event: FormEvent) => { event.preventDefault(); void onLogin(username, password); }}><label>用户名<input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="输入用户名" autoFocus /></label><label>密码<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="输入密码" /></label>{notice ? <p className="form-error">{notice}</p> : null}<button className="primary-button" disabled={loading}>{loading ? '正在连接...' : '进入工作台'}<ArrowUpRight size={18} /></button></form><small>认证服务：{getApiBaseUrl()}</small></section></main>;
};

const Sidebar = ({ active, open, onClose, onSelect, user, onLogout, immersive, onToggleImmersive }: { active: View; open: boolean; onClose: () => void; onSelect: (view: View) => void; user: ElectionUser; onLogout: () => void; immersive: boolean; onToggleImmersive: () => void }) => {
  const items: Array<{ id: View; label: string; icon: typeof LayoutDashboard }> = [{ id: 'dashboard', label: '工作台', icon: LayoutDashboard }, { id: 'ranking', label: '打卡排行', icon: Trophy }, { id: 'team', label: '团队成员', icon: UsersRound }, { id: 'reports', label: '成长报告', icon: BookOpenText }];
  return <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}><div className="sidebar-header"><div className="brand-mark"><Sparkles size={20} /></div><div><strong>lec<span>e</span>ction</strong><small>DESKTOP CLIENT</small></div><button className="icon-button sidebar-close" onClick={onClose}><X size={18} /></button></div><nav>{items.map(({ id, label, icon: Icon }) => <button key={id} className={active === id ? 'nav-active' : ''} onClick={() => onSelect(id)}><Icon size={19} /><span>{label}</span>{active === id ? <i /> : null}</button>)}</nav><div className="sidebar-bottom"><button className={`immersive-toggle ${immersive ? 'enabled' : ''}`} onClick={onToggleImmersive}><Moon size={17} /><span><strong>免提示模式</strong><small>{immersive ? 'QQ、微信提醒已静音' : '专注时关闭 QQ、微信提醒'}</small></span><i /></button><p className="system-note"><VolumeX size={13} />首次开启会请求通知管理授权</p><button className="logout" onClick={onLogout}><LogOut size={17} />退出 {user.displayName}</button></div></aside>;
};

const Dashboard = ({ user, attendance, points, teamStats, remindersEnabled, onToggleReminders, onAttendance, onRanking }: { user: ElectionUser; attendance: AttendanceSnapshot | null; points: number; teamStats: TeamWeeklyStat[]; remindersEnabled: boolean; onToggleReminders: () => void; onAttendance: () => void; onRanking: () => void }) => {
  const elapsed = attendance?.session?.elapsedSeconds ?? 0;
  const active = Boolean(attendance?.hasActiveSession);
  const ranking = teamStats.slice(0, 3);
  return <div className="page dashboard-page"><section className="welcome-row"><div><p className="eyebrow">{formatToday().toUpperCase()}</p><h1>你好，{user.displayName}<span> · </span>专注开始</h1><p>每一分钟都有记录，每一次回看都看得见成长。</p></div><div className="week-pill"><CalendarDays size={17} /><span>{getWeekKey()}</span><i /></div></section><section className="dashboard-grid"><article className={`focus-card blue-card ${active ? 'is-active' : ''}`}><div className="focus-card-top"><div><span className="live-dot" />{active ? '正在专注' : '准备开始'}</div><small>{active ? '服务端持续确认中' : '由服务器确认有效时长'}</small></div><div className="timer">{formatDuration(elapsed)}</div><p>{active ? '保持节奏，所有有效分钟都会沉淀成新的积分。' : '点击开始，开启一段清晰、有记录的学习时光。'}</p><button className="attendance-button" onClick={onAttendance}>{active ? '结束专注' : '开始专注'}<ArrowUpRight size={19} /></button><div className="focus-orb orb-one" /><div className="focus-orb orb-two" /></article><article className="points-card blue-card"><div className="card-label"><CircleDollarSign size={18} />成长积分</div><div className="points-value"><span>{points.toLocaleString()}</span><small>PTS</small></div><div className="points-foot"><Flame size={17} /><span>有效专注每满一分钟 +1</span></div><div className="mini-bars">{[34, 57, 41, 72, 54, 83, 66].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div></article><article className="reminder-card blue-card"><div className="card-label"><BellRing size={18} />按时提醒</div><strong>{remindersEnabled ? '提醒已开启' : '提醒已暂停'}</strong><p>09:00、13:00、20:30 将通过 Windows 原生消息提醒。</p><button className={`switch-row ${remindersEnabled ? 'on' : ''}`} onClick={onToggleReminders}><span>{remindersEnabled ? '关闭提醒' : '开启提醒'}</span><i /></button></article></section><section className="lower-grid"><article className="ranking-preview blue-card"><div className="section-head"><div><p className="eyebrow">ATTENDANCE RANKING</p><h2>本周打卡排行</h2></div><button onClick={onRanking}>完整排行 <ChevronRight size={16} /></button></div>{ranking.length ? <ol className="compact-ranking">{ranking.map((member, index) => <li key={member.memberKey}><b>{String(index + 1).padStart(2, '0')}</b><span>{member.displayName}</span><small>{formatStudyDuration(member.totalDurationSeconds)}</small></li>)}</ol> : <EmptyData text="服务器上线团队统计后，这里会显示本周排行。" />}</article><article className="focus-guide blue-card"><div className="section-head"><div><p className="eyebrow">QUIET MODE</p><h2>专注，不必全屏</h2></div><EyeOff size={19} /></div><p>免提示模式不会改变窗口大小，只会静音 LecPunch 的按时提醒。QQ、微信的通知与声音可由 Windows 专注助手统一控制。</p><div><span><Check size={14} />保持当前窗口</span><span><Check size={14} />LecPunch 静音</span></div></article></section></div>;
};

const RankingPage = ({ teamStats }: { teamStats: TeamWeeklyStat[] }) => <div className="page ranking-page"><section className="welcome-row"><div><p className="eyebrow">ATTENDANCE LEADERBOARD</p><h1>打卡<span>排行</span></h1><p>按本周有效打卡时长排序；排行只展示成员昵称。</p></div><div className="week-pill"><CalendarDays size={17} /><span>{getWeekKey()}</span><i /></div></section><section className="ranking-card blue-card">{teamStats.length ? <ol className="full-ranking">{teamStats.map((member, index) => <li key={member.memberKey}><div className={`rank-medal rank-${index + 1}`}>{index < 3 ? <Crown size={18} /> : String(index + 1).padStart(2, '0')}</div><strong>{member.displayName}</strong><span>{member.sessionsCount} 次打卡</span><time>{formatStudyDuration(member.totalDurationSeconds)}</time></li>)}</ol> : <EmptyData text="暂无团队统计数据。服务器部署 stats 模块后，排行会自动加载。" />}</section></div>;

const TeamPage = ({ teamStats }: { teamStats: TeamWeeklyStat[] }) => {
  const groups = useMemo(() => {
    const result = new Map<string, TeamWeeklyStat[]>();
    teamStats.forEach((member) => { const grade = member.enrollYear ? `${member.enrollYear} 级` : '未设置年级'; result.set(grade, [...(result.get(grade) ?? []), member]); });
    return [...result.entries()].sort(([left], [right]) => right.localeCompare(left));
  }, [teamStats]);
  return <div className="page team-page"><section className="welcome-row"><div><p className="eyebrow">TEAM DIRECTORY</p><h1>团队<span>成员</span></h1><p>按入学年级分组，展示昵称与实名；数据仅限同团队认证成员可见。</p></div></section>{groups.length ? <section className="grade-groups">{groups.map(([grade, members]) => <article className="grade-group blue-card" key={grade}><header><div><p className="eyebrow">COHORT</p><h2>{grade}</h2></div><span>{members.length} 位成员</span></header><div className="member-grid">{members.map((member) => <div className="member-card" key={member.memberKey}><div className="member-avatar">{member.displayName.slice(0, 1)}</div><div><strong>{member.displayName}</strong><span>（{member.realName || '未设置真名'}）</span><small>{member.role === 'admin' ? '管理员' : '成员'} · 本周 {formatStudyDuration(member.totalDurationSeconds)}</small></div></div>)}</div></article>)}</section> : <section className="blue-card empty-panel"><UsersRound size={30} /><h2>团队成员暂未加载</h2><p>部署并开放 `/stats/team/current-week` 后，应用会按不同年级自动分组显示昵称与真名。</p></section>}</div>;
};

const ReportsPage = ({ reports, connected }: { reports: WeeklyReportFeed | null; connected: boolean }) => <div className="page reports-page"><section className="welcome-row"><div><p className="eyebrow">GROWTH REPORTS</p><h1>成长<span>报告</span></h1><p>日报原文始终保留在成员自己的 GitHub 博客；桌面端只读取汇总与跳转链接。</p></div><div className="week-pill"><CalendarDays size={17} /><span>{reports?.weekKey ?? getWeekKey()}</span><i /></div></section>{connected && reports ? <section className="report-list">{reports.members.map((report) => <article className="member-report blue-card" key={report.studentId}><div className="report-avatar">{report.displayName.slice(0, 1)}</div><div className="member-report-main"><div><p className="eyebrow">{report.studentId}</p><h2>{report.displayName}</h2></div><p>{report.summary}</p><div className="report-meta"><span><BookOpenText size={14} />{report.dailyCount} 篇日报</span><span className={`status-${report.status}`}>{report.status === 'generated' ? '已生成' : report.status === 'missing' ? '缺少日报' : '等待处理'}</span></div></div>{report.url ? <a href={report.url} target="_blank" rel="noreferrer" className="open-report">打开报告 <ArrowUpRight size={16} /></a> : <span className="open-report disabled">报告尚未发布</span>}</article>)}</section> : <EmptyReportState />}</div>;
const EmptyReportState = () => <section className="empty-report blue-card"><div className="empty-icon"><BookOpenText size={30} /></div><p className="eyebrow">REPORT SOURCE NOT CONNECTED</p><h2>等待本地周报管理软件发布清单</h2><p>配置统一 GitHub 管理仓库中的 <code>overview/current.json</code> 地址后，这里会显示本周汇总。</p><div className="manifest-code">VITE_REPORTS_MANIFEST_URL=https://raw.githubusercontent.com/...</div></section>;
const EmptyData = ({ text }: { text: string }) => <p className="empty-data">{text}</p>;

const QuickSchedule = ({ initialTask, onClose, onSave }: { initialTask: QuickTask | null; onClose: () => void; onSave: (task: QuickTask) => void }) => {
  const [title, setTitle] = useState(initialTask?.title ?? '专注提醒');
  const [time, setTime] = useState(initialTask?.time ?? '20:30');
  return <div className="schedule-mask" role="dialog" aria-modal="true" aria-label="快速设置定时任务"><section className="schedule-dialog blue-card"><button className="schedule-close" onClick={onClose} aria-label="关闭"><X size={18} /></button><p className="eyebrow">QUICK SCHEDULE</p><h2>快速定时任务</h2><p>每天到点后，将以 Windows 原生通知提醒你。</p><label>任务名称<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={24} autoFocus /></label><label>提醒时间<input value={time} onChange={(event) => setTime(event.target.value)} type="time" /></label><button className="primary-button" onClick={() => onSave({ title: title.trim() || '专注提醒', time })}>保存并生效 <BellRing size={17} /></button></section></div>;
};
