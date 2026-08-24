import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowsClockwise,
  CaretDown,
  Check,
  Clock,
  Copy,
  DotsSixVertical,
  Eye,
  EyeClosed,
  GpsFix,
} from '@phosphor-icons/react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import {
  Reveal,
  ToolLayout,
  undoRedoKey,
  useFocusOnActivate,
  useHistory,
  type PendingAction,
  type ToolId,
} from './shared';
import {
  formatTimeInZone,
  getSystemTimeZone,
  getTimeZoneOptions,
  parseTimeInput,
} from '../utils/time';
import { toast } from './AppToast';

const resultIds = [
  'local',
  'dateTime',
  'dateOnly',
  'timeOnly',
  'zonedIso8601',
  'rfc3339',
  'utc',
  'compact',
  'underscore',
  'unixSeconds',
  'unixMilliseconds',
  'unixNanoseconds',
] as const;
type TimeResultId = (typeof resultIds)[number];
function normalizeOrder(order: string[]) {
  const valid = new Set<string>(resultIds),
    seen = new Set<string>(),
    next: TimeResultId[] = [];
  for (const id of order)
    if (valid.has(id) && !seen.has(id)) {
      next.push(id as TimeResultId);
      seen.add(id);
    }
  for (const id of resultIds) if (!seen.has(id)) next.push(id);
  return next;
}
function TimezoneCombobox({
  value,
  onChange,
  zones,
  placeholder,
  label,
}: {
  value: string;
  onChange: (id: string) => void;
  zones: Array<{ id: string; label: string }>;
  placeholder: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? zones.filter(
          (zone) => zone.label.toLowerCase().includes(q) || zone.id.toLowerCase().includes(q),
        )
      : zones;
  }, [query, zones]);
  const current = zones.find((zone) => zone.id === value);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 pt-3.5 font-mono text-[10px] font-medium uppercase tracking-[.04em] text-muted-foreground">
      <span>{label}</span>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery('');
        }}
      >
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              className="h-[42px] w-full justify-between rounded-(--radius) border border-border bg-card px-3 text-[13px]"
              role="combobox"
              aria-label={label}
            />
          }
        >
          <span className="min-w-0 truncate">{current?.label ?? placeholder}</span>
          <CaretDown size={14} weight="bold" />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(340px,var(--anchor-width))] max-h-[280px] overflow-hidden p-0"
        >
          <Input
            className="h-auto border-x-0 border-t-0 border-b border-border rounded-none bg-transparent px-3 py-2 text-[13px] shadow-none focus-visible:ring-0"
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={placeholder}
          />
          <div className="max-h-[236px] overflow-y-auto p-1">
            {filtered.map((zone) => (
              <Button
                key={zone.id}
                variant="ghost"
                className={`w-full justify-between rounded-sm px-2 py-1.5 text-xs ${zone.id === value ? 'bg-accent text-accent-foreground' : ''}`}
                onClick={() => {
                  onChange(zone.id);
                  setOpen(false);
                }}
              >
                <span className="min-w-0 truncate">{zone.label}</span>
                {zone.id === value && <Check size={12} weight="bold" />}
              </Button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(date),
    get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}
function zonedOffset(date: Date, timeZone: string) {
  const part =
      new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
        .formatToParts(date)
        .find((item) => item.type === 'timeZoneName')?.value || 'GMT',
    match = part.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  return match ? `${match[1]}${match[2].padStart(2, '0')}:${match[3] || '00'}` : 'Z';
}
function TimeResultRow({
  id,
  label,
  value,
  hidden,
  editing,
  onCopy,
  onToggle,
  onSortIndexChange,
}: {
  id: TimeResultId;
  label: string;
  value: string;
  hidden: boolean;
  editing: boolean;
  onCopy: () => void;
  onToggle?: () => void;
  onSortIndexChange?: (index: number) => void;
}) {
  const { t } = useTranslation();
  const sortable = useSortable({ id });
  useLayoutEffect(() => {
    if (sortable.isDragging) onSortIndexChange?.(sortable.newIndex);
  }, [onSortIndexChange, sortable.isDragging, sortable.newIndex]);
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    zIndex: sortable.isDragging ? 1 : undefined,
  };
  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      data-time-result-id={id}
      className={`grid min-h-11 items-center border-b border-border px-1 ${editing ? 'grid-cols-[30px_110px_minmax(0,1fr)_34px]' : 'grid-cols-[110px_minmax(0,1fr)]'} ${hidden ? 'opacity-40' : ''} ${sortable.isDragging ? 'bg-accent' : ''}`}
    >
      {editing && (
        <Button
          ref={sortable.setActivatorNodeRef}
          variant="ghost"
          className="grid size-[30px] min-w-[30px] place-items-center p-0 cursor-grab active:cursor-grabbing"
          {...sortable.attributes}
          {...sortable.listeners}
          aria-label={t('timeTool.dragResult', { label })}
        >
          <DotsSixVertical size={16} weight="duotone" />
        </Button>
      )}
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <Button
        variant="ghost"
        className="min-h-9 min-w-0 justify-start gap-2.5 rounded-(--radius) px-3"
        onClick={onCopy}
      >
        <code className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-foreground">
          {value}
        </code>
        <Copy size={15} weight="duotone" />
      </Button>
      {editing && (
        <Button
          variant="ghost"
          className="size-[30px] min-w-[30px] p-0"
          onClick={onToggle}
          aria-label={t(hidden ? 'timeTool.showResult' : 'timeTool.hideResult', { label })}
        >
          {hidden ? <Eye size={16} weight="duotone" /> : <EyeClosed size={16} weight="duotone" />}
        </Button>
      )}
    </div>
  );
}
export default function TimeTool({
  active,
  resultOrder,
  hiddenResults,
  onSaveResults,
  record,
  pending,
  clearPending,
}: {
  active: boolean;
  resultOrder: string[];
  hiddenResults: string[];
  onSaveResults: (order: string[], hidden: string[]) => void;
  record: (tool: ToolId, action: string, detail: string, input: string) => void;
  pending: PendingAction | null;
  clearPending: () => void;
}) {
  const { t } = useTranslation();
  const { value: input, setValue: setInput, undo, redo } = useHistory('');
  const [timeZone, setTimeZone] = useState(getSystemTimeZone);
  const zones = useMemo(() => getTimeZoneOptions(), []);
  const consumed = useRef<PendingAction | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [draftOrder, setDraftOrder] = useState<TimeResultId[]>(() => normalizeOrder(resultOrder));
  const [draftHidden, setDraftHidden] = useState<Set<string>>(() => new Set(hiddenResults));
  const draftOrderRef = useRef(draftOrder),
    draftHiddenRef = useRef(draftHidden),
    dragTargetIndexRef = useRef(-1);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  useFocusOnActivate(active, () => inputRef.current?.focus());
  const parsed = useMemo(() => parseTimeInput(input, new Date(), timeZone), [input, timeZone]);
  const values = useMemo<Record<TimeResultId, string>>(() => {
    if (!parsed)
      return Object.fromEntries(resultIds.map((id) => [id, ''])) as Record<TimeResultId, string>;
    const part = zonedParts(parsed, timeZone),
      date = `${part.year}-${part.month}-${part.day}`,
      time = `${part.hour}:${part.minute}:${part.second}`;
    return {
      local: formatTimeInZone(parsed, timeZone),
      dateTime: `${date} ${time}`,
      dateOnly: date,
      timeOnly: time,
      zonedIso8601: `${date}T${time}${zonedOffset(parsed, timeZone)}`,
      rfc3339: parsed.toISOString(),
      utc: parsed.toUTCString(),
      compact: `${part.year}${part.month}${part.day}${part.hour}${part.minute}${part.second}`,
      underscore: `${part.year}_${part.month}_${part.day}_${part.hour}_${part.minute}_${part.second}`,
      unixSeconds: Math.floor(parsed.getTime() / 1000).toString(),
      unixMilliseconds: parsed.getTime().toString(),
      unixNanoseconds: (BigInt(parsed.getTime()) * 1000000n).toString(),
    };
  }, [parsed, timeZone]);
  const order = normalizeOrder(resultOrder),
    hidden = new Set(hiddenResults),
    shown = order.filter((id) => !hidden.has(id));
  useEffect(() => {
    if (!pending || pending.tool !== 'time' || consumed.current === pending) return;
    consumed.current = pending;
    clearPending();
    if (pending.action === 'refresh') {
      const now = Math.floor(Date.now() / 1000).toString();
      setInput(now, { isolate: true });
      record('time', t('timeTool.refresh'), now, now);
      return;
    }
    if (pending.action === 'timezone') {
      setTimeZone(getSystemTimeZone());
      return;
    }
    setInput(pending.input, { isolate: true });
    if (pending.action !== 'restore')
      record('time', t('timeTool.converted'), pending.input.trim().slice(0, 40), pending.input);
  }, [pending]);
  const copyResult = (id: TimeResultId) => {
    const label = t(`timeTool.${id}`),
      value = values[id];
    navigator.clipboard?.writeText(value).catch(() => {});
    toast(t('toast.copied', { value }));
    record('time', t('timeTool.converted'), label, input);
  };
  const startEditing = () => {
    const next = normalizeOrder(resultOrder),
      nextHidden = new Set(hiddenResults);
    if (!input.trim()) setInput(Math.floor(Date.now() / 1000).toString(), { isolate: true });
    draftOrderRef.current = next;
    draftHiddenRef.current = nextHidden;
    setDraftOrder(next);
    setDraftHidden(nextHidden);
    setEditing(true);
  };
  const finishEditing = () => {
    onSaveResults(draftOrderRef.current, [...draftHiddenRef.current]);
    setEditing(false);
  };
  const toggleResult = (id: TimeResultId) => {
    const next = new Set(draftHiddenRef.current);
    next.has(id) ? next.delete(id) : next.add(id);
    draftHiddenRef.current = next;
    setDraftHidden(next);
  };
  const moveResult = (fromIndex: number, toIndex: number) => {
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= draftOrderRef.current.length ||
      toIndex >= draftOrderRef.current.length ||
      fromIndex === toIndex
    )
      return;
    const next = arrayMove(draftOrderRef.current, fromIndex, toIndex);
    draftOrderRef.current = next;
    setDraftOrder(next);
  };
  return (
    <Reveal index={0} fill active={active}>
      <ToolLayout title={t('timeTool.title')} desc={t('timeTool.subtitle')} contentMode="fixed">
        <div className="grid h-full min-h-0 grid-rows-[auto_auto_auto_minmax(0,1fr)]">
          <Label className="flex flex-col items-stretch gap-2 font-mono text-[10px] font-medium uppercase tracking-[.04em] text-muted-foreground">
            <span>{t('timeTool.input')}</span>
            <div className="flex items-center gap-2">
              <div className="flex h-[46px] min-w-0 flex-1 items-center gap-2.5 rounded-(--radius) border border-border bg-card px-3.5 focus-within:border-muted-foreground">
                <Clock size={18} weight="duotone" />
                <Input
                  ref={inputRef}
                  className="min-w-0 flex-1 border-0 bg-transparent px-0 py-0 text-[13px] shadow-none focus-visible:ring-0 dark:bg-transparent"
                  value={input}
                  onKeyDown={(event) => undoRedoKey(event, undo, redo)}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder={t('timeTool.placeholder')}
                />
              </div>
              <Button
                variant="ghost"
                className="size-[42px] min-w-[42px] flex-none rounded-(--radius) p-0"
                aria-label={t('timeTool.refresh')}
                onClick={() => {
                  const now = Math.floor(Date.now() / 1000).toString();
                  setInput(now, { isolate: true });
                  record('time', t('timeTool.refresh'), now, now);
                }}
              >
                <ArrowsClockwise size={17} weight="duotone" />
              </Button>
            </div>
            <small className="text-[9px] normal-case tracking-normal">{t('timeTool.hint')}</small>
          </Label>
          <div className="flex items-end gap-2">
            <TimezoneCombobox
              value={timeZone}
              onChange={setTimeZone}
              zones={zones}
              label={t('timeTool.timezone')}
              placeholder={t('timeTool.timezonePlaceholder')}
            />
            <Button
              variant="ghost"
              className="size-[42px] min-w-[42px] flex-none rounded-(--radius) p-0"
              aria-label={t('timeTool.useSystemTimezone')}
              onClick={() => setTimeZone(getSystemTimeZone())}
            >
              <GpsFix size={17} weight="duotone" />
            </Button>
          </div>
          <div className="mt-3.5 flex min-h-[39px] items-center justify-between gap-3 border-b border-border px-1 py-1.5">
            <span className="text-[10px] text-muted-foreground">
              {editing ? t('timeTool.editHint') : ''}
            </span>
            <Button
              variant={editing ? 'default' : 'outline'}
              onClick={editing ? finishEditing : startEditing}
              className="h-[26px] px-2.5 text-[11px]"
            >
              {t(editing ? 'timeTool.done' : 'timeTool.edit')}
            </Button>
          </div>
          <div className="min-h-0 overflow-x-hidden overflow-y-auto">
            {editing ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={({ active }) => {
                  dragTargetIndexRef.current = draftOrderRef.current.indexOf(
                    String(active.id) as TimeResultId,
                  );
                }}
                onDragEnd={({ active }) => {
                  const from = draftOrderRef.current.indexOf(String(active.id) as TimeResultId);
                  moveResult(from, dragTargetIndexRef.current);
                  dragTargetIndexRef.current = -1;
                }}
                onDragCancel={() => {
                  dragTargetIndexRef.current = -1;
                }}
              >
                <SortableContext items={draftOrder} strategy={verticalListSortingStrategy}>
                  <div>
                    {draftOrder.map((id) => (
                      <TimeResultRow
                        key={id}
                        id={id}
                        label={t(`timeTool.${id}`)}
                        value={values[id]}
                        hidden={draftHidden.has(id)}
                        editing
                        onCopy={() => copyResult(id)}
                        onToggle={() => toggleResult(id)}
                        onSortIndexChange={(index) => {
                          dragTargetIndexRef.current = index;
                        }}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            ) : parsed ? (
              <DndContext sensors={sensors}>
                <SortableContext items={shown} strategy={verticalListSortingStrategy}>
                  <div>
                    {shown.map((id) => (
                      <TimeResultRow
                        key={id}
                        id={id}
                        label={t(`timeTool.${id}`)}
                        value={values[id]}
                        hidden={false}
                        editing={false}
                        onCopy={() => copyResult(id)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            ) : (
              <div className="flex min-h-[140px] flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                <Clock size={24} weight="duotone" />
                <strong className="text-sm font-semibold">{t('timeTool.emptyTitle')}</strong>
                <span className="text-[11px]">{t('timeTool.emptyHint')}</span>
              </div>
            )}
          </div>
        </div>
      </ToolLayout>
    </Reveal>
  );
}
