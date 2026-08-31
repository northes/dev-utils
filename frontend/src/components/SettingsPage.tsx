import { cloneElement, isValidElement, useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
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
import type { Icon, ToolId } from './shared';
import { ClearHistoryDialog } from './HistoryPage';
import { Reveal, ToolLayout, ToolLayoutHeader, ToolLayoutScrollableContent } from './shared';
import { toast } from './ui/toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { GITHUB_REPO_URL } from '../repositoryUrl';
import { THEME_MODE_OPTIONS, THEME_OPTIONS, type ThemeMode } from '../theme';

export type ToolDefinition = {
  id: ToolId;
  nameKey: string;
  descriptionKey: string;
  icon: Icon;
  keywords: string;
};
type BooleanSettingKey = 'trayMatchEnabled' | 'autoOverwrite' | 'autoCheckUpdates';
function SettingSwitch({
  selected,
  onChange,
  isDisabled = false,
  ariaLabel,
}: {
  selected: boolean;
  onChange: (v: boolean) => void;
  isDisabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <Switch
      checked={selected}
      onCheckedChange={onChange}
      disabled={isDisabled}
      aria-label={ariaLabel}
      size="sm"
    />
  );
}
function SettingsGroup({
  title,
  subtitle,
  children,
  className = '',
  listClassName = '',
  flushSettingsSave,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  className?: string;
  listClassName?: string;
  flushSettingsSave?: () => Promise<void>;
}) {
  const isAbout = title === i18n.t('settings.about');
  const heading = (
    <div>
      <h2 className="mb-[5px] text-xs leading-[1.25] font-semibold tracking-[.01em] text-foreground">
        {title}
      </h2>
      <p className="m-0 text-[10px] leading-[1.5] text-muted-foreground">{subtitle}</p>
    </div>
  );
  return (
    <>
      <section
        className={`grid grid-cols-[minmax(0,1fr)_minmax(320px,520px)] gap-6 border-t border-border py-[18px] max-[700px]:grid-cols-1 max-[700px]:gap-2.5${className ? ` ${className}` : ''}`}
      >
        {heading}
        <div className={`settings-list min-w-0${listClassName ? ` ${listClassName}` : ''}`}>
          {children}
        </div>
      </section>
      {isAbout && (
        <section className="grid grid-cols-[minmax(0,1fr)_minmax(320px,520px)] gap-6 border-t border-border py-[18px] max-[700px]:grid-cols-1 max-[700px]:gap-2.5">
          <div>
            <h2 className="mb-[5px] text-xs leading-[1.25] font-semibold tracking-[.01em] text-foreground">
              {i18n.t('settings.application')}
            </h2>
            <p className="m-0 text-[10px] leading-[1.5] text-muted-foreground">
              {i18n.t('settings.applicationSubtitle')}
            </p>
          </div>
          <div className="settings-list min-w-0">
            <Setting label={i18n.t('settings.quit')} description={i18n.t('settings.quitDesc')}>
              <Button
                variant="destructive"
                onClick={() => {
                  void (flushSettingsSave?.() ?? Promise.resolve()).finally(() => {
                    void Application.Quit();
                  });
                }}
              >
                <Power data-icon="inline-start" weight="duotone" />
                {i18n.t('settings.quit')}
              </Button>
            </Setting>
          </div>
        </section>
      )}
    </>
  );
}
function Setting({
  label,
  description,
  children,
  className = '',
}: {
  label?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const child =
    isValidElement(children) && children.type === SettingSwitch
      ? cloneElement(
          children as React.ReactElement<{ ariaLabel?: string }>,
          label ? { ariaLabel: label } : {},
        )
      : children;
  return (
    <div
      className={`flex min-h-[46px] items-center justify-between gap-5${className ? ` ${className}` : ''}`}
    >
      {label && (
        <span className="flex flex-col gap-[3px]">
          <strong className="text-[11px] leading-[1.4] font-medium text-foreground">{label}</strong>
          {description && (
            <small className="text-[10px] leading-[1.4] text-muted-foreground">{description}</small>
          )}
        </span>
      )}
      {child}
    </div>
  );
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
  const [checking, setChecking] = useState(false);
  const [version, setVersion] = useState('');
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
  const toggleTrayTool = (tool: ToolId, value: boolean) =>
    setSettings((current) => {
      const selected = new Set(
        current.trayMatchTools ?? ['json', 'time', 'text', 'base64', 'diff', 'jwt', 'url'],
      );
      value ? selected.add(tool) : selected.delete(tool);
      return {
        ...current,
        trayMatchTools: tools.filter((item) => selected.has(item.id)).map((item) => item.id),
      };
    });
  const setThemeMode = (value: ThemeMode) =>
    setThemeModeWithTransition((current) => ({ ...current, themeMode: value }));
  const setLightTheme = (value: string) =>
    setSettings((current) => ({ ...current, lightTheme: value }));
  const setDarkTheme = (value: string) =>
    setSettings((current) => ({ ...current, darkTheme: value }));
  const setLanguage = (code: string) => {
    setSettings((current) => ({ ...current, language: code }));
    i18n.changeLanguage(code);
  };
  const trayTools = new Set(
    settings.trayMatchTools ?? ['json', 'time', 'text', 'base64', 'diff', 'jwt', 'url'],
  );
  const themeModeOptions = THEME_MODE_OPTIONS.map(({ id, labelKey }) => ({
    id,
    label: t(labelKey),
  }));
  const lightThemeOptions = THEME_OPTIONS.filter((option) => option.tone === 'light').map(
    ({ id, labelKey }) => ({
      id,
      label: t(labelKey),
    }),
  );
  const darkThemeOptions = THEME_OPTIONS.filter((option) => option.tone === 'dark').map(
    ({ id, labelKey }) => ({
      id,
      label: t(labelKey),
    }),
  );
  const clipboardSettings = (
    <SettingsGroup
      className="settings-group--clipboard"
      listClassName="flex flex-col gap-4 max-[700px]:gap-3"
      title={t('settings.clipboard')}
      subtitle={t('settings.clipboardSubtitle')}
    >
      <div className="clipboard-core-settings flex flex-col divide-y divide-border">
        <Setting label={t('settings.trayMatch')} description={t('settings.trayMatchDesc')}>
          <SettingSwitch
            selected={settings.trayMatchEnabled}
            onChange={(v) => update('trayMatchEnabled', v)}
          />
        </Setting>
        <Setting label={t('settings.autoOverwrite')} description={t('settings.autoOverwriteDesc')}>
          <SettingSwitch
            selected={settings.autoOverwrite}
            onChange={(v) => update('autoOverwrite', v)}
            isDisabled={!settings.trayMatchEnabled}
          />
        </Setting>
      </div>
      <div className="tray-match-tool-group m-0 border-0 border-t border-border pt-3">
        <div className="tray-match-tool-heading flex min-h-0 flex-col gap-0.5 border-0 pb-2">
          <strong className="text-[11px] leading-[1.4] font-medium text-foreground">
            {t('settings.trayMatchTools')}
          </strong>
          <small className="text-[10px] leading-[1.4] text-muted-foreground">
            {t('settings.trayMatchToolsDesc')}
          </small>
        </div>
        <div className="tray-match-tool-list grid grid-cols-2 gap-x-5 max-[700px]:grid-cols-1">
          {tools.map((tool) => (
            <Setting key={tool.id} label={t(tool.nameKey)}>
              <SettingSwitch
                selected={trayTools.has(tool.id)}
                onChange={(value) => toggleTrayTool(tool.id, value)}
                isDisabled={!settings.trayMatchEnabled}
              />
            </Setting>
          ))}
        </div>
      </div>
    </SettingsGroup>
  );
  return (
    <Reveal index={0} fill>
      <ToolLayout className="settings-page">
        <ToolLayoutHeader title={t('settings.title')} />
        <ToolLayoutScrollableContent>
          <SettingsGroup
            title={t('settings.appearance')}
            subtitle={t('settings.appearanceSubtitle')}
          >
            <div className="divide-y divide-border">
              <Setting label={t('settings.themeMode')} className="setting--appearance">
                <Select
                  items={themeModeOptions.map(({ id, label }) => ({ value: id, label }))}
                  value={settings.themeMode}
                  onValueChange={(value) => {
                    if (value) setThemeMode(value as ThemeMode);
                  }}
                >
                  <SelectTrigger
                    className="data-[size=default]:h-10 w-40 flex-none text-[11px]"
                    aria-label={t('settings.themeMode')}
                  >
                    <SelectValue>
                      {themeModeOptions.find((option) => option.id === settings.themeMode)?.label}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {themeModeOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Setting>
              <Setting label={t('settings.lightTheme')}>
                <Select
                  items={lightThemeOptions.map(({ id, label }) => ({ value: id, label }))}
                  value={settings.lightTheme}
                  onValueChange={(value) => {
                    if (value) setLightTheme(value);
                  }}
                >
                  <SelectTrigger
                    className="data-[size=default]:h-10 w-40 flex-none text-[11px]"
                    aria-label={t('settings.lightTheme')}
                  >
                    <SelectValue>
                      {lightThemeOptions.find((option) => option.id === settings.lightTheme)?.label}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {lightThemeOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Setting>
              <Setting label={t('settings.darkTheme')}>
                <Select
                  items={darkThemeOptions.map(({ id, label }) => ({ value: id, label }))}
                  value={settings.darkTheme}
                  onValueChange={(value) => {
                    if (value) setDarkTheme(value);
                  }}
                >
                  <SelectTrigger
                    className="data-[size=default]:h-10 w-40 flex-none text-[11px]"
                    aria-label={t('settings.darkTheme')}
                  >
                    <SelectValue>
                      {darkThemeOptions.find((option) => option.id === settings.darkTheme)?.label}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {darkThemeOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Setting>
              <Setting
                label={t('settings.adjustSidebar')}
                description={t('settings.adjustSidebarDesc')}
              >
                <Button
                  id="sidebar-manage-trigger"
                  variant="outline"
                  className="text-[11px]"
                  aria-expanded={sidebarManaging}
                  aria-controls="app-sidebar"
                  onClick={onToggleSidebarManage}
                >
                  <SidebarSimple data-icon="inline-start" weight="duotone" />
                  {t(sidebarManaging ? 'sidebar.done' : 'settings.adjustSidebar')}
                </Button>
              </Setting>
            </div>
          </SettingsGroup>
          <SettingsGroup title={t('settings.editor')} subtitle={t('settings.editorSubtitle')}>
            <Setting className="setting--choice">
              <div className="inline-flex h-10 rounded-lg border border-border bg-card p-[3px]">
                {[12, 14, 16, 18].map((size) => (
                  <Button
                    key={size}
                    variant="ghost"
                    className={`min-w-[76px] rounded-lg px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground ${(settings.codeEditorFontSize || 16) === size ? 'bg-muted text-foreground' : ''}`}
                    onClick={() =>
                      setSettings((current) => ({
                        ...current,
                        codeEditorFontSize: size,
                      }))
                    }
                  >
                    {size}px
                  </Button>
                ))}
              </div>
            </Setting>
          </SettingsGroup>
          <SettingsGroup title={t('settings.language')} subtitle={t('settings.languageSubtitle')}>
            <Setting className="setting--choice">
              <div className="inline-flex h-10 rounded-lg border border-border bg-card p-[3px]">
                {SUPPORTED_LANGUAGES.map((l) => (
                  <Button
                    key={l.code}
                    variant="ghost"
                    className={`min-w-[76px] rounded-lg px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground ${settings.language === l.code ? 'bg-muted text-foreground' : ''}`}
                    onClick={() => setLanguage(l.code)}
                  >
                    {t(l.labelKey)}
                  </Button>
                ))}
              </div>
            </Setting>
          </SettingsGroup>
          {clipboardSettings}
          <SettingsGroup title={t('settings.updates')} subtitle={t('settings.updatesSubtitle')}>
            <div className="divide-y divide-border">
              <Setting
                label={t('settings.autoCheckUpdates')}
                description={t('settings.autoCheckUpdatesDesc')}
              >
                <SettingSwitch
                  selected={settings.autoCheckUpdates}
                  onChange={(v) => update('autoCheckUpdates', v)}
                />
              </Setting>
              <Setting
                label={t('settings.currentVersion')}
                description={version ? `v${version}` : undefined}
              >
                <Button
                  variant="outline"
                  className="text-[11px]"
                  disabled={checking}
                  onClick={() => void checkUpdates()}
                >
                  <ArrowsClockwise data-icon="inline-start" weight="duotone" />
                  {t(checking ? 'settings.checkingUpdates' : 'settings.checkUpdates')}
                </Button>
              </Setting>
            </div>
          </SettingsGroup>
          <SettingsGroup title={t('settings.privacy')} subtitle={t('settings.privacySubtitle')}>
            <Setting label={t('settings.history')} description={t('settings.historyDesc')}>
              <Button
                variant="destructive"
                className="text-[11px]"
                onClick={() => setConfirmClear(true)}
              >
                <Trash data-icon="inline-start" weight="duotone" />
                {t('settings.clearHistory')}
              </Button>
            </Setting>
          </SettingsGroup>
          <SettingsGroup
            title={t('settings.about')}
            subtitle={t('settings.aboutSubtitle')}
            flushSettingsSave={flushSettingsSave}
          >
            <Setting label={t('settings.projectLink')} description={GITHUB_REPO_URL}>
              <Button
                variant="outline"
                className="text-[11px]"
                onClick={() => void Browser.OpenURL(GITHUB_REPO_URL)}
              >
                <ArrowSquareOut data-icon="inline-start" weight="duotone" />
                {t('settings.openProject')}
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
    </Reveal>
  );
}
