import {
  Fragment,
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import type { SetStateAction } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './components/ui/alert-dialog';
import { Button } from './components/ui/button';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from './components/ui/command';
import { Clipboard, Events } from '@wailsio/runtime';
import { useTranslation } from 'react-i18next';
import {
  BracketsCurly,
  CaretLeft as ArrowLeft,
  CaretRight as ArrowRight,
  ClipboardText,
  Clock,
  ClockCounterClockwise,
  Command as CommandIcon,
  FileCode,
  GearSix,
  GitDiff,
  Key,
  LinkSimple,
  SidebarSimple,
  TextAa,
  TextT,
} from '@phosphor-icons/react';
import type { HighlightMode } from './components/DiffTool';
import type { ToolDefinition } from './components/SettingsPage';
import { type HistoryItem, normalizeHistoryDetail } from './components/HistoryPage';
import {
  decodeBase64,
  decodeBase64Text,
  parseJsonLoose,
  type Icon,
  type PendingAction,
  type ToolId,
} from './components/shared';
import { parseTimeInput } from './utils/time';
import { parseSupportedUrl } from './utils/url';
import { toast, Toaster } from './components/ui/toast';
import UpdatePill from './components/UpdatePill';
import OverlayScrollbar from './components/OverlayScrollbar';
import {
  AppendHistory,
  ClearHistory,
  Get as GetConfig,
  GetHistoryContent,
  Save as SaveConfig,
} from '../bindings/changeme/configservice';
import { Log as LogFrontend } from '../bindings/changeme/logservice';
import { SetAutoCheckEnabled } from '../bindings/changeme/updateservice';
import type { Config as Settings } from '../bindings/changeme/models';
import { useLocation, useNavigate, useNavigationType } from 'react-router';
import { resolveTheme } from './theme';

type Page = 'settings' | 'history' | ToolId;
type SidebarMode = 'full' | 'icon' | 'hidden';
type PaletteContext = string;
type PaletteItem = {
  id: string;
  labelKey: string;
  groupKey: string;
  icon: Icon;
  keywords: string;
  page?: Page;
  tool?: ToolId;
  action?: string;
  mode?: string;
  target?: 'before' | 'after' | 'alternate';
  pane?: 'input' | 'result';
  subgroupKey?: string;
  needsInput?: boolean;
  context?: PaletteContext;
};
type TranslatablePaletteItem = PaletteItem & { label: string; group: string; subgroup: string };
type IndexedItem = TranslatablePaletteItem & { text: string; pinyin: string; initials: string };
type Romanize = (text: string) => string;

function logFrontend(message: string) {
  void LogFrontend(message).catch((error) => {
    console.error('[frontend] logservice failed', error);
  });
}

const defaultSettings: Settings = {
  trayMatchEnabled: true,
  trayMatchTools: ['json', 'time', 'text', 'base64', 'diff', 'jwt', 'url'],
  urlTrayMatchMigrated: true,
  autoOverwrite: false,
  autoCheckUpdates: true,
  language: 'zh-CN',
  sidebarMode: 'full',
  themeMode: 'dark',
  lightTheme: 'default-light',
  darkTheme: 'default-dark',
  diffHighlightMode: 'character',
  diffClipboardTargetMode: 'alternate',
  codeEditorFontSize: 16,
  timeResultOrder: [
    'local',
    'dateTime',
    'dateOnly',
    'zonedIso8601',
    'rfc3339',
    'utc',
    'compact',
    'underscore',
    'unixSeconds',
    'unixMilliseconds',
    'unixNanoseconds',
  ],
  hiddenTimeResults: [],
  jsonAutoFormatOnFill: true,
  jsonAutoFormatOnFillMigrated: true,
};
const JsonTool = lazy(() => import('./components/JsonTool'));
const TimeTool = lazy(() => import('./components/TimeTool'));
const TextTool = lazy(() => import('./components/TextTool'));
const Base64Tool = lazy(() => import('./components/Base64Tool'));
const DiffTool = lazy(() => import('./components/DiffTool'));
const JwtTool = lazy(() => import('./components/JwtTool'));
const UrlTool = lazy(() => import('./components/UrlTool'));
const SettingsPage = lazy(() => import('./components/SettingsPage'));
const HistoryPage = lazy(() => import('./components/HistoryPage'));
const tools: ToolDefinition[] = [
  {
    id: 'json' as const,
    nameKey: 'tools.json.name',
    descriptionKey: 'tools.json.description',
    icon: BracketsCurly,
    keywords: 'json format minify compare schema path',
  },
  {
    id: 'time' as const,
    nameKey: 'tools.time.name',
    descriptionKey: 'tools.time.description',
    icon: Clock,
    keywords: 'time timestamp date unix utc rfc iso',
  },
  {
    id: 'text' as const,
    nameKey: 'tools.text.name',
    descriptionKey: 'tools.text.description',
    icon: TextAa,
    keywords: 'text count trim spaces lines bytes',
  },
  {
    id: 'base64' as const,
    nameKey: 'tools.base64.name',
    descriptionKey: 'tools.base64.description',
    icon: FileCode,
    keywords: 'base64 encode decode text image data url 图片 编码 解码',
  },
  {
    id: 'diff' as const,
    nameKey: 'tools.diff.name',
    descriptionKey: 'tools.diff.description',
    icon: GitDiff,
    keywords: 'diff compare patch code text difference 差异 对比 比较',
  },
  {
    id: 'jwt' as const,
    nameKey: 'tools.jwt.name',
    descriptionKey: 'tools.jwt.description',
    icon: Key,
    keywords: 'jwt token decode header payload signature 令牌 解码 解析 签名',
  },
  {
    id: 'url' as const,
    nameKey: 'tools.url.name',
    descriptionKey: 'tools.url.description',
    icon: LinkSimple,
    keywords: 'url uri link query params hash path 地址 链接 参数 路径 哈希',
  },
];
const paletteItems: PaletteItem[] = [
  {
    id: 'nav:settings',
    labelKey: 'nav.settings',
    groupKey: 'groups.nav',
    icon: GearSix,
    keywords: 'settings preferences options 设置 配置 选项',
    page: 'settings',
  },
  {
    id: 'nav:history',
    labelKey: 'nav.history',
    groupKey: 'groups.nav',
    icon: ClockCounterClockwise,
    keywords: 'history recent log activity 历史 记录',
    page: 'history',
  },
  {
    id: 'open:json',
    labelKey: 'commands.openJson',
    groupKey: 'groups.tools',
    icon: BracketsCurly,
    keywords: 'json workspace 打开工具',
    page: 'json',
  },
  {
    id: 'open:time',
    labelKey: 'commands.openTime',
    groupKey: 'groups.tools',
    icon: Clock,
    keywords: 'time timestamp date 时间 打开工具',
    page: 'time',
  },
  {
    id: 'open:text',
    labelKey: 'commands.openText',
    groupKey: 'groups.tools',
    icon: TextAa,
    keywords: 'text toolkit 文本 打开工具',
    page: 'text',
  },
  {
    id: 'open:base64',
    labelKey: 'commands.openBase64',
    groupKey: 'groups.tools',
    icon: FileCode,
    keywords: 'base64 图片 文本 编码 解码 打开工具',
    page: 'base64',
  },
  {
    id: 'open:diff',
    labelKey: 'commands.openDiff',
    groupKey: 'groups.tools',
    icon: GitDiff,
    keywords: 'diff compare patch code text 差异 对比 比较 打开工具',
    page: 'diff',
  },
  {
    id: 'open:jwt',
    labelKey: 'commands.openJwt',
    groupKey: 'groups.tools',
    icon: Key,
    keywords: 'jwt token decode header payload signature 令牌 解码 解析 签名 打开工具',
    page: 'jwt',
  },
  {
    id: 'open:url',
    labelKey: 'commands.openUrl',
    groupKey: 'groups.tools',
    icon: LinkSimple,
    keywords: 'url uri link query params hash path 地址 链接 参数 路径 哈希 打开工具',
    page: 'url',
  },
  {
    id: 'paste',
    labelKey: 'commands.paste',
    groupKey: 'groups.tools',
    icon: ClipboardText,
    keywords: 'paste clipboard insert zhantie niantie zt 粘贴 剪贴板 插入',
    action: 'paste',
  },
  {
    id: 'json:format',
    labelKey: 'jsonTool.format',
    groupKey: 'tools.json.name',
    icon: BracketsCurly,
    keywords: 'format pretty indent beautify 格式化 美化',
    tool: 'json',
    action: 'format',
  },
  {
    id: 'json:autoFormatOnFill',
    labelKey: 'commands.toggleAutoFormatOnFill',
    groupKey: 'tools.json.name',
    icon: BracketsCurly,
    keywords: 'auto format fill paste pretty 切换 填入 自动 格式化',
    tool: 'json',
    action: 'autoFormatOnFill',
  },
  {
    id: 'json:minify',
    labelKey: 'jsonTool.minify',
    groupKey: 'tools.json.name',
    icon: BracketsCurly,
    keywords: 'minify compact uglify 压缩 精简 缩小',
    tool: 'json',
    action: 'minify',
  },
  {
    id: 'json:copy',
    labelKey: 'jsonTool.copy',
    groupKey: 'tools.json.name',
    icon: BracketsCurly,
    keywords: 'copy json clipboard 复制 拷贝 剪贴板',
    tool: 'json',
    action: 'copy',
  },
  {
    id: 'json:clear',
    labelKey: 'jsonTool.clear',
    groupKey: 'tools.json.name',
    icon: BracketsCurly,
    keywords: 'clear reset empty 清空 重置',
    tool: 'json',
    action: 'clear',
  },
  {
    id: 'json:schema',
    labelKey: 'commands.toggleSchema',
    groupKey: 'tools.json.name',
    icon: BracketsCurly,
    keywords: 'schema jsonpath path panel 切换 结构 路径 面板 侧栏',
    tool: 'json',
    action: 'schema',
  },
  {
    id: 'json:schema:copy',
    labelKey: 'jsonTool.copy',
    groupKey: 'tools.json.name',
    subgroupKey: 'jsonTool.schema',
    icon: BracketsCurly,
    keywords: 'schema copy result jsonpath 复制 结果',
    tool: 'json',
    action: 'copy',
    pane: 'result',
    context: 'json.schema',
  },
  {
    id: 'json:schema:clear',
    labelKey: 'jsonTool.clear',
    groupKey: 'tools.json.name',
    subgroupKey: 'jsonTool.schema',
    icon: BracketsCurly,
    keywords: 'schema clear result 清空 结果',
    tool: 'json',
    action: 'clear',
    pane: 'result',
    context: 'json.schema',
  },
  {
    id: 'json:schema:minify',
    labelKey: 'jsonTool.minify',
    groupKey: 'tools.json.name',
    subgroupKey: 'jsonTool.schema',
    icon: BracketsCurly,
    keywords: 'schema minify result 压缩 结果',
    tool: 'json',
    action: 'minify',
    pane: 'result',
    context: 'json.schema',
  },
  {
    id: 'json:schema:format',
    labelKey: 'jsonTool.format',
    groupKey: 'tools.json.name',
    subgroupKey: 'jsonTool.schema',
    icon: BracketsCurly,
    keywords: 'schema format result 格式化 结果',
    tool: 'json',
    action: 'format',
    pane: 'result',
    context: 'json.schema',
  },
  {
    id: 'json:workflow',
    labelKey: 'commands.toggleWorkflow',
    groupKey: 'tools.json.name',
    icon: BracketsCurly,
    keywords: 'workflow pipeline item transform rule 工作流 流程 规则 项目 转换',
    tool: 'json',
    action: 'workflow',
  },
  {
    id: 'json:workflow:addItem',
    labelKey: 'jsonTool.workflow.addItem',
    groupKey: 'tools.json.name',
    subgroupKey: 'jsonTool.workflow.title',
    icon: BracketsCurly,
    keywords: 'workflow add item step node rule 工作流 添加 节点 步骤 项目 规则',
    tool: 'json',
    action: 'workflowAddItem',
    context: 'json.workflow',
  },
  {
    id: 'json:workflow:import',
    labelKey: 'jsonTool.workflow.importConfig',
    groupKey: 'tools.json.name',
    subgroupKey: 'jsonTool.workflow.title',
    icon: BracketsCurly,
    keywords: 'workflow import config clipboard 工作流 导入 配置 剪贴板',
    tool: 'json',
    action: 'workflowImport',
    context: 'json.workflow',
  },
  {
    id: 'json:workflow:export',
    labelKey: 'jsonTool.workflow.exportConfig',
    groupKey: 'tools.json.name',
    subgroupKey: 'jsonTool.workflow.title',
    icon: BracketsCurly,
    keywords: 'workflow export config clipboard 工作流 导出 配置 剪贴板',
    tool: 'json',
    action: 'workflowExport',
    context: 'json.workflow',
  },
  {
    id: 'json:workflow:copy',
    labelKey: 'jsonTool.copy',
    groupKey: 'tools.json.name',
    subgroupKey: 'jsonTool.workflow.title',
    icon: BracketsCurly,
    keywords: 'workflow output copy result 工作流 输出 复制 结果',
    tool: 'json',
    action: 'workflowCopy',
    context: 'json.workflow',
  },
  {
    id: 'time:refresh',
    labelKey: 'timeTool.refresh',
    groupKey: 'tools.time.name',
    icon: Clock,
    keywords: 'time timestamp now refresh 时间戳 当前 插入 刷新',
    tool: 'time',
    action: 'refresh',
  },
  {
    id: 'time:timezone',
    labelKey: 'timeTool.useSystemTimezone',
    groupKey: 'tools.time.name',
    icon: Clock,
    keywords: 'time timezone system local 时区 系统 本机',
    tool: 'time',
    action: 'timezone',
  },
  {
    id: 'text:copy',
    labelKey: 'textTool.copy',
    groupKey: 'tools.text.name',
    icon: TextT,
    keywords: 'copy text clipboard 复制 拷贝 剪贴板',
    tool: 'text',
    action: 'copy',
  },
  {
    id: 'text:clear',
    labelKey: 'textTool.clear',
    groupKey: 'tools.text.name',
    icon: TextT,
    keywords: 'clear reset empty 清空 重置',
    tool: 'text',
    action: 'clear',
  },
  {
    id: 'text:trim',
    labelKey: 'textTool.trim',
    groupKey: 'tools.text.name',
    icon: TextT,
    keywords: 'trim whitespace 修剪 去除首尾空白',
    tool: 'text',
    action: 'trim',
  },
  {
    id: 'text:removeSpaces',
    labelKey: 'textTool.removeSpaces',
    groupKey: 'tools.text.name',
    icon: TextT,
    keywords: 'remove spaces 删除 空格',
    tool: 'text',
    action: 'removeSpaces',
  },
  {
    id: 'text:compress',
    labelKey: 'textTool.compressSpaces',
    groupKey: 'tools.text.name',
    icon: TextT,
    keywords: 'compress spaces collapse 修剪 空格',
    tool: 'text',
    action: 'compress',
  },
  {
    id: 'text:compressLine',
    labelKey: 'textTool.compressLine',
    groupKey: 'tools.text.name',
    icon: TextT,
    keywords: 'line newline one line 压缩 换行 一行',
    tool: 'text',
    action: 'compressLine',
  },
  {
    id: 'text:upper',
    labelKey: 'textTool.caseModes.upper',
    groupKey: 'tools.text.name',
    subgroupKey: 'textTool.case',
    icon: TextT,
    keywords: 'uppercase case 大写 转换',
    tool: 'text',
    action: 'upper',
  },
  {
    id: 'text:lower',
    labelKey: 'textTool.caseModes.lower',
    groupKey: 'tools.text.name',
    subgroupKey: 'textTool.case',
    icon: TextT,
    keywords: 'lowercase case 小写 转换',
    tool: 'text',
    action: 'lower',
  },
  {
    id: 'text:lineUpper',
    labelKey: 'textTool.caseModes.lineUpper',
    groupKey: 'tools.text.name',
    subgroupKey: 'textTool.case',
    icon: TextT,
    keywords: 'line case upper 行首 大写 转换',
    tool: 'text',
    action: 'lineUpper',
  },
  {
    id: 'text:lineLower',
    labelKey: 'textTool.caseModes.lineLower',
    groupKey: 'tools.text.name',
    subgroupKey: 'textTool.case',
    icon: TextT,
    keywords: 'line case lower 行首 小写 转换',
    tool: 'text',
    action: 'lineLower',
  },
  {
    id: 'text:wordUpper',
    labelKey: 'textTool.caseModes.wordUpper',
    groupKey: 'tools.text.name',
    subgroupKey: 'textTool.case',
    icon: TextT,
    keywords: 'word case upper 词首 单词 大写 转换',
    tool: 'text',
    action: 'wordUpper',
  },
  {
    id: 'text:wordLower',
    labelKey: 'textTool.caseModes.wordLower',
    groupKey: 'tools.text.name',
    subgroupKey: 'textTool.case',
    icon: TextT,
    keywords: 'word case lower 词首 单词 小写 转换',
    tool: 'text',
    action: 'wordLower',
  },
  {
    id: 'base64:clear',
    labelKey: 'base64Tool.clear',
    groupKey: 'tools.base64.name',
    icon: FileCode,
    keywords: 'clear reset empty 清空 重置',
    tool: 'base64',
    action: 'clear',
  },
  {
    id: 'base64:copy',
    labelKey: 'base64Tool.copy',
    groupKey: 'tools.base64.name',
    icon: FileCode,
    keywords: 'copy base64 clipboard result 复制 拷贝 剪贴板 结果',
    tool: 'base64',
    action: 'copy',
  },
  {
    id: 'jwt:clear',
    labelKey: 'jwtTool.clear',
    groupKey: 'tools.jwt.name',
    icon: Key,
    keywords: 'clear reset empty 清空 重置',
    tool: 'jwt',
    action: 'clear',
  },
  {
    id: 'jwt:copyHeader',
    labelKey: 'jwtTool.copyHeader',
    groupKey: 'tools.jwt.name',
    icon: Key,
    keywords: 'copy header 复制 头',
    tool: 'jwt',
    action: 'copyHeader',
  },
  {
    id: 'jwt:copyPayload',
    labelKey: 'jwtTool.copyPayload',
    groupKey: 'tools.jwt.name',
    icon: Key,
    keywords: 'copy payload 复制 载荷 数据 负载',
    tool: 'jwt',
    action: 'copyPayload',
  },
  {
    id: 'jwt:copySignature',
    labelKey: 'jwtTool.copySignature',
    groupKey: 'tools.jwt.name',
    icon: Key,
    keywords: 'copy signature 复制 签名',
    tool: 'jwt',
    action: 'copySignature',
  },
  {
    id: 'url:clear',
    labelKey: 'urlTool.clear',
    groupKey: 'tools.url.name',
    icon: LinkSimple,
    keywords: 'clear reset empty 清空 重置',
    tool: 'url',
    action: 'clear',
  },
  {
    id: 'url:copy',
    labelKey: 'urlTool.copy',
    groupKey: 'tools.url.name',
    icon: LinkSimple,
    keywords: 'copy result clipboard 复制 结果 剪贴板',
    tool: 'url',
    action: 'copy',
  },
  {
    id: 'diff:swap',
    labelKey: 'diffTool.swap',
    groupKey: 'tools.diff.name',
    icon: GitDiff,
    keywords: 'swap exchange 交换 对调',
    tool: 'diff',
    action: 'swap',
  },
  {
    id: 'diff:clear',
    labelKey: 'diffTool.clear',
    groupKey: 'tools.diff.name',
    icon: GitDiff,
    keywords: 'clear reset 清空 重置',
    tool: 'diff',
    action: 'clear',
  },
  {
    id: 'diff:highlightWordAlt',
    labelKey: 'diffTool.modes.word-alt',
    groupKey: 'tools.diff.name',
    subgroupKey: 'diffTool.highlightMode',
    icon: GitDiff,
    keywords: 'highlight mode word alt 高亮 按词 交替',
    tool: 'diff',
    action: 'highlight',
    mode: 'word-alt',
  },
  {
    id: 'diff:highlightWord',
    labelKey: 'diffTool.modes.word',
    groupKey: 'tools.diff.name',
    subgroupKey: 'diffTool.highlightMode',
    icon: GitDiff,
    keywords: 'highlight mode word 高亮 按词',
    tool: 'diff',
    action: 'highlight',
    mode: 'word',
  },
  {
    id: 'diff:highlightCharacter',
    labelKey: 'diffTool.modes.character',
    groupKey: 'tools.diff.name',
    subgroupKey: 'diffTool.highlightMode',
    icon: GitDiff,
    keywords: 'highlight mode character 高亮 按字符 逐字',
    tool: 'diff',
    action: 'highlight',
    mode: 'character',
  },
  {
    id: 'diff:highlightNone',
    labelKey: 'diffTool.modes.none',
    groupKey: 'tools.diff.name',
    subgroupKey: 'diffTool.highlightMode',
    icon: GitDiff,
    keywords: 'highlight mode none off 高亮 关闭',
    tool: 'diff',
    action: 'highlight',
    mode: 'none',
  },
  {
    id: 'diff:fillAlternate',
    labelKey: 'diffTool.targets.alternate',
    groupKey: 'tools.diff.name',
    subgroupKey: 'diffTool.clipboardTarget',
    icon: GitDiff,
    keywords: 'clipboard fill alternate 剪贴板 填入 交替',
    tool: 'diff',
    action: 'fill',
    target: 'alternate',
    needsInput: true,
  },
  {
    id: 'diff:fillBefore',
    labelKey: 'diffTool.targets.before',
    groupKey: 'tools.diff.name',
    subgroupKey: 'diffTool.clipboardTarget',
    icon: GitDiff,
    keywords: 'clipboard fill before 剪贴板 填入 原始 内容',
    tool: 'diff',
    action: 'fill',
    target: 'before',
    needsInput: true,
  },
  {
    id: 'diff:fillAfter',
    labelKey: 'diffTool.targets.after',
    groupKey: 'tools.diff.name',
    subgroupKey: 'diffTool.clipboardTarget',
    icon: GitDiff,
    keywords: 'clipboard fill after 剪贴板 填入 修改 内容',
    tool: 'diff',
    action: 'fill',
    target: 'after',
    needsInput: true,
  },
];
function loadValue<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || '') as T;
  } catch {
    return fallback;
  }
}
function pageFromPath(path: string): Page {
  const value = path.replace(/^\/+/, '');
  if (value === 'settings' || value === 'history' || tools.some((tool) => tool.id === value))
    return value as Page;
  const last = loadValue<string>('devutils.lastPage', '');
  if (last === 'settings' || last === 'history' || tools.some((tool) => tool.id === last))
    return last as Page;
  return tools[0].id as Page;
}
function routePath(page: Page) {
  return `/${page}`;
}
function isPage(value: unknown): value is Page {
  return value === 'settings' || value === 'history' || tools.some((tool) => tool.id === value);
}
function historyIndex() {
  const index = window.history.state?.idx;
  return typeof index === 'number' ? index : 0;
}
function detectBase64(s: string): 'text' | 'image' | null {
  const data = /^data:[^,]+;base64,([A-Za-z0-9+/_=-]+)$/i.exec(s);
  const raw = data?.[1] ?? s;
  const isDataUrl = Boolean(data);
  if (
    raw.length < 4 ||
    raw.length > 16 * 1024 * 1024 ||
    raw.includes('.') ||
    !/^[A-Za-z0-9+/_-]+={0,2}$/.test(raw)
  )
    return null;
  const decoded = decodeBase64(raw);
  if (decoded === null) return null;
  try {
    const bytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
    const image =
      bytes.length > 8 &&
      ((bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) ||
        (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
        String.fromCharCode(...bytes.slice(0, 6)).startsWith('GIF') ||
        String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP');
    if (image) return 'image';
    return isDataUrl || decodeBase64Text(raw) !== null ? 'text' : null;
  } catch {
    return null;
  }
}
function detectJwt(s: string): boolean {
  const parts = s.trim().split('.');
  if (parts.length !== 3) return false;
  const object = (seg: string) => {
    const d = decodeBase64Text(seg);
    if (d === null) return false;
    try {
      const v = JSON.parse(d);
      return v !== null && typeof v === 'object' && !Array.isArray(v);
    } catch {
      return false;
    }
  };
  return object(parts[0]) && object(parts[1]);
}
function fuzzyScore(text: string, q: string): number {
  let m = 0,
    score = 0,
    streak = 0,
    prev = -1;
  for (let i = 0; i < q.length; i++) {
    const idx = text.indexOf(q[i], m);
    if (idx < 0) return -1;
    if (prev !== -1 && idx === prev + 1) {
      streak++;
      score += 3 + streak * 2;
    } else {
      streak = 0;
      score += 1 + (idx === 0 ? 4 : 0);
    }
    prev = idx;
    m = idx + 1;
  }
  return score + (m === text.length ? 2 : 0);
}
function buildIndex(items: TranslatablePaletteItem[], romanize: Romanize): IndexedItem[] {
  return items.map((item) => {
    const raw = `${item.label} ${item.group} ${item.subgroup} ${item.keywords}`.toLowerCase();
    const text = raw.replace(/\s+/g, '');
    let initials = '';
    for (const word of raw.split(/\s+/)) {
      if (/^[a-z0-9]+$/.test(word)) {
        if (word.length <= 2) initials += word;
      } else {
        for (const c of word) {
          const s = romanize(c);
          if (s) initials += s[0];
        }
      }
    }
    return { ...item, text, pinyin: romanize(text), initials };
  });
}

function AppShell() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigationType = useNavigationType();
  const routerNavigate = useNavigate();
  const workspaceRef = useRef<HTMLElement>(null);
  const page = pageFromPath(location.pathname);
  const [visited, setVisited] = useState<Set<Page>>(() => new Set([page]));
  const pageRef = useRef<Page>(page);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [romanize, setRomanize] = useState<Romanize>(() => (text) => text);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [jsonSchemaOpen, setJsonSchemaOpen] = useState(false);
  const [jsonWorkflowOpen, setJsonWorkflowOpen] = useState(false);
  const [matchDialog, setMatchDialog] = useState<null | {
    tool: ToolId;
    input: string;
    mode?: string;
    target?: 'before' | 'after';
  }>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [systemDark, setSystemDark] = useState(
    () =>
      typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const nextDiffTarget = useRef<'before' | 'after'>('before');
  const settingsReady = useRef(false);
  const lastFocusedRef = useRef<Element | null>(null);
  const theme = resolveTheme(
    settings.themeMode,
    settings.lightTheme,
    settings.darkTheme,
    systemDark,
  );
  const setSettingsWithThemeTransition = (update: SetStateAction<Settings>) => {
    const current = settingsRef.current;
    const next = typeof update === 'function' ? update(current) : update;
    const nextTheme = resolveTheme(next.themeMode, next.lightTheme, next.darkTheme, systemDark);
    if (nextTheme === theme) {
      setSettings(next);
      return;
    }
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const viewTransitionDocument = document as Document & {
      startViewTransition?: (updateCallback: () => void) => unknown;
    };
    if (!viewTransitionDocument.startViewTransition || reducedMotion) {
      setSettings(next);
      return;
    }
    viewTransitionDocument.startViewTransition(() => flushSync(() => setSettings(next)));
  };
  const currentHistoryIndex = historyIndex();
  const [maxHistoryIndex, setMaxHistoryIndex] = useState(currentHistoryIndex);
  const canGoBack = currentHistoryIndex > 0;
  const canGoForward = currentHistoryIndex < maxHistoryIndex;
  const dismissOverlays = () => {
    closePalette();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  };
  const navigatePage = (next: Page) => {
    logFrontend(`[route] navigatePage from=${page} to=${next}`);
    routerNavigate(routePath(next));
    dismissOverlays();
  };
  const navigate = navigatePage;
  useEffect(() => {
    const next = pageFromPath(location.pathname);
    logFrontend(
      `[route] location pathname=${location.pathname} key=${location.key} type=${navigationType} page=${next}`,
    );
    if (location.pathname !== routePath(next)) routerNavigate(routePath(next), { replace: true });
  }, [location.key, location.pathname, navigationType, routerNavigate]);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const dark = theme.endsWith('-dark');
    root.classList.toggle('dark', dark);
    root.dataset.theme = theme;
    root.style.colorScheme = dark ? 'dark' : 'light';
    root.style.setProperty('--code-editor-font-size', `${settings.codeEditorFontSize || 16}px`);
  }, [theme, settings.codeEditorFontSize]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    setSystemDark(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  useEffect(() => {
    if (settings.language && i18n.language !== settings.language)
      i18n.changeLanguage(settings.language);
  }, [i18n, settings.language]);
  useEffect(() => {
    if (!paletteOpen || romanize('中') !== '中') return;
    void import('pinyin-pro').then(({ pinyin }) =>
      setRomanize(
        () => (text) =>
          pinyin(text, { toneType: 'none', type: 'array' })
            .join('')
            .replace(/\s+/g, '')
            .toLowerCase(),
      ),
    );
  }, [paletteOpen, romanize]);
  useEffect(() => {
    pageRef.current = page;
    setVisited((current) => (current.has(page) ? current : new Set(current).add(page)));
  }, [page]);
  useEffect(() => {
    setMaxHistoryIndex((current) => {
      const next =
        navigationType === 'PUSH' ? currentHistoryIndex : Math.max(current, currentHistoryIndex);
      return current === next ? current : next;
    });
  }, [currentHistoryIndex, location.key, navigationType]);
  useEffect(() => {
    void Events.On('navigate', (event) => {
      logFrontend(`[event] navigate data=${String(event.data)}`);
      if (isPage(event.data)) navigatePage(event.data);
    });
  }, []);
  useEffect(() => {
    const off = Events.On('mouse:navigate', (event) => {
      logFrontend(`[event] mouse:navigate data=${String(event.data)}`);
      if (event.data === 'back') routerNavigate(-1);
      if (event.data === 'forward') routerNavigate(1);
    });
    const onMouse = (event: MouseEvent) => {
      if (event.button === 3 || event.button === 4)
        logFrontend(`[dom] mouse button=${event.button} type=${event.type}`);
    };
    window.addEventListener('mousedown', onMouse);
    window.addEventListener('mouseup', onMouse);
    return () => {
      off();
      window.removeEventListener('mousedown', onMouse);
      window.removeEventListener('mouseup', onMouse);
    };
  }, [routerNavigate]);
  useEffect(() => {
    const onSchema = (event: Event) => setJsonSchemaOpen((event as CustomEvent<boolean>).detail);
    window.addEventListener('devutils:json-schema', onSchema);
    return () => window.removeEventListener('devutils:json-schema', onSchema);
  }, []);
  useEffect(() => {
    const onWorkflow = (event: Event) =>
      setJsonWorkflowOpen((event as CustomEvent<boolean>).detail);
    window.addEventListener('devutils:json-workflow', onWorkflow);
    return () => window.removeEventListener('devutils:json-workflow', onWorkflow);
  }, []);
  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      routerNavigate(event.button === 3 ? -1 : 1);
    };
    window.addEventListener('mousedown', onMouseDown, true);
    return () => window.removeEventListener('mousedown', onMouseDown, true);
  }, [routerNavigate]);
  useEffect(() => {
    const off = Events.On('tray:analyze', () => {
      void analyzeClipboard();
    });
    return () => off();
  }, []);
  useLayoutEffect(() => workspaceRef.current?.scrollTo(0, 0), [page]);
  useEffect(() => {
    GetConfig()
      .then((c) => {
        settingsReady.current = true;
        setSettings(c);
      })
      .catch(() => {
        settingsReady.current = true;
      });
  }, []);
  useEffect(() => {
    if (!settingsReady.current) return;
    void SaveConfig(settings);
    void SetAutoCheckEnabled(settings.autoCheckUpdates);
  }, [settings]);
  useEffect(() => {
    localStorage.setItem('devutils.lastPage', JSON.stringify(page));
  }, [page]);
  const sidebarMode = (settings.sidebarMode as SidebarMode) || 'full';
  const indexed = useMemo(() => {
    const isTool = tools.some((tool) => tool.id === page);
    const contexts = new Set<PaletteContext>();
    if (jsonSchemaOpen && page === 'json') contexts.add('json.schema');
    if (jsonWorkflowOpen && page === 'json') contexts.add('json.workflow');
    const items = paletteItems.filter(
      (item) =>
        (!isTool || !item.tool || item.tool === page) &&
        (!item.context || contexts.has(item.context)),
    );
    return buildIndex(
      items.map((item) => ({
        ...item,
        label: t(item.labelKey),
        group: t(item.groupKey),
        subgroup: item.subgroupKey ? t(item.subgroupKey) : '',
      })),
      romanize,
    );
  }, [t, jsonSchemaOpen, jsonWorkflowOpen, page, romanize]);
  const record = (
    tool: ToolId,
    action: string,
    detail: string,
    input: string,
    output = '',
    meta?: { mode?: string; mediaType?: string; name?: string; bytes?: number },
  ) => {
    void AppendHistory({
      tool,
      action,
      detail: normalizeHistoryDetail(detail),
      mode: meta?.mode ?? '',
      mediaType: meta?.mediaType ?? '',
      name: meta?.name ?? '',
      bytes: meta?.bytes ?? new TextEncoder().encode(input).length,
      input,
      output,
    }).catch(() => toast.add({ title: t('toast.historyFailed'), type: 'error' }));
  };
  const openHistory = async (item: HistoryItem) => {
    try {
      const content = await GetHistoryContent(item.id);
      setPending({
        tool: item.tool,
        action: 'restore',
        input: content.input,
        output: content.output,
        mode: item.mode,
      });
      navigate(item.tool);
    } catch {
      toast.add({ title: t('toast.historyFailed'), type: 'error' });
    }
  };
  const clearHistory = () => {
    void ClearHistory().catch(() => toast.add({ title: t('toast.historyFailed'), type: 'error' }));
  };
  const cycleSidebar = () =>
    setSettings((s) => ({
      ...s,
      sidebarMode: s.sidebarMode === 'full' ? 'icon' : s.sidebarMode === 'icon' ? 'hidden' : 'full',
    }));
  const openPalette = () => {
    lastFocusedRef.current = document.activeElement;
    setPaletteOpen(true);
  };
  const closePalette = () => {
    setPaletteOpen(false);
    requestAnimationFrame(() => {
      const el = lastFocusedRef.current;
      if (el instanceof HTMLElement) el.focus();
    });
  };
  const pasteIntoFocused = async () => {
    setPaletteOpen(false);
    const text = (await Clipboard.Text().catch(() => '')) || '';
    if (!text.trim()) {
      toast.add({
        title: t('toast.clipboardEmpty'),
        description: t('toast.clipboardEmptyDesc'),
        type: 'warning',
      });
      return;
    }
    const target = lastFocusedRef.current;
    if (
      !(target instanceof HTMLElement) ||
      (!target.isContentEditable && target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA')
    ) {
      toast.add({ title: t('toast.pasteTarget'), type: 'warning' });
      return;
    }
    requestAnimationFrame(() => {
      target.focus();
      document.execCommand('insertText', false, text);
      if (target.closest('.json-input-cm'))
        window.dispatchEvent(new CustomEvent('devutils:json-after-fill'));
    });
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (!paletteOpen) lastFocusedRef.current = document.activeElement;
        setPaletteOpen((open) => !open);
      } else if (event.key === 'Escape' && paletteOpen) closePalette();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, closePalette]);
  const run = (item: IndexedItem) => {
    if (item.action === 'paste') {
      void pasteIntoFocused();
      return;
    }
    setPaletteOpen(false);
    if (!item.tool) {
      setPending(null);
      navigate(item.page!);
      return;
    }
    const tool = item.tool;
    const action = item.action ?? 'open';
    const needsInput = !!item.needsInput;
    const apply = async () => {
      let input = '';
      if (needsInput) {
        input = (await Clipboard.Text().catch(() => '')) || '';
        if (!input.trim()) {
          setPending(null);
          navigate(tool);
          toast.add({
            title: t('toast.clipboardEmpty'),
            description: t('toast.clipboardEmptyDesc'),
            type: 'warning',
          });
          return;
        }
      }
      if (tool === 'diff' && action === 'fill' && item.target === 'alternate') {
        const t = nextDiffTarget.current;
        nextDiffTarget.current = t === 'before' ? 'after' : 'before';
        setPending({ tool, action, input, target: t });
        navigate(tool);
        return;
      }
      setPending({
        tool,
        action,
        input,
        mode: item.mode,
        target: item.target === 'alternate' ? undefined : item.target,
        pane: item.pane,
      });
      navigate(tool);
    };
    apply();
  };
  const analyzeClipboard = async () => {
    if (!settingsRef.current.trayMatchEnabled) return;
    const text = (await Clipboard.Text().catch(() => '')) || '';
    const currentSettings = settingsRef.current;
    if (!currentSettings.trayMatchEnabled) return;
    const s = text.trim();
    if (!s) return;
    const currentPage = pageRef.current;
    const trayTools = new Set(
      currentSettings.trayMatchTools ?? ['json', 'time', 'text', 'base64', 'diff', 'jwt', 'url'],
    );
    let tool: ToolId | null = null;
    let mode: string | undefined;
    let target: 'before' | 'after' | undefined;
    if (currentPage === 'diff') {
      tool = 'diff';
      target =
        currentSettings.diffClipboardTargetMode === 'before'
          ? 'before'
          : currentSettings.diffClipboardTargetMode === 'after'
            ? 'after'
            : nextDiffTarget.current;
    } else {
      const parsedTime = parseTimeInput(s);
      if (parsedTime && trayTools.has('time')) tool = 'time';
      else if (trayTools.has('url') && parseSupportedUrl(s)) tool = 'url';
      else if (trayTools.has('jwt') && detectJwt(s)) tool = 'jwt';
      else {
        mode = detectBase64(s) ?? undefined;
        if (mode && trayTools.has('base64')) tool = 'base64';
        else
          try {
            parseJsonLoose(s);
            if (trayTools.has('json')) tool = 'json';
          } catch {}
        if (!tool && trayTools.has('text')) tool = 'text';
      }
    }
    if (!tool) return;
    const apply = (match: {
      tool: ToolId;
      input: string;
      mode?: string;
      target?: 'before' | 'after';
    }) => {
      if (
        match.tool === 'diff' &&
        match.target &&
        currentSettings.diffClipboardTargetMode === 'alternate'
      )
        nextDiffTarget.current = match.target === 'before' ? 'after' : 'before';
      setPending({
        tool: match.tool,
        action: 'open',
        input: match.input,
        mode: match.mode,
        target: match.target,
      });
      navigate(match.tool);
      toast.add({
        title: t('toast.trayAutoFilled', { tool: t(`tools.${match.tool}.name`) }),
        type: 'success',
      });
    };
    const match = { tool, input: text, mode, target };
    if (currentSettings.autoOverwrite) apply(match);
    else setMatchDialog(match);
  };
  return (
    <>
      <Toaster />
      <OverlayScrollbar />
      <div className="app-shell relative grid h-dvh grid-rows-[38px_minmax(0,1fr)] bg-background">
        <div className="ambient pointer-events-none absolute inset-0 z-0" />
        <header
          className="titlebar relative z-[2] flex h-full items-center border-b border-border bg-background px-4 pl-[76px] [--wails-draggable:drag]"
          data-wails-drag
        >
          <Button
            variant="ghost"
            size="icon-sm"
            className="sidebar-toggle relative top-px flex-none self-center rounded-lg text-muted-foreground [--wails-draggable:no-drag] hover:bg-muted hover:text-foreground"
            onClick={cycleSidebar}
            aria-label={t('sidebar.toggle')}
            title={t('sidebar.toggle')}
          >
            <SidebarSimple size={16} weight="duotone" />
          </Button>
          <div className="titlebar-navigation relative top-px ml-1 flex h-7 items-center gap-0.5 self-center [--wails-draggable:no-drag]">
            <Button
              variant="ghost"
              disabled={!canGoBack}
              size="icon-sm"
              className="titlebar-navigation-button flex-none text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-[15px]"
              onClick={() => routerNavigate(-1)}
              aria-label={t('titlebar.back')}
              title={t('titlebar.back')}
            >
              <ArrowLeft size={15} weight="duotone" />
            </Button>
            <Button
              variant="ghost"
              disabled={!canGoForward}
              size="icon-sm"
              className="titlebar-navigation-button flex-none text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-[15px]"
              onClick={() => routerNavigate(1)}
              aria-label={t('titlebar.forward')}
              title={t('titlebar.forward')}
            >
              <ArrowRight size={15} weight="duotone" />
            </Button>
          </div>
          <UpdatePill />
        </header>
        <div
          className={`main relative z-[1] grid min-h-0 ${sidebarMode === 'hidden' ? 'grid-cols-[0px_minmax(0,1fr)] [&_.sidebar]:invisible [&_.sidebar]:overflow-hidden' : sidebarMode === 'icon' ? 'grid-cols-[56px_minmax(0,1fr)] [&_.sidebar]:overflow-hidden [&_.sidebar]:pt-3 [&_.sidebar-heading]:hidden [&_.sidebar-item]:justify-center [&_.sidebar-item]:px-0 [&_.sidebar-item_span]:hidden [&_.sidebar-palette_kbd]:hidden [&_.sidebar-palette_span]:hidden [&_.sidebar-palette]:justify-center' : 'grid-cols-[232px_minmax(0,1fr)]'}`}
        >
          <Sidebar page={page} onNavigate={navigate} onOpenPalette={openPalette} />
          <main
            className={`workspace relative min-h-0 w-full overflow-x-hidden overflow-y-auto bg-background${tools.some((tool) => tool.id === page) || page === 'history' || page === 'settings' ? ' overflow-y-hidden' : ''}`}
            ref={workspaceRef}
          >
            {' '}
            <div
              className={`tool-slot h-full min-h-0 overflow-hidden${page === 'json' ? '' : ' is-hidden absolute inset-0 invisible pointer-events-none'}`}
            >
              {visited.has('json') && (
                <Suspense fallback={null}>
                  <JsonTool
                    active={page === 'json'}
                    theme={theme}
                    autoFormatOnFill={settings.jsonAutoFormatOnFill !== false}
                    onAutoFormatOnFillChange={(jsonAutoFormatOnFill) =>
                      setSettings((current) => ({ ...current, jsonAutoFormatOnFill }))
                    }
                    record={record}
                    pending={pending}
                    clearPending={() => setPending(null)}
                  />
                </Suspense>
              )}
            </div>
            <div
              className={`tool-slot h-full min-h-0 overflow-hidden${page === 'time' ? '' : ' is-hidden absolute inset-0 invisible pointer-events-none'}`}
            >
              {visited.has('time') && (
                <Suspense fallback={null}>
                  <TimeTool
                    active={page === 'time'}
                    resultOrder={settings.timeResultOrder ?? []}
                    hiddenResults={settings.hiddenTimeResults ?? []}
                    onSaveResults={(timeResultOrder, hiddenTimeResults) =>
                      setSettings((current) => ({ ...current, timeResultOrder, hiddenTimeResults }))
                    }
                    record={record}
                    pending={pending}
                    clearPending={() => setPending(null)}
                  />
                </Suspense>
              )}
            </div>
            <div
              className={`tool-slot h-full min-h-0 overflow-hidden${page === 'text' ? '' : ' is-hidden absolute inset-0 invisible pointer-events-none'}`}
            >
              {visited.has('text') && (
                <Suspense fallback={null}>
                  <TextTool
                    active={page === 'text'}
                    theme={theme}
                    record={record}
                    pending={pending}
                    clearPending={() => setPending(null)}
                  />
                </Suspense>
              )}
            </div>
            <div
              className={`tool-slot h-full min-h-0 overflow-hidden${page === 'base64' ? '' : ' is-hidden absolute inset-0 invisible pointer-events-none'}`}
            >
              {visited.has('base64') && (
                <Suspense fallback={null}>
                  <Base64Tool
                    active={page === 'base64'}
                    theme={theme}
                    record={record}
                    pending={pending}
                    clearPending={() => setPending(null)}
                  />
                </Suspense>
              )}
            </div>
            <div
              className={`tool-slot h-full min-h-0 overflow-hidden${page === 'diff' ? '' : ' is-hidden absolute inset-0 invisible pointer-events-none'}`}
            >
              {visited.has('diff') && (
                <Suspense fallback={null}>
                  <DiffTool
                    active={page === 'diff'}
                    theme={theme}
                    highlightMode={settings.diffHighlightMode}
                    onHighlightModeChange={(diffHighlightMode: HighlightMode) =>
                      setSettings((current) => ({ ...current, diffHighlightMode }))
                    }
                    clipboardTargetMode={settings.diffClipboardTargetMode}
                    onClipboardTargetModeChange={(diffClipboardTargetMode) =>
                      setSettings((current) => ({ ...current, diffClipboardTargetMode }))
                    }
                    record={record}
                    pending={pending}
                    clearPending={() => setPending(null)}
                  />
                </Suspense>
              )}
            </div>
            <div
              className={`tool-slot h-full min-h-0 overflow-hidden${page === 'jwt' ? '' : ' is-hidden absolute inset-0 invisible pointer-events-none'}`}
            >
              {visited.has('jwt') && (
                <Suspense fallback={null}>
                  <JwtTool
                    active={page === 'jwt'}
                    record={record}
                    pending={pending}
                    clearPending={() => setPending(null)}
                  />
                </Suspense>
              )}
            </div>
            <div
              className={`tool-slot h-full min-h-0 overflow-hidden${page === 'url' ? '' : ' is-hidden absolute inset-0 invisible pointer-events-none'}`}
            >
              {visited.has('url') && (
                <Suspense fallback={null}>
                  <UrlTool
                    active={page === 'url'}
                    theme={theme}
                    record={record}
                    pending={pending}
                    clearPending={() => setPending(null)}
                  />
                </Suspense>
              )}
            </div>
            <div
              className={`tool-slot h-full min-h-0 overflow-hidden${page === 'settings' ? '' : ' is-hidden absolute inset-0 invisible pointer-events-none'}`}
            >
              {page === 'settings' && (
                <Suspense fallback={null}>
                  <SettingsPage
                    settings={settings}
                    setSettings={setSettings}
                    setThemeMode={setSettingsWithThemeTransition}
                    tools={tools}
                    clearHistory={clearHistory}
                  />
                </Suspense>
              )}
            </div>
            <div
              className={`tool-slot h-full min-h-0 overflow-hidden${page === 'history' ? '' : ' is-hidden absolute inset-0 invisible pointer-events-none'}`}
            >
              {visited.has('history') && (
                <Suspense fallback={null}>
                  <HistoryPage
                    active={page === 'history'}
                    openHistory={openHistory}
                    clear={clearHistory}
                  />
                </Suspense>
              )}
            </div>
          </main>
        </div>
        <CommandPalette
          open={paletteOpen}
          onClose={closePalette}
          indexed={indexed}
          run={run}
          page={page}
        />
      </div>
      <AlertDialog
        open={matchDialog !== null}
        onOpenChange={(open) => {
          if (!open) setMatchDialog(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('matchDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('matchDialog.bodyPrefix')}
              <strong>{matchDialog ? t(`tools.${matchDialog.tool}.name`) : ''}</strong>
              {t('matchDialog.bodySuffix')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('matchDialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const d = matchDialog;
                setMatchDialog(null);
                if (d) {
                  if (
                    d.tool === 'diff' &&
                    d.target &&
                    settings.diffClipboardTargetMode === 'alternate'
                  )
                    nextDiffTarget.current = d.target === 'before' ? 'after' : 'before';
                  setPending({
                    tool: d.tool,
                    action: 'open',
                    input: d.input,
                    mode: d.mode,
                    target: d.target,
                  });
                  navigate(d.tool);
                }
              }}
            >
              {t('matchDialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function CommandPalette({
  open,
  onClose,
  indexed,
  run,
  page,
}: {
  open: boolean;
  onClose: () => void;
  indexed: IndexedItem[];
  run: (item: IndexedItem) => void;
  page: Page;
}) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) setInput('');
  }, [open]);
  useLayoutEffect(() => {
    if (open) listRef.current?.scrollTo({ top: 0, left: 0 });
  }, [open]);
  const matches = useMemo(() => {
    const q = input.trim().toLowerCase().replace(/\s+/g, '');
    if (!q) return null;
    const isEnglish = /^[a-z0-9]+$/i.test(q);
    const rank = (i: IndexedItem) => (i.tool && i.tool === page ? 0 : i.page ? 1 : 2);
    const labelHit = (i: IndexedItem) =>
      isEnglish && i.label.toLowerCase().replace(/\s+/g, '').includes(q) ? 1 : 0;
    const initialsHit = (i: IndexedItem) => (isEnglish && i.initials.includes(q) ? 1 : 0);
    const scored: Array<{ item: IndexedItem; score: number }> = [];
    for (const item of indexed) {
      const score = Math.max(
        fuzzyScore(item.text, q),
        fuzzyScore(item.pinyin, q) * 0.95,
        fuzzyScore(item.initials, q) * 0.9,
      );
      if (score > 0) scored.push({ item, score });
    }
    scored.sort(
      (a, b) =>
        labelHit(b.item) - labelHit(a.item) ||
        initialsHit(b.item) - initialsHit(a.item) ||
        rank(a.item) - rank(b.item) ||
        b.score - a.score,
    );
    return scored.map((s) => s.item);
  }, [input, indexed, page]);
  const list = matches ?? indexed;
  const groups = useMemo(() => {
    const grouped = new Map<string, { heading: string; items: IndexedItem[] }>();
    for (const item of list) {
      const heading = item.subgroup ? `${item.group} - ${item.subgroup}` : item.group;
      const group = grouped.get(heading);
      if (group) group.items.push(item);
      else grouped.set(heading, { heading, items: [item] });
    }
    return [...grouped.values()];
  }, [list]);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const selected = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!selected) return;
      const heading = selected
        .closest<HTMLElement>('[cmdk-group]')
        ?.querySelector<HTMLElement>('[cmdk-group-heading]');
      (heading ?? selected).scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [input, list, open]);
  return (
    <CommandDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      title={t('palette.title')}
      description={t('palette.description')}
    >
      <Command shouldFilter={false} aria-label={t('palette.listLabel')}>
        <CommandInput
          autoFocus
          aria-label={t('palette.searchLabel')}
          placeholder={t('palette.searchPlaceholder')}
          value={input}
          onValueChange={(value) => setInput(value)}
        />
        <CommandList listRef={listRef}>
          <CommandEmpty>{t('palette.empty')}</CommandEmpty>
          {groups.map((group, index) => (
            <Fragment key={group.heading}>
              {index > 0 && <CommandSeparator />}
              <CommandGroup heading={group.heading}>
                {group.items.map((item) => (
                  <CommandItem key={item.id} value={item.id} onSelect={() => run(item)}>
                    <item.icon size={16} weight="duotone" />
                    <span>{t(item.labelKey)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </Fragment>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

function Sidebar({
  page,
  onNavigate,
  onOpenPalette,
}: {
  page: Page;
  onNavigate: (p: Page) => void;
  onOpenPalette: () => void;
}) {
  const { t } = useTranslation();
  return (
    <aside className="sidebar flex min-h-0 flex-col gap-0.5 overflow-auto border-r border-border bg-background px-3 pb-3.5">
      <nav className="flex flex-col gap-0.5" aria-label={t('groups.tools')}>
        <div className="sidebar-heading my-4 mb-1 px-2 text-[9px] font-medium uppercase tracking-[.08em] text-muted-foreground">
          {t('groups.tools')}
        </div>
        {tools.map((tool) => (
          <Button
            key={tool.id}
            variant="ghost"
            className={`sidebar-item flex h-auto min-h-0 w-full items-center justify-start gap-2.5 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-[17px]${page === tool.id ? ' bg-primary text-primary-foreground' : ''}`}
            aria-current={page === tool.id ? 'page' : undefined}
            aria-label={t(tool.nameKey)}
            title={t(tool.nameKey)}
            onClick={() => onNavigate(tool.id)}
          >
            <tool.icon data-icon="inline-start" size={17} weight="duotone" />
            <span>{t(tool.nameKey)}</span>
          </Button>
        ))}
      </nav>
      <nav className="flex flex-col gap-0.5" aria-label={t('titlebar.history')}>
        <div className="sidebar-heading my-4 mb-1 px-2 text-[9px] font-medium uppercase tracking-[.08em] text-muted-foreground">
          {t('titlebar.history')}
        </div>
        <Button
          variant="ghost"
          className={`sidebar-item flex h-auto min-h-0 w-full items-center justify-start gap-2.5 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-[17px]${page === 'history' ? ' bg-primary text-primary-foreground' : ''}`}
          aria-current={page === 'history' ? 'page' : undefined}
          aria-label={t('titlebar.history')}
          title={t('titlebar.history')}
          onClick={() => onNavigate('history')}
        >
          <ClockCounterClockwise data-icon="inline-start" size={17} weight="duotone" />
          <span>{t('titlebar.history')}</span>
        </Button>
      </nav>
      <nav className="flex flex-col gap-0.5" aria-label={t('groups.system')}>
        <div className="sidebar-heading my-4 mb-1 px-2 text-[9px] font-medium uppercase tracking-[.08em] text-muted-foreground">
          {t('groups.system')}
        </div>
        <Button
          variant="ghost"
          className={`sidebar-item flex h-auto min-h-0 w-full items-center justify-start gap-2.5 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-[17px]${page === 'settings' ? ' bg-primary text-primary-foreground' : ''}`}
          aria-current={page === 'settings' ? 'page' : undefined}
          aria-label={t('titlebar.settings')}
          title={t('titlebar.settings')}
          onClick={() => onNavigate('settings')}
        >
          <GearSix data-icon="inline-start" size={17} weight="duotone" />
          <span>{t('titlebar.settings')}</span>
        </Button>
      </nav>
      <div className="sidebar-footer mt-auto flex-none border-t border-border pt-3.5">
        <Button
          variant="ghost"
          className="sidebar-palette flex h-auto min-h-0 w-full items-center justify-start gap-2.5 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-[17px]"
          onClick={onOpenPalette}
          aria-label={t('statusbar.openPalette')}
          title={t('statusbar.openPalette')}
        >
          <CommandIcon data-icon="inline-start" size={17} weight="duotone" />
          <span className="min-w-0 flex-1 truncate">{t('statusbar.openPalette')}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1">
            <kbd className="rounded-sm bg-muted px-1 text-[10px] leading-4 text-muted-foreground">
              {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}
            </kbd>
            <kbd className="rounded-sm bg-muted px-1 text-[10px] leading-4 text-muted-foreground">
              K
            </kbd>
          </span>
        </Button>
      </div>
    </aside>
  );
}
export default AppShell;
