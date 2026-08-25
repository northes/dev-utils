import { useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import CodeMirror from '@uiw/react-codemirror';
import { json5 } from 'codemirror-json5';
import { EditorView, keymap } from '@codemirror/view';
import { acceptCompletion } from '@codemirror/autocomplete';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Switch } from './ui/switch';
import { DotsSixVertical, Trash } from '@phosphor-icons/react';
import type { Extension } from '@codemirror/state';
import { pathCompletions, valueCompletions } from './JsonPathCompletion';
import { JsonErrorPanel } from './JsonErrorPanel';
import { isObject } from './JsonWorkflowEngine';
import type {
  WorkflowContexts,
  WorkflowDirection,
  WorkflowError,
  WorkflowItem,
  WorkflowItemType,
  WorkflowSortMode,
} from './JsonWorkflowEngine';

class WorkflowConfigError extends Error {
  constructor() {
    super('invalidConfig');
  }
}
const createWorkflowId = () => `workflow-${Date.now()}-${Math.random().toString(36).slice(2)}`;
function newWorkflowItem(type: WorkflowItemType = 'extract'): WorkflowItem {
  return {
    id: createWorkflowId(),
    enabled: true,
    type,
    path: '$',
    sortMode: 'key',
    direction: 'asc',
    arrayPath: '$',
    itemPath: '$',
    filterValue: '',
    template: '{$.name}?token={$.token}',
  };
}
const typeOptions: WorkflowItemType[] = ['extract', 'sort', 'arraySort', 'filter', 'template'];
const configString = (item: Record<string, unknown>, key: string, fallback: string) => {
  const value = item[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'string') throw new WorkflowConfigError();
  return value;
};
export function parseWorkflowConfig(source: string): WorkflowItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new WorkflowConfigError();
  }
  if (isObject(parsed) && parsed.version !== undefined && parsed.version !== 1)
    throw new WorkflowConfigError();
  const items = Array.isArray(parsed)
    ? parsed
    : isObject(parsed) && Array.isArray(parsed.items)
      ? parsed.items
      : null;
  if (!items) throw new WorkflowConfigError();
  const result = items.map((raw) => {
    if (
      !isObject(raw) ||
      typeof raw.type !== 'string' ||
      !typeOptions.includes(raw.type as WorkflowItemType)
    )
      throw new WorkflowConfigError();
    if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean')
      throw new WorkflowConfigError();
    if (raw.sortMode !== undefined && raw.sortMode !== 'key' && raw.sortMode !== 'value')
      throw new WorkflowConfigError();
    if (raw.direction !== undefined && raw.direction !== 'asc' && raw.direction !== 'desc')
      throw new WorkflowConfigError();
    const item: WorkflowItem = {
      id: createWorkflowId(),
      enabled: raw.enabled ?? true,
      type: raw.type as WorkflowItemType,
      path: configString(raw, 'path', '$'),
      sortMode: (raw.sortMode ?? 'key') as WorkflowSortMode,
      direction: (raw.direction ?? 'asc') as WorkflowDirection,
      arrayPath: configString(raw, 'arrayPath', '$'),
      itemPath: configString(raw, 'itemPath', '$'),
      filterValue: configString(raw, 'filterValue', ''),
      template: configString(raw, 'template', '{$.name}?token={$.token}'),
    };
    return item;
  });
  if (result.filter((item) => item.type === 'template').length > 1) throw new WorkflowConfigError();
  const template = result.find((item) => item.type === 'template');
  return template ? [...result.filter((item) => item !== template), template] : result;
}
export function serializeWorkflow(rules: WorkflowItem[]): string {
  return JSON.stringify({ version: 1, items: rules.map(({ id, ...item }) => item) }, null, 2);
}

