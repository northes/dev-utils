import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from './ui/button';
import { DataTable } from './ui/data-table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Calendar } from './ui/calendar';
import {
  BracketsCurly,
  CalendarBlank,
  Clock,
  FileCode,
  GitDiff,
  Hash,
  Key,
  LinkSimple,
  TextAa,
  Trash,
  X,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { type DateRange } from 'react-day-picker';
import { type ColumnDef } from '@tanstack/react-table';
import { enUS, zhCN } from 'date-fns/locale';
import type { HistoryItem as StoredHistoryItem } from '../../bindings/changeme/models';
import { QueryHistory } from '../../bindings/changeme/configservice';
import { Reveal, type ToolId } from './shared';

export type HistoryItem = Omit<StoredHistoryItem, 'tool'> & { tool: ToolId };
export function normalizeHistoryDetail(detail: string) {
  return detail.replace(/\s+/g, ' ').trim();
}
export function toHistoryItem(item: StoredHistoryItem): HistoryItem | null {
  return item.tool === 'json' ||
    item.tool === 'time' ||
    item.tool === 'text' ||
    item.tool === 'base64' ||
    item.tool === 'diff' ||
    item.tool === 'jwt' ||
    item.tool === 'url'
    ? { ...item, tool: item.tool, detail: normalizeHistoryDetail(item.detail) }
    : null;
}
const fmtDate = (d: Date, lang: string) =>
  d.toLocaleDateString(lang, { year: 'numeric', month: '2-digit', day: '2-digit' });
const formatRange = (range: DateRange | undefined, lang: string) =>
  range?.from
    ? `${fmtDate(range.from, lang)}${range.to ? ` — ${fmtDate(range.to, lang)}` : ''}`
    : '';
export function formatRelative(
  date: string,
  t: (k: string, o?: Record<string, unknown>) => string,
) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 60000));
  if (minutes < 1) return t('timeAgo.justNow');
  if (minutes < 60) return t('timeAgo.minutes', { count: minutes });
  const hours = Math.round(minutes / 60);
  return hours < 24
    ? t('timeAgo.hours', { count: hours })
    : t('timeAgo.days', { count: Math.round(hours / 24) });
}
export function HistoryIcon({ tool }: { tool: ToolId }) {
  return tool === 'json' ? (
    <BracketsCurly weight="duotone" />
  ) : tool === 'time' ? (
    <Clock weight="duotone" />
  ) : tool === 'base64' ? (
    <FileCode weight="duotone" />
  ) : tool === 'diff' ? (
    <GitDiff weight="duotone" />
  ) : tool === 'jwt' ? (
    <Key weight="duotone" />
  ) : tool === 'url' ? (
    <LinkSimple weight="duotone" />
  ) : (
    <TextAa weight="duotone" />
  );
}

