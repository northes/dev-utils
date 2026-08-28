import * as React from 'react';
import { Slider as SliderPrimitive } from '@base-ui/react/slider';
import { Eyedropper } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Input } from './input';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

const colorFormats = ['hex', 'rgb', 'hsl', 'hsb'] as const;
type ColorFormat = (typeof colorFormats)[number];
type ColorValue = { r: number; g: number; b: number; a: number };
type HSVColorValue = { h: number; s: number; v: number; a: number };

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
function toHex(n: number) {
  return Math.round(clamp(n, 0, 255))
    .toString(16)
    .padStart(2, '0');
}
function rgbToHex(color: ColorValue, withAlpha = false) {
  const hex = `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
  if (!withAlpha || color.a >= 1) return hex;
  return `${hex}${toHex(color.a * 255)}`;
}
function hexToRgb(hex: string, alpha = 1): ColorValue {
  const raw = hex.replace('#', '');
  if (raw.length === 3) {
    return {
      r: Number.parseInt(raw[0] + raw[0], 16),
      g: Number.parseInt(raw[1] + raw[1], 16),
      b: Number.parseInt(raw[2] + raw[2], 16),
      a: alpha,
    };
  }
  if (raw.length === 8) {
    return {
      r: Number.parseInt(raw.slice(0, 2), 16),
      g: Number.parseInt(raw.slice(2, 4), 16),
      b: Number.parseInt(raw.slice(4, 6), 16),
      a: Number.parseInt(raw.slice(6, 8), 16) / 255,
    };
  }
  if (raw.length === 6) {
    return {
      r: Number.parseInt(raw.slice(0, 2), 16),
      g: Number.parseInt(raw.slice(2, 4), 16),
      b: Number.parseInt(raw.slice(4, 6), 16),
      a: alpha,
    };
  }
  return { r: 0, g: 0, b: 0, a: alpha };
}
function rgbToHsv(color: ColorValue): HSVColorValue {
  const r = color.r / 255,
    g = color.g / 255,
    b = color.b / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    diff = max - min;
  let h = 0;
  if (diff !== 0) {
    if (max === r) h = ((g - b) / diff) % 6;
    else if (max === g) h = (b - r) / diff + 2;
    else h = (r - g) / diff + 4;
  }
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  return {
    h,
    s: Math.round((max === 0 ? 0 : diff / max) * 100),
    v: Math.round(max * 100),
    a: color.a,
  };
}
function hsvToRgb(hsv: HSVColorValue): ColorValue {
  const h = hsv.h / 360,
    s = hsv.s / 100,
    v = hsv.v / 100;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const map = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][i % 6] ?? [0, 0, 0];
  return {
    r: Math.round(map[0] * 255),
    g: Math.round(map[1] * 255),
    b: Math.round(map[2] * 255),
    a: hsv.a,
  };
}
function rgbToHsl(color: ColorValue) {
  const r = color.r / 255,
    g = color.g / 255,
    b = color.b / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    diff = max - min,
    sum = max + min,
    l = sum / 2;
  let h = 0,
    s = 0;
  if (diff !== 0) {
    s = l > 0.5 ? diff / (2 - sum) : diff / sum;
    if (max === r) h = (g - b) / diff + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / diff + 2;
    else h = (r - g) / diff + 4;
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}
function hslToRgb(hsl: { h: number; s: number; l: number }, alpha = 1): ColorValue {
  const h = hsl.h / 360,
    s = hsl.s / 100,
    l = hsl.l / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 1 / 6) [r, g, b] = [c, x, 0];
  else if (h < 2 / 6) [r, g, b] = [x, c, 0];
  else if (h < 3 / 6) [r, g, b] = [0, c, x];
  else if (h < 4 / 6) [r, g, b] = [0, x, c];
  else if (h < 5 / 6) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
    a: alpha,
  };
}
function colorToString(color: ColorValue, format: ColorFormat = 'hex'): string {
  if (format === 'rgb' || format === 'hsb')
    return color.a < 1
      ? `rgba(${color.r}, ${color.g}, ${color.b}, ${Number(color.a.toFixed(2))})`
      : `rgb(${color.r}, ${color.g}, ${color.b})`;
  if (format === 'hsl') {
    const hsl = rgbToHsl(color);
    return color.a < 1
      ? `hsla(${hsl.h}, ${hsl.s}%, ${hsl.l}%, ${Number(color.a.toFixed(2))})`
      : `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
  }
  return rgbToHex(color, color.a < 1);
}
function hsbToDisplayString(color: ColorValue): string {
  const hsv = rgbToHsv(color);
  return color.a < 1
    ? `hsba(${hsv.h}, ${hsv.s}%, ${hsv.v}%, ${Number(color.a.toFixed(2))})`
    : `hsb(${hsv.h}, ${hsv.s}%, ${hsv.v}%)`;
}
function parseColorString(value: string): ColorValue | null {
  const trimmed = value.trim();
  const hexValue = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  if (/^#([a-fA-F0-9]{3}|[a-fA-F0-9]{6}|[a-fA-F0-9]{8})$/.test(hexValue)) return hexToRgb(hexValue);
  if (trimmed.startsWith('#')) return null;
  const rgb = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/);
  if (rgb)
    return {
      r: Number(rgb[1]),
      g: Number(rgb[2]),
      b: Number(rgb[3]),
      a: rgb[4] ? Number(rgb[4]) : 1,
    };
  const hsl = trimmed.match(/^hsla?\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*(?:,\s*([\d.]+))?\s*\)$/);
  if (hsl)
    return hslToRgb(
      { h: Number(hsl[1]), s: Number(hsl[2]), l: Number(hsl[3]) },
      hsl[4] ? Number(hsl[4]) : 1,
    );
  const hsb = trimmed.match(/^hsba?\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*(?:,\s*([\d.]+))?\s*\)$/);
  if (hsb)
    return hsvToRgb({
      h: Number(hsb[1]),
      s: Number(hsb[2]),
      v: Number(hsb[3]),
      a: hsb[4] ? Number(hsb[4]) : 1,
    });
  return null;
}

