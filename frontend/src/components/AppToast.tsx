import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CheckCircle, Info, WarningCircle, X, XCircle } from '@phosphor-icons/react';
import { Button } from './ui/button';
import { useTranslation } from 'react-i18next';

type ToastVariant = 'default' | 'accent' | 'success' | 'warning' | 'danger';
type ToastOptions = { description?: string; variant?: ToastVariant; timeout?: number };
type ToastItem = {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
  phase: 'entering' | 'visible' | 'exiting';
  exitIndex?: number;
};
type AutoTimer = {
  handle: ReturnType<typeof setTimeout> | null;
  deadline: number;
  remaining: number;
};
let items: ToastItem[] = [];
let nextId = 1;
let timersPaused = false;
const listeners = new Set<() => void>();
const autoTimers = new Map<number, AutoTimer>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => items;
const remove = (id: number) => {
  autoTimers.delete(id);
  items = items.filter((item) => item.id !== id);
  emit();
};
const close = (id: number) => {
  const exitIndex = items
    .filter((item) => item.phase !== 'exiting')
    .findIndex((item) => item.id === id);
  if (exitIndex < 0) return;
  const timer = autoTimers.get(id);
  if (timer?.handle) clearTimeout(timer.handle);
  autoTimers.delete(id);
  items = items.map((item) => (item.id === id ? { ...item, phase: 'exiting', exitIndex } : item));
  emit();
  setTimeout(() => remove(id), 350);
};
const schedule = (id: number, remaining: number) => {
  if (timersPaused) {
    autoTimers.set(id, { deadline: 0, remaining, handle: null });
    return;
  }
  const deadline = Date.now() + remaining;
  autoTimers.set(id, { deadline, remaining, handle: setTimeout(() => close(id), remaining) });
};
const pauseAll = () => {
  timersPaused = true;
  autoTimers.forEach((timer, id) => {
    if (timer.handle) clearTimeout(timer.handle);
    autoTimers.set(id, {
      handle: null,
      deadline: 0,
      remaining: timer.handle ? Math.max(0, timer.deadline - Date.now()) : timer.remaining,
    });
  });
};
const resumeAll = () => {
  timersPaused = false;
  autoTimers.forEach((timer, id) => schedule(id, timer.remaining));
};
const add = (title: string, options: ToastOptions = {}) => {
  const id = nextId++;
  items = [
    {
      id,
      title,
      description: options.description,
      variant: options.variant ?? 'default',
      phase: 'entering',
    },
    ...items,
  ];
  emit();
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      items = items.map((item) =>
        item.id === id && item.phase === 'entering' ? { ...item, phase: 'visible' } : item,
      );
      emit();
    }),
  );
  const timeout = options.timeout ?? 4000;
  if (timeout > 0) schedule(id, timeout);
  return id;
};
export const toast = Object.assign(add, {
  success: (title: string, options: Omit<ToastOptions, 'variant'> = {}) =>
    add(title, { ...options, variant: 'success' }),
  danger: (title: string, options: Omit<ToastOptions, 'variant'> = {}) =>
    add(title, { ...options, variant: 'danger' }),
  info: (title: string, options: Omit<ToastOptions, 'variant'> = {}) =>
    add(title, { ...options, variant: 'accent' }),
  warning: (title: string, options: Omit<ToastOptions, 'variant'> = {}) =>
    add(title, { ...options, variant: 'warning' }),
  close,
  clear: () => items.forEach((item) => close(item.id)),
  pauseAll,
  resumeAll,
});
const icons = {
  default: Info,
  accent: Info,
  success: CheckCircle,
  warning: WarningCircle,
  danger: XCircle,
};
const iconColor = {
  default: 'text-popover-foreground',
  accent: 'text-[var(--accent-soft-foreground)]',
  success: 'text-[var(--success-soft-foreground)]',
  warning: 'text-[var(--warning-soft-foreground)]',
  danger: 'text-destructive',
};
function AppToast({
  item,
  index,
  expanded,
  frontHeight,
  expandedOffset,
  onHeight,
  onExpand,
}: {
  item: ToastItem;
  index: number;
  expanded: boolean;
  frontHeight: number;
  expandedOffset: number;
  onHeight: (id: number, height: number) => void;
  onExpand: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const Icon = icons[item.variant];
  const hidden = index >= 3;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => onHeight(item.id, el.scrollHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [item.id, onHeight]);
  const exiting = item.phase === 'exiting',
    entering = item.phase === 'entering',
    interactive = expanded || index === 0;
  return (
    <div
      ref={ref}
      className={`absolute inset-x-0 top-0 flex min-h-12 items-center gap-1.5 overflow-hidden rounded-(--radius) bg-card px-4 py-3 text-foreground shadow-[var(--overlay-shadow)] outline-none transition-[transform,opacity,height] duration-300 ease-out focus-visible:ring-2 focus-visible:ring-ring ${interactive ? 'h-auto pointer-events-auto overflow-visible' : 'pointer-events-none'} ${hidden ? 'invisible opacity-0' : ''} ${exiting ? 'pointer-events-none opacity-0 -translate-y-[18px] scale-[.985]' : entering ? 'opacity-0 -translate-y-2.5 scale-[.985]' : ''}`}
      style={
        {
          height: interactive ? undefined : `${frontHeight}px`,
          opacity: hidden || exiting ? 0 : undefined,
          transform: `translate3d(0,${exiting ? -18 : expanded ? expandedOffset : index * 12}px,0) scale(${exiting ? 0.985 : expanded ? 1 : 1 - index * 0.05})`,
          zIndex: 100 - index,
        } as React.CSSProperties
      }
      role={item.variant === 'danger' ? 'alert' : 'status'}
      aria-hidden={hidden}
      aria-live={item.variant === 'danger' ? 'assertive' : 'polite'}
      tabIndex={index === 0 ? 0 : -1}
      onMouseEnter={onExpand}
    >
      <Icon className={`flex-none ${iconColor[item.variant]}`} size={18} weight="duotone" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <strong className="text-xs font-medium">{item.title}</strong>
        {item.description ? (
          <small className="text-[11px] leading-4 text-muted-foreground">{item.description}</small>
        ) : null}
      </span>
      <Button
        variant="ghost"
        className="ml-auto grid size-6 min-w-6 flex-none place-items-center rounded-full border border-transparent p-0 text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground hover:opacity-100 focus-visible:opacity-100 [&_svg]:size-3"
        aria-label={t('toast.close')}
        title={t('toast.close')}
        onClick={() => close(item.id)}
      >
        <X size={12} weight="bold" />
      </Button>
    </div>
  );
}
export function AppToastProvider() {
  const { t } = useTranslation();
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [expanded, setExpanded] = useState(false);
  const [heights, setHeights] = useState<Record<number, number>>({});
  const setHeight = useCallback(
    (id: number, height: number) =>
      setHeights((previous) =>
        previous[id] === height ? previous : { ...previous, [id]: height },
      ),
    [],
  );
  const expand = () => {
    if (!expanded) {
      setExpanded(true);
      pauseAll();
    }
  };
  const collapse = () => {
    setExpanded(false);
    resumeAll();
  };
  const active = current.filter((item) => item.phase !== 'exiting');
  const frontHeight = heights[active[0]?.id] ?? 56;
  const totalVisible = active
    .slice(0, 3)
    .reduce((sum, item) => sum + (heights[item.id] ?? frontHeight) + 12, -12);
  return (
    <div
      className={`fixed top-4 right-4 z-[80] w-[min(260px,calc(100vw-32px))] outline-none ${expanded ? 'pointer-events-auto' : 'pointer-events-none'}`}
      style={{ height: `${expanded ? Math.max(120, totalVisible) : 120}px` }}
      aria-label={t('toast.region')}
      onMouseEnter={expand}
      onMouseLeave={collapse}
    >
      {current.map((item) => {
        const index = item.phase === 'exiting' ? (item.exitIndex ?? 0) : active.indexOf(item);
        return (
          <AppToast
            key={item.id}
            item={item}
            index={index}
            expanded={expanded}
            frontHeight={frontHeight}
            expandedOffset={active
              .slice(0, index)
              .reduce((sum, previous) => sum + (heights[previous.id] ?? frontHeight) + 12, 0)}
            onHeight={setHeight}
            onExpand={expand}
          />
        );
      })}
    </div>
  );
}
