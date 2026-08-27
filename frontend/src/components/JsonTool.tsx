import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';
import { Switch } from './ui/switch';
import { useTranslation } from 'react-i18next';
import { Clipboard } from '@wailsio/runtime';
import CodeMirror from '@uiw/react-codemirror';
import type { Extension } from '@codemirror/state';
import { json5 } from 'codemirror-json5';
import { codeFolding, syntaxTree } from '@codemirror/language';
import { EditorView, keymap } from '@codemirror/view';
import { acceptCompletion } from '@codemirror/autocomplete';
import { quietEditorTheme } from './codeMirrorTheme';
import {
  Copy,
  DownloadSimple,
  Table as TableIcon,
  Trash,
  UploadSimple,
} from '@phosphor-icons/react';
import {
  formatJsonPreserve,
  hasComments,
  parseJsonLoose,
  Reveal,
  ToolActionBar,
  ToolLayoutContent,
  ToolLayoutFooter,
  ToolLayoutHeader,
  ToolLayoutToolbar,
  ToolLayout,
  useFocusOnActivate,
  type PendingAction,
  type ToolBarAction,
  type ToolId,
} from './shared';
import { toast } from './ui/toast';
import { JsonErrorPanel } from './JsonErrorPanel';
import { JsonTablePreview } from './JsonTablePreview';
import '../styles/tools/editor.css';
import '../styles/tools/json.css';
import {
  newWorkflowItem,
  parseWorkflowConfig,
  serializeWorkflow,
  WorkflowPanel,
} from './JsonWorkflow';
import type { WorkflowItem } from './JsonWorkflowEngine';
import { useDebouncedWorkflowEvaluation } from './useDebouncedWorkflowEvaluation';
import { pathCompletions as sharedPathCompletions } from './JsonPathCompletion';

type PathToken = { type: 'key' | 'index' | 'all'; value: string };
type SourceNode = {
  start: number;
  end: number;
  children?: Record<string, SourceNode> | SourceNode[];
};
type JsonPathErrorCode =
  | 'unclosedComment'
  | 'unclosedString'
  | 'invalidObjectKey'
  | 'missingColon'
  | 'unclosedNode'
  | 'pathMissingBracket'
  | 'pathInvalidSegment'
  | 'pathInvalidChar'
  | 'notArray'
  | 'indexOutOfRange'
  | 'noKeyAt'
  | 'keyNotFound'
  | 'pathNotFound';
