import { Application, Ticker } from 'pixi.js';
import { CubismSetting, Live2DSprite } from 'easy-live2d';
import { BellRing, Coffee, Moon, ShoppingBag } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type Hand = 'left' | 'right';
type Position = { x: number; y: number };

const CAT_WIDTH = 360;
const CAT_HEIGHT = 208;
const POSITION_STORAGE_KEY = 'lecpunch.election.bongocat-position';
const assetBase = window.lecpunchDesktop?.isPackaged
  ? 'lecpunch-assets://bongocat/keyboard/'
  : `${import.meta.env.BASE_URL}bongocat/keyboard/`;

const mapKey = (event: KeyboardEvent) => {
  const aliases: Record<string, string> = {
    Enter: 'Return',
    Space: 'Space',
    Backquote: 'BackQuote',
    Backslash: 'Backslash',
    Slash: 'Slash',
    ShiftLeft: 'ShiftLeft',
    ShiftRight: 'ShiftRight',
    ControlLeft: 'ControlLeft',
    ControlRight: 'ControlRight',
    AltLeft: 'Alt',
    AltRight: 'AltGr',
    MetaLeft: 'Meta',
    MetaRight: 'Meta',
    CapsLock: 'CapsLock',
    Tab: 'Tab',
    Escape: 'Escape',
    Delete: 'Delete',
    Backspace: 'Backspace',
    ArrowUp: 'UpArrow',
    ArrowDown: 'DownArrow',
    ArrowLeft: 'LeftArrow',
    ArrowRight: 'RightArrow'
  };

  if (aliases[event.code]) return aliases[event.code];
  if (/^Key[A-Z]$/.test(event.code)) return event.code;
  if (/^Digit\d$/.test(event.code)) return `Num${event.code.slice(-1)}`;
  if (/^Numpad\d$/.test(event.code)) return `Num${event.code.slice(-1)}`;
  return null;
};

const getHand = (key: string): Hand => key.endsWith('Arrow') ? 'right' : 'left';

const clampPosition = (position: Position): Position => ({
  x: Math.max(0, Math.min(position.x, window.innerWidth - CAT_WIDTH)),
  y: Math.max(38, Math.min(position.y, window.innerHeight - CAT_HEIGHT))
});

const readInitialPosition = (): Position => {
  try {
    const saved = JSON.parse(localStorage.getItem(POSITION_STORAGE_KEY) || 'null') as Position | null;
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) return clampPosition(saved);
  } catch {
    // A malformed saved location should never block the cat from rendering.
  }
  return clampPosition({ x: window.innerWidth - CAT_WIDTH - 24, y: window.innerHeight - CAT_HEIGHT - 28 });
};

