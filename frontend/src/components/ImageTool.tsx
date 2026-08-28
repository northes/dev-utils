import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Dialogs } from '@wailsio/runtime';
import {
  ArrowCounterClockwise,
  ArrowsOut,
  CaretRight,
  Crop,
  DownloadSimple,
  Image as ImageIcon,
  Plus,
  Trash,
  UploadSimple,
} from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { ReadImageFile } from '../../bindings/changeme/fileservice';
import { SaveBase64File } from '../../bindings/changeme/configservice';
import { Button } from './ui/button';
import {
  ColorPicker,
  ColorPickerAlphaSlider,
  ColorPickerArea,
  ColorPickerContent,
  ColorPickerEyeDropper,
  ColorPickerFormatSelect,
  ColorPickerHueSlider,
  ColorPickerInput,
  ColorPickerSwatch,
  ColorPickerTrigger,
} from './ui/color-picker';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Slider } from './ui/slider';
import { Switch } from './ui/switch';
import { Toggle } from './ui/toggle';
import {
  Reveal,
  ToolActionBar,
  ToolLayout,
  ToolLayoutContent,
  ToolLayoutFooter,
  ToolLayoutHeader,
  useFocusOnActivate,
  type PendingAction,
  type ToolId,
} from './shared';
import { toast } from './ui/toast';
import FileDropEmpty, { hasFileTransfer, useFileDragOver } from './FileDropEmpty';
import './ImageTool.css';

type SizeMode = 'crop' | 'expand';
type Rect = { x: number; y: number; w: number; h: number };
type Fit = Rect & { scale: number };
type EdgeHandle = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'se' | 'sw';
type CornerHandle = 'nw' | 'ne' | 'se' | 'sw';
type ExpandCanvas = { width: number; height: number; imageX: number; imageY: number };
type SizeSession =
  | { mode: 'crop'; sizeMode: SizeMode; crop: Rect }
  | {
      mode: 'expand';
      sizeMode: SizeMode;
      expand: ExpandCanvas;
      fillTransparent: boolean;
      fillColor: string;
    };
type SourceImage = { name: string; mime: string; dataUrl: string; width: number; height: number };
type WatermarkDraft = {
  text: string;
  color: string;
  font: string;
  fontSize: number;
  letterSpacing: number;
  lineSpacing: number;
};
type Watermark = WatermarkDraft & {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT = 8192;
const MIN_CROP = 8;
const OPEN_PATTERN = '*.png;*.jpg;*.jpeg;*.svg;*.webp';
const EDGE_HANDLES: EdgeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CORNER_HANDLES: CornerHandle[] = ['nw', 'ne', 'se', 'sw'];
const HANDLE_CURSOR: Record<EdgeHandle, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
};
const HANDLE_POS: Record<EdgeHandle, { left: string; top: string }> = {
  nw: { left: '0%', top: '0%' },
  n: { left: '50%', top: '0%' },
  ne: { left: '100%', top: '0%' },
  e: { left: '100%', top: '50%' },
  se: { left: '100%', top: '100%' },
  s: { left: '50%', top: '100%' },
  sw: { left: '0%', top: '100%' },
  w: { left: '0%', top: '50%' },
};
const HANDLE_KEY: Record<EdgeHandle, string> = {
  nw: 'imageTool.handleNw',
  n: 'imageTool.handleN',
  ne: 'imageTool.handleNe',
  e: 'imageTool.handleE',
  se: 'imageTool.handleSe',
  s: 'imageTool.handleS',
  sw: 'imageTool.handleSw',
  w: 'imageTool.handleW',
};
const FONTS = [
  { value: 'system-ui, "Segoe UI", sans-serif', key: 'imageTool.fontSans' },
  { value: 'Georgia, "Times New Roman", serif', key: 'imageTool.fontSerif' },
  { value: 'ui-monospace, SFMono-Regular, Menlo, monospace', key: 'imageTool.fontMono' },
] as const;
const DEFAULT_DRAFT: WatermarkDraft = {
  text: '',
  color: '#ffffff',
  font: FONTS[0].value,
  fontSize: 32,
  letterSpacing: 0,
  lineSpacing: 0,
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
function basename(path: string) {
  return path.replace(/^.*[/\\]/, '') || path;
}
function mimeFromName(name: string) {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'webp') return 'image/webp';
  return '';
}
function isSupportedName(name: string, mime = '') {
  return Boolean(
    mimeFromName(name) || /^(image\/png|image\/jpeg|image\/svg\+xml|image\/webp)$/.test(mime),
  );
}

function toDataUrl(data: string, mime: string) {
  if (data.startsWith('data:')) return data;
  return `data:${mime || 'image/png'};base64,${data.replace(/\s/g, '')}`;
}
function loadHtmlImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('load'));
    img.src = src;
  });
}
function fitContain(srcW: number, srcH: number, boxW: number, boxH: number, pad = 20): Fit {
  const availW = Math.max(0, boxW - pad * 2);
  const availH = Math.max(0, boxH - pad * 2);
  if (availW <= 0 || availH <= 0 || srcW <= 0 || srcH <= 0)
    return { x: 0, y: 0, w: 0, h: 0, scale: 1 };
  const scale = Math.min(availW / srcW, availH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h, scale };
}
function pointInFit(clientX: number, clientY: number, origin: DOMRect, fit: Fit) {
  return {
    x: (clientX - origin.left - fit.x) / fit.scale,
    y: (clientY - origin.top - fit.y) / fit.scale,
  };
}
function fromPoints(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  maxW: number,
  maxH: number,
): Rect {
  const x = clamp(Math.min(x0, x1), 0, Math.max(0, maxW - 1));
  const y = clamp(Math.min(y0, y1), 0, Math.max(0, maxH - 1));
  const r = clamp(Math.max(x0, x1), x + 1, maxW);
  const b = clamp(Math.max(y0, y1), y + 1, maxH);
  return { x, y, w: Math.max(1, r - x), h: Math.max(1, b - y) };
}
function resizeRect(
  rect: Rect,
  handle: EdgeHandle,
  x: number,
  y: number,
  maxW: number,
  maxH: number,
): Rect {
  let { x: rx, y: ry, w, h } = rect;
  const right = rx + w;
  const bottom = ry + h;
  if (handle.includes('w')) rx = clamp(x, 0, right - MIN_CROP);
  if (handle.includes('n')) ry = clamp(y, 0, bottom - MIN_CROP);
  if (handle.includes('e')) w = clamp(x, rx + MIN_CROP, maxW) - rx;
  if (handle.includes('s')) h = clamp(y, ry + MIN_CROP, maxH) - ry;
  if (handle.includes('w')) w = right - rx;
  if (handle.includes('n')) h = bottom - ry;
  return { x: rx, y: ry, w: Math.max(1, w), h: Math.max(1, h) };
}
function moveRect(rect: Rect, dx: number, dy: number, maxW: number, maxH: number): Rect {
  return {
    x: clamp(rect.x + dx, 0, Math.max(0, maxW - rect.w)),
    y: clamp(rect.y + dy, 0, Math.max(0, maxH - rect.h)),
    w: rect.w,
    h: rect.h,
  };
}