class JsonPathError extends Error {
  constructor(
    readonly code: JsonPathErrorCode,
    readonly params: Record<string, string> = {},
  ) {
    super(code);
  }
}
const parseFail = (code: JsonPathErrorCode, params?: Record<string, string>): never => {
  throw new JsonPathError(code, params);
};
function sourceNode(doc: string, start = 0): SourceNode {
  const skip = (i: number) => {
    while (i < doc.length) {
      if (/\s/.test(doc[i])) {
        i++;
        continue;
      }
      if (doc[i] === '/' && doc[i + 1] === '/') {
        i = doc.indexOf('\n', i + 2);
        if (i < 0) return doc.length;
        continue;
      }
      if (doc[i] === '/' && doc[i + 1] === '*') {
        i = doc.indexOf('*/', i + 2);
        if (i < 0) parseFail('unclosedComment');
        i += 2;
        continue;
      }
      break;
    }
    return i;
  };
  const stringEnd = (i: number) => {
    const quote = doc[i++];
    for (; i < doc.length; i++) {
      if (doc[i] === '\\') i++;
      else if (doc[i] === quote) return i + 1;
    }
    return parseFail('unclosedString');
  };
  const value = (i: number): SourceNode => {
    i = skip(i);
    const node: SourceNode = { start: i, end: i };
    if (doc[i] === '{' || doc[i] === '[') {
      const object = doc[i] === '{';
      const children: Record<string, SourceNode> | SourceNode[] = object ? {} : [];
      i++;
      while (true) {
        i = skip(i);
        if (doc[i] === (object ? '}' : ']')) {
          node.end = i + 1;
          break;
        }
        if (object) {
          if (doc[i] !== '"' && doc[i] !== "'") parseFail('invalidObjectKey');
          const keyStart = i,
            keyEnd = stringEnd(i),
            key = JSON.parse(doc.slice(keyStart, keyEnd));
          i = skip(keyEnd);
          if (doc[i] !== ':') parseFail('missingColon');
          const child = value(i + 1);
          (children as Record<string, SourceNode>)[key] = child;
          i = skip(child.end);
        } else {
          const child = value(i);
          (children as SourceNode[]).push(child);
          i = skip(child.end);
        }
        if (doc[i] === ',') {
          i++;
          continue;
        }
        if (doc[i] === (object ? '}' : ']')) {
          node.end = i + 1;
          break;
        }
        parseFail('unclosedNode');
      }
      node.children = children;
      return node;
    }
    if (doc[i] === '"' || doc[i] === "'") node.end = stringEnd(i);
    else {
      while (i < doc.length && !/[\s,}\]]/.test(doc[i])) i++;
      node.end = i;
    }
    return node;
  };
  return value(start);
}
function parsePath(p: string): PathToken[] {
  const tokens: PathToken[] = [];
  let s = p.trim();
  if (s.startsWith('$')) s = s.slice(1);
  let i = 0;
  while (i < s.length) {
    if (s[i] === '.' || s[i] === '/') {
      i++;
      continue;
    }
    if (s[i] === '[') {
      const end = s.indexOf(']', i);
      if (end < 0) parseFail('pathMissingBracket');
      const inner = s.slice(i + 1, end).trim();
      if (inner === '*') tokens.push({ type: 'all', value: '*' });
      else if (/^-?\d+$/.test(inner)) tokens.push({ type: 'index', value: inner });
      else if (
        (inner.startsWith("'") && inner.endsWith("'")) ||
        (inner.startsWith('"') && inner.endsWith('"'))
      )
        tokens.push({ type: 'key', value: inner.slice(1, -1) });
      else parseFail('pathInvalidSegment', { value: inner });
      i = end + 1;
    } else if (/[A-Za-z0-9_$]/.test(s[i])) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_$-]/.test(s[j])) j++;
      tokens.push({ type: 'key', value: s.slice(i, j) });
      i = j;
    } else parseFail('pathInvalidChar', { value: s[i] });
  }
  return tokens;
}
function matchPath(
  doc: string,
  path: string,
): { ok: true; value: unknown; source?: string } | { ok: false; error: JsonPathError } {
  try {
    const root = parseJsonLoose(doc);
    const tokens = parsePath(path);
    const walk = (cur: any, i: number): any => {
      if (i >= tokens.length) return cur;
      const tok = tokens[i];
      if (tok.type === 'all') {
        const children = Array.isArray(cur)
          ? cur
          : cur && typeof cur === 'object'
            ? Object.values(cur)
            : [];
        return children.map((c) => walk(c, i + 1));
      }
      if (tok.type === 'index') {
        if (!Array.isArray(cur)) parseFail('notArray');
        const next = cur[Number(tok.value)];
        if (next === undefined) parseFail('indexOutOfRange');
        return walk(next, i + 1);
      }
      if (cur == null || typeof cur !== 'object') parseFail('noKeyAt', { key: tok.value });
      if (!(tok.value in cur)) parseFail('keyNotFound', { key: tok.value });
      return walk(cur[tok.value], i + 1);
    };
    const value = walk(root, 0);
    let node = sourceNode(doc);
    for (const token of tokens) {
      if (token.type === 'all') {
        node = undefined as never;
        break;
      }
      const children = node.children;
      if (token.type === 'index') {
        if (!Array.isArray(children)) parseFail('notArray');
        else node = children[Number(token.value)];
      } else {
        if (!children || Array.isArray(children)) parseFail('noKeyAt', { key: token.value });
        else node = children[token.value];
      }
      if (!node) parseFail('pathNotFound');
    }
    return { ok: true, value, source: node ? doc.slice(node.start, node.end) : undefined };
  } catch (e) {
    return { ok: false, error: e instanceof JsonPathError ? e : new JsonPathError('pathNotFound') };
  }
}