type StoreState = { color: ColorValue; hsv: HSVColorValue; open: boolean; format: ColorFormat };
type Store = {
  subscribe: (cb: () => void) => () => void;
  getState: () => StoreState;
  setColor: (value: ColorValue) => void;
  setHsv: (value: HSVColorValue) => void;
  setOpen: (value: boolean) => void;
  setFormat: (value: ColorFormat) => void;
};

const StoreContext = React.createContext<Store | null>(null);
const PickerContext = React.createContext<{
  disabled?: boolean;
  inline?: boolean;
  withoutAlpha?: boolean;
} | null>(null);

function useStoreContext() {
  const store = React.useContext(StoreContext);
  if (!store) throw new Error('ColorPicker parts must be used within ColorPicker');
  return store;
}
function usePickerContext() {
  const context = React.useContext(PickerContext);
  if (!context) throw new Error('ColorPicker parts must be used within ColorPicker');
  return context;
}
function useStore<T>(selector: (state: StoreState) => T) {
  const store = useStoreContext();
  return React.useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
    () => selector(store.getState()),
  );
}

export type ColorPickerProps = {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  format?: ColorFormat;
  defaultFormat?: ColorFormat;
  onFormatChange?: (format: ColorFormat) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  inline?: boolean;
  withoutAlpha?: boolean;
  className?: string;
  children?: React.ReactNode;
};