function outputSize(image: SourceImage, mode: SizeMode, crop: Rect, expand: ExpandCanvas) {
  if (mode === 'crop')
    return { w: Math.max(1, Math.round(crop.w)), h: Math.max(1, Math.round(crop.h)) };
  return { w: expand.width, h: expand.height };
}
function clampExpand(next: ExpandCanvas, imgW: number, imgH: number): ExpandCanvas {
  const width = clamp(Math.round(next.width), imgW, MAX_OUTPUT);
  const height = clamp(Math.round(next.height), imgH, MAX_OUTPUT);
  return {
    width,
    height,
    imageX: clamp(Math.round(next.imageX), 0, width - imgW),
    imageY: clamp(Math.round(next.imageY), 0, height - imgH),
  };
}
function estimateLineWidth(line: string, fontSize: number, letterSpacing: number) {
  const chars = Math.max(1, [...line].length);
  return fontSize * 0.62 * chars + Math.max(0, chars - 1) * letterSpacing;
}
function measureWatermark(
  text: string,
  font: string,
  fontSize: number,
  letterSpacing: number,
  lineSpacing: number,
) {
  const lines = (text || ' ').split('\n');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  let maxW = 0;
  if (ctx) ctx.font = `${Math.max(8, fontSize)}px ${font}`;
  for (const line of lines) {
    const measured = ctx?.measureText(line).width ?? 0;
    const spaced =
      (measured > 1 ? measured : 0) + Math.max(0, [...line].length - 1) * letterSpacing;
    maxW = Math.max(maxW, spaced, estimateLineWidth(line, fontSize, letterSpacing));
  }
  const lineHeight = Math.max(8, fontSize) + lineSpacing;
  return {
    width: Math.max(32, Math.ceil(maxW + 16)),
    height: Math.max(Math.max(8, fontSize) + 8, Math.ceil(lineHeight * lines.length + 8)),
  };
}
function fillSpacedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  letterSpacing: number,
) {
  if (!letterSpacing || !text) {
    ctx.fillText(text, x, y);
    return;
  }

  const supportsLetterSpacing = 'letterSpacing' in (ctx as unknown as Record<string, unknown>);
  if (supportsLetterSpacing) {
    ctx.letterSpacing = `${letterSpacing}px`;
    ctx.fillText(text, x, y);
    ctx.letterSpacing = '0px';
    return;
  }

  const characters = Array.from(text);
  const widths = characters.map((character) => ctx.measureText(character).width);
  const width = widths.reduce((total, characterWidth) => total + characterWidth, 0);
  const spacedWidth = width + letterSpacing * (characters.length - 1);
  const startX =
    ctx.textAlign === 'center'
      ? x - spacedWidth / 2
      : ctx.textAlign === 'right' || ctx.textAlign === 'end'
        ? x - spacedWidth
        : x;

  const textAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  let cursor = startX;
  characters.forEach((character, index) => {
    ctx.fillText(character, cursor, y);
    cursor += widths[index] + (index < characters.length - 1 ? letterSpacing : 0);
  });
  ctx.textAlign = textAlign;
}
async function renderComposite(args: {
  source: SourceImage;
  sizeMode: SizeMode;
  crop: Rect;
  expand: ExpandCanvas;
  fillTransparent: boolean;
  fillColor: string;
  watermarks: Watermark[];
}) {
  const img = await loadHtmlImage(args.source.dataUrl);
  const cropRect =
    args.sizeMode === 'crop'
      ? args.crop
      : { x: 0, y: 0, w: args.source.width, h: args.source.height };
  const placed =
    args.sizeMode === 'expand'
      ? clampExpand(args.expand, args.source.width, args.source.height)
      : { width: cropRect.w, height: cropRect.h, imageX: 0, imageY: 0 };
  const width = Math.max(1, Math.round(placed.width));
  const height = Math.max(1, Math.round(placed.height));
  if (width > MAX_OUTPUT || height > MAX_OUTPUT) throw new Error('size');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('ctx');
  if (args.sizeMode === 'expand') {
    if (args.fillTransparent) ctx.clearRect(0, 0, width, height);
    else {
      ctx.fillStyle = args.fillColor;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(
      img,
      0,
      0,
      args.source.width,
      args.source.height,
      placed.imageX,
      placed.imageY,
      args.source.width,
      args.source.height,
    );
  } else {
    ctx.drawImage(
      img,
      cropRect.x,
      cropRect.y,
      cropRect.w,
      cropRect.h,
      0,
      0,
      cropRect.w,
      cropRect.h,
    );
  }
  args.watermarks.forEach((wm) => drawWatermark(ctx, wm));
  return canvas;
}

function encodeJpegUrl(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<string>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('jpeg'));
          return;
        }
        resolve(URL.createObjectURL(blob));
      },
      'image/jpeg',
      clamp(quality, 1, 100) / 100,
    );
  });
}

