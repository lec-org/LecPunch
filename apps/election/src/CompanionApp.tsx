import { useEffect, useState } from 'react';
import { BongoCatCompanion } from '@/components/BongoCatCompanion';
import { checkIn, checkOut, fetchAttendance } from '@/lib/api';
import type { AttendanceSnapshot } from '@/types';

export const CompanionApp = () => {
  const [attendance, setAttendance] = useState<AttendanceSnapshot | null>(null);
  const [immersive, setImmersive] = useState(false);

  const refreshAttendance = async () => {
    try {
      setAttendance(await fetchAttendance());
    } catch {
      setAttendance(null);
    }
  };

  useEffect(() => {
    document.body.classList.add('companion-body');
    void refreshAttendance();
    const timer = window.setInterval(() => void refreshAttendance(), 30_000);
    return () => {
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
    void window.lecpunchDesktop?.setImmersive(next);
    void window.lecpunchDesktop?.notify({ title: 'LecPunch', body: next ? '沉浸模式已开启。' : '沉浸模式已退出。' });
  };

  return <main className="companion-shell"><BongoCatCompanion desktop attendanceActive={Boolean(attendance?.hasActiveSession)} immersive={immersive} onAttendance={() => void toggleAttendance()} onToggleImmersive={toggleImmersive} onOpenSchedule={() => window.lecpunchDesktop?.showMain('schedule')} onOpenShop={() => window.lecpunchDesktop?.showMain('shop')} /></main>;
};