function tryAutoFormat(src: string) {
  if (!src.trim()) return src;
  try {
    if (hasComments(src)) {
      const next = formatJsonPreserve(src);
      parseJsonLoose(next);
      return next;
    }
    return JSON.stringify(parseJsonLoose(src), null, 2);
  } catch {
    return src;
  }
}
function JsonEditorPane({
  label,
  value,
  onChange,
  foldExt,
  onCreate,
  theme,
  readOnly = false,
  placeholder,
  cmClassName,
  formatOnPaste,
  tableMode = false,
  tableDisabled = false,
  active = true,
  onToggleTable,
  tablePreview,
  tableHint,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  foldExt: ReturnType<typeof codeFolding>;
  onCreate?: (v: EditorView) => void;
  theme: Extension;
  readOnly?: boolean;
  placeholder?: string;
  cmClassName?: string;
  formatOnPaste?: (next: string) => string;
  tableMode?: boolean;
  tableDisabled?: boolean;
  active?: boolean;
  onToggleTable?: () => void;
  tablePreview?: ReactNode;
  tableHint?: string;
}) {
  const { t } = useTranslation();
  const formatOnPasteRef = useRef(formatOnPaste);
  formatOnPasteRef.current = formatOnPaste;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const pasteExt = useMemo(
    () =>
      EditorView.domEventHandlers({
        paste(event, view) {
          const format = formatOnPasteRef.current;
          if (!format) return false;
          const pasted = event.clipboardData?.getData('text/plain');
          if (pasted == null) return false;
          event.preventDefault();
          const sel = view.state.selection.main;
          onChangeRef.current?.(
            format(
              view.state.doc.sliceString(0, sel.from) + pasted + view.state.doc.sliceString(sel.to),
            ),
          );
          return true;
        },
      }),
    [],
  );
  return (
    <div className="json-pane flex min-h-0 min-w-0 flex-1 flex-col gap-2">
      <span className="json-pane-label flex-none font-mono text-[10px] font-medium leading-none tracking-[.04em] text-muted-foreground uppercase">
        {label}
      </span>
      <div className="json-pane-editor relative flex min-h-0 min-w-0 flex-1">
        {onToggleTable && (
          <Button
            type="button"
            variant={tableMode ? 'secondary' : 'ghost'}
            size="icon-sm"
            className="json-table-toggle absolute top-2 right-2 z-20"
            disabled={tableDisabled}
            aria-label={t('jsonTool.tablePreview')}
            title={
              tableDisabled
                ? tableHint
                : t(tableMode ? 'jsonTool.tablePreviewOn' : 'jsonTool.tablePreview')
            }
            onClick={onToggleTable}
          >
            <TableIcon />
          </Button>
        )}
        <CodeMirror
          className={`json-cm${cmClassName ? ' ' + cmClassName : ''}`}
          height="100%"
          value={value}
          onChange={onChange}
          onCreateEditor={(v) => {
            v.contentDOM.setAttribute('aria-label', label);
            onCreate?.(v);
          }}
          theme={theme}
          editable={!readOnly}
          placeholder={placeholder}
          extensions={[json5(), foldExt, pasteExt]}
        />
        {tablePreview && (
          <div
            className={`json-table-layer${tableMode && active ? ' is-visible' : ''}`}
            aria-hidden={!tableMode || !active}
            {...(!tableMode || !active ? { inert: true } : {})}
          >
            {tablePreview}
          </div>
        )}
      </div>
    </div>
  );
}