function WorkflowSelect({
  label,
  value,
  options,
  onSelect,
  className = '',
}: {
  label: string;
  value: string;
  options: Array<{ key: string; label: string }>;
  onSelect: (value: string) => void;
  className?: string;
}) {
  return (
    <Select
      items={options.map((option) => ({ value: option.key, label: option.label }))}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onSelect(next);
      }}
    >
      <SelectTrigger
        className={`json-workflow-select h-[30px] min-h-[30px] w-full min-w-0 flex-1 justify-self-stretch px-[9px] text-[11px] ${className}`.trim()}
        aria-label={label}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.key} value={option.key}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function PathField({
  label,
  value,
  placeholder,
  onChange,
  root,
  theme,
  template = false,
  completion = true,
  values,
  onCreate,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  root: unknown;
  theme: Extension;
  template?: boolean;
  completion?: boolean;
  values?: unknown[];
  onCreate?: (view: EditorView) => void;
}) {
  const rootRef = useRef(root);
  const valuesRef = useRef(values);
  if (root !== undefined) rootRef.current = root;
  if (values !== undefined) valuesRef.current = values;
  const extensions = useMemo(
    () => [
      EditorView.lineWrapping,
      ...(!completion
        ? valueCompletions(() => valuesRef.current ?? [])
        : pathCompletions(() => rootRef.current, template)),
      keymap.of([{ key: 'Tab', run: (view) => acceptCompletion(view) }]),
    ],
    [completion, template],
  );
  return (
    <label className="json-workflow-field flex min-w-0 items-center gap-2 @max-[520px]/workflow-rules:items-stretch @max-[520px]/workflow-rules:flex-col @max-[520px]/workflow-rules:gap-[5px]">
      <span className="w-[86px] min-w-[86px] whitespace-nowrap font-mono text-[10px] font-medium leading-none tracking-[.02em] text-muted-foreground @max-[520px]/workflow-rules:w-auto @max-[520px]/workflow-rules:min-w-0">
        {label}
      </span>
      <CodeMirror
        className="json-cm json-workflow-path-cm min-w-0 flex-1 overflow-visible rounded-lg border border-input bg-card focus-within:border-ring"
        height="30px"
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        spellCheck={false}
        theme={theme}
        indentWithTab={false}
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          autocompletion: false,
          closeBrackets: false,
        }}
        extensions={extensions}
        onCreateEditor={(view) => {
          view.contentDOM.setAttribute('aria-label', label);
          onCreate?.(view);
        }}
      />
    </label>
  );
}
function SelectField({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: string;
  options: Array<{ key: string; label: string }>;
  onSelect: (value: string) => void;
}) {
  return (
    <label className="json-workflow-field json-workflow-select-field flex min-w-0 items-center gap-2 @max-[520px]/workflow-rules:items-stretch @max-[520px]/workflow-rules:flex-col @max-[520px]/workflow-rules:gap-[5px]">
      <span className="w-[86px] min-w-[86px] whitespace-nowrap font-mono text-[10px] font-medium leading-none tracking-[.02em] text-muted-foreground @max-[520px]/workflow-rules:w-auto @max-[520px]/workflow-rules:min-w-0">
        {label}
      </span>
      <WorkflowSelect label={label} value={value} options={options} onSelect={onSelect} />
    </label>
  );
}

