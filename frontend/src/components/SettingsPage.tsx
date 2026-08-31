import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
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
import {
  ArrowSquareOut,
  ArrowsClockwise,
  Power,
  SidebarSimple,
  Trash,
} from '@phosphor-icons/react';
import { Application, Browser } from '@wailsio/runtime';
import { useTranslation } from 'react-i18next';
import i18n, { SUPPORTED_LANGUAGES } from '../i18n';
import type { Config as Settings } from '../../bindings/changeme/models';
import { CheckForUpdates, GetCurrentVersion } from '../../bindings/changeme/updateservice';
import { ClearHistoryDialog } from './HistoryPage';
import {
  ToolLayout,
  ToolLayoutHeader,
  ToolLayoutScrollableContent,
  type Icon,
  type ToolId,
} from './shared';
import { toast } from './ui/toast';
import { GITHUB_REPO_URL } from '../repositoryUrl';
import { THEME_MODE_OPTIONS, type ThemeMode } from '../theme';
import { cn } from '@/lib/utils';

const TRAY_MATCH_DEFAULT_TOOLS: readonly ToolId[] = [
  'json',
  'time',
  'text',
  'base64',
  'diff',
  'jwt',
  'url',
];
const EDITOR_FONT_SIZES = [12, 14, 16, 18] as const;
const settingRowClass = 'flex min-h-8 items-center justify-between gap-5';
const settingLabelClass = 'text-xs leading-[1.4] font-medium text-foreground';
const settingHintClass = 'text-[10px] leading-[1.4] text-muted-foreground';
const settingStackClass =
  'divide-y divide-border [&>:not(:first-child)]:pt-3 [&>:not(:last-child)]:pb-3';

export type ToolDefinition = {
  id: ToolId;
  nameKey: string;
  descriptionKey: string;
  icon: Icon;
  keywords: string;
};
type BooleanSettingKey = 'trayMatchEnabled' | 'autoOverwrite' | 'autoCheckUpdates';
type ChoiceOption<T extends string | number> = { id: T; label: string };

function SettingSwitch({
  selected,
  onChange,
  isDisabled = false,
  id,
  describedBy,
}: {
  selected: boolean;
  onChange: (v: boolean) => void;
  isDisabled?: boolean;
  id?: string;
  describedBy?: string;
}) {
  return (
    <Switch
      id={id}
      checked={selected}
      onCheckedChange={onChange}
      disabled={isDisabled}
      size="sm"
      aria-describedby={describedBy}
    />
  );
}

function SettingsGroup({
  title,
  subtitle,
  children,
  divider = true,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  divider?: boolean;
}) {
  return (
    <section
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_minmax(320px,520px)] gap-5 py-4 max-[700px]:grid-cols-1 max-[700px]:gap-2.5',
        divider && 'border-t border-border',
      )}
    >
      <div>
        <h2 className="mb-1 text-xs leading-[1.25] font-semibold tracking-[.01em] text-foreground">
          {title}
        </h2>
        <p className="m-0 text-[10px] leading-[1.5] text-muted-foreground">{subtitle}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Setting({
  label,
  description,
  children,
}: {
  label?: string;
  description?: string;
  children: React.ReactNode;
}) {
  const controlId = useId();
  const isSwitch = isValidElement(children) && children.type === SettingSwitch;
  const switchProps = isSwitch
    ? (children.props as { isDisabled?: boolean; describedBy?: string })
    : undefined;
  const switchDisabled = Boolean(switchProps?.isDisabled);
  const copy = label ? (
    <span className="flex min-w-0 flex-col gap-0.5">
      <strong className={settingLabelClass}>{label}</strong>
      {description ? <small className={settingHintClass}>{description}</small> : null}
    </span>
  ) : null;
  if (isSwitch) {
    return (
      <div className={settingRowClass}>
        {label ? (
          <label
            htmlFor={controlId}
            className={cn('min-w-0', switchDisabled ? 'cursor-not-allowed' : 'cursor-pointer')}
          >
            {copy}
          </label>
        ) : null}
        {cloneElement(children as ReactElement<{ id?: string; describedBy?: string }>, {
          id: controlId,
          describedBy: switchProps?.describedBy,
        })}
      </div>
    );
  }
  return (
    <div className={settingRowClass}>
      {copy}
      {children}
    </div>
  );
}