function drawWatermark(ctx: CanvasRenderingContext2D, wm: Watermark) {
  const lines = wm.text.split('\n');
  const lineHeight = wm.fontSize + wm.lineSpacing;
  ctx.save();
  ctx.translate(wm.x + wm.width / 2, wm.y + wm.height / 2);
  ctx.rotate((wm.rotation * Math.PI) / 180);
  ctx.fillStyle = wm.color;
  ctx.font = `${wm.fontSize}px ${wm.font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const startY = -((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) =>
    fillSpacedText(ctx, line, 0, startY + i * lineHeight, wm.letterSpacing),
  );
  ctx.restore();
}
function toLocal(x: number, y: number, wm: Watermark) {
  const cx = wm.x + wm.width / 2;
  const cy = wm.y + wm.height / 2;
  const dx = x - cx;
  const dy = y - cy;
  const rad = (-wm.rotation * Math.PI) / 180;
  return {
    x: dx * Math.cos(rad) - dy * Math.sin(rad) + wm.width / 2,
    y: dx * Math.sin(rad) + dy * Math.cos(rad) + wm.height / 2,
  };
}
function resizeWatermark(
  wm: Watermark,
  handle: CornerHandle,
  localX: number,
  localY: number,
): Watermark {
  const min = 16;
  let width = wm.width;
  let height = wm.height;
  let dx = 0;
  let dy = 0;
  if (handle.includes('e')) width = Math.max(min, localX);
  else {
    width = Math.max(min, wm.width - localX);
    dx = wm.width - width;
  }
  if (handle.includes('s')) height = Math.max(min, localY);
  else {
    height = Math.max(min, wm.height - localY);
    dy = wm.height - height;
  }
  const rad = (wm.rotation * Math.PI) / 180;
  return {
    ...wm,
    x: wm.x + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: wm.y + dx * Math.sin(rad) + dy * Math.cos(rad),
    width,
    height,
    fontSize: clamp(wm.fontSize * (height / Math.max(1, wm.height)), 8, 400),
  };
}

type Session = {
  pointerId: number;
  target: Element;
  onMove: (event: PointerEvent) => void;
  onEnd: (canceled: boolean) => void;
};

function usePointerSession() {
  const session = useRef<Session | null>(null);
  const stopRef = useRef<(canceled: boolean) => void>(() => {});
  const [dragging, setDragging] = useState(false);
  const handleMove = useRef((event: PointerEvent) => {
    const current = session.current;
    if (!current || event.pointerId !== current.pointerId) return;
    current.onMove(event);
  }).current;
  const handleUp = useRef((event: PointerEvent) => {
    if (session.current && event.pointerId === session.current.pointerId) stopRef.current(false);
  }).current;
  const handleCancel = useRef((event: PointerEvent) => {
    if (session.current && event.pointerId === session.current.pointerId) stopRef.current(true);
  }).current;
  const handleBlur = useRef(() => stopRef.current(true)).current;
  const handleHidden = useRef(() => {
    if (document.hidden) stopRef.current(true);
  }).current;

  const stop = useCallback(
    (canceled: boolean) => {
      const current = session.current;
      if (!current) return;
      session.current = null;
      setDragging(false);
      try {
        if (current.target.hasPointerCapture(current.pointerId))
          current.target.releasePointerCapture(current.pointerId);
      } catch {
        /* already released */
      }
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleCancel);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('visibilitychange', handleHidden);
      current.onEnd(canceled);
    },
    [handleBlur, handleCancel, handleHidden, handleMove, handleUp],
  );

  stopRef.current = stop;

  useEffect(() => () => stop(true), [stop]);

  const start = useCallback(
    (
      event: ReactPointerEvent,
      onMoveFn: (e: PointerEvent) => void,
      onEnd: (canceled: boolean) => void,
    ) => {
      stop(true);
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      session.current = {
        pointerId: event.pointerId,
        target: event.currentTarget,
        onMove: onMoveFn,
        onEnd,
      };
      setDragging(true);
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
      window.addEventListener('pointercancel', handleCancel);
      window.addEventListener('blur', handleBlur);
      document.addEventListener('visibilitychange', handleHidden);
    },
    [handleBlur, handleCancel, handleHidden, handleMove, handleUp, stop],
  );

  return { start, stop, dragging };
}

function ImageToolDisclosure({
  id,
  title,
  meta,
  open,
  onOpenChange,
  children,
}: {
  id: string;
  title: string;
  meta?: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col border-t border-border pt-3">
      <button
        type="button"
        id={`${id}-toggle`}
        className="flex min-h-7 w-full cursor-pointer items-center gap-2 rounded-sm border-0 bg-transparent p-0 text-left font-mono text-[10px] font-medium uppercase tracking-[.04em] text-muted-foreground hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => onOpenChange(!open)}
      >
        <CaretRight
          size={10}
          weight="bold"
          className={`flex-none ${open ? 'rotate-90' : ''}`}
          aria-hidden
        />
        <span className="min-w-0 flex-1">{title}</span>
        {meta ? (
          <span className="max-w-[46%] truncate font-sans text-[11px] font-normal normal-case tracking-normal">
            {meta}
          </span>
        ) : null}
      </button>
      <div
        id={id}
        role="region"
        aria-labelledby={`${id}-toggle`}
        hidden={!open}
        className={open ? 'flex flex-col gap-3 pt-3' : undefined}
      >
        {open ? children : null}
      </div>
    </section>
  );
}

export default function ImageTool({
  active,
  record,
  pending,
  clearPending,
}: {
  active: boolean;
  record: (tool: ToolId, action: string, detail: string, input: string, output?: string) => void;
  pending: PendingAction | null;
  clearPending: () => void;
}) {
  const { t } = useTranslation();
  const consumed = useRef<PendingAction | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const emptyRef = useRef<HTMLButtonElement>(null);
  const pointer = usePointerSession();
  const [source, setSource] = useState<SourceImage | null>(null);
  const [sizeMode, setSizeMode] = useState<SizeMode>('crop');
  const [crop, setCrop] = useState<Rect>({ x: 0, y: 0, w: 1, h: 1 });
  const [expand, setExpand] = useState<ExpandCanvas>({ width: 1, height: 1, imageX: 0, imageY: 0 });
  const [fillTransparent, setFillTransparent] = useState(true);
  const [fillColor, setFillColor] = useState('#ffffff');
  const [quality, setQuality] = useState(92);
  const [draft, setDraft] = useState<WatermarkDraft>(DEFAULT_DRAFT);
  const [watermarks, setWatermarks] = useState<Watermark[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [imageSelected, setImageSelected] = useState(false);
  const [sizeInput, setSizeInput] = useState({ w: '', h: '' });
  const [pane, setPane] = useState({ w: 0, h: 0 });
  const fileDrag = useFileDragOver();
  const over = fileDrag.over;
  const [openFill, setOpenFill] = useState(false);
  const [openQuality, setOpenQuality] = useState(false);
  const [openWatermark, setOpenWatermark] = useState(false);
  const [sizeSession, setSizeSession] = useState<SizeSession | null>(null);
  const [jpegPreview, setJpegPreview] = useState<{ url: string; key: string } | null>(null);
  const jpegPreviewRef = useRef<string | null>(null);
  const jpegTaskRef = useRef(0);
  const exportRef = useRef<() => Promise<void>>(async () => {});
  const pngExport = sizeMode === 'expand' && fillTransparent;
  const cropEditing = sizeSession?.mode === 'crop';
  const expandEditing = sizeSession?.mode === 'expand';
  const selectedWm = watermarks.find((item) => item.id === selectedId);
  const form = selectedWm
    ? {
        text: selectedWm.text,
        color: selectedWm.color,
        font: selectedWm.font,
        fontSize: selectedWm.fontSize,
        letterSpacing: selectedWm.letterSpacing,
        lineSpacing: selectedWm.lineSpacing,
      }
    : draft;

  useFocusOnActivate(active, () => {
    if (source) previewRef.current?.focus();
    else emptyRef.current?.focus();
  });

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setPane({ w: rect.width, h: rect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [source]);

  const out = source ? outputSize(source, sizeMode, crop, expand) : { w: 0, h: 0 };
  const fit = useMemo(
    () =>
      source
        ? sizeMode === 'crop' && cropEditing
          ? fitContain(source.width, source.height, pane.w, pane.h)
          : fitContain(out.w, out.h, pane.w, pane.h)
        : { x: 0, y: 0, w: 0, h: 0, scale: 1 },
    [source, sizeMode, cropEditing, pane.w, pane.h, out.w, out.h],
  );

  const previewKey = source
    ? [
        source.dataUrl,
        sizeMode,
        crop.x,
        crop.y,
        crop.w,
        crop.h,
        expand.width,
        expand.height,
        expand.imageX,
        expand.imageY,
        fillTransparent ? '1' : '0',
        fillColor,
        quality,
        watermarks
          .map(
            (item) =>
              `${item.id}:${item.x}:${item.y}:${item.width}:${item.height}:${item.rotation}:${item.text}:${item.color}:${item.font}:${item.fontSize}:${item.letterSpacing}:${item.lineSpacing}`,
          )
          .join(';'),
      ].join('|')
    : '';

  const replaceJpegPreview = useCallback((next: { url: string; key: string } | null) => {
    const nextUrl = next?.url ?? null;
    if (jpegPreviewRef.current && jpegPreviewRef.current !== nextUrl)
      URL.revokeObjectURL(jpegPreviewRef.current);
    jpegPreviewRef.current = nextUrl;
    setJpegPreview(next);
  }, []);

  const invalidateJpegPreview = useCallback(() => {
    jpegTaskRef.current += 1;
    replaceJpegPreview(null);
  }, [replaceJpegPreview]);

  const startGeometry = (
    event: ReactPointerEvent,
    onMoveFn: (e: PointerEvent) => void,
    onEnd: (canceled: boolean) => void,
  ) => {
    invalidateJpegPreview();
    pointer.start(event, onMoveFn, onEnd);
  };

  const resetImage = useCallback(
    (next: SourceImage | null) => {
      pointer.stop(true);
      invalidateJpegPreview();
      setSource(next);
      setSizeMode('crop');
      setCrop(next ? { x: 0, y: 0, w: next.width, h: next.height } : { x: 0, y: 0, w: 1, h: 1 });
      setExpand(
        next
          ? { width: next.width, height: next.height, imageX: 0, imageY: 0 }
          : { width: 1, height: 1, imageX: 0, imageY: 0 },
      );
      setFillTransparent(true);
      setFillColor('#ffffff');
      setQuality(92);
      setWatermarks([]);
      setSelectedId('');
      setImageSelected(false);
      setDraft(DEFAULT_DRAFT);
      fileDrag.clear();
      setOpenFill(false);
      setOpenQuality(false);
      setOpenWatermark(false);
      setSizeSession(null);
    },
    [fileDrag.clear, invalidateJpegPreview, pointer.stop],
  );

  const clearSelection = () => {
    setSelectedId('');
    setImageSelected(false);
  };

  useEffect(() => {
    if (selectedId) setOpenWatermark(true);
  }, [selectedId]);

  const patchDraft = (patch: Partial<WatermarkDraft>) => {
    if (selectedWm) {
      setWatermarks((list) =>
        list.map((item) => {
          if (item.id !== selectedWm.id) return item;
          const next = { ...item, ...patch };
          const size = measureWatermark(
            next.text,
            next.font,
            next.fontSize,
            next.letterSpacing,
            next.lineSpacing,
          );
          return { ...next, width: size.width, height: size.height };
        }),
      );
      return;
    }
    setDraft((current) => ({ ...current, ...patch }));
  };

  const applyLoaded = useCallback(
    async (dataUrl: string, name: string, mime: string) => {
      try {
        const img = await loadHtmlImage(dataUrl);
        const width = img.naturalWidth || img.width || 1;
        const height = img.naturalHeight || img.height || 1;
        resetImage({
          name,
          mime: mime || mimeFromName(name) || 'image/png',
          dataUrl,
          width,
          height,
        });
      } catch {
        toast.add({ title: t('imageTool.loadFailed'), type: 'error' });
      }
    },
    [resetImage, t],
  );

  const loadFile = useCallback(
    async (file: File) => {
      if (!isSupportedName(file.name, file.type)) {
        toast.add({ title: t('imageTool.unsupported'), type: 'warning' });
        return;
      }
      if (file.size > MAX_BYTES) {
        toast.add({ title: t('imageTool.tooLarge'), type: 'warning' });
        return;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('read'));
        reader.readAsDataURL(file);
      }).catch(() => '');
      if (!dataUrl) {
        toast.add({ title: t('imageTool.loadFailed'), type: 'error' });
        return;
      }
      await applyLoaded(dataUrl, file.name, file.type);
    },
    [applyLoaded, t],
  );

  useEffect(() => {
    if (!active) return;
    const dragover = (event: DragEvent) => {
      const transfer = event.dataTransfer;
      if (!transfer || !hasFileTransfer(transfer)) return;
      event.preventDefault();
      transfer.dropEffect = 'copy';
    };
    const drop = (event: DragEvent) => {
      const transfer = event.dataTransfer;
      if (!transfer || !hasFileTransfer(transfer)) return;
      event.preventDefault();
      fileDrag.clear();
      const file = transfer.files[0];
      if (file) void loadFile(file);
    };
    window.addEventListener('dragover', dragover);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', dragover);
      window.removeEventListener('drop', drop);
    };
  }, [active, fileDrag.clear, loadFile]);

  const openNative = async () => {
    try {
      const path = await Dialogs.OpenFile({
        Title: t('imageTool.openTitle'),
        ButtonText: t('imageTool.open'),
        CanChooseFiles: true,
        AllowsMultipleSelection: false,
        Filters: [{ DisplayName: t('imageTool.filterImages'), Pattern: OPEN_PATTERN }],
      });
      if (!path) return;
      const name = basename(path);
      if (!isSupportedName(name)) {
        toast.add({ title: t('imageTool.unsupported'), type: 'warning' });
        return;
      }
      const data = await ReadImageFile(path);
      await applyLoaded(toDataUrl(data, mimeFromName(name)), name, mimeFromName(name));
    } catch {
      toast.add({ title: t('imageTool.loadFailed'), type: 'error' });
    }
  };

  useEffect(() => {
    if (!source || pngExport) {
      replaceJpegPreview(null);
      return;
    }
    if (sizeSession || pointer.dragging) return;
    const task = ++jpegTaskRef.current;
    const key = previewKey;
    let cancelled = false;
    void (async () => {
      try {
        const canvas = await renderComposite({
          source,
          sizeMode,
          crop,
          expand,
          fillTransparent,
          fillColor,
          watermarks,
        });
        if (cancelled || task !== jpegTaskRef.current) return;
        const url = await encodeJpegUrl(canvas, quality);
        if (cancelled || task !== jpegTaskRef.current) {
          URL.revokeObjectURL(url);
          return;
        }
        await loadHtmlImage(url);
        if (cancelled || task !== jpegTaskRef.current) {
          URL.revokeObjectURL(url);
          return;
        }
        replaceJpegPreview({ url, key });
      } catch {
        if (!cancelled && task === jpegTaskRef.current) replaceJpegPreview(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    source,
    pngExport,
    sizeSession,
    pointer.dragging,
    previewKey,
    sizeMode,
    crop,
    expand,
    fillTransparent,
    fillColor,
    watermarks,
    quality,
  ]);

  useEffect(
    () => () => {
      if (jpegPreviewRef.current) URL.revokeObjectURL(jpegPreviewRef.current);
    },
    [],
  );

  const exportImage = async () => {
    if (sizeSession || pointer.dragging) return;
    if (!source) {
      toast.add({ title: t('imageTool.noImage'), type: 'warning' });
      return;
    }
    try {
      const canvas = await renderComposite({
        source,
        sizeMode,
        crop,
        expand,
        fillTransparent,
        fillColor,
        watermarks,
      });
      const width = canvas.width;
      const height = canvas.height;
      const needAlpha = pngExport;
      const mime = needAlpha ? 'image/png' : 'image/jpeg';
      const dataUrl = needAlpha
        ? canvas.toDataURL(mime)
        : canvas.toDataURL(mime, clamp(quality, 1, 100) / 100);
      const ext = needAlpha ? 'png' : 'jpg';
      const filename = `${source.name.replace(/\.[^.]+$/, '') || 'image'}-edited.${ext}`;
      const path = await Dialogs.SaveFile({
        Title: t('imageTool.exportTitle'),
        Filename: filename,
        ButtonText: t('imageTool.save'),
        CanCreateDirectories: true,
        Filters: [
          {
            DisplayName: t('imageTool.filterImages'),
            Pattern: needAlpha ? '*.png' : '*.jpg;*.jpeg',
          },
        ],
      });
      if (!path) return;
      await SaveBase64File(path, dataUrl);
      const detail = t('imageTool.dimensions', { width, height });
      record('image', t('imageTool.export'), detail, source.name, filename);
      toast.add({ title: t('imageTool.exported') });
    } catch {
      toast.add({ title: t('imageTool.exportFailed'), type: 'error' });
    }
  };
  exportRef.current = exportImage;

  useEffect(() => {
    if (!pending || pending.tool !== 'image' || consumed.current === pending) return;
    consumed.current = pending;
    clearPending();
    if (pending.action === 'clear') {
      resetImage(null);
      return;
    }
    if (pending.action === 'export') {
      void exportRef.current();
    }
  }, [pending, clearPending]);

  useEffect(() => {
    if (!out.w || !out.h) return;
    setSizeInput({ w: String(out.w), h: String(out.h) });
  }, [out.w, out.h]);

  const applySize = () => {
    if (!source) return;
    const nextW = clamp(Math.round(Number(sizeInput.w) || 0), MIN_CROP, MAX_OUTPUT);
    const nextH = clamp(Math.round(Number(sizeInput.h) || 0), MIN_CROP, MAX_OUTPUT);
    if (sizeMode === 'crop') {
      const w = clamp(nextW, MIN_CROP, source.width);
      const h = clamp(nextH, MIN_CROP, source.height);
      setCrop({
        x: clamp(crop.x, 0, source.width - w),
        y: clamp(crop.y, 0, source.height - h),
        w,
        h,
      });
      return;
    }
    setExpand(
      clampExpand(
        { ...expand, width: Math.max(nextW, source.width), height: Math.max(nextH, source.height) },
        source.width,
        source.height,
      ),
    );
  };

  const beginSizeEdit = (mode: SizeMode) => {
    if (!source) return;
    if (sizeSession?.mode === mode) return;
    pointer.stop(true);
    invalidateJpegPreview();

    let prevSizeMode = sizeMode;
    let prevCrop = crop;
    let prevExpand = expand;
    let prevFillTransparent = fillTransparent;
    let prevFillColor = fillColor;
    if (sizeSession?.mode === 'crop') {
      prevSizeMode = sizeSession.sizeMode;
      prevCrop = sizeSession.crop;
      setCrop(sizeSession.crop);
    } else if (sizeSession?.mode === 'expand') {
      prevSizeMode = sizeSession.sizeMode;
      prevExpand = sizeSession.expand;
      prevFillTransparent = sizeSession.fillTransparent;
      prevFillColor = sizeSession.fillColor;
      setExpand(sizeSession.expand);
      setFillTransparent(sizeSession.fillTransparent);
      setFillColor(sizeSession.fillColor);
    }

    setSizeMode(mode);
    setImageSelected(false);
    if (mode === 'crop') {
      setSizeSession({ mode: 'crop', sizeMode: prevSizeMode, crop: { ...prevCrop } });
      return;
    }
    setSizeSession({
      mode: 'expand',
      sizeMode: prevSizeMode,
      expand: { ...prevExpand },
      fillTransparent: prevFillTransparent,
      fillColor: prevFillColor,
    });
  };

  const commitSizeEdit = () => {
    pointer.stop(false);
    setSizeSession(null);
    setImageSelected(false);
  };

  const cancelSizeEdit = () => {
    if (!sizeSession) return;
    pointer.stop(true);
    setSizeMode(sizeSession.sizeMode);
    if (sizeSession.mode === 'crop') setCrop(sizeSession.crop);
    else {
      setExpand(sizeSession.expand);
      setFillTransparent(sizeSession.fillTransparent);
      setFillColor(sizeSession.fillColor);
    }
    setSizeSession(null);
    setImageSelected(false);
  };

  const addWatermark = () => {
    if (!source) return;
    const text = form.text.trim();
    if (!text) return;
    const size = measureWatermark(
      text,
      form.font,
      form.fontSize,
      form.letterSpacing,
      form.lineSpacing,
    );
    const id = `wm-${Date.now()}`;
    const next: Watermark = {
      id,
      text,
      color: form.color,
      font: form.font,
      fontSize: form.fontSize,
      letterSpacing: form.letterSpacing,
      lineSpacing: form.lineSpacing,
      width: size.width,
      height: size.height,
      x: Math.max(0, (out.w - size.width) / 2),
      y: Math.max(0, (out.h - size.height) / 2),
      rotation: 0,
    };
    setWatermarks((list) => [...list, next]);
    setSelectedId(id);
    setImageSelected(false);
  };

  const stagePoint = (event: PointerEvent, origin: DOMRect, snapped: Fit) =>
    pointInFit(event.clientX, event.clientY, origin, snapped);

  const beginCropDraw = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!source || !cropEditing) return;
    const origin = event.currentTarget.getBoundingClientRect();
    const snapped = { ...fit };
    const start = stagePoint(event.nativeEvent, origin, snapped);
    const prev = crop;
    const live = { ...prev };
    clearSelection();
    startGeometry(
      event,
      (move) => {
        const p = stagePoint(move, origin, snapped);
        live.w = Math.abs(p.x - start.x);
        live.h = Math.abs(p.y - start.y);
        setCrop(fromPoints(start.x, start.y, p.x, p.y, source.width, source.height));
      },
      (canceled) => {
        if (canceled || live.w < 2 || live.h < 2) setCrop(prev);
      },
    );
  };

  const beginCropMove = (event: ReactPointerEvent) => {
    if (!source || !cropEditing) return;
    event.stopPropagation();
    const origin = previewRef.current?.getBoundingClientRect();
    if (!origin) return;
    const snapped = { ...fit };
    const start = stagePoint(event.nativeEvent, origin, snapped);
    const prev = crop;
    clearSelection();
    startGeometry(
      event,
      (move) => {
        const p = stagePoint(move, origin, snapped);
        setCrop(moveRect(prev, p.x - start.x, p.y - start.y, source.width, source.height));
      },
      (canceled) => {
        if (canceled) setCrop(prev);
      },
    );
  };

  const beginCropResize = (event: ReactPointerEvent, handle: EdgeHandle) => {
    if (!source || !cropEditing) return;
    event.stopPropagation();
    const origin = previewRef.current?.getBoundingClientRect();
    if (!origin) return;
    const snapped = { ...fit };
    const prev = crop;
    startGeometry(
      event,
      (move) => {
        const p = stagePoint(move, origin, snapped);
        setCrop(resizeRect(prev, handle, p.x, p.y, source.width, source.height));
      },
      (canceled) => {
        if (canceled) setCrop(prev);
      },
    );
  };

  const beginExpand = (event: ReactPointerEvent, handle: EdgeHandle) => {
    if (!source || !expandEditing) return;
    event.stopPropagation();
    const origin = previewRef.current?.getBoundingClientRect();
    if (!origin) return;
    const snapped = { ...fit };
    const prev = expand;
    startGeometry(
      event,
      (move) => {
        const p = stagePoint(move, origin, snapped);
        const next = { ...prev };
        if (handle.includes('e')) next.width = p.x;
        if (handle.includes('s')) next.height = p.y;
        if (handle.includes('w')) {
          next.width = prev.width - p.x;
          next.imageX = prev.imageX - p.x;
        }
        if (handle.includes('n')) {
          next.height = prev.height - p.y;
          next.imageY = prev.imageY - p.y;
        }
        setExpand(clampExpand(next, source.width, source.height));
      },
      (canceled) => {
        if (canceled) setExpand(prev);
      },
    );
  };

  const beginImageMove = (event: ReactPointerEvent) => {
    if (!source || !expandEditing) return;
    event.stopPropagation();
    const origin = previewRef.current?.getBoundingClientRect();
    if (!origin) return;
    const snapped = { ...fit };
    const start = stagePoint(event.nativeEvent, origin, snapped);
    const prev = expand;
    setSelectedId('');
    setImageSelected(true);
    startGeometry(
      event,
      (move) => {
        const p = stagePoint(move, origin, snapped);
        setExpand(
          clampExpand(
            {
              ...prev,
              imageX: prev.imageX + p.x - start.x,
              imageY: prev.imageY + p.y - start.y,
            },
            source.width,
            source.height,
          ),
        );
      },
      (canceled) => {
        if (canceled) setExpand(prev);
      },
    );
  };

  const beginWmMove = (event: ReactPointerEvent, id: string) => {
    event.stopPropagation();
    const origin = previewRef.current?.getBoundingClientRect();
    if (!origin) return;
    const snapped = { ...fit };
    const wm = watermarks.find((item) => item.id === id);
    if (!wm) return;
    const start = stagePoint(event.nativeEvent, origin, snapped);
    const prev = watermarks;
    setSelectedId(id);
    startGeometry(
      event,
      (move) => {
        const p = stagePoint(move, origin, snapped);
        const dx = p.x - start.x;
        const dy = p.y - start.y;
        setWatermarks((list) =>
          list.map((item) =>
            item.id === id
              ? {
                  ...item,
                  x: clamp(wm.x + dx, -item.width + 8, out.w - 8),
                  y: clamp(wm.y + dy, -item.height + 8, out.h - 8),
                }
              : item,
          ),
        );
      },
      (canceled) => {
        if (canceled) setWatermarks(prev);
      },
    );
  };

  const beginWmResize = (event: ReactPointerEvent, id: string, handle: CornerHandle) => {
    event.stopPropagation();
    const origin = previewRef.current?.getBoundingClientRect();
    if (!origin) return;
    const snapped = { ...fit };
    const wm = watermarks.find((item) => item.id === id);
    if (!wm) return;
    const prev = watermarks;
    const cropAt = crop;
    const mode = sizeMode;
    const cropSpace = cropEditing;
    setSelectedId(id);
    startGeometry(
      event,
      (move) => {
        const raw = stagePoint(move, origin, snapped);
        const p = mode === 'crop' && cropSpace ? { x: raw.x - cropAt.x, y: raw.y - cropAt.y } : raw;
        const local = toLocal(p.x, p.y, wm);
        setWatermarks((list) =>
          list.map((item) =>
            item.id === id ? resizeWatermark(wm, handle, local.x, local.y) : item,
          ),
        );
      },
      (canceled) => {
        if (canceled) setWatermarks(prev);
      },
    );
  };

  const beginWmRotate = (event: ReactPointerEvent, id: string) => {
    event.stopPropagation();
    const origin = previewRef.current?.getBoundingClientRect();
    if (!origin) return;
    const snapped = { ...fit };
    const wm = watermarks.find((item) => item.id === id);
    if (!wm) return;
    const prev = watermarks;
    const cropAt = crop;
    const mode = sizeMode;
    const cropSpace = cropEditing;
    const cx = wm.x + wm.width / 2;
    const cy = wm.y + wm.height / 2;
    setSelectedId(id);
    startGeometry(
      event,
      (move) => {
        const raw = stagePoint(move, origin, snapped);
        const p = mode === 'crop' && cropSpace ? { x: raw.x - cropAt.x, y: raw.y - cropAt.y } : raw;
        const rotation = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
        setWatermarks((list) =>
          list.map((item) => (item.id === id ? { ...item, rotation } : item)),
        );
      },
      (canceled) => {
        if (canceled) setWatermarks(prev);
      },
    );
  };

  const cropStyle =
    source && cropEditing
      ? {
          left: fit.x + crop.x * fit.scale,
          top: fit.y + crop.y * fit.scale,
          width: crop.w * fit.scale,
          height: crop.h * fit.scale,
        }
      : null;
  const canvasStyle =
    source && (sizeMode === 'expand' || (sizeMode === 'crop' && !cropEditing))
      ? { left: fit.x, top: fit.y, width: fit.w, height: fit.h }
      : null;
  const imageStyle =
    source && sizeMode === 'expand'
      ? {
          left: expand.imageX * fit.scale,
          top: expand.imageY * fit.scale,
          width: source.width * fit.scale,
          height: source.height * fit.scale,
        }
      : source && cropEditing
        ? { left: fit.x, top: fit.y, width: fit.w, height: fit.h }
        : source && sizeMode === 'crop'
          ? {
              left: -crop.x * fit.scale,
              top: -crop.y * fit.scale,
              width: source.width * fit.scale,
              height: source.height * fit.scale,
            }
          : null;

  const watermarkOffset =
    source && cropEditing
      ? { x: fit.x + crop.x * fit.scale, y: fit.y + crop.y * fit.scale, scale: fit.scale }
      : { x: fit.x, y: fit.y, scale: fit.scale };
  const outputClip = cropEditing ? cropStyle : canvasStyle;
  const showFinalPreview = Boolean(
    source &&
    jpegPreview &&
    jpegPreview.key === previewKey &&
    !pngExport &&
    !sizeSession &&
    !pointer.dragging,
  );

  return (
    <Reveal index={0} fill active={active}>
      <ToolLayout className="image-tool">
        <ToolLayoutHeader title={t('imageTool.title')} />
        <ToolLayoutContent>
          <div className="grid h-full min-h-0 min-w-0 grid-cols-[minmax(0,1.2fr)_minmax(228px,0.72fr)] grid-rows-[minmax(0,1fr)] max-[700px]:grid-cols-1 max-[700px]:grid-rows-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="flex h-full min-h-0 min-w-0 flex-col">
              <div
                ref={previewRef}
                tabIndex={source ? 0 : -1}
                aria-label={t('imageTool.preview')}
                data-empty={source ? undefined : 'true'}
                data-over={over ? 'true' : undefined}
                data-dragging={pointer.dragging ? 'true' : undefined}
                {...fileDrag.dragProps}
                className="image-tool-stage relative min-h-0 flex-1 overflow-hidden"
              >
                {over ? (
                  <span className="sr-only" role="status">
                    {t('fileDrop.release')}
                  </span>
                ) : null}
                {!source ? (
                  <FileDropEmpty
                    icon={ImageIcon}
                    title={t('imageTool.emptyTitle')}
                    desc={t('imageTool.emptyHint')}
                    actionLabel={t('imageTool.chooseFile')}
                    onChooseFile={() => void openNative()}
                    actionRef={emptyRef}
                    over={over}
                    framed={false}
                    announce={false}
                  />
                ) : (
                  <>
                    {sizeMode === 'expand' && canvasStyle ? (
                      <div
                        className="absolute z-[1]"
                        style={canvasStyle}
                        onPointerDown={() => clearSelection()}
                      >
                        <div className="absolute inset-0 overflow-hidden">
                          <div
                            data-fill="true"
                            className={`absolute inset-0 ${fillTransparent ? 'image-tool-check' : ''}`}
                            style={fillTransparent ? undefined : { backgroundColor: fillColor }}
                          />
                          {imageStyle ? (
                            <img
                              src={source.dataUrl}
                              alt={source.name}
                              draggable={false}
                              aria-label={expandEditing ? t('imageTool.moveImage') : undefined}
                              data-selected={imageSelected ? 'true' : undefined}
                              className={`image-tool-photo absolute max-h-none max-w-none select-none ${expandEditing ? 'cursor-move' : ''} ${showFinalPreview ? 'opacity-0' : ''}`}
                              style={imageStyle}
                              onPointerDown={expandEditing ? beginImageMove : undefined}
                            />
                          ) : null}
                          {showFinalPreview && jpegPreview ? (
                            <img
                              src={jpegPreview.url}
                              alt=""
                              aria-hidden
                              draggable={false}
                              className="pointer-events-none absolute inset-0 max-h-none max-w-none size-full"
                            />
                          ) : null}
                        </div>
                        {expandEditing
                          ? EDGE_HANDLES.map((handle) => (
                              <button
                                key={handle}
                                type="button"
                                className="image-tool-handle"
                                style={{ ...HANDLE_POS[handle], cursor: HANDLE_CURSOR[handle] }}
                                aria-label={t('imageTool.expandHandle', {
                                  handle: t(HANDLE_KEY[handle]),
                                })}
                                onPointerDown={(event) => beginExpand(event, handle)}
                              />
                            ))
                          : null}
                      </div>
                    ) : null}
                    {sizeMode === 'crop' && !cropEditing && canvasStyle ? (
                      <div className="absolute z-[1] overflow-hidden" style={canvasStyle}>
                        {imageStyle ? (
                          <img
                            src={source.dataUrl}
                            alt={source.name}
                            draggable={false}
                            className={`absolute max-h-none max-w-none select-none ${showFinalPreview ? 'opacity-0' : ''}`}
                            style={imageStyle}
                          />
                        ) : null}
                        {showFinalPreview && jpegPreview ? (
                          <img
                            src={jpegPreview.url}
                            alt=""
                            aria-hidden
                            draggable={false}
                            className="pointer-events-none absolute inset-0 max-h-none max-w-none size-full"
                          />
                        ) : null}
                      </div>
                    ) : null}
                    {cropEditing && imageStyle ? (
                      <img
                        src={source.dataUrl}
                        alt={source.name}
                        draggable={false}
                        className="absolute max-h-none max-w-none select-none"
                        style={imageStyle}
                      />
                    ) : null}
                    {cropEditing ? (
                      <div
                        className="absolute inset-0 z-[1] cursor-crosshair"
                        onPointerDown={beginCropDraw}
                      />
                    ) : null}
                    {cropStyle ? (
                      <div
                        role="group"
                        aria-label={t('imageTool.moveCrop')}
                        className="image-tool-crop absolute z-[2] cursor-move border border-primary"
                        style={cropStyle}
                        onPointerDown={beginCropMove}
                      >
                        {EDGE_HANDLES.map((handle) => (
                          <button
                            key={handle}
                            type="button"
                            className="image-tool-handle"
                            style={{ ...HANDLE_POS[handle], cursor: HANDLE_CURSOR[handle] }}
                            aria-label={t('imageTool.cropHandle', {
                              handle: t(HANDLE_KEY[handle]),
                            })}
                            onPointerDown={(event) => beginCropResize(event, handle)}
                          />
                        ))}
                      </div>
                    ) : null}
                    {outputClip && !showFinalPreview ? (
                      <div
                        className="pointer-events-none absolute z-[3] overflow-hidden"
                        style={outputClip}
                      >
                        {watermarks.map((wm) => {
                          const width = wm.width * watermarkOffset.scale;
                          const height = wm.height * watermarkOffset.scale;
                          return (
                            <div
                              key={`${wm.id}-text`}
                              className="absolute flex items-center justify-center"
                              style={{
                                left:
                                  watermarkOffset.x +
                                  wm.x * watermarkOffset.scale -
                                  outputClip.left,
                                top:
                                  watermarkOffset.y + wm.y * watermarkOffset.scale - outputClip.top,
                                width,
                                height,
                                transform: `rotate(${wm.rotation}deg)`,
                                color: wm.color,
                                fontFamily: wm.font,
                                fontSize: Math.max(8, wm.fontSize * watermarkOffset.scale),
                                letterSpacing: wm.letterSpacing * watermarkOffset.scale,
                                lineHeight: `${(wm.fontSize + wm.lineSpacing) * watermarkOffset.scale}px`,
                                whiteSpace: 'pre',
                                textAlign: 'center',
                              }}
                            >
                              <span className="max-h-full max-w-full px-1">{wm.text}</span>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                    {watermarks.map((wm) => {
                      const left = watermarkOffset.x + wm.x * watermarkOffset.scale;
                      const top = watermarkOffset.y + wm.y * watermarkOffset.scale;
                      const width = wm.width * watermarkOffset.scale;
                      const height = wm.height * watermarkOffset.scale;
                      const selected = wm.id === selectedId;
                      return (
                        <div
                          key={wm.id}
                          role="group"
                          aria-label={t('imageTool.watermarkLayer', { text: wm.text })}
                          aria-roledescription={t('imageTool.watermarkMove')}
                          data-selected={selected ? 'true' : undefined}
                          className="image-tool-layer absolute z-[3] flex cursor-move items-center justify-center overflow-visible"
                          style={{
                            left,
                            top,
                            width,
                            height,
                            transform: `rotate(${wm.rotation}deg)`,
                          }}
                          onPointerDown={(event) => {
                            setImageSelected(false);
                            beginWmMove(event, wm.id);
                          }}
                        >
                          <span className="pointer-events-none sr-only">{wm.text}</span>
                          {selected ? (
                            <>
                              <button
                                type="button"
                                className="image-tool-rotate"
                                aria-label={t('imageTool.watermarkRotate')}
                                onPointerDown={(event) => beginWmRotate(event, wm.id)}
                              />
                              {CORNER_HANDLES.map((handle) => (
                                <button
                                  key={handle}
                                  type="button"
                                  className="image-tool-handle"
                                  style={{ ...HANDLE_POS[handle], cursor: HANDLE_CURSOR[handle] }}
                                  aria-label={t('imageTool.watermarkResize', {
                                    handle: t(HANDLE_KEY[handle]),
                                  })}
                                  onPointerDown={(event) => beginWmResize(event, wm.id, handle)}
                                />
                              ))}
                            </>
                          ) : null}
                        </div>
                      );
                    })}
                    <span className="image-tool-hud pointer-events-none absolute bottom-2 left-2 font-mono text-[10px] font-medium tracking-[.02em]">
                      {t('imageTool.dimensions', { width: out.w, height: out.h })}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="image-tool-replace absolute top-2 right-2 bg-background"
                      aria-label={t('imageTool.replace')}
                      onClick={() => void openNative()}
                    >
                      <UploadSimple weight="duotone" />
                    </Button>
                  </>
                )}
              </div>
            </div>
            <div className="image-tool-controls flex h-full min-h-0 min-w-0 flex-col overflow-x-hidden overflow-y-auto border-border max-[700px]:border-t min-[701px]:border-l [padding-inline-end:var(--overlay-scrollbar-hit-size)]">
              <div className="flex flex-col gap-3 py-3 pl-3 max-[700px]:pl-0">
                <section className="flex flex-col gap-3">
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
                    <h2 className="m-0 min-w-0 font-mono text-[10px] font-medium uppercase tracking-[.04em] text-muted-foreground">
                      {t('imageTool.size')}
                    </h2>
                    <div className="image-tool-size-actions">
                      <Toggle
                        size="sm"
                        className="flex-none"
                        pressed={sizeSession?.mode === 'crop'}
                        disabled={!source}
                        onClick={() => beginSizeEdit('crop')}
                        onPressedChange={() => beginSizeEdit('crop')}
                        aria-label={t('imageTool.crop')}
                      >
                        <Crop data-icon="inline-start" />
                        {t('imageTool.crop')}
                      </Toggle>
                      <Toggle
                        size="sm"
                        className="flex-none"
                        pressed={sizeSession?.mode === 'expand'}
                        disabled={!source}
                        onClick={() => beginSizeEdit('expand')}
                        onPressedChange={() => beginSizeEdit('expand')}
                        aria-label={t('imageTool.expand')}
                      >
                        <ArrowsOut data-icon="inline-start" />
                        {t('imageTool.expand')}
                      </Toggle>
                    </div>
                  </div>
                  {sizeSession ? (
                    <p className="m-0 text-[11px] leading-5 text-muted-foreground" role="status">
                      {sizeSession.mode === 'crop'
                        ? t('imageTool.cropHint')
                        : t('imageTool.expandHint')}
                    </p>
                  ) : null}
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2 min-[701px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <Label
                      htmlFor="image-size-width"
                      className="flex-col items-stretch gap-1.5 text-[11px] text-muted-foreground"
                    >
                      {t('imageTool.width')}
                      <Input
                        id="image-size-width"
                        type="number"
                        min={1}
                        max={MAX_OUTPUT}
                        value={sizeInput.w}
                        disabled={!source}
                        onChange={(event) =>
                          setSizeInput((current) => ({ ...current, w: event.target.value }))
                        }
                      />
                    </Label>
                    <Label
                      htmlFor="image-size-height"
                      className="flex-col items-stretch gap-1.5 text-[11px] text-muted-foreground"
                    >
                      {t('imageTool.height')}
                      <Input
                        id="image-size-height"
                        type="number"
                        min={1}
                        max={MAX_OUTPUT}
                        value={sizeInput.h}
                        disabled={!source}
                        onChange={(event) =>
                          setSizeInput((current) => ({ ...current, h: event.target.value }))
                        }
                      />
                    </Label>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 flex-none min-[701px]:col-span-2"
                      disabled={!source}
                      onClick={applySize}
                    >
                      {t('imageTool.applySize')}
                    </Button>
                  </div>
                  {sizeSession ? (
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-none"
                        onClick={cancelSizeEdit}
                      >
                        {t('imageTool.editCancel')}
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        className="flex-none"
                        onClick={commitSizeEdit}
                      >
                        {t('imageTool.editDone')}
                      </Button>
                    </div>
                  ) : null}
                </section>
                {sizeMode === 'expand' ? (
                  <ImageToolDisclosure
                    id="image-fill-panel"
                    title={t('imageTool.fill')}
                    meta={fillTransparent ? t('imageTool.fillTransparent') : fillColor}
                    open={openFill}
                    onOpenChange={setOpenFill}
                  >
                    <Label
                      htmlFor="image-fill-transparent"
                      className="justify-between text-[11px] text-muted-foreground"
                    >
                      <span>{t('imageTool.fillTransparent')}</span>
                      <Switch
                        id="image-fill-transparent"
                        checked={fillTransparent}
                        onCheckedChange={(checked) => setFillTransparent(checked === true)}
                        size="sm"
                      />
                    </Label>
                    {!fillTransparent ? (
                      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span id="image-fill-color-label">{t('imageTool.fillColor')}</span>
                        <ColorPicker
                          value={fillColor}
                          onValueChange={setFillColor}
                          withoutAlpha
                          defaultFormat="hex"
                        >
                          <ColorPickerTrigger aria-labelledby="image-fill-color-label">
                            <ColorPickerSwatch />
                          </ColorPickerTrigger>
                          <ColorPickerContent>
                            <ColorPickerArea />
                            <ColorPickerHueSlider />
                            <div className="flex items-center gap-2">
                              <ColorPickerEyeDropper />
                              <ColorPickerFormatSelect />
                            </div>
                            <ColorPickerInput withoutAlpha />
                          </ColorPickerContent>
                        </ColorPicker>
                      </div>
                    ) : null}
                  </ImageToolDisclosure>
                ) : null}
                <ImageToolDisclosure
                  id="image-quality-panel"
                  title={t('imageTool.quality')}
                  meta={
                    pngExport
                      ? t('imageTool.outputPng')
                      : t('imageTool.qualityValue', { value: quality })
                  }
                  open={openQuality}
                  onOpenChange={setOpenQuality}
                >
                  <Slider
                    min={1}
                    max={100}
                    step={1}
                    value={[quality]}
                    disabled={!source}
                    aria-labelledby="image-quality-panel-toggle"
                    aria-describedby={pngExport ? 'image-quality-png-hint' : undefined}
                    onValueChange={(value) => {
                      const next = Array.isArray(value) ? value[0] : value;
                      if (typeof next === 'number' && Number.isFinite(next)) setQuality(next);
                    }}
                  />
                  {pngExport ? (
                    <p
                      id="image-quality-png-hint"
                      className="m-0 text-[11px] leading-5 text-muted-foreground"
                    >
                      {t('imageTool.qualityPngHint')}
                    </p>
                  ) : null}
                </ImageToolDisclosure>
                <ImageToolDisclosure
                  id="image-watermark-panel"
                  title={t('imageTool.watermark')}
                  meta={watermarks.length ? String(watermarks.length) : undefined}
                  open={openWatermark}
                  onOpenChange={setOpenWatermark}
                >
                  <Label
                    htmlFor="image-wm-text"
                    className="flex-col items-stretch gap-1.5 text-[11px] text-muted-foreground"
                  >
                    {t('imageTool.watermarkText')}
                    <Input
                      id="image-wm-text"
                      value={form.text}
                      placeholder={t('imageTool.watermarkTextPlaceholder')}
                      onChange={(event) => patchDraft({ text: event.target.value })}
                    />
                  </Label>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                      <span id="image-wm-color-label">{t('imageTool.watermarkColor')}</span>
                      <ColorPicker
                        value={form.color}
                        onValueChange={(value) => patchDraft({ color: value })}
                      >
                        <ColorPickerTrigger aria-labelledby="image-wm-color-label">
                          <ColorPickerSwatch />
                        </ColorPickerTrigger>
                        <ColorPickerContent>
                          <ColorPickerArea />
                          <ColorPickerHueSlider />
                          <ColorPickerAlphaSlider />
                          <div className="flex items-center gap-2">
                            <ColorPickerEyeDropper />
                            <ColorPickerFormatSelect />
                          </div>
                          <ColorPickerInput />
                        </ColorPickerContent>
                      </ColorPicker>
                    </div>
                    <div className="flex min-w-0 flex-col gap-1.5 text-[11px] text-muted-foreground">
                      <span id="image-wm-font-label">{t('imageTool.watermarkFont')}</span>
                      <Select
                        value={form.font}
                        items={FONTS.map((font) => ({ value: font.value, label: t(font.key) }))}
                        onValueChange={(value) => {
                          if (value) patchDraft({ font: value });
                        }}
                      >
                        <SelectTrigger
                          className="h-8 w-full min-w-0 text-[11px]"
                          aria-labelledby="image-wm-font-label"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FONTS.map((font) => (
                            <SelectItem key={font.key} value={font.value}>
                              {t(font.key)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Label
                      htmlFor="image-wm-size"
                      className="flex-col items-stretch gap-1.5 text-[11px] text-muted-foreground"
                    >
                      {t('imageTool.fontSize')}
                      <Input
                        id="image-wm-size"
                        type="number"
                        min={8}
                        max={400}
                        value={form.fontSize}
                        onChange={(event) =>
                          patchDraft({ fontSize: clamp(Number(event.target.value) || 8, 8, 400) })
                        }
                      />
                    </Label>
                    <Label
                      htmlFor="image-wm-letter"
                      className="flex-col items-stretch gap-1.5 text-[11px] text-muted-foreground"
                    >
                      {t('imageTool.letterSpacing')}
                      <Input
                        id="image-wm-letter"
                        type="number"
                        min={-20}
                        max={80}
                        value={form.letterSpacing}
                        onChange={(event) =>
                          patchDraft({
                            letterSpacing: clamp(Number(event.target.value) || 0, -20, 80),
                          })
                        }
                      />
                    </Label>
                    <Label
                      htmlFor="image-wm-line"
                      className="flex-col items-stretch gap-1.5 text-[11px] text-muted-foreground"
                    >
                      {t('imageTool.lineSpacing')}
                      <Input
                        id="image-wm-line"
                        type="number"
                        min={-20}
                        max={80}
                        value={form.lineSpacing}
                        onChange={(event) =>
                          patchDraft({
                            lineSpacing: clamp(Number(event.target.value) || 0, -20, 80),
                          })
                        }
                      />
                    </Label>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!source || !form.text.trim()}
                      onClick={addWatermark}
                    >
                      <Plus data-icon="inline-start" />
                      {t('imageTool.addWatermark')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!selectedId}
                      aria-label={t('imageTool.removeWatermark')}
                      onClick={() => {
                        setWatermarks((list) => list.filter((item) => item.id !== selectedId));
                        clearSelection();
                      }}
                    >
                      <Trash data-icon="inline-start" />
                      {t('imageTool.removeWatermark')}
                    </Button>
                  </div>
                </ImageToolDisclosure>
              </div>
            </div>
          </div>
        </ToolLayoutContent>
        <ToolLayoutFooter>
          <ToolActionBar
            label={t('imageTool.actions')}
            actions={[
              {
                key: 'clear',
                label: t('imageTool.clear'),
                icon: Trash,
                variant: 'tertiary',
                disabled: !source,
                onPress: () => resetImage(null),
              },
              {
                key: 'restore',
                label: t('imageTool.restore'),
                icon: ArrowCounterClockwise,
                variant: 'tertiary',
                disabled: !source,
                onPress: () => {
                  if (source) resetImage(source);
                },
              },
              {
                key: 'export',
                label: t('imageTool.export'),
                icon: DownloadSimple,
                variant: 'primary',
                disabled: !source || Boolean(sizeSession) || pointer.dragging,
                onPress: () => void exportImage(),
              },
            ]}
          />
        </ToolLayoutFooter>
      </ToolLayout>
    </Reveal>
  );
}