function WorkflowRuleRow({
  item,
  index,
  root,
  itemRoot,
  filterValues,
  labels,
  theme,
  onUpdate,
  onTypeChange,
  onRemove,
  onFirstEditorCreate,
}: {
  item: WorkflowItem;
  index: number;
  root: unknown;
  itemRoot: unknown;
  filterValues: unknown[];
  labels: Record<WorkflowItemType, string>;
  theme: Extension;
  onUpdate: (id: string, patch: Partial<WorkflowItem>) => void;
  onTypeChange: (item: WorkflowItem, type: WorkflowItemType) => void;
  onRemove: (id: string) => void;
  onFirstEditorCreate: (id: string, view: EditorView) => void;
}) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1 : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`json-workflow-item border-b border-border px-3 pt-3.5 pb-6${item.enabled ? '' : ' opacity-[.55]'}${isDragging ? ' bg-[color-mix(in_oklch,var(--primary)_12%,transparent)]' : ''}`}
    >
      <div className="json-workflow-item-header grid min-w-0 grid-cols-[28px_24px_minmax(0,1fr)_28px_28px] items-center gap-2">
        <Button
          ref={setActivatorNodeRef}
          variant="ghost"
          size="icon-sm"
          className="json-workflow-drag flex-none cursor-grab touch-none text-muted-foreground"
          {...attributes}
          {...listeners}
          aria-label={t('jsonTool.workflow.drag')}
          title={t('jsonTool.workflow.drag')}
        >
          <DotsSixVertical size={14} weight="duotone" />
        </Button>
        <span className="json-workflow-index w-6 min-w-6 text-center font-mono text-[10px] font-medium leading-none text-muted-foreground">
          {String(index + 1).padStart(2, '0')}
        </span>
        <WorkflowSelect
          label={t('jsonTool.workflow.type')}
          value={item.type}
          options={typeOptions.map((type) => ({ key: type, label: labels[type] }))}
          onSelect={(value) => onTypeChange(item, value as WorkflowItemType)}
          className="json-workflow-type w-full min-w-0 justify-self-stretch"
        />
        <Switch
          size="sm"
          className="json-workflow-enabled flex-none justify-self-end"
          checked={item.enabled}
          onCheckedChange={(checked) => onUpdate(item.id, { enabled: checked })}
          aria-label={t('jsonTool.workflow.enableItem')}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          className="json-workflow-delete flex-none text-muted-foreground"
          onClick={() => onRemove(item.id)}
          aria-label={t('jsonTool.workflow.delete')}
          title={t('jsonTool.workflow.delete')}
        >
          <Trash size={14} weight="duotone" />
        </Button>
      </div>
      <div className="json-workflow-item-body min-w-0 pt-2.5 pl-[66px] @max-[520px]/workflow-rules:pl-0">
        {item.type === 'extract' && (
          <PathField
            label={t('jsonTool.workflow.path')}
            value={item.path}
            placeholder={t('jsonTool.workflow.pathPlaceholder')}
            onChange={(value) => onUpdate(item.id, { path: value })}
            root={root}
            theme={theme}
            onCreate={(view) => onFirstEditorCreate(item.id, view)}
          />
        )}{' '}
        {item.type === 'sort' && (
          <div className="json-workflow-inline-fields grid grid-cols-2 gap-x-2 gap-y-2.5 @max-[520px]/workflow-rules:grid-cols-1">
            <SelectField
              label={t('jsonTool.workflow.sortMode')}
              value={item.sortMode}
              options={[
                { key: 'key', label: t('jsonTool.sortByKey') },
                { key: 'value', label: t('jsonTool.sortByValue') },
              ]}
              onSelect={(value) => onUpdate(item.id, { sortMode: value as WorkflowSortMode })}
            />
            <SelectField
              label={t('jsonTool.workflow.direction')}
              value={item.direction}
              options={[
                { key: 'asc', label: t('jsonTool.sortOrderAsc') },
                { key: 'desc', label: t('jsonTool.sortOrderDesc') },
              ]}
              onSelect={(value) => onUpdate(item.id, { direction: value as WorkflowDirection })}
            />
          </div>
        )}{' '}
        {item.type === 'arraySort' && (
          <div className="json-workflow-fields grid grid-cols-2 gap-x-2 gap-y-2.5 @max-[520px]/workflow-rules:grid-cols-1">
            <PathField
              label={t('jsonTool.workflow.arrayPath')}
              value={item.arrayPath}
              placeholder={t('jsonTool.workflow.arrayPathPlaceholder')}
              onChange={(value) => onUpdate(item.id, { arrayPath: value })}
              root={root}
              theme={theme}
              onCreate={(view) => onFirstEditorCreate(item.id, view)}
            />
            <PathField
              label={t('jsonTool.workflow.itemPath')}
              value={item.itemPath}
              placeholder={t('jsonTool.workflow.itemPathPlaceholder')}
              onChange={(value) => onUpdate(item.id, { itemPath: value })}
              root={itemRoot}
              theme={theme}
            />
            <SelectField
              label={t('jsonTool.workflow.direction')}
              value={item.direction}
              options={[
                { key: 'asc', label: t('jsonTool.sortOrderAsc') },
                { key: 'desc', label: t('jsonTool.sortOrderDesc') },
              ]}
              onSelect={(value) => onUpdate(item.id, { direction: value as WorkflowDirection })}
            />
          </div>
        )}{' '}
        {item.type === 'filter' && (
          <div className="json-workflow-fields grid grid-cols-2 gap-x-2 gap-y-2.5 @max-[520px]/workflow-rules:grid-cols-1">
            <PathField
              label={t('jsonTool.workflow.arrayPath')}
              value={item.arrayPath}
              placeholder={t('jsonTool.workflow.arrayPathPlaceholder')}
              onChange={(value) => onUpdate(item.id, { arrayPath: value })}
              root={root}
              theme={theme}
              onCreate={(view) => onFirstEditorCreate(item.id, view)}
            />
            <PathField
              label={t('jsonTool.workflow.itemPath')}
              value={item.itemPath}
              placeholder={t('jsonTool.workflow.itemPathPlaceholder')}
              onChange={(value) => onUpdate(item.id, { itemPath: value })}
              root={itemRoot}
              theme={theme}
            />
            <PathField
              label={t('jsonTool.workflow.filterValue')}
              value={item.filterValue}
              placeholder={t('jsonTool.workflow.filterValuePlaceholder')}
              onChange={(value) => onUpdate(item.id, { filterValue: value })}
              root={root}
              theme={theme}
              completion={false}
              values={filterValues}
            />
          </div>
        )}{' '}
        {item.type === 'template' && (
          <PathField
            label={t('jsonTool.workflow.template')}
            value={item.template}
            placeholder={t('jsonTool.workflow.templatePlaceholder')}
            onChange={(value) => onUpdate(item.id, { template: value })}
            root={root}
            theme={theme}
            template
            onCreate={(view) => onFirstEditorCreate(item.id, view)}
          />
        )}{' '}
      </div>
    </div>
  );
}

