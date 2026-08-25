import { useEffect, useMemo, useRef, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Button } from './ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { useTranslation } from 'react-i18next';
import { CaretDown, CaretUp, Copy, Trash } from '@phosphor-icons/react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { quietEditorTheme } from './codeMirrorTheme';
import {
  type PendingAction,
  Reveal,
  ToolActionBar,
  type ToolId,
  ToolLayout,
  useFocusOnActivate,
} from './shared';
import { toast } from './ui/toast';

const countDetails = (characters: string[]) =>
  Array.from(
    characters.reduce(
      (counts, character) => counts.set(character, (counts.get(character) ?? 0) + 1),
      new Map<string, number>(),
    ),
  ).sort(([left], [right]) => left.localeCompare(right, 'zh-CN'));
const words = (value: string) => value.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) ?? [];
type CaseMode = 'upper' | 'lower' | 'lineUpper' | 'lineLower' | 'wordUpper' | 'wordLower';
const caseModes: CaseMode[] = [
  'upper',
  'lower',
  'lineUpper',
  'lineLower',
  'wordUpper',
  'wordLower',
];
type SortDescriptor = { column: 'entry' | 'count'; direction: 'ascending' | 'descending' };
const transformCase = (value: string, mode: CaseMode) =>
  mode === 'upper'
    ? value.toUpperCase()
    : mode === 'lower'
      ? value.toLowerCase()
      : mode === 'lineUpper'
        ? value.replace(/(^|\n)([^\n])/g, (_, start, character) => start + character.toUpperCase())
        : mode === 'lineLower'
          ? value.replace(
              /(^|\n)([^\n])/g,
              (_, start, character) => start + character.toLowerCase(),
            )
          : mode === 'wordUpper'
            ? value.replace(
                /[A-Za-z]+/g,
                (word) => word[0].toUpperCase() + word.slice(1).toLowerCase(),
              )
            : value.replace(/[A-Za-z]+/g, (word) => word[0].toLowerCase() + word.slice(1));