export const BongoCatCompanion = ({
  attendanceActive,
  immersive,
  onAttendance,
  onToggleImmersive,
  onOpenSchedule,
  onOpenShop
}: {
  attendanceActive: boolean;
  immersive: boolean;
  onAttendance: () => void;
  onToggleImmersive: () => void;
  onOpenSchedule: () => void;
  onOpenShop: () => void;
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modelRef = useRef<Live2DSprite | null>(null);
  const pointerRef = useRef<{ id: number; startX: number; startY: number; origin: Position; moved: boolean } | null>(null);
  const [position, setPosition] = useState<Position>(readInitialPosition);
  const [menuOpen, setMenuOpen] = useState(false);
  const [leftKey, setLeftKey] = useState<string | null>(null);
  const [rightKey, setRightKey] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let app: Application | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let cancelled = false;

    const resizeModel = () => {
      const model = modelRef.current;
      const host = hostRef.current;
      if (!model || !host) return;
      const scale = Math.min(host.clientWidth / model.width, host.clientHeight / model.height);
      model.scale.set(scale);
      model.anchor.set(0.5);
      model.x = host.clientWidth / 2;
      model.y = host.clientHeight / 2;
    };

    const loadModel = async () => {
      try {
        const canvas = canvasRef.current;
        const host = hostRef.current;
        if (!canvas || !host) return;

        app = new Application();
        await app.init({ view: canvas, resizeTo: host, backgroundAlpha: 0, autoDensity: true, resolution: devicePixelRatio });
        const response = await fetch(`${assetBase}cat.model3.json`);
        if (!response.ok) throw new Error('Live2D 模型清单不可访问');
        const modelJSON = await response.json();
        const modelSetting = new CubismSetting({ modelJSON });
        modelSetting.redirectPath(({ file }) => `${assetBase}${file}`);
        const model = new Live2DSprite({ modelSetting, ticker: Ticker.shared });
        app.stage.addChild(model);
        await model.ready;
        if (cancelled) {
          model.destroy();
          return;
        }
        modelRef.current = model;
        resizeModel();
        resizeObserver = new ResizeObserver(resizeModel);
        resizeObserver.observe(host);
        setReady(true);
      } catch (error) {
        console.error('BongoCat Live2D load failed', error);
        if (!cancelled) setLoadFailed(true);
      }
    };

    void loadModel();
    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      modelRef.current?.destroy();
      modelRef.current = null;
      app?.destroy();
    };
  }, []);

  useEffect(() => {
    const updateGaze = (event: PointerEvent) => {
      const model = modelRef.current;
      if (!model) return;
      const x = event.clientX / window.innerWidth * 2 - 1;
      const y = event.clientY / window.innerHeight * 2 - 1;
      model.setParameterValueById('ParamAngleX', -x * 24);
      model.setParameterValueById('ParamAngleY', -y * 12);
      model.setParameterValueById('ParamEyeBallX', -x);
      model.setParameterValueById('ParamEyeBallY', -y);
    };
    window.addEventListener('pointermove', updateGaze, { passive: true });
    return () => window.removeEventListener('pointermove', updateGaze);
  }, []);

  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      const key = mapKey(event);
      if (!key) return;
      const hand = getHand(key);
      if (hand === 'left') setLeftKey(key);
      else setRightKey(key);
      modelRef.current?.setParameterValueById(hand === 'left' ? 'CatParamLeftHandDown' : 'CatParamRightHandDown', 1);
    };
    const release = (event: KeyboardEvent) => {
      const key = mapKey(event);
      if (!key) return;
      const hand = getHand(key);
      if (hand === 'left') setLeftKey((current) => current === key ? null : current);
      else setRightKey((current) => current === key ? null : current);
      modelRef.current?.setParameterValueById(hand === 'left' ? 'CatParamLeftHandDown' : 'CatParamRightHandDown', 0);
    };
    const releaseAll = () => {
      setLeftKey(null);
      setRightKey(null);
      modelRef.current?.setParameterValueById('CatParamLeftHandDown', 0);
      modelRef.current?.setParameterValueById('CatParamRightHandDown', 0);
    };
    window.addEventListener('keydown', press);
    window.addEventListener('keyup', release);
    window.addEventListener('blur', releaseAll);
    return () => {
      window.removeEventListener('keydown', press);
      window.removeEventListener('keyup', release);
      window.removeEventListener('blur', releaseAll);
    };
  }, []);

  useEffect(() => {
    const keepInsideScreen = () => setPosition((current) => clampPosition(current));
    window.addEventListener('resize', keepInsideScreen);
    return () => window.removeEventListener('resize', keepInsideScreen);
  }, []);

  const persistPosition = (next: Position) => {
    localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(next));
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, origin: position, moved: false };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    const dx = event.clientX - pointer.startX;
    const dy = event.clientY - pointer.startY;
    if (Math.hypot(dx, dy) > 6) pointer.moved = true;
    setPosition(clampPosition({ x: pointer.origin.x + dx, y: pointer.origin.y + dy }));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    pointerRef.current = null;
    if (pointer.moved) {
      setPosition((current) => {
        persistPosition(current);
        return current;
      });
    } else {
      setMenuOpen((open) => !open);
    }
  };

  const actions = [
    { label: attendanceActive ? '结束打卡' : '开始打卡', icon: <Coffee size={18} />, onClick: onAttendance },
    { label: immersive ? '退出沉浸' : '沉浸模式', icon: <Moon size={18} />, onClick: onToggleImmersive },
    { label: '定时任务', icon: <BellRing size={18} />, onClick: onOpenSchedule },
    { label: '小猫商城', icon: <ShoppingBag size={18} />, onClick: onOpenShop }
  ];

  return <aside className={`bongo-companion ${menuOpen ? 'menu-open' : ''}`} style={{ left: position.x, top: position.y }} aria-label="LecPunch 小猫助手">
    <div className="cat-orbit" aria-hidden="true" />
    <div className="cat-action-fan">{actions.map((action, index) => <button className={`cat-action cat-action-${index + 1}`} key={action.label} onClick={() => { action.onClick(); setMenuOpen(false); }} title={action.label}><span>{action.icon}</span><em>{action.label}</em></button>)}</div>
    <div className="bongo-stage" ref={hostRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} role="button" tabIndex={0} aria-label="拖动小猫移动，单击打开快捷功能">
      <img className="bongo-background" src={`${assetBase}resources/background.png`} alt="" draggable={false} />
      <canvas className="bongo-canvas" ref={canvasRef} />
      {leftKey ? <img className="bongo-key-layer" src={`${assetBase}resources/left-keys/${leftKey}.png`} alt="" draggable={false} /> : null}
      {rightKey ? <img className="bongo-key-layer" src={`${assetBase}resources/right-keys/${rightKey}.png`} alt="" draggable={false} /> : null}
      {!ready ? <img className={`bongo-cover ${loadFailed ? 'load-failed' : ''}`} src={`${assetBase}resources/cover.png`} alt="小猫键盘助手正在准备" draggable={false} /> : null}
      <div className="bongo-hint">{menuOpen ? '点选快捷功能' : '拖动移动 · 单击菜单'}</div>
    </div>
  </aside>;
};