export function ColorPicker({
  value,
  defaultValue = '#000000',
  onValueChange,
  format,
  defaultFormat = 'hex',
  onFormatChange,
  open,
  defaultOpen = false,
  onOpenChange,
  disabled,
  inline,
  withoutAlpha,
  className,
  children,
}: ColorPickerProps) {
  const listeners = React.useRef(new Set<() => void>());
  const onValueChangeRef = React.useRef(onValueChange);
  const onOpenChangeRef = React.useRef(onOpenChange);
  const onFormatChangeRef = React.useRef(onFormatChange);
  onValueChangeRef.current = onValueChange;
  onOpenChangeRef.current = onOpenChange;
  onFormatChangeRef.current = onFormatChange;
  const initial = parseColorString(value ?? defaultValue) ?? { r: 0, g: 0, b: 0, a: 1 };
  if (withoutAlpha) initial.a = 1;
  const stateRef = React.useRef<StoreState>({
    color: initial,
    hsv: rgbToHsv(initial),
    open: open ?? defaultOpen,
    format: format ?? defaultFormat,
  });
  const store = React.useMemo<Store>(
    () => ({
      subscribe: (cb) => {
        listeners.current.add(cb);
        return () => listeners.current.delete(cb);
      },
      getState: () => stateRef.current,
      setColor: (next) => {
        const color = withoutAlpha ? { ...next, a: 1 } : next;
        stateRef.current.color = color;
        onValueChangeRef.current?.(colorToString(color, stateRef.current.format));
        listeners.current.forEach((cb) => cb());
      },
      setHsv: (next) => {
        const hsv = withoutAlpha ? { ...next, a: 1 } : next;
        stateRef.current.hsv = hsv;
        const color = hsvToRgb(hsv);
        stateRef.current.color = color;
        onValueChangeRef.current?.(colorToString(color, stateRef.current.format));
        listeners.current.forEach((cb) => cb());
      },
      setOpen: (next) => {
        stateRef.current.open = next;
        onOpenChangeRef.current?.(next);
        listeners.current.forEach((cb) => cb());
      },
      setFormat: (next) => {
        stateRef.current.format = next;
        onFormatChangeRef.current?.(next);
        listeners.current.forEach((cb) => cb());
      },
    }),
    [withoutAlpha],
  );

  React.useLayoutEffect(() => {
    if (value === undefined) return;
    const parsed = parseColorString(value);
    if (!parsed) return;
    const color = withoutAlpha ? { ...parsed, a: 1 } : parsed;
    stateRef.current.color = color;
    stateRef.current.hsv = rgbToHsv(color);
    listeners.current.forEach((cb) => cb());
  }, [value, withoutAlpha]);

  React.useLayoutEffect(() => {
    if (open !== undefined) store.setOpen(open);
  }, [open, store]);

  const openState = useSyncOpen(store);
  const body = (
    <PickerContext.Provider value={{ disabled, inline, withoutAlpha }}>
      <div data-slot="color-picker" className={cn('inline-flex', className)}>
        {children}
      </div>
    </PickerContext.Provider>
  );
  if (inline) return <StoreContext.Provider value={store}>{body}</StoreContext.Provider>;
  return (
    <StoreContext.Provider value={store}>
      <Popover open={openState} onOpenChange={store.setOpen}>
        {body}
      </Popover>
    </StoreContext.Provider>
  );
}

function useSyncOpen(store: Store) {
  return React.useSyncExternalStore(
    store.subscribe,
    () => store.getState().open,
    () => store.getState().open,
  );
}

export function ColorPickerTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Button>) {
  const context = usePickerContext();
  return (
    <PopoverTrigger
      disabled={context.disabled}
      nativeButton
      render={
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          disabled={context.disabled}
          className={cn('min-w-8 p-1', className)}
          {...props}
        />
      }
    >
      {children}
    </PopoverTrigger>
  );
}

export function ColorPickerContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof PopoverContent>) {
  const context = usePickerContext();
  if (context.inline)
    return (
      <div
        data-slot="color-picker-content"
        className={cn('flex w-[280px] flex-col gap-3 p-1', className)}
      >
        {children}
      </div>
    );
  return (
    <PopoverContent
      data-slot="color-picker-content"
      align="end"
      className={cn('w-[280px] gap-3 p-3', className)}
      {...props}
    >
      {children}
    </PopoverContent>
  );
}

