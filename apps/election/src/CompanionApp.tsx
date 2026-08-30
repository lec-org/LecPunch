import { type CSSProperties, useEffect, useState } from 'react';
import { BongoCatCompanion } from '@/components/BongoCatCompanion';
import { checkIn, checkOut, fetchAttendance } from '@/lib/api';
import type { AttendanceSnapshot } from '@/types';

export const CompanionApp = () => {
  const [attendance, setAttendance] = useState<AttendanceSnapshot | null>(null);
  const [immersive, setImmersive] = useState(false);
  const [catScale, setCatScale] = useState(1);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
    void window.lecpunchDesktop?.getCompanionSettings().then((settings) => setCatScale(settings.scale));
    const timer = window.setInterval(() => void refreshAttendance(), 30_000);
    return () => {
      document.documentElement.classList.remove('companion-document');
      document.body.classList.remove('companion-body');
      window.clearInterval(timer);
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

  const hideCat = async () => {
    await window.lecpunchDesktop?.updateCompanionSettings({ visible: false });
  };

  return <main className="companion-shell" style={{ '--companion-scale': catScale } as CSSProperties}><BongoCatCompanion desktop attendanceActive={Boolean(attendance?.hasActiveSession)} immersive={immersive} catScale={catScale} settingsOpen={settingsOpen} onToggleSettings={() => setSettingsOpen((open) => !open)} onSetCatScale={(scale) => void updateCatScale(scale)} onSetVisible={(visible) => { if (!visible) void hideCat(); }} onOpenFocusAssist={() => void window.lecpunchDesktop?.openFocusAssist()} onAttendance={() => void toggleAttendance()} onToggleImmersive={toggleImmersive} onOpenSchedule={() => window.lecpunchDesktop?.showMain('schedule')} onOpenShop={() => window.lecpunchDesktop?.showMain('shop')} /></main>;
};