function ChoiceGroup<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ChoiceOption<T>[];
  onChange: (value: T) => void;
}) {
  const labelId = useId();
  const radiosRef = useRef<Array<HTMLElement | null>>([]);
  const selectedIndex = options.findIndex((option) => option.id === value);
  const focusIndex = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.id);
    radiosRef.current[index]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>, index: number) => {
    const last = options.length - 1;
    if (last < 0) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      focusIndex(index === last ? 0 : index + 1);
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusIndex(index === 0 ? last : index - 1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      focusIndex(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      focusIndex(last);
    }
  };
  return (
    <div
      className={cn(
        settingRowClass,
        'max-[700px]:flex-col max-[700px]:items-start max-[700px]:gap-2',
      )}
    >
      <strong id={labelId} className={settingLabelClass}>
        {label}
      </strong>
      <div role="radiogroup" aria-labelledby={labelId} className="flex min-w-0 flex-none flex-wrap">
        {options.map((option, index) => {
          const checked = option.id === value;
          return (
            <Button
              key={String(option.id)}
              type="button"
              role="radio"
              variant={checked ? 'default' : 'ghost'}
              aria-checked={checked}
              tabIndex={checked || (selectedIndex < 0 && index === 0) ? 0 : -1}
              className="flex-none"
              onClick={() => onChange(option.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              ref={(node) => {
                radiosRef.current[index] = node;
              }}
            >
              {option.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

function trayMatchToolSet(toolIds: string[] | null | undefined) {
  return new Set((toolIds ?? TRAY_MATCH_DEFAULT_TOOLS) as ToolId[]);
}

export default function SettingsPage({
  settings,
  setSettings,
  setThemeMode: setThemeModeWithTransition,
  clearHistory,
  tools,
  sidebarManaging,
  onToggleSidebarManage,
  flushSettingsSave,
}: {
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  setThemeMode: (update: React.SetStateAction<Settings>) => void;
  clearHistory: () => void;
  tools: ToolDefinition[];
  sidebarManaging: boolean;
  onToggleSidebarManage: () => void;
  flushSettingsSave: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmQuit, setConfirmQuit] = useState(false);
  const [checking, setChecking] = useState(false);
  const [quitting, setQuitting] = useState(false);
  const [version, setVersion] = useState('');
  const trayMatchMinHintId = useId();
  useEffect(() => {
    void GetCurrentVersion().then(setVersion);
  }, []);
  const update = (key: BooleanSettingKey, value: boolean) =>
    setSettings((current) => ({ ...current, [key]: value }));
  const checkUpdates = async () => {
    setChecking(true);
    window.dispatchEvent(new CustomEvent('devutils:update-check', { detail: 'checking' }));
    try {
      const available = await CheckForUpdates();
      if (!available) toast.add({ title: t('settings.upToDate'), type: 'success' });
      window.dispatchEvent(
        new CustomEvent('devutils:update-check', {
          detail: available ? 'available' : 'finished',
        }),
      );
    } catch {
      toast.add({
        title: t('settings.updateFailed'),
        description: t('settings.updateFailedDesc'),
        type: 'error',
      });
      window.dispatchEvent(new CustomEvent('devutils:update-check', { detail: 'finished' }));
    } finally {
      setChecking(false);
    }
  };
  const matchableTools = tools.filter((tool) => TRAY_MATCH_DEFAULT_TOOLS.includes(tool.id));
  const toggleTrayTool = (tool: ToolId, value: boolean) =>
    setSettings((current) => {
      const selected = new Set(
        [...trayMatchToolSet(current.trayMatchTools)].filter((id) =>
          TRAY_MATCH_DEFAULT_TOOLS.includes(id),
        ),
      );
      if (value) selected.add(tool);
      else {
        if (selected.size <= 1 && selected.has(tool)) return current;
        selected.delete(tool);
      }
      const trayMatchTools = matchableTools
        .filter((item) => selected.has(item.id))
        .map((item) => item.id);
      if (trayMatchTools.length === 0) return current;
      return { ...current, trayMatchTools };
    });
  const setThemeMode = (value: ThemeMode) =>
    setThemeModeWithTransition((current) => ({ ...current, themeMode: value }));
  const setLanguage = (code: string) => {
    setSettings((current) => ({ ...current, language: code }));
    i18n.changeLanguage(code);
  };
  const quitApp = async () => {
    setQuitting(true);
    try {
      await flushSettingsSave();
    } catch {
      setQuitting(false);
      setConfirmQuit(false);
      return;
    }
    try {
      await Application.Quit();
    } catch {
      toast.add({
        title: t('settings.quitFailed'),
        description: t('settings.quitFailedDesc'),
        type: 'error',
      });
      setQuitting(false);
    }
  };
  const trayTools = new Set(
    [...trayMatchToolSet(settings.trayMatchTools)].filter((id) =>
      TRAY_MATCH_DEFAULT_TOOLS.includes(id),
    ),
  );
  const lastTrayToolLocked = trayTools.size <= 1;
  const defaultTrayTools = matchableTools.filter((tool) =>
    TRAY_MATCH_DEFAULT_TOOLS.includes(tool.id),
  );
  const extraTrayTools = matchableTools.filter(
    (tool) => !TRAY_MATCH_DEFAULT_TOOLS.includes(tool.id),
  );
  const themeModeOptions = THEME_MODE_OPTIONS.map(({ id, labelKey }) => ({
    id,
    label: t(labelKey),
  }));
  const fontSizeOptions = EDITOR_FONT_SIZES.map((size) => ({
    id: size,
    label: `${size}px`,
  }));
  const languageOptions = SUPPORTED_LANGUAGES.map((language) => ({
    id: language.code,
    label: t(language.labelKey),
  }));
  const renderTrayToolSwitch = (tool: ToolDefinition) => {
    const selected = trayTools.has(tool.id);
    const restricted = selected && lastTrayToolLocked;
    return (
      <Setting key={tool.id} label={t(tool.nameKey)}>
        <SettingSwitch
          selected={selected}
          onChange={(value) => toggleTrayTool(tool.id, value)}
          isDisabled={restricted}
          describedBy={restricted ? trayMatchMinHintId : undefined}
        />
      </Setting>
    );
  };

  return (
    <div className="h-full min-h-0">
      <ToolLayout>
        <ToolLayoutHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />
        <ToolLayoutScrollableContent>
          <SettingsGroup
            divider={false}
            title={t('settings.appearance')}
            subtitle={t('settings.appearanceSubtitle')}
          >
            <ChoiceGroup
              label={t('settings.themeMode')}
              value={settings.themeMode as ThemeMode}
              options={themeModeOptions}
              onChange={setThemeMode}
            />
          </SettingsGroup>
          <SettingsGroup title={t('settings.workspace')} subtitle={t('settings.workspaceSubtitle')}>
            <Setting
              label={t('settings.adjustSidebar')}
              description={t('settings.adjustSidebarDesc')}
            >
              <Button
                id="sidebar-manage-trigger"
                variant="outline"
                aria-expanded={sidebarManaging}
                aria-controls="app-sidebar"
                onClick={onToggleSidebarManage}
              >
                <SidebarSimple data-icon="inline-start" weight="duotone" />
                {t(sidebarManaging ? 'sidebar.done' : 'settings.adjustSidebar')}
              </Button>
            </Setting>
          </SettingsGroup>
          <SettingsGroup title={t('settings.editor')} subtitle={t('settings.editorSubtitle')}>
            <ChoiceGroup
              label={t('settings.editorFontSize')}
              value={settings.codeEditorFontSize || 16}
              options={fontSizeOptions}
              onChange={(size) =>
                setSettings((current) => ({
                  ...current,
                  codeEditorFontSize: size,
                }))
              }
            />
          </SettingsGroup>
          <SettingsGroup title={t('settings.language')} subtitle={t('settings.languageSubtitle')}>
            <ChoiceGroup
              label={t('settings.language')}
              value={settings.language}
              options={languageOptions}
              onChange={setLanguage}
            />
          </SettingsGroup>
          <SettingsGroup title={t('settings.clipboard')} subtitle={t('settings.clipboardSubtitle')}>
            <div className="flex flex-col gap-3">
              <div className="divide-y divide-border">
                <Setting label={t('settings.trayMatch')} description={t('settings.trayMatchDesc')}>
                  <SettingSwitch
                    selected={settings.trayMatchEnabled}
                    onChange={(value) => update('trayMatchEnabled', value)}
                  />
                </Setting>
                {settings.trayMatchEnabled ? (
                  <Setting
                    label={t('settings.autoOverwrite')}
                    description={t('settings.autoOverwriteDesc')}
                  >
                    <SettingSwitch
                      selected={settings.autoOverwrite}
                      onChange={(value) => update('autoOverwrite', value)}
                    />
                  </Setting>
                ) : null}
              </div>
              {settings.trayMatchEnabled ? (
                <div className="flex flex-col gap-3 border-t border-border pt-3">
                  <div className="flex flex-col gap-0.5">
                    <strong className={settingLabelClass}>{t('settings.trayMatchTools')}</strong>
                    <small className={settingHintClass}>{t('settings.trayMatchToolsDesc')}</small>
                  </div>
                  <div>
                    <div className="flex flex-col gap-0.5 pb-2">
                      <strong className={settingLabelClass}>
                        {t('settings.trayMatchToolsDefault')}
                      </strong>
                      <small className={settingHintClass}>
                        {t('settings.trayMatchToolsDefaultDesc')}
                      </small>
                    </div>
                    <div className="grid grid-cols-2 gap-x-5 max-[700px]:grid-cols-1">
                      {defaultTrayTools.map(renderTrayToolSwitch)}
                    </div>
                  </div>
                  {extraTrayTools.length > 0 ? (
                    <div className="border-t border-border pt-3">
                      <div className="flex flex-col gap-0.5 pb-2">
                        <strong className={settingLabelClass}>
                          {t('settings.trayMatchToolsExtra')}
                        </strong>
                        <small className={settingHintClass}>
                          {t('settings.trayMatchToolsExtraDesc')}
                        </small>
                      </div>
                      <div className="grid grid-cols-2 gap-x-5 max-[700px]:grid-cols-1">
                        {extraTrayTools.map(renderTrayToolSwitch)}
                      </div>
                    </div>
                  ) : null}
                  {lastTrayToolLocked ? (
                    <p id={trayMatchMinHintId} className={cn('m-0', settingHintClass)}>
                      {t('settings.trayMatchToolsMin')}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className={cn('m-0 border-t border-border pt-3', settingHintClass)}>
                  {t('settings.trayMatchDisabledHint')}
                </p>
              )}
            </div>
          </SettingsGroup>
          <SettingsGroup title={t('settings.updates')} subtitle={t('settings.updatesSubtitle')}>
            <div className={settingStackClass}>
              <Setting
                label={t('settings.autoCheckUpdates')}
                description={t('settings.autoCheckUpdatesDesc')}
              >
                <SettingSwitch
                  selected={settings.autoCheckUpdates}
                  onChange={(value) => update('autoCheckUpdates', value)}
                />
              </Setting>
              <Setting
                label={t('settings.currentVersion')}
                description={version ? `v${version}` : undefined}
              >
                <Button variant="outline" disabled={checking} onClick={() => void checkUpdates()}>
                  <ArrowsClockwise data-icon="inline-start" weight="duotone" />
                  {t(checking ? 'settings.checkingUpdates' : 'settings.checkUpdates')}
                </Button>
              </Setting>
            </div>
          </SettingsGroup>
          <SettingsGroup title={t('settings.privacy')} subtitle={t('settings.privacySubtitle')}>
            <Setting label={t('settings.history')} description={t('settings.historyDesc')}>
              <Button variant="destructive" onClick={() => setConfirmClear(true)}>
                <Trash data-icon="inline-start" weight="duotone" />
                {t('settings.clearHistory')}
              </Button>
            </Setting>
          </SettingsGroup>
          <SettingsGroup title={t('settings.about')} subtitle={t('settings.aboutSubtitle')}>
            <Setting label={t('settings.projectLink')} description={t('settings.projectLinkDesc')}>
              <Button variant="outline" onClick={() => void Browser.OpenURL(GITHUB_REPO_URL)}>
                <ArrowSquareOut data-icon="inline-start" weight="duotone" />
                {t('settings.openProject')}
              </Button>
            </Setting>
          </SettingsGroup>
          <SettingsGroup
            title={t('settings.application')}
            subtitle={t('settings.applicationSubtitle')}
          >
            <Setting label={t('settings.quit')} description={t('settings.quitDesc')}>
              <Button variant="outline" onClick={() => setConfirmQuit(true)}>
                <Power data-icon="inline-start" weight="duotone" />
                {t('settings.quit')}
              </Button>
            </Setting>
          </SettingsGroup>
        </ToolLayoutScrollableContent>
      </ToolLayout>
      <ClearHistoryDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={clearHistory}
      />
      <AlertDialog
        open={confirmQuit}
        onOpenChange={(open) => {
          if (!open && !quitting) setConfirmQuit(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('quitDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('quitDialog.body')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={quitting}>{t('quitDialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={quitting} onClick={() => void quitApp()}>
              {t('quitDialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
