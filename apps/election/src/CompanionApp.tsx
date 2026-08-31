import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { BongoCatCompanion } from '@/components/BongoCatCompanion';
import { checkIn, checkOut, fetchAttendance, fetchCurrentUser } from '@/lib/api';
import type { AttendanceSnapshot } from '@/types';

export const CompanionApp = () => {
  const [attendance, setAttendance] = useState<AttendanceSnapshot | null>(null);
  const [immersive, setImmersive] = useState(false);
  const [catScale, setCatScale] = useState(1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [replyTemplate, setReplyTemplate] = useState('{username} {message}');
  const [userName, setUserName] = useState('同学');
  const [catMessage, setCatMessage] = useState<{ id: number; message: string } | null>(null);
  const messageTimerRef = useRef<number | null>(null);

  const refreshAttendance = async () => {
    try {
      setAttendance(await fetchAttendance());
    } catch {
      setAttendance(null);
    }
  };

  useEffect(() => {
    document.documentElement.classList.add('companion-document');
    document.body.classList.add('companion-body');
    void refreshAttendance();
    void window.lecpunchDesktop?.getCompanionSettings().then((settings) => {
      setCatScale(settings.scale);
      setReplyTemplate(settings.replyTemplate);
    });
    void fetchCurrentUser().then((user) => setUserName(user.displayName)).catch(() => undefined);
    const stopMessages = window.lecpunchDesktop?.onBongoMessage(({ message }) => {
      if (messageTimerRef.current) window.clearTimeout(messageTimerRef.current);
      setCatMessage({ id: Date.now(), message });
      messageTimerRef.current = window.setTimeout(() => setCatMessage(null), 2000);
    });
    const timer = window.setInterval(() => void refreshAttendance(), 30_000);
    return () => {
      document.documentElement.classList.remove('companion-document');
      document.body.classList.remove('companion-body');
      window.clearInterval(timer);
      stopMessages?.();
      if (messageTimerRef.current) window.clearTimeout(messageTimerRef.current);
    };
  }, []);

  const toggleAttendance = async () => {
    try {
      if (attendance?.hasActiveSession) {
        await checkOut();
        await window.lecpunchDesktop?.notify({ title: 'LecPunch', body: '小猫已为你结束本次打卡。' });
      } else {
        await checkIn();
        await window.lecpunchDesktop?.notify({ title: 'LecPunch', body: '小猫已为你开始专注打卡。' });
      }
      await refreshAttendance();
      window.lecpunchDesktop?.notifyMainStateChanged();
    } catch (error) {
      await window.lecpunchDesktop?.notify({ title: 'LecPunch', body: error instanceof Error ? error.message : '打卡操作失败。' });
    }
  };

  const toggleImmersive = () => {
    const next = !immersive;
    setImmersive(next);
    localStorage.setItem('lecpunch.election.immersive-enabled', String(next));
    void window.lecpunchDesktop?.setImmersive(next).then((result) => {
      if (!result?.enabled && next) setImmersive(false);
      return window.lecpunchDesktop?.notify({ title: 'LecPunch', body: result?.message ?? (next ? '免提示模式已开启。' : '免提示模式已退出。') });
    });
  };

  const updateCatScale = async (scale: number) => {
    const settings = await window.lecpunchDesktop?.updateCompanionSettings({ scale });
    setCatScale(settings?.scale ?? scale);
  };

  const updateReplyTemplate = async (template: string) => {
    setReplyTemplate(template);
    if (!template.trim()) return;
    const settings = await window.lecpunchDesktop?.updateCompanionSettings({ replyTemplate: template });
    if (settings?.replyTemplate) setReplyTemplate(settings.replyTemplate);
  };

  const hideCat = async () => {
    await window.lecpunchDesktop?.updateCompanionSettings({ visible: false });
  };

  const formattedCatMessage = catMessage ? {
    ...catMessage,
    message: replyTemplate.split('{username}').join(userName || '同学').split('{message}').join(catMessage.message)
  } : null;

  return <main className="companion-shell" style={{ '--cat-scale': catScale } as CSSProperties}><BongoCatCompanion desktop attendanceActive={Boolean(attendance?.hasActiveSession)} immersive={immersive} catScale={catScale} settingsOpen={settingsOpen} onToggleSettings={() => setSettingsOpen((open) => !open)} onSetCatScale={(scale) => void updateCatScale(scale)} onSetVisible={(visible) => { if (!visible) void hideCat(); }} onOpenFocusAssist={() => void window.lecpunchDesktop?.openFocusAssist()} onAttendance={() => void toggleAttendance()} onToggleImmersive={toggleImmersive} onOpenSchedule={() => window.lecpunchDesktop?.showMain('schedule')} onOpenShop={() => window.lecpunchDesktop?.showMain('shop')} replyTemplate={replyTemplate} onSetReplyTemplate={(template) => void updateReplyTemplate(template)} catMessage={formattedCatMessage} /></main>;
};