export default function TextTool({
  active,
  record,
  pending,
  clearPending,
}: {
  active: boolean;
  theme: string;
  record: (tool: ToolId, action: string, detail: string, input: string) => void;
  pending: PendingAction | null;
  clearPending: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const consumed = useRef<PendingAction | null>(null);
  const inputView = useRef<EditorView | null>(null);
  useFocusOnActivate(active, () => inputView.current?.focus());
  const [sort, setSort] = useState<SortDescriptor>({ column: 'count', direction: 'descending' });
  const stats = useMemo(() => {
    const chars = [...value],
      wordList = words(value),
      details: Array<[string, string[]]> = [
        ['chinese', chars.filter((x) => /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(x))],
        ['english', chars.filter((x) => /[A-Za-z]/.test(x))],
        ['digits', chars.filter((x) => /\d/.test(x))],
        ['words', wordList],
        ['punctuation', chars.filter((x) => /[\p{P}]/u.test(x))],
      ];
    return [
      ...details.map(([key, items]) => ({
        key,
        count: items.length,
        details: countDetails(items),
        detail: items.length > 0,
      })),
      { key: 'lines', count: value ? value.split(/\r?\n/).length : 0, details: [], detail: false },
      { key: 'bytes', count: new TextEncoder().encode(value).length, details: [], detail: false },
    ];
  }, [value]);
  const apply = (action: string, fn: (input: string) => string) => {
    const next = fn(value);
    setValue(next);
    record('text', action, `${[...next].length} ${t('textTool.characters')}`, next);
  };
  const copy = () => {
    navigator.clipboard?.writeText(value).catch(() => {});
    toast.add({
      title: t('toast.copied', { value: `${[...value].length} ${t('textTool.characters')}` }),
    });
    record('text', t('textTool.copy'), `${[...value].length} ${t('textTool.characters')}`, value);
  };
  const copyDetail = (entry: string, count: number) => {
    const copied = `${entry}: ${count}`;
    navigator.clipboard?.writeText(copied).catch(() => {});
    toast.add({ title: t('toast.copied', { value: copied }) });
    record('text', t('textTool.copied'), copied, value);
  };
  const sorted = (details: Array<[string, number]>) =>
    [...details].sort(([a, ac], [b, bc]) => {
      const order = sort.column === 'count' ? ac - bc : a.localeCompare(b, 'zh-CN');
      return sort.direction === 'descending' ? -order : order;
    });
  const toggle = (column: 'entry' | 'count') =>
    setSort((current) =>
      current.column === column
        ? { column, direction: current.direction === 'ascending' ? 'descending' : 'ascending' }
        : { column, direction: 'ascending' },
    );
  useEffect(() => {
    if (!pending || pending.tool !== 'text' || consumed.current === pending) return;
    consumed.current = pending;
    clearPending();
    const transforms: Record<string, (input: string) => string> = {
      trim: (s) => s.trim(),
      removeSpaces: (s) => s.replace(/[ \t]+/g, ''),
      compress: (s) => s.replace(/ {2,}/g, ' '),
      compressLine: (s) => s.replace(/\r\n?|\n/g, ' '),
      upper: (s) => transformCase(s, 'upper'),
      lower: (s) => transformCase(s, 'lower'),
      lineUpper: (s) => transformCase(s, 'lineUpper'),
      lineLower: (s) => transformCase(s, 'lineLower'),
      wordUpper: (s) => transformCase(s, 'wordUpper'),
      wordLower: (s) => transformCase(s, 'wordLower'),
    };
    if (pending.action === 'clear') {
      setValue('');
      return;
    }
    if (pending.action === 'copy') {
      const next = value.trim() || pending.input;
      if (next) navigator.clipboard?.writeText(next).catch(() => {});
      return;
    }
    if (transforms[pending.action]) {
      setValue(transforms[pending.action](value));
      return;
    }
    setValue(pending.input);
  }, [pending, value]);
  return (
    <Reveal index={0} fill active={active}>
      <ToolLayout
        title={t('textTool.title')}
        desc={t('textTool.subtitle')}
        contentClassName="grid grid-rows-[minmax(0,1fr)_auto] gap-3"
        contentMode="fixed"
        footer={
          <ToolActionBar
            label={t('textTool.actions')}
            actions={[
              {
                key: 'clear',
                label: t('textTool.clear'),
                icon: Trash,
                variant: 'tertiary',
                disabled: !value,
                onPress: () => setValue(''),
              },
              {
                key: 'case',
                label: t('textTool.case'),
                type: 'select',
                disabled: !value,
                options: caseModes.map((key) => ({ key, label: t(`textTool.caseModes.${key}`) })),
                onSelect: (mode) =>
                  apply(t(`textTool.caseModes.${mode}`), (input) =>
                    transformCase(input, mode as CaseMode),
                  ),
              },
              {
                key: 'trim',
                label: t('textTool.trim'),
                variant: 'secondary',
                disabled: !value,
                onPress: () => apply(t('textTool.trimmed'), (input) => input.trim()),
              },
              {
                key: 'compressSpaces',
                label: t('textTool.compressSpaces'),
                variant: 'secondary',
                disabled: !value,
                onPress: () =>
                  apply(t('textTool.compressedSpaces'), (input) => input.replace(/ {2,}/g, ' ')),
              },
              {
                key: 'removeSpaces',
                label: t('textTool.removeSpaces'),
                variant: 'secondary',
                disabled: !value,
                onPress: () =>
                  apply(t('textTool.removedSpaces'), (input) => input.replace(/[ \t]+/g, '')),
              },
              {
                key: 'compressLine',
                label: t('textTool.compressLine'),
                variant: 'secondary',
                disabled: !value,
                onPress: () =>
                  apply(t('textTool.compressedLine'), (input) => input.replace(/\r\n?|\n/g, ' ')),
              },
              {
                key: 'copy',
                label: t('textTool.copy'),
                icon: Copy,
                variant: 'primary',
                disabled: !value,
                onPress: copy,
              },
            ]}
          />
        }
      >
        <div className="flex min-h-0 min-w-0 flex-col gap-2 font-mono text-[10px] font-medium uppercase tracking-[.04em] text-muted-foreground">
          <span>{t('textTool.input')}</span>
          <CodeMirror
            className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card focus-within:border-muted-foreground [&_.cm-editor]:h-full [&_.cm-editor]:[font:var(--code-editor-font-size)/1.6_var(--font-mono)] [&_.cm-editor.cm-focused]:outline-none [&_.cm-scroller]:overflow-auto"
            height="100%"
            value={value}
            onChange={setValue}
            onCreateEditor={(view) => {
              view.contentDOM.setAttribute('aria-label', t('textTool.input'));
              inputView.current = view;
            }}
            theme={quietEditorTheme}
            extensions={[EditorView.lineWrapping]}
            basicSetup={{
              lineNumbers: true,
              foldGutter: false,
              highlightActiveLine: false,
              highlightActiveLineGutter: false,
              autocompletion: false,
              closeBrackets: false,
            }}
          />
        </div>
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border">
          {stats.map((stat) => (
            <div className="flex flex-col gap-1.5 bg-card p-3.5 text-foreground" key={stat.key}>
              {stat.detail ? (
                <Popover>
                  <PopoverTrigger
                    render={
                      <Button
                        variant="ghost"
                        className="flex w-full flex-col items-start gap-1.5 p-0 text-left hover:bg-transparent"
                        aria-label={t('textTool.showDetails', { label: t(`textTool.${stat.key}`) })}
                      />
                    }
                  >
                    <span className="font-mono text-[9px] font-normal capitalize text-muted-foreground">
                      {t(`textTool.${stat.key}`)}
                    </span>
                    <strong className="font-mono text-base leading-none font-medium">
                      {stat.count.toLocaleString()}
                    </strong>
                  </PopoverTrigger>
                  <PopoverContent className="w-[320px] overflow-hidden p-0">
                    <div className="max-h-[min(420px,calc(100vh-32px))] overflow-auto [scrollbar-gutter:auto]">
                      <Table>
                        <TableHeader className="sticky top-0 bg-card">
                          <TableRow>
                            <TableHead className="h-8 px-2.5 text-left">
                              <Button
                                variant="ghost"
                                className="h-8 w-full justify-start gap-1 rounded-none px-0 text-[9px] uppercase"
                                onClick={() => toggle('entry')}
                              >
                                {t('textTool.detailEntry')}
                                {sort.column === 'entry' &&
                                  (sort.direction === 'ascending' ? (
                                    <CaretUp data-icon="inline-end" size={10} weight="duotone" />
                                  ) : (
                                    <CaretDown data-icon="inline-end" size={10} weight="duotone" />
                                  ))}
                              </Button>
                            </TableHead>
                            <TableHead className="h-8 px-2.5 text-right">
                              <Button
                                variant="ghost"
                                className="h-8 w-full justify-end gap-1 rounded-none px-0 text-[9px] uppercase"
                                onClick={() => toggle('count')}
                              >
                                {t('textTool.detailCount')}
                                {sort.column === 'count' &&
                                  (sort.direction === 'ascending' ? (
                                    <CaretUp data-icon="inline-end" size={10} weight="duotone" />
                                  ) : (
                                    <CaretDown data-icon="inline-end" size={10} weight="duotone" />
                                  ))}
                              </Button>
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sorted(stat.details).map(([entry, count]) => (
                            <TableRow
                              key={entry}
                              onClick={() => copyDetail(entry, count)}
                              className="cursor-pointer hover:bg-accent"
                            >
                              <TableCell className="h-8 px-2.5 py-1 font-mono text-[11px]">
                                {entry}
                              </TableCell>
                              <TableCell className="h-8 px-2.5 py-1 text-right font-mono text-[10px] text-muted-foreground">
                                {count.toLocaleString()}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </PopoverContent>
                </Popover>
              ) : (
                <>
                  <span className="font-mono text-[9px] font-normal capitalize text-muted-foreground">
                    {t(`textTool.${stat.key}`)}
                  </span>
                  <strong className="font-mono text-base leading-none font-medium">
                    {stat.count.toLocaleString()}
                  </strong>
                </>
              )}
            </div>
          ))}
        </div>
      </ToolLayout>
    </Reveal>
  );
}