export function WorkflowPanel({
  rules,
  contexts,
  output,
  error,
  theme,
  foldExt,
  onChange,
  onRemove,
  onMove,
  focusItemId,
  onFocusHandled,
}: {
  rules: WorkflowItem[];
  contexts: WorkflowContexts;
  output: string;
  error: WorkflowError | null;
  theme: Extension;
  foldExt: Extension;
  onChange: (update: WorkflowItem[] | ((rules: WorkflowItem[]) => WorkflowItem[])) => void;
  onRemove: (id: string) => void;
  onMove: (from: number, to: number) => void;
  focusItemId: string | null;
  onFocusHandled: () => void;
}) {
  const { t } = useTranslation();
  const { roots: root, itemRoots, filterValues } = contexts;
  const listRef = useRef<HTMLDivElement>(null);
  const editorViews = useRef(new Map<string, EditorView>());
  const focusItemIdRef = useRef(focusItemId);
  focusItemIdRef.current = focusItemId;
  const hasTemplate = rules.some((item) => item.type === 'template');
  const labels = {
    extract: t('jsonTool.workflow.types.extract'),
    sort: t('jsonTool.workflow.types.sort'),
    arraySort: t('jsonTool.workflow.types.arraySort'),
    filter: t('jsonTool.workflow.types.filter'),
    template: t('jsonTool.workflow.types.template'),
  };
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const update = (id: string, patch: Partial<WorkflowItem>) =>
    onChange((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  const updateType = (item: WorkflowItem, type: WorkflowItemType) => {
    if (type === 'template' && hasTemplate && item.type !== 'template') return;
    if (type !== 'template') {
      update(item.id, { type });
      return;
    }
    onChange((current) => {
      const next = current.map((currentItem) =>
        currentItem.id === item.id ? { ...currentItem, type } : currentItem,
      );
      const changed = next.find((currentItem) => currentItem.id === item.id);
      if (!changed) return current;
      return [...next.filter((currentItem) => currentItem.id !== item.id), changed];
    });
  };
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= rules.length) return;
    onMove(from, to);
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = rules.findIndex((item) => item.id === String(active.id));
    const to = rules.findIndex((item) => item.id === String(over.id));
    move(from, to);
  };
  const focusAddedItem = (id: string, view: EditorView) => {
    editorViews.current.set(id, view);
    if (focusItemIdRef.current !== id) return;
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
    view.focus();
    onFocusHandled();
  };
  useLayoutEffect(() => {
    if (!focusItemId) return;
    const view = editorViews.current.get(focusItemId);
    if (view) focusAddedItem(focusItemId, view);
  }, [focusItemId]);
  return (
    <div className="json-workflow-panel grid h-full min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-3 @max-[959px]/json-page:grid-cols-2 @max-[959px]/json-page:grid-rows-1 @min-[960px]/json-page:contents">
      <section className="json-workflow-rules flex min-h-0 min-w-0 flex-col [container-name:workflow-rules] [container-type:inline-size] @min-[960px]/json-page:h-full @min-[960px]/json-page:min-h-0">
        <div className="json-workflow-section-header flex h-[18px] min-h-[18px] flex-none items-start justify-between gap-2">
          <span className="font-mono text-[10px] font-medium leading-none tracking-[.04em] text-muted-foreground uppercase">
            {t('jsonTool.workflow.rules')}
          </span>
        </div>
        <div
          ref={listRef}
          className="json-workflow-list min-h-0 overflow-auto [scrollbar-gutter:auto]"
        >
          {rules.length === 0 ? (
            <div className="json-workflow-empty flex min-h-[74px] items-center justify-center text-[11px] text-muted-foreground">
              {t('jsonTool.workflow.empty')}
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext
                items={rules.map((item) => item.id)}
                strategy={verticalListSortingStrategy}
              >
                {rules.map((item, index) => (
                  <WorkflowRuleRow
                    key={item.id}
                    item={item}
                    index={index}
                    root={root[index]}
                    itemRoot={itemRoots[index]}
                    filterValues={filterValues[index]}
                    labels={labels}
                    theme={theme}
                    onUpdate={update}
                    onTypeChange={updateType}
                    onRemove={onRemove}
                    onFirstEditorCreate={focusAddedItem}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}
        </div>
      </section>
      <section className="json-workflow-output flex min-h-0 min-w-0 flex-col @min-[960px]/json-page:h-full @min-[960px]/json-page:min-h-0">
        <div className="json-workflow-section-header flex h-[18px] min-h-[18px] flex-none items-start justify-between gap-2">
          <span className="font-mono text-[10px] font-medium leading-none tracking-[.04em] text-muted-foreground uppercase">
            {t('jsonTool.workflow.output')}
          </span>
        </div>
        <div className="json-workflow-output-field flex min-h-0 flex-1">
          {error ? (
            <JsonErrorPanel
              title={t('jsonTool.workflow.errorTitle')}
              description={t(`jsonTool.workflow.errors.${error.code}`)}
              item={
                error.item !== undefined
                  ? t('jsonTool.workflow.errorItem', {
                      item: String(error.item + 1).padStart(2, '0'),
                    })
                  : undefined
              }
              path={
                error.path
                  ? { label: t('jsonTool.workflow.errorPath'), value: error.path }
                  : undefined
              }
            />
          ) : (
            <CodeMirror
              className="json-cm json-workflow-cm flex min-h-0 flex-1"
              height="100%"
              value={output}
              editable={false}
              theme={theme}
              extensions={[json5(), foldExt, EditorView.lineWrapping]}
              onCreateEditor={(view) =>
                view.contentDOM.setAttribute('aria-label', t('jsonTool.workflow.output'))
              }
            />
          )}
        </div>
      </section>
    </div>
  );
}

export { newWorkflowItem };