export default function JsonTool({
  active,
  theme,
  autoFormatOnFill,
  onAutoFormatOnFillChange,
  record,
  pending,
  clearPending,
}: {
  active: boolean;
  theme: string;
  autoFormatOnFill: boolean;
  onAutoFormatOnFillChange: (value: boolean) => void;
  record: (tool: ToolId, action: string, detail: string, input: string, output?: string) => void;
  pending: PendingAction | null;
  clearPending: () => void;
}) {
  const { t } = useTranslation();
  const fmtErr = (e: unknown) =>
    e instanceof JsonPathError ? t(`jsonTool.errors.${e.code}`, e.params) : String(e);
  const [schema, setSchema] = useState(false);
  const [workflowMode, setWorkflowMode] = useState(false);
  const [input, setInput] = useState('');
  const [path, setPath] = useState('$');
  const [result, setResult] = useState('');
  const [pathError, setPathError] = useState('');
  const [workflowRules, setWorkflowRules] = useState<WorkflowItem[]>([]);
  const [workflowFocusId, setWorkflowFocusId] = useState<string | null>(null);
  const [inputTableMode, setInputTableMode] = useState(false);
  const [resultTableMode, setResultTableMode] = useState(false);
  const [commentDialog, setCommentDialog] = useState<null | {
    mode: 'format' | 'minify';
    pane: 'input' | 'result';
  }>(null);
  const consumed = useRef<PendingAction | null>(null);
  const views = useRef(new Map<string, EditorView>());
  const autoFormatRef = useRef(autoFormatOnFill);
  autoFormatRef.current = autoFormatOnFill;
  useFocusOnActivate(active, () => views.current.get('input')?.focus());
  const cmTheme = quietEditorTheme;
  const jsonValue = useMemo(() => {
    try {
      return parseJsonLoose(input);
    } catch {
      return null;
    }
  }, [input]);
  const inputPreview = useMemo(() => {
    try {
      return { valid: true, value: parseJsonLoose(input) };
    } catch {
      return { valid: false, value: null };
    }
  }, [input]);
  const resultPreview = useMemo(() => {
    try {
      return { valid: true, value: parseJsonLoose(result) };
    } catch {
      return { valid: false, value: null };
    }
  }, [result]);
  // Auto-exit table mode when content becomes empty or invalid
  useEffect(() => {
    if (inputTableMode && (!input.trim() || !inputPreview.valid)) {
      setInputTableMode(false);
    }
  }, [input, inputPreview.valid, inputTableMode]);
  useEffect(() => {
    if (resultTableMode && (!result.trim() || !resultPreview.valid)) {
      setResultTableMode(false);
    }
  }, [result, resultPreview.valid, resultTableMode]);
  const jsonValueRef = useRef<unknown>(jsonValue);
  jsonValueRef.current = jsonValue;
  const pathExt = useMemo(
    () => [
      EditorView.lineWrapping,
      sharedPathCompletions(() => jsonValueRef.current),
      keymap.of([
        {
          key: 'Tab',
          run: (v) => {
            acceptCompletion(v);
            return true;
          },
        },
      ]),
    ],
    [],
  );
  const foldExt = useMemo(
    () =>
      codeFolding({
        preparePlaceholder: (state: any, range: { from: number; to: number }) => {
          let node = syntaxTree(state).resolveInner(range.from, 1);
          while (node && node.name !== 'Object' && node.name !== 'Array' && node.parent)
            node = node.parent;
          if (!node) return '…';
          if (node.name === 'Object')
            return t('jsonTool.foldObject', { count: node.getChildren('Property').length });
          let n = 0;
          const c = node.cursor();
          if (c.firstChild())
            do {
              if (!['[', ']', ','].includes(c.name)) n++;
            } while (c.nextSibling());
          return t('jsonTool.foldArray', { count: n });
        },
        placeholderDOM: (_view: unknown, onclick: (e: Event) => void, prepared?: string) => {
          const el = document.createElement('span');
          el.textContent = prepared ?? '…';
          el.className = 'cm-foldPlaceholder';
          el.onclick = onclick;
          return el;
        },
      }),
    [t],
  );
  const summary = (v: string) =>
    `${v.split(/\r?\n/).length} ${t('jsonTool.lines')} · ${[...v].length} ${t('jsonTool.characters')}`;
  const runTransform = (pane: 'input' | 'result', minify: boolean, stripComments: boolean) => {
    const src = pane === 'input' ? input : result;
    const set = pane === 'input' ? setInput : setResult;
    try {
      let next;
      if (!minify && !stripComments && hasComments(src)) {
        next = formatJsonPreserve(src);
        try {
          parseJsonLoose(next);
        } catch {
          toast.add({
            title: t('jsonTool.formatFailed'),
            description: t('jsonTool.invalidJsonDesc'),
            type: 'error',
          });
          return;
        }
      } else {
        const v = stripComments ? parseJsonLoose(src) : JSON.parse(src);
        next = minify ? JSON.stringify(v) : JSON.stringify(v, null, 2);
      }
      set(next);
      record(
        'json',
        minify ? t('jsonTool.minified') : t('jsonTool.formatted'),
        summary(next),
        next,
      );
    } catch {
      toast.add({
        title: t(minify ? 'jsonTool.minifyFailed' : 'jsonTool.formatFailed'),
        description: t('jsonTool.invalidJsonDesc'),
        type: 'error',
      });
    }
  };
  const requestTransform = (pane: 'input' | 'result', minify: boolean) => {
    if (hasComments(pane === 'input' ? input : result))
      setCommentDialog({ mode: minify ? 'minify' : 'format', pane });
    else runTransform(pane, minify, false);
  };
  const changeInput = (value: string) => setInput(value);
  const toggleSchema = () => {
    setSchema((v) => {
      const next = !v;
      if (next) {
        setWorkflowMode(false);
        setPath((current) => {
          const normalized = current.trim();
          return normalized === '' || normalized === '$.' ? '$' : current;
        });
      }
      return next;
    });
  };
  const toggleWorkflow = () => {
    setWorkflowMode((v) => {
      const next = !v;
      if (next) setSchema(false);
      return next;
    });
  };
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('devutils:json-schema', { detail: schema }));
  }, [schema]);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('devutils:json-workflow', { detail: workflowMode }));
  }, [workflowMode]);
  const workflow = useDebouncedWorkflowEvaluation(workflowMode, input, workflowRules);
  const addWorkflowItem = () => {
    const next = newWorkflowItem();
    const hasTemplate = workflowRules.some((item) => item.type === 'template');
    setWorkflowFocusId(next.id);
    if (hasTemplate) toast.add({ title: t('jsonTool.workflow.templateNotice'), type: 'warning' });
    setWorkflowRules((r) => {
      const template = r.find((item) => item.type === 'template');
      if (!template) return [...r, next];
      return [...r.filter((item) => item.id !== template.id), next, template];
    });
  };
  const removeWorkflowItem = (id: string) =>
    setWorkflowRules((r) => r.filter((item) => item.id !== id));
  const moveWorkflowItem = (from: number, to: number) =>
    setWorkflowRules((r) => {
      if (from === to || to < 0 || to >= r.length) return r;
      const next = [...r];
      const [moved] = next.splice(from, 1);
      if (!moved || moved.type === 'template') return r;
      const templateIndex = next.findIndex((item) => item.type === 'template');
      next.splice(
        templateIndex < 0 ? Math.min(to, next.length) : Math.min(to, templateIndex),
        0,
        moved,
      );
      return next;
    });
  const exportWorkflow = async () => {
    try {
      if (!navigator.clipboard) throw new Error('clipboard');
      await navigator.clipboard.writeText(serializeWorkflow(workflowRules));
      toast.add({ title: t('jsonTool.workflow.exported') });
    } catch {
      toast.add({
        title: t('jsonTool.workflow.exportFailed'),
        description: t('jsonTool.workflow.clipboardWriteFailed'),
        type: 'error',
      });
    }
  };
  const importWorkflow = async () => {
    try {
      const source = (await Clipboard.Text().catch(() => '')) || '';
      if (!source.trim()) {
        toast.add({ title: t('jsonTool.workflow.importEmpty'), type: 'warning' });
        return;
      }
      setWorkflowRules(parseWorkflowConfig(source));
      toast.add({ title: t('jsonTool.workflow.imported') });
    } catch (error) {
      if (error instanceof Error && error.message === 'invalidConfig') {
        toast.add({
          title: t('jsonTool.workflow.importFailed'),
          description: t('jsonTool.workflow.invalidConfig'),
          type: 'error',
        });
        return;
      }
      toast.add({
        title: t('jsonTool.workflow.importFailed'),
        description: t('jsonTool.workflow.clipboardReadFailed'),
        type: 'error',
      });
    }
  };
  const copyWorkflow = () => {
    if (workflow.error || !workflow.output) return;
    void navigator.clipboard?.writeText(workflow.output).catch(() => {});
    const bytes = new TextEncoder().encode(workflow.output).length;
    toast.add({ title: t('toast.copied', { value: `${bytes} ${t('jsonTool.bytes')}` }) });
    record(
      'json',
      t('jsonTool.workflow.copy'),
      `${bytes} ${t('jsonTool.bytes')}`,
      input,
      workflow.output,
    );
  };
  const copyPane = async (pane: 'input' | 'result') => {
    const value = pane === 'input' ? input : result;
    await navigator.clipboard?.writeText(value).catch(() => {});
    const bytes = new TextEncoder().encode(value).length;
    toast.add({ title: t('toast.copied', { value: `${bytes} ${t('jsonTool.bytes')}` }) });
  };
  const editorActions = (pane: 'input' | 'result') => {
    const value = pane === 'input' ? input : result;
    const actions: ToolBarAction[] = [
      {
        key: 'clear',
        label: t('jsonTool.clear'),
        icon: Trash,
        variant: 'tertiary',
        disabled: !value,
        onPress: () => (pane === 'input' ? changeInput('') : setResult('')),
      },
    ];
    actions.push(
      {
        key: 'copy',
        label: t('jsonTool.copy'),
        icon: Copy,
        variant: 'secondary',
        disabled: !value,
        onPress: () => copyPane(pane),
      },
      {
        key: 'minify',
        label: t('jsonTool.minify'),
        variant: 'secondary',
        disabled: !value,
        onPress: () => requestTransform(pane, true),
      },
    );
    if (pane === 'input')
      actions.push({
        key: 'format',
        label: t('jsonTool.format'),
        variant: 'primary',
        disabled: !value,
        onPress: () => requestTransform(pane, false),
      });
    else
      actions.push({
        key: 'format',
        label: t('jsonTool.format'),
        variant: 'primary',
        disabled: !value,
        onPress: () => requestTransform(pane, false),
      });
    return (
      <ToolActionBar
        label={t(pane === 'input' ? 'jsonTool.inputActions' : 'jsonTool.resultActions')}
        actions={actions}
      />
    );
  };
  const workflowRuleActions = (
    <ToolActionBar
      label={t('jsonTool.workflow.ruleActions')}
      actions={[
        {
          key: 'import',
          label: t('jsonTool.workflow.importConfig'),
          icon: UploadSimple,
          variant: 'secondary',
          onPress: () => void importWorkflow(),
        },
        {
          key: 'export',
          label: t('jsonTool.workflow.exportConfig'),
          icon: DownloadSimple,
          variant: 'secondary',
          onPress: () => void exportWorkflow(),
        },
        {
          key: 'add',
          label: t('jsonTool.workflow.addItem'),
          variant: 'primary',
          onPress: addWorkflowItem,
        },
      ]}
    />
  );
  const workflowActions = (
    <ToolActionBar
      label={t('jsonTool.workflow.actions')}
      actions={[
        {
          key: 'copy',
          label: t('jsonTool.copy'),
          icon: Copy,
          variant: 'primary',
          disabled: !!workflow.error || !workflow.output,
          onPress: copyWorkflow,
        },
      ]}
    />
  );
  const jsonGridClass = workflowMode
    ? 'grid-cols-3 grid-rows-[minmax(0,1fr)] gap-3 @max-[959px]/json-page:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)] @max-[959px]/json-page:grid-rows-1 @min-[960px]/json-page:grid-cols-3 @min-[960px]/json-page:grid-rows-1'
    : schema
      ? 'grid-cols-2 grid-rows-[minmax(0,1fr)] gap-3 @max-[959px]/json-page:grid-cols-2 @max-[959px]/json-page:grid-rows-1 @min-[960px]/json-page:grid-cols-3 @min-[960px]/json-page:grid-rows-1'
      : 'grid-cols-1 grid-rows-[minmax(0,1fr)] gap-0';
  const footerGridClass = workflowMode
    ? 'grid-cols-3 @max-[959px]/json-page:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)] @min-[960px]/json-page:grid-cols-3'
    : schema
      ? 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)] @max-[959px]/json-page:grid-cols-2 @min-[960px]/json-page:grid-cols-3'
      : 'grid-cols-1';
  useEffect(() => {
    if (!pending || pending.tool !== 'json' || consumed.current === pending) return;
    consumed.current = pending;
    clearPending();
    const pane = pending.pane ?? 'input';
    if (pending.action === 'autoFormatOnFill') {
      onAutoFormatOnFillChange(!autoFormatRef.current);
      return;
    }
    if (pending.action === 'schema') {
      toggleSchema();
      return;
    }
    if (pending.action === 'workflow') {
      toggleWorkflow();
      return;
    }
    if (pending.action === 'workflowAddItem') {
      addWorkflowItem();
      return;
    }
    if (pending.action === 'workflowCopy') {
      copyWorkflow();
      return;
    }
    if (pending.action === 'workflowImport') {
      void importWorkflow();
      return;
    }
    if (pending.action === 'workflowExport') {
      void exportWorkflow();
      return;
    }
    if (pending.action === 'clear') {
      pane === 'input' ? changeInput('') : setResult('');
      return;
    }
    if (pending.action === 'format' || pending.action === 'minify') {
      requestTransform(pane, pending.action === 'minify');
      return;
    }
    if (pending.action === 'copy') {
      const toCopy = (pane === 'input' ? input : result).trim() || pending.input;
      if (!toCopy.trim()) {
        toast.add({
          title: t('toast.clipboardEmpty'),
          description: t('toast.clipboardEmptyDesc'),
          type: 'warning',
        });
        return;
      }
      void navigator.clipboard?.writeText(toCopy).catch(() => {});
      const bytes = new TextEncoder().encode(toCopy).length;
      toast.add({ title: t('toast.copied', { value: `${bytes} ${t('jsonTool.bytes')}` }) });
      record('json', t('jsonTool.copied'), `${bytes} ${t('jsonTool.bytes')}`, toCopy);
      return;
    }
    if (pending.action === 'restore') {
      changeInput(pending.input);
      if (pending.output !== undefined) setResult(pending.output);
      return;
    }
    if (pending.action === 'validate') {
      changeInput(pending.input);
      try {
        JSON.parse(pending.input);
        record('json', t('jsonTool.validated'), summary(pending.input), pending.input);
      } catch {
        record('json', t('jsonTool.invalid'), summary(pending.input), pending.input);
      }
      return;
    }
    const next = autoFormatRef.current ? tryAutoFormat(pending.input) : pending.input;
    changeInput(next);
    if (autoFormatRef.current && next !== pending.input)
      record('json', t('jsonTool.formatted'), summary(next), next);
  }, [pending, workflow]);
  useEffect(() => {
    const onFill = () => {
      if (!autoFormatRef.current) return;
      const view = views.current.get('input');
      if (!view) return;
      const src = view.state.doc.toString();
      const next = tryAutoFormat(src);
      if (next !== src) setInput(next);
    };
    window.addEventListener('devutils:json-after-fill', onFill);
    return () => window.removeEventListener('devutils:json-after-fill', onFill);
  }, []);
  useEffect(() => {
    if (!schema) return;
    if (!input.trim()) {
      setResult('');
      setPathError('');
      return;
    }
    const m = matchPath(input, path);
    if (m.ok) {
      setResult(m.source ?? JSON.stringify(m.value, null, 2));
      setPathError('');
    } else {
      setResult('');
      setPathError(fmtErr(m.error));
    }
  }, [schema, input, path]);
  useEffect(() => {
    for (const v of views.current.values()) v.requestMeasure();
    const timer = window.setTimeout(() => {
      const view = views.current.get(schema ? 'path' : 'input');
      if (!view) return;
      view.focus();
      if (schema) {
        const end = view.state.doc.length;
        view.dispatch({ selection: { anchor: end } });
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [schema, workflowMode]);
  return (
    <Reveal index={0} fill active={active}>
      <ToolLayout className="json-page [container-name:json-page] [container-type:inline-size]">
        <ToolLayoutHeader title={t('jsonTool.title')} />
        <ToolLayoutToolbar
          left={
            <Label className="flex h-8 flex-none items-center gap-2 border border-transparent bg-transparent py-0 pr-1.5 text-[11px] text-muted-foreground">
              <Checkbox
                checked={autoFormatOnFill}
                onCheckedChange={(checked) => onAutoFormatOnFillChange(checked)}
              />
              <span>{t('jsonTool.autoFormatOnFill')}</span>
            </Label>
          }
          right={
            <>
              <Label className="flex h-8 flex-none items-center gap-2 border border-transparent bg-transparent py-0 pr-1.5 pl-3 text-[11px] text-muted-foreground">
                <span>{t('jsonTool.schema')}</span>
                <Switch checked={schema} onCheckedChange={toggleSchema} size="sm" />
              </Label>
              <Label className="flex h-8 flex-none items-center gap-2 border border-transparent bg-transparent py-0 pr-1.5 pl-3 text-[11px] text-muted-foreground">
                <span>{t('jsonTool.workflow.title')}</span>
                <Switch checked={workflowMode} onCheckedChange={toggleWorkflow} size="sm" />
              </Label>
            </>
          }
        />
        <ToolLayoutContent>
          <div className="json-content h-full min-h-0 overflow-hidden">
            <div
              className={`json-schema-layout grid h-full min-h-0 min-w-0 ${jsonGridClass}${workflowMode ? ' workflow-layout' : ''}`}
            >
              <JsonEditorPane
                label={t('jsonTool.input')}
                value={input}
                onChange={changeInput}
                foldExt={foldExt}
                onCreate={(v) => views.current.set('input', v)}
                theme={cmTheme}
                placeholder={t('jsonTool.placeholder')}
                cmClassName="json-input-cm"
                formatOnPaste={autoFormatOnFill ? tryAutoFormat : undefined}
                tableMode={inputTableMode}
                active={active}
                tableDisabled={!input.trim() || !inputPreview.valid}
                tableHint={t('jsonTool.tablePreviewInvalid')}
                onToggleTable={() => setInputTableMode((current) => !current)}
                tablePreview={<JsonTablePreview value={inputPreview.value} t={t} />}
              />
              <div
                className={`json-schema-right grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-3 ${workflowMode ? '@max-[959px]/json-page:contents' : '@max-[959px]/json-page:grid'} @min-[960px]/json-page:contents${schema || workflowMode ? '' : ' hidden'}`}
              >
                {schema && (
                  <>
                    <div className="json-path flex min-w-0 flex-col gap-2 min-h-0">
                      <span className="flex-none font-mono text-[10px] font-medium leading-none tracking-[.04em] text-muted-foreground uppercase">
                        {t('jsonTool.schema')}
                      </span>
                      <div className="json-path-field flex min-h-0 min-w-0 flex-1">
                        <CodeMirror
                          className="json-cm json-path-cm"
                          height="100%"
                          value={path}
                          onChange={setPath}
                          theme={cmTheme}
                          indentWithTab={false}
                          onCreateEditor={(v) => {
                            v.contentDOM.setAttribute('aria-label', t('jsonTool.schema'));
                            views.current.set('path', v);
                          }}
                          basicSetup={{
                            lineNumbers: false,
                            foldGutter: false,
                            autocompletion: false,
                            closeBrackets: false,
                          }}
                          extensions={pathExt}
                          placeholder={t('jsonTool.schemaPathPlaceholder')}
                        />
                      </div>
                    </div>
                    <div className="json-pane flex min-h-0 min-w-0 flex-1 flex-col gap-2">
                      <span className="json-pane-label flex-none font-mono text-[10px] font-medium leading-none tracking-[.04em] text-muted-foreground uppercase">
                        {t('jsonTool.result')}
                      </span>
                      <div className="json-pane-editor relative flex min-h-0 min-w-0 flex-1">
                        {pathError ? (
                          <JsonErrorPanel
                            title={t('jsonTool.workflow.errorTitle')}
                            description={pathError}
                          />
                        ) : (
                          <CodeMirror
                            className="json-cm"
                            height="100%"
                            value={result}
                            editable={false}
                            theme={cmTheme}
                            onCreateEditor={(v) => {
                              v.contentDOM.setAttribute('aria-label', t('jsonTool.result'));
                              views.current.set('result', v);
                            }}
                            extensions={[json5(), foldExt]}
                          />
                        )}
                        {!pathError && (
                          <div
                            className={`json-table-layer${resultTableMode && active ? ' is-visible' : ''}`}
                            aria-hidden={!resultTableMode || !active}
                            {...(!resultTableMode || !active ? { inert: true } : {})}
                          >
                            <JsonTablePreview value={resultPreview.value} t={t} />
                          </div>
                        )}
                        {!pathError && (
                          <Button
                            type="button"
                            variant={resultTableMode ? 'secondary' : 'ghost'}
                            size="icon-sm"
                            className="json-table-toggle absolute top-2 right-2 z-20"
                            disabled={!result.trim() || !resultPreview.valid}
                            aria-label={t('jsonTool.tablePreview')}
                            title={
                              !result.trim() || !resultPreview.valid
                                ? t('jsonTool.tablePreviewInvalid')
                                : t(
                                    resultTableMode
                                      ? 'jsonTool.tablePreviewOn'
                                      : 'jsonTool.tablePreview',
                                  )
                            }
                            onClick={() => setResultTableMode((current) => !current)}
                          >
                            <TableIcon />
                          </Button>
                        )}
                      </div>
                    </div>
                  </>
                )}
                {workflowMode && (
                  <div className="json-workflow-slot min-h-0 min-w-0 @max-[959px]/json-page:contents @min-[960px]/json-page:contents">
                    <WorkflowPanel
                      contexts={workflow.contexts}
                      rules={workflowRules}
                      output={workflow.output}
                      error={workflow.error}
                      theme={cmTheme}
                      foldExt={foldExt}
                      focusItemId={workflowFocusId}
                      onFocusHandled={() => setWorkflowFocusId(null)}
                      onChange={setWorkflowRules}
                      onRemove={removeWorkflowItem}
                      onMove={moveWorkflowItem}
                    />
                  </div>
                )}
              </div>
            </div>
            <div className={`detected hidden${input && !jsonValue ? ' invalid' : ''}`}>
              <span>{t('jsonTool.detected')}</span>
              {input ? (
                <strong className={jsonValue ? undefined : 'empty'}>
                  {jsonValue ? `${t('jsonTool.valid')} · ${summary(input)}` : t('jsonTool.invalid')}
                </strong>
              ) : (
                <strong className="empty">{t('jsonTool.placeholder')}</strong>
              )}
            </div>
          </div>
        </ToolLayoutContent>
        <ToolLayoutFooter>
          <div
            className={`json-footer-actions grid items-start gap-3 ${footerGridClass}${workflowMode ? ' workflow-layout' : ''}`}
          >
            {editorActions('input')}
            {schema && editorActions('result')}
            {workflowMode && (
              <div className="json-workflow-rules-footer-actions min-w-0">
                {workflowRuleActions}
              </div>
            )}
            {workflowMode && (
              <div className="json-workflow-footer-actions min-w-0">{workflowActions}</div>
            )}
          </div>
        </ToolLayoutFooter>
      </ToolLayout>
      <AlertDialog
        open={commentDialog !== null}
        onOpenChange={(open) => {
          if (!open) setCommentDialog(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('jsonTool.commentTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {commentDialog?.mode === 'minify'
                ? t('jsonTool.commentMinifyBody')
                : t('jsonTool.commentFormatBody')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('jsonTool.cancel')}</AlertDialogCancel>
            {commentDialog?.mode === 'format' && (
              <Button
                variant="outline"
                onClick={() => {
                  const d = commentDialog;
                  setCommentDialog(null);
                  if (d) runTransform(d.pane, false, false);
                }}
              >
                {t('jsonTool.keepComments')}
              </Button>
            )}
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const d = commentDialog;
                setCommentDialog(null);
                if (d) runTransform(d.pane, d.mode === 'minify', true);
              }}
            >
              {commentDialog?.mode === 'minify'
                ? t('jsonTool.minifyClear')
                : t('jsonTool.clearComments')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Reveal>
  );
}