export function ColorPickerArea({ className, ...props }: React.ComponentProps<'div'>) {
  const store = useStoreContext();
  const context = usePickerContext();
  const hsv = useStore((state) => state.hsv);
  const { t } = useTranslation();
  const areaRef = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{ pointerId: number } | null>(null);

  const applyPoint = React.useCallback(
    (clientX: number, clientY: number) => {
      const el = areaRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / rect.width, 0, 1);
      const y = clamp(1 - (clientY - rect.top) / rect.height, 0, 1);
      const current = store.getState().hsv;
      store.setHsv({ h: current.h, s: Math.round(x * 100), v: Math.round(y * 100), a: current.a });
    },
    [store],
  );

  const stop = React.useCallback(() => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    const el = areaRef.current;
    try {
      if (el?.hasPointerCapture(current.pointerId)) el.releasePointerCapture(current.pointerId);
    } catch {
      /* already released */
    }
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onHidden);
  }, []);

  const onMove = (event: PointerEvent) => {
    if (!drag.current || event.pointerId !== drag.current.pointerId) return;
    applyPoint(event.clientX, event.clientY);
  };
  const onUp = (event: PointerEvent) => {
    if (drag.current && event.pointerId === drag.current.pointerId) stop();
  };
  const onBlur = () => stop();
  const onHidden = () => {
    if (document.hidden) stop();
  };

  React.useEffect(() => () => stop(), [stop]);

  const hue = hsvToRgb({ h: hsv.h, s: 100, v: 100, a: 1 });

  return (
    <div
      ref={areaRef}
      role="slider"
      tabIndex={context.disabled ? -1 : 0}
      aria-label={t('colorPicker.area')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={hsv.s}
      data-slot="color-picker-area"
      className={cn(
        'relative h-36 w-full cursor-crosshair touch-none rounded-md border border-border',
        context.disabled && 'pointer-events-none opacity-50',
        className,
      )}
      onPointerDown={(event) => {
        if (context.disabled) return;
        event.preventDefault();
        stop();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId };
        applyPoint(event.clientX, event.clientY);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
        window.addEventListener('blur', onBlur);
        document.addEventListener('visibilitychange', onHidden);
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 10 : 2;
        let s = hsv.s,
          v = hsv.v;
        if (event.key === 'ArrowRight') s += step;
        else if (event.key === 'ArrowLeft') s -= step;
        else if (event.key === 'ArrowUp') v += step;
        else if (event.key === 'ArrowDown') v -= step;
        else return;
        event.preventDefault();
        store.setHsv({ ...hsv, s: clamp(s, 0, 100), v: clamp(v, 0, 100) });
      }}
      {...props}
    >
      <div className="absolute inset-0 overflow-hidden rounded-[inherit]">
        <div
          className="absolute inset-0"
          style={{ backgroundColor: `rgb(${hue.r}, ${hue.g}, ${hue.b})` }}
        />
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to right, #fff, transparent)' }}
        />
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to bottom, transparent, #000)' }}
        />
      </div>
      <div
        className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-sm"
        style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%` }}
      />
    </div>
  );
}

function HueSliderTrack() {
  return (
    <SliderPrimitive.Track className="relative h-3 w-full grow overflow-hidden rounded-full bg-[linear-gradient(to_right,#ff0000_0%,#ffff00_16.66%,#00ff00_33.33%,#00ffff_50%,#0000ff_66.66%,#ff00ff_83.33%,#ff0000_100%)]" />
  );
}

export function ColorPickerHueSlider({ className, ...props }: SliderPrimitive.Root.Props<number>) {
  const store = useStoreContext();
  const context = usePickerContext();
  const hsv = useStore((state) => state.hsv);
  const { t } = useTranslation();
  return (
    <SliderPrimitive.Root
      data-slot="color-picker-hue-slider"
      min={0}
      max={360}
      step={1}
      value={hsv.h}
      disabled={context.disabled}
      aria-label={t('colorPicker.hue')}
      className={cn('relative flex w-full touch-none items-center select-none', className)}
      onValueChange={(value) => store.setHsv({ ...store.getState().hsv, h: value })}
      {...props}
    >
      <SliderPrimitive.Control className="relative flex h-3 w-full items-center">
        <HueSliderTrack />
        <SliderPrimitive.Thumb className="block size-4 rounded-full border border-border bg-background shadow-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none" />
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export function ColorPickerAlphaSlider({
  className,
  ...props
}: SliderPrimitive.Root.Props<number>) {
  const store = useStoreContext();
  const context = usePickerContext();
  const color = useStore((state) => state.color);
  const { t } = useTranslation();
  if (context.withoutAlpha) return null;
  const gradient = `rgb(${color.r}, ${color.g}, ${color.b})`;
  return (
    <SliderPrimitive.Root
      data-slot="color-picker-alpha-slider"
      min={0}
      max={100}
      step={1}
      value={Math.round(color.a * 100)}
      disabled={context.disabled}
      aria-label={t('colorPicker.alpha')}
      className={cn('relative flex w-full touch-none items-center select-none', className)}
      onValueChange={(value) => {
        const a = value / 100;
        const current = store.getState();
        store.setColor({ ...current.color, a });
        store.setHsv({ ...current.hsv, a });
      }}
      {...props}
    >
      <SliderPrimitive.Control className="relative flex h-3 w-full items-center">
        <SliderPrimitive.Track
          className="relative h-3 w-full grow overflow-hidden rounded-full"
          style={{
            background:
              'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)',
            backgroundSize: '8px 8px',
            backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0',
          }}
        >
          <div
            className="absolute inset-0 rounded-full"
            style={{ background: `linear-gradient(to right, transparent, ${gradient})` }}
          />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="block size-4 rounded-full border border-border bg-background shadow-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none" />
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export function ColorPickerSwatch({ className, ...props }: React.ComponentProps<'div'>) {
  const color = useStore((state) => state.color);
  const format = useStore((state) => state.format);
  const { t } = useTranslation();
  const colorString = `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`;
  return (
    <div
      role="img"
      aria-label={t('colorPicker.current', {
        value: format === 'hsb' ? hsbToDisplayString(color) : colorToString(color, format),
      })}
      data-slot="color-picker-swatch"
      className={cn('size-6 rounded-md border border-border shadow-sm', className)}
      style={
        color.a < 1
          ? {
              background: `linear-gradient(${colorString}, ${colorString}), repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 0% 50% / 8px 8px`,
            }
          : { backgroundColor: colorString }
      }
      {...props}
    />
  );
}

export function ColorPickerEyeDropper(props: React.ComponentProps<typeof Button>) {
  const store = useStoreContext();
  const context = usePickerContext();
  const { t } = useTranslation();
  const [supported, setSupported] = React.useState(false);
  React.useEffect(() => {
    setSupported(typeof window !== 'undefined' && Boolean(window.EyeDropper));
  }, []);
  if (!supported) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      aria-label={t('colorPicker.eyedropper')}
      disabled={context.disabled}
      onClick={async () => {
        if (!window.EyeDropper) return;
        try {
          const result = await new window.EyeDropper().open();
          if (!result.sRGBHex) return;
          const color = hexToRgb(result.sRGBHex, store.getState().color.a);
          store.setColor(color);
          store.setHsv(rgbToHsv(color));
        } catch {
          /* user cancelled */
        }
      }}
      {...props}
    >
      <Eyedropper />
    </Button>
  );
}

export function ColorPickerFormatSelect({ className }: { className?: string }) {
  const store = useStoreContext();
  const context = usePickerContext();
  const format = useStore((state) => state.format);
  const { t } = useTranslation();
  return (
    <Select
      value={format}
      disabled={context.disabled}
      items={colorFormats.map((item) => ({ value: item, label: item.toUpperCase() }))}
      onValueChange={(value) => {
        if (typeof value === 'string' && colorFormats.includes(value as ColorFormat))
          store.setFormat(value as ColorFormat);
      }}
    >
      <SelectTrigger
        size="sm"
        className={cn('h-8 min-w-18 text-[11px]', className)}
        aria-label={t('colorPicker.format')}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {colorFormats.map((item) => (
          <SelectItem key={item} value={item}>
            {item.toUpperCase()}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function hexHasExplicitAlpha(value: string) {
  const raw = value.trim().replace(/^#/, '');
  return raw.length === 8;
}

function HexTextInput({
  color,
  disabled,
  hideAlpha,
  className,
  ariaLabel,
  onCommit,
}: {
  color: ColorValue;
  disabled?: boolean;
  hideAlpha: boolean;
  className?: string;
  ariaLabel: string;
  onCommit: (color: ColorValue) => void;
}) {
  const committed = rgbToHex(color);
  const [draft, setDraft] = React.useState(committed);
  const focusedRef = React.useRef(false);
  React.useEffect(() => {
    setDraft(committed);
  }, [committed]);
  const commit = () => {
    const parsed = parseColorString(draft);
    if (!parsed) {
      setDraft(committed);
      return;
    }
    onCommit({
      ...parsed,
      a: hideAlpha ? 1 : hexHasExplicitAlpha(draft) ? parsed.a : color.a,
    });
  };
  return (
    <Input
      aria-label={ariaLabel}
      className={cn('h-8 font-mono text-[11px]', className)}
      value={draft}
      disabled={disabled}
      spellCheck={false}
      autoComplete="off"
      onFocus={() => {
        focusedRef.current = true;
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        focusedRef.current = false;
        commit();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        focusedRef.current = false;
        commit();
        event.currentTarget.blur();
      }}
    />
  );
}

export function ColorPickerInput({
  withoutAlpha,
  className,
}: {
  withoutAlpha?: boolean;
  className?: string;
}) {
  const store = useStoreContext();
  const context = usePickerContext();
  const color = useStore((state) => state.color);
  const format = useStore((state) => state.format);
  const hsv = useStore((state) => state.hsv);
  const hideAlpha = withoutAlpha ?? context.withoutAlpha;
  const { t } = useTranslation();
  const apply = (next: ColorValue) => {
    const colorValue = hideAlpha ? { ...next, a: 1 } : next;
    store.setColor(colorValue);
    store.setHsv(rgbToHsv(colorValue));
  };
  if (format === 'hex') {
    return (
      <div className={cn('flex min-w-0 flex-1 items-center', className)}>
        <HexTextInput
          color={color}
          disabled={context.disabled}
          hideAlpha={Boolean(hideAlpha)}
          className={hideAlpha ? '' : 'rounded-r-none'}
          ariaLabel={t('colorPicker.hex')}
          onCommit={apply}
        />
        {hideAlpha ? null : (
          <Input
            aria-label={t('colorPicker.alpha')}
            className="h-8 w-14 rounded-l-none border-l-0 text-[11px]"
            inputMode="numeric"
            value={Math.round(color.a * 100)}
            disabled={context.disabled}
            onChange={(event) => {
              const n = Number(event.target.value);
              if (!Number.isNaN(n)) apply({ ...color, a: clamp(n, 0, 100) / 100 });
            }}
          />
        )}
      </div>
    );
  }
  const channels =
    format === 'rgb'
      ? [
          { key: 'r', value: color.r, max: 255, label: t('colorPicker.red') },
          { key: 'g', value: color.g, max: 255, label: t('colorPicker.green') },
          { key: 'b', value: color.b, max: 255, label: t('colorPicker.blue') },
        ]
      : format === 'hsl'
        ? [
            { key: 'h', value: rgbToHsl(color).h, max: 360, label: t('colorPicker.hue') },
            { key: 's', value: rgbToHsl(color).s, max: 100, label: t('colorPicker.saturation') },
            { key: 'l', value: rgbToHsl(color).l, max: 100, label: t('colorPicker.lightness') },
          ]
        : [
            { key: 'h', value: hsv.h, max: 360, label: t('colorPicker.hue') },
            { key: 's', value: hsv.s, max: 100, label: t('colorPicker.saturation') },
            { key: 'v', value: hsv.v, max: 100, label: t('colorPicker.brightness') },
          ];
  return (
    <div className={cn('flex min-w-0 flex-1 items-center', className)}>
      {channels.map((channel, index) => (
        <Input
          key={channel.key}
          aria-label={channel.label}
          className={cn(
            'h-8 min-w-0 flex-1 px-1.5 text-center text-[11px]',
            index === 0 ? 'rounded-r-none' : 'rounded-none border-l-0',
            hideAlpha && index === channels.length - 1 ? 'rounded-r-lg' : '',
          )}
          inputMode="numeric"
          value={channel.value}
          disabled={context.disabled}
          onChange={(event) => {
            const n = Number(event.target.value);
            if (Number.isNaN(n)) return;
            const next = clamp(n, 0, channel.max);
            if (format === 'rgb') apply({ ...color, [channel.key]: next });
            else if (format === 'hsl') {
              const hsl = rgbToHsl(color);
              apply(hslToRgb({ ...hsl, [channel.key]: next }, color.a));
            } else {
              const nextHsv = { ...hsv, [channel.key]: next };
              store.setHsv(nextHsv);
            }
          }}
        />
      ))}
      {hideAlpha ? null : (
        <Input
          aria-label={t('colorPicker.alpha')}
          className="h-8 w-12 rounded-l-none border-l-0 px-1.5 text-center text-[11px]"
          inputMode="numeric"
          value={Math.round(color.a * 100)}
          disabled={context.disabled}
          onChange={(event) => {
            const n = Number(event.target.value);
            if (!Number.isNaN(n)) apply({ ...color, a: clamp(n, 0, 100) / 100 });
          }}
        />
      )}
    </div>
  );
}

declare global {
  interface Window {
    EyeDropper?: { new (): { open: () => Promise<{ sRGBHex: string }> } };
  }
}
