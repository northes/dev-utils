import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from './ui/button';
import { Check, Copy, Trash } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { quietEditorTheme } from './codeMirrorTheme';
import {
  Reveal,
  ToolActionBar,
  ToolLayout,
  useFocusOnActivate,
  type PendingAction,
  type ToolId,
} from './shared';
import { toast } from './ui/toast';
import { parseSupportedUrl, urlParamsJson } from '../utils/url';

function UrlPart({
  label,
  value,
  id,
  onCopy,
}: {
  label: string;
  value: string;
  id: string;
  onCopy: (id: string, value: string, label: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-[104px_minmax(0,1fr)_30px] items-start gap-3 border-b border-border px-0.5 py-[13px] last:border-b-0">
      <span className="pt-[7px] font-mono text-[10px] leading-[1.35] font-medium uppercase tracking-[.04em] text-muted-foreground">
        {label}
      </span>
      <code className="min-w-0 overflow-wrap-anywhere pt-[5px] font-mono text-xs leading-6 text-foreground">
        {value || '/'}
      </code>
      <Button
        variant="ghost"
        size="icon"
        className="size-[30px] min-w-[30px] flex-none p-0"
        aria-label={t('urlTool.copy')}
        onClick={() => onCopy(id, value, label)}
      >
        <Copy size={14} weight="duotone" />
      </Button>
    </div>
  );
}
export default function UrlTool({
  active,
  record,
  pending,
  clearPending,
}: {
  active: boolean;
  theme: string;
  record: (tool: ToolId, action: string, detail: string, input: string, output?: string) => void;
  pending: PendingAction | null;
  clearPending: () => void;
}) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const inputView = useRef<EditorView | null>(null);
  const consumed = useRef<PendingAction | null>(null);
  const lastRecorded = useRef('');
  const recordTimer = useRef<number | null>(null);
  const [copied, setCopied] = useState('');
  const parts = useMemo(() => parseSupportedUrl(input), [input]);
  const invalid = !!input.trim() && !parts;
  useFocusOnActivate(active, () => inputView.current?.focus());
  const output = parts ? JSON.stringify(parts, null, 2) : '';
  useEffect(() => {
    const value = input.trim();
    if (recordTimer.current !== null) {
      window.clearTimeout(recordTimer.current);
      recordTimer.current = null;
    }
    if (parts && value && lastRecorded.current !== value)
      recordTimer.current = window.setTimeout(() => {
        recordTimer.current = null;
        lastRecorded.current = value;
        record(
          'url',
          t('urlTool.analyzed'),
          t('urlTool.paramCount', { count: parts.params.length }),
          input,
          output,
        );
      }, 1500);
    else if (!value) lastRecorded.current = '';
    return () => {
      if (recordTimer.current !== null) window.clearTimeout(recordTimer.current);
    };
  }, [parts, input, output, record, t]);
  const copyValue = async (id: string, value: string, label: string) => {
    await navigator.clipboard?.writeText(value).catch(() => {});
    setCopied(id);
    window.setTimeout(() => setCopied((current) => (current === id ? '' : current)), 1600);
    toast.add({ title: t('toast.copied', { value: label }) });
  };
  const copy = async () => {
    if (!parts) return;
    await copyValue('all', output, t('urlTool.copied'));
    record(
      'url',
      t('urlTool.copy'),
      t('urlTool.paramCount', { count: parts.params.length }),
      input,
      output,
    );
  };
  useEffect(() => {
    if (!pending || pending.tool !== 'url' || consumed.current === pending) return;
    consumed.current = pending;
    clearPending();
    if (pending.action === 'clear') {
      setInput('');
      return;
    }
    if (pending.action === 'copy') {
      if (!parts) toast.add({ title: t('urlTool.invalid'), type: 'warning' });
      else void copy();
      return;
    }
    setInput(pending.input);
  }, [pending, parts]);
  return (
    <Reveal index={0} fill active={active}>
      <ToolLayout
        title={t('urlTool.title')}
        desc={t('urlTool.subtitle')}
        contentMode="fixed"
        footer={
          <ToolActionBar
            label={t('urlTool.actions')}
            actions={[
              {
                key: 'clear',
                label: t('urlTool.clear'),
                icon: Trash,
                variant: 'tertiary',
                disabled: !input,
                onPress: () => setInput(''),
              },
              {
                key: 'copy',
                label: copied === 'all' ? t('urlTool.copied') : t('urlTool.copy'),
                icon: copied === 'all' ? Check : Copy,
                variant: 'primary',
                disabled: !parts,
                onPress: () => void copy(),
              },
            ]}
          />
        }
      >
        <div className="grid h-full min-h-0 grid-cols-2 gap-3">
          <div className="flex min-h-0 min-w-0 flex-col gap-2 font-mono text-[10px] font-medium uppercase tracking-[.04em] text-muted-foreground">
            <span>{t('urlTool.input')}</span>
            <CodeMirror
              className="min-h-0 flex-1 overflow-hidden rounded-(--radius) border border-border bg-card focus-within:border-muted-foreground [&_.cm-editor]:h-full [&_.cm-editor]:[font:var(--code-editor-font-size)/1.65_var(--font-mono)] [&_.cm-editor.cm-focused]:outline-none [&_.cm-scroller]:overflow-auto"
              height="100%"
              value={input}
              onChange={setInput}
              onCreateEditor={(view) => {
                view.contentDOM.setAttribute('aria-label', t('urlTool.input'));
                inputView.current = view;
              }}
              theme={quietEditorTheme}
              extensions={[EditorView.lineWrapping]}
              basicSetup={{
                lineNumbers: false,
                foldGutter: false,
                highlightActiveLine: false,
                highlightActiveLineGutter: false,
                autocompletion: false,
                closeBrackets: false,
              }}
            />
          </div>
          <div
            className={`min-h-0 overflow-auto border-y border-border ${invalid ? 'border-destructive' : ''}`}
          >
            {parts ? (
              <>
                <UrlPart
                  label={t('urlTool.base')}
                  value={parts.base}
                  id="base"
                  onCopy={copyValue}
                />
                <UrlPart
                  label={t('urlTool.path')}
                  value={parts.path}
                  id="path"
                  onCopy={copyValue}
                />
                <UrlPart
                  label={t('urlTool.hash')}
                  value={parts.hash}
                  id="hash"
                  onCopy={copyValue}
                />
                <div className="grid grid-cols-[104px_minmax(0,1fr)_30px] items-start gap-3 border-b border-border px-0.5 py-[13px]">
                  <span className="pt-[7px] font-mono text-[10px] leading-[1.35] font-medium uppercase tracking-[.04em] text-muted-foreground">
                    {t('urlTool.params')}
                  </span>
                  <div className="min-w-0 overflow-hidden rounded-(--radius) border border-border bg-border">
                    {parts.params.length ? (
                      parts.params.map(([key, value], index = 0) => (
                        <div
                          key={`${key}-${index}`}
                          className="grid grid-cols-2 gap-px border-b border-border last:border-b-0"
                        >
                          <code className="min-w-0 overflow-wrap-anywhere bg-card px-2 py-[7px] font-mono text-xs leading-5 text-foreground">
                            {key}
                          </code>
                          <code className="min-w-0 overflow-wrap-anywhere bg-card px-2 py-[7px] font-mono text-xs leading-5 text-foreground">
                            {value}
                          </code>
                        </div>
                      ))
                    ) : (
                      <div className="bg-card px-2 py-[7px] text-xs normal-case">
                        {t('urlTool.noParams')}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-[30px] min-w-[30px] flex-none p-0"
                    aria-label={t('urlTool.copy')}
                    onClick={() =>
                      void copyValue('params', urlParamsJson(parts.params), t('urlTool.params'))
                    }
                  >
                    <Copy size={14} weight="duotone" />
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex h-full min-h-[160px] flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground">
                <strong className="text-xs text-foreground">
                  {invalid ? t('urlTool.invalid') : t('urlTool.empty')}
                </strong>
                <span className="max-w-[270px] text-[11px] leading-5">
                  {invalid ? t('urlTool.invalidHint') : t('urlTool.emptyHint')}
                </span>
              </div>
            )}
          </div>
        </div>
      </ToolLayout>
    </Reveal>
  );
}