export function ClearHistoryDialog({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('clearHistoryDialog.title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('clearHistoryDialog.body')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>{t('clearHistoryDialog.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              onConfirm();
              onClose();
            }}
            variant="destructive"
          >
            {t('clearHistoryDialog.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const pageSize = 50;
const historyTools: Array<{ id: ToolId; nameKey: string }> = (
  ['json', 'time', 'text', 'base64', 'diff', 'jwt', 'url'] as const
).map((id) => ({ id, nameKey: `tools.${id}.name` }));

export default function HistoryPage({
  openHistory,
  clear,
  active,
}: {
  openHistory: (item: HistoryItem) => void;
  clear: () => void;
  active: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [confirmClear, setConfirmClear] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [tool, setTool] = useState<'all' | ToolId>('all');
  const toolOptions = [
    { value: 'all', label: t('history.allTools') },
    ...historyTools.map((h) => ({ value: h.id, label: t(h.nameKey) })),
  ];
  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const prevActive = useRef(active);
  useEffect(() => {
    if (active && !prevActive.current) setReload((r) => r + 1);
    if (!active) {
      setRangeOpen(false);
      setConfirmClear(false);
    }
    prevActive.current = active;
  }, [active]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const from = range?.from ? range.from.getTime() : 0;
    const to = range?.to ? range.to.getTime() + 59999 : 0;
    QueryHistory((page - 1) * pageSize, pageSize, { tool: tool === 'all' ? '' : tool, from, to })
      .then((result) => {
        if (cancelled) return;
        setItems(
          (result.items ?? []).map(toHistoryItem).filter((x): x is HistoryItem => x !== null),
        );
        setTotal(result.total);
        setError(false);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tool, range, page, reload]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clearAll = () => {
    clear();
    setPage(1);
    setReload((r) => r + 1);
  };
  const changeRange = (value: DateRange | undefined) => {
    setRange(value);
    setPage(1);
  };
  const columns = useMemo<ColumnDef<HistoryItem>[]>(
    () => [
      {
        accessorKey: 'tool',
        header: t('history.columnTool'),
        cell: ({ row }) => (
          <div className="flex items-center gap-2 font-medium">
            <span className="text-muted-foreground [&_svg]:size-3.5">
              <HistoryIcon tool={row.original.tool} />
            </span>
            <span>{t(`tools.${row.original.tool}.name`)}</span>
          </div>
        ),
      },
      {
        accessorKey: 'action',
        header: t('history.columnAction'),
        cell: ({ row }) => (
          <div className="max-w-[200px] truncate font-medium">{row.original.action}</div>
        ),
      },
      {
        accessorKey: 'detail',
        header: t('history.columnDetail'),
        cell: ({ row }) => (
          <div className="max-w-[360px] truncate text-muted-foreground">{row.original.detail}</div>
        ),
      },
      {
        accessorKey: 'at',
        header: t('history.columnTime'),
        cell: ({ row }) => (
          <time
            className="whitespace-nowrap text-muted-foreground"
            title={new Date(row.original.at).toLocaleString(i18n.language)}
          >
            {formatRelative(row.original.at, t)}
          </time>
        ),
      },
    ],
    [t, i18n.language],
  );
  const emptyState = loading ? (
    <div className="flex items-center justify-center py-10">
      <span
        className="size-4 animate-spin rounded-full border-2 border-border border-t-muted-foreground"
        aria-hidden="true"
      />
    </div>
  ) : (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <Hash size={28} weight="duotone" className="text-muted-foreground" />
      <div className="text-sm font-medium text-foreground">{t('history.emptyTitle')}</div>
      <div className="text-xs text-muted-foreground">{t('history.emptyHint')}</div>
    </div>
  );
  const rangePicker = (
    <Popover open={rangeOpen} onOpenChange={setRangeOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            className="h-[32px] min-w-0 flex-1 justify-start gap-2 px-3 text-left text-[11px] font-normal"
            aria-label={t('history.filterRange')}
          />
        }
      >
        <CalendarBlank
          data-icon="inline-start"
          size={14}
          weight="duotone"
          className="flex-none text-muted-foreground"
        />
        <span
          className={range?.from ? 'truncate text-foreground' : 'truncate text-muted-foreground'}
        >
          {formatRange(range, i18n.language) || t('history.filterRange')}
        </span>
      </PopoverTrigger>
      <PopoverContent className="h-[242px] w-[408px] max-w-[calc(100vw-36px)] p-0" align="start">
        <Calendar
          mode="range"
          selected={range}
          onSelect={(v) => changeRange(v)}
          locale={i18n.language === 'zh-CN' ? zhCN : enUS}
          numberOfMonths={2}
          disabled={{ after: new Date() }}
          classNames={{
            root: 'h-full w-full [--cell-size:1.625rem]',
            months: 'relative flex h-full w-full flex-row gap-2',
            month: 'flex h-full min-w-0 flex-1 flex-col gap-2',
            month_grid: 'flex min-h-0 w-full flex-1 flex-col',
            weekdays:
              'text-muted-foreground flex w-full select-none rounded-md text-[0.8rem] font-normal',
            weeks: 'flex min-h-0 flex-1 flex-col',
            week: 'flex min-h-0 w-full flex-1',
            day: 'group/day relative flex h-full w-full select-none items-center justify-center p-0 text-center [&:first-child[data-selected=true]_button]:rounded-l-md [&:last-child[data-selected=true]_button]:rounded-r-md',
          }}
        />
      </PopoverContent>
    </Popover>
  );
  return (
    <Reveal index={0} fill>
      <section className="flex h-full min-h-0 flex-col overflow-hidden px-7 pb-[26px] pt-5 max-[700px]:px-[18px] max-[700px]:pb-4 max-[700px]:pt-3.5">
        <header className="mb-4 flex-none">
          <div>
            <h1 className="text-[19px] font-semibold leading-tight">{t('history.title')}</h1>
            <p className="mt-1 text-[10px] text-muted-foreground">{t('history.subtitle')}</p>
          </div>
        </header>
        <div className="mb-3 flex flex-wrap items-end gap-4 border-b border-border px-0.5 pb-3 max-[700px]:flex-col max-[700px]:items-stretch">
          <div className="flex min-w-0 flex-col gap-1 text-[10px] font-medium text-muted-foreground max-[700px]:w-full">
            <span id="history-tool-filter-label">{t('history.filterTool')}</span>
            <Select
              items={toolOptions}
              value={tool}
              onValueChange={(v) => {
                setTool(v === 'all' ? 'all' : (v as ToolId));
                setPage(1);
              }}
            >
              <SelectTrigger
                className="w-[220px] max-w-full max-[700px]:w-full"
                aria-labelledby="history-tool-filter-label"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectItem value="all">{t('history.allTools')}</SelectItem>
                {historyTools.map((h) => (
                  <SelectItem key={h.id} value={h.id}>
                    {t(h.nameKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-w-0 flex-col gap-1 text-[10px] font-medium text-muted-foreground max-[700px]:w-full">
            <span>{t('history.filterRange')}</span>
            <div className="flex min-w-0 w-[408px] max-w-full gap-1 max-[700px]:w-full">
              {rangePicker}
              {range && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="flex-none"
                  onClick={() => changeRange(undefined)}
                  aria-label={t('history.clearRange')}
                >
                  <X size={13} weight="duotone" />
                </Button>
              )}
            </div>
          </div>
          {total > 0 && (
            <Button
              variant="ghost"
              className="ml-auto h-[32px] min-h-0 flex-none text-[11px] max-[700px]:ml-0 max-[700px]:self-end"
              onClick={() => setConfirmClear(true)}
            >
              <Trash data-icon="inline-start" weight="duotone" />
              {t('history.clear')}
            </Button>
          )}
        </div>
        {error ? (
          <Button
            variant="ghost"
            className="flex h-auto min-h-0 flex-1 flex-col items-center justify-center gap-2 text-muted-foreground [&_svg]:size-7"
            onClick={() => {
              setError(false);
              setReload((r) => r + 1);
            }}
          >
            <Hash data-icon="inline-start" size={28} weight="duotone" />
            <span className="text-sm font-medium text-foreground">{t('history.loadFailed')}</span>
            <span className="text-xs text-muted-foreground">{t('history.loadFailedHint')}</span>
          </Button>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <DataTable
              columns={columns}
              data={loading ? [] : items}
              emptyState={emptyState}
              onRowClick={(item) => void openHistory(item)}
            />
            {total > 0 && (
              <div className="history-pagination flex items-center justify-between gap-3 border-t border-border p-2">
                <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                  {t('history.summary', {
                    start: (page - 1) * pageSize + 1,
                    end: Math.min(page * pageSize, total),
                    total,
                  })}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    disabled={page === 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="h-auto rounded-lg px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent disabled:opacity-50"
                  >
                    {t('history.prev')}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={page === totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="h-auto rounded-lg px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent disabled:opacity-50"
                  >
                    {t('history.next')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
        <ClearHistoryDialog
          open={confirmClear}
          onClose={() => setConfirmClear(false)}
          onConfirm={clearAll}
        />
      </section>
    </Reveal>
  );
}
