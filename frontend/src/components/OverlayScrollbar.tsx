import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

type Axis = 'x' | 'y';
type Thumb = { top: number; left: number; width: number; height: number };
type Drag = { axis: Axis; el: HTMLElement; pointerId: number; start: number; scroll: number };
type Pane = {
  el: HTMLElement;
  id: number;
  controlId: string;
  zIndex: number;
  top: number;
  left: number;
  width: number;
  height: number;
  radius: string;
  v: Thumb | null;
  h: Thumb | null;
  maxX: number;
  maxY: number;
};
type Axes = { x: boolean; y: boolean };
type Layers = {
  dialog: HTMLElement | null;
  floating: HTMLElement | null;
  floatingLevel: number;
  floatingAboveDialog: boolean;
};

const ids = new WeakMap<Element, number>();
let nextId = 0;
function idOf(el: Element) {
  let id = ids.get(el);
  if (id == null) {
    id = ++nextId;
    ids.set(el, id);
  }
  return id;
}

const gap = 3,
  min = 24;
function scrollbarHitSize() {
  const value = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--overlay-scrollbar-hit-size'),
  );
  return Number.isFinite(value) && value > 0 ? value : 0;
}
function axesFor(el: HTMLElement): Axes {
  if (
    !el.isConnected ||
    el.classList.contains('overlay-scroll') ||
    el.closest('.overlay-scroll') ||
    el.closest('[data-slot="command-list"]') ||
    el.closest('.tool-slot.is-hidden')
  )
    return { x: false, y: false };
  const s = getComputedStyle(el);
  if (s.visibility === 'hidden' || s.display === 'none' || s.pointerEvents === 'none')
    return { x: false, y: false };
  const scrollable = (value: string) =>
    value === 'auto' || value === 'scroll' || value === 'overlay';
  return { x: scrollable(s.overflowX), y: scrollable(s.overflowY) };
}
function sourceLevel(el: HTMLElement) {
  let level = 0;
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const z = getComputedStyle(node).zIndex;
    if (z !== 'auto') {
      const value = Number.parseInt(z, 10);
      if (Number.isFinite(value)) level = Math.max(level, value);
    }
  }
  return level;
}
function currentLayers(): Layers {
  const floating = [
    ...document.querySelectorAll<HTMLElement>(
      '[data-slot="popover-content"],[data-slot="select-content"]',
    ),
  ];
  const dialogs = [
    ...document.querySelectorAll<HTMLElement>(
      '[data-slot="dialog-content"], [data-slot="alert-dialog-content"]',
    ),
  ];
  const topFloating = floating.length ? floating[floating.length - 1] : null,
    dialog = dialogs.length ? dialogs[dialogs.length - 1] : null;
  const floatingAboveDialog = !!(
    dialog &&
    topFloating &&
    dialog.compareDocumentPosition(topFloating) & Node.DOCUMENT_POSITION_FOLLOWING
  );
  return {
    dialog,
    floating: topFloating,
    floatingLevel: topFloating ? sourceLevel(topFloating) : 0,
    floatingAboveDialog,
  };
}
function visibleInLayers(el: HTMLElement, layers: Layers) {
  if (layers.dialog) {
    if (!layers.floatingAboveDialog) return layers.dialog.contains(el);
    if (layers.floating?.contains(el)) return true;
    if (!layers.dialog.contains(el)) return false;
    return sourceLevel(el) < layers.floatingLevel;
  }
  if (!layers.floating) return true;
  const owner = el.closest<HTMLElement>(
    '[data-slot="popover-content"],[data-slot="select-content"]',
  );
  if (owner) return owner === layers.floating;
  return sourceLevel(el) < layers.floatingLevel;
}
function layout(el: HTMLElement, layers: Layers, hit: number): Pane | null {
  const axes = axesFor(el),
    r = el.getBoundingClientRect(),
    s = getComputedStyle(el);
  if (!visibleInLayers(el, layers)) return null;
  if (
    r.width <= 0 ||
    r.height <= 0 ||
    r.right <= 0 ||
    r.bottom <= 0 ||
    r.left >= window.innerWidth ||
    r.top >= window.innerHeight
  )
    return null;
  const y = axes.y && el.scrollHeight > el.clientHeight + 1,
    x = axes.x && el.scrollWidth > el.clientWidth + 1;
  if (!x && !y) return null;
  const yTrack = Math.max(0, r.height - gap * 2 - (x ? hit : 0)),
    xTrack = Math.max(0, r.width - gap * 2 - (y ? hit : 0));
  const maxY = el.scrollHeight - el.clientHeight,
    maxX = el.scrollWidth - el.clientWidth;
  const vh = Math.min(yTrack, Math.max(min, (el.clientHeight / el.scrollHeight) * yTrack));
  const hw = Math.min(xTrack, Math.max(min, (el.clientWidth / el.scrollWidth) * xTrack));
  const v =
    y && yTrack > 0
      ? {
          top: gap + (maxY > 0 ? (el.scrollTop / maxY) * (yTrack - vh) : 0),
          left: r.width - hit,
          width: hit,
          height: vh,
        }
      : null;
  const h =
    x && xTrack > 0
      ? {
          top: r.height - hit,
          left: gap + (maxX > 0 ? (el.scrollLeft / maxX) * (xTrack - hw) : 0),
          width: hw,
          height: hit,
        }
      : null;
  const id = idOf(el),
    controlId = el.id || `overlay-scroll-source-${id}`;
  if (!el.id) el.id = controlId;
  return {
    el,
    id,
    controlId,
    zIndex: sourceLevel(el) + 1,
    top: r.top,
    left: r.left,
    width: r.width,
    height: r.height,
    radius: s.borderRadius,
    v,
    h,
    maxX,
    maxY,
  };
}
function overlayMutation(record: MutationRecord) {
  if (record.target instanceof Element && record.target.closest('.overlay-scroll')) return true;
  if (record.type !== 'childList') return false;
  const nodes = [...record.addedNodes, ...record.removedNodes];
  return (
    nodes.length > 0 &&
    nodes.every(
      (node) =>
        node instanceof Element &&
        (node.classList.contains('overlay-scroll') || !!node.closest('.overlay-scroll')),
    )
  );
}

export default function OverlayScrollbar() {
  const { t } = useTranslation();
  const [panes, setPanes] = useState<Pane[]>([]);
  const entriesRef = useRef(new Map<HTMLElement, number>());
  const dragRef = useRef<Drag | null>(null);
  const cleanupDragRef = useRef<() => void>(() => {});
  const resizeRef = useRef<ResizeObserver | null>(null);
  const rafRef = useRef(0);
  const paint = () => {
    window.cancelAnimationFrame(rafRef.current);
    rafRef.current = window.requestAnimationFrame(() => {
      const next: Pane[] = [],
        layers = currentLayers(),
        hit = scrollbarHitSize();
      for (const el of entriesRef.current.keys()) {
        const pane = layout(el, layers, hit);
        if (pane) next.push(pane);
      }
      setPanes(next);
    });
  };
  const unregisterTree = (node: Node) => {
    if (!(node instanceof Element)) return;
    for (const el of entriesRef.current.keys())
      if (el === node || node.contains(el)) {
        resizeRef.current?.unobserve(el);
        entriesRef.current.delete(el);
      }
  };
  const reconcile = (el: HTMLElement) => {
    const axes = axesFor(el),
      eligible = axes.x || axes.y,
      registered = entriesRef.current.has(el);
    if (eligible && !registered) {
      entriesRef.current.set(el, idOf(el));
      resizeRef.current?.observe(el);
    } else if (!eligible && registered) {
      resizeRef.current?.unobserve(el);
      entriesRef.current.delete(el);
    }
  };
  const scan = (node: Node) => {
    if (
      !(node instanceof HTMLElement) ||
      node.classList.contains('overlay-scroll') ||
      node.closest('.overlay-scroll')
    )
      return;
    reconcile(node);
    for (const el of node.querySelectorAll<HTMLElement>('*')) reconcile(el);
  };
  const applyDrag = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId || !(event.buttons & 1)) return;
    const axes = axesFor(drag.el),
      r = drag.el.getBoundingClientRect(),
      hit = scrollbarHitSize();
    const y = axes.y && drag.el.scrollHeight > drag.el.clientHeight + 1,
      x = axes.x && drag.el.scrollWidth > drag.el.clientWidth + 1;
    if (drag.axis === 'y') {
      const track = Math.max(0, r.height - gap * 2 - (x ? hit : 0)),
        thumb = Math.min(
          track,
          Math.max(min, (drag.el.clientHeight / drag.el.scrollHeight) * track),
        ),
        span = track - thumb;
      if (span > 0)
        drag.el.scrollTop =
          drag.scroll +
          ((event.clientY - drag.start) / span) * (drag.el.scrollHeight - drag.el.clientHeight);
    } else {
      const track = Math.max(0, r.width - gap * 2 - (y ? hit : 0)),
        thumb = Math.min(track, Math.max(min, (drag.el.clientWidth / drag.el.scrollWidth) * track)),
        span = track - thumb;
      if (span > 0)
        drag.el.scrollLeft =
          drag.scroll +
          ((event.clientX - drag.start) / span) * (drag.el.scrollWidth - drag.el.clientWidth);
    }
    paint();
  };
  const startDrag = (el: HTMLElement, axis: Axis) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.buttons !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    cleanupDragRef.current();
    const pointerId = event.pointerId,
      target = event.currentTarget;
    dragRef.current = {
      axis,
      el,
      pointerId,
      start: axis === 'y' ? event.clientY : event.clientX,
      scroll: axis === 'y' ? el.scrollTop : el.scrollLeft,
    };
    try {
      target.setPointerCapture(pointerId);
    } catch {}
    const finish = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', end, true);
      document.removeEventListener('pointercancel', end, true);
      window.removeEventListener('blur', finish);
      document.removeEventListener('visibilitychange', visibility);
      try {
        if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
      } catch {}
      cleanupDragRef.current = () => {};
      paint();
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (!(e.buttons & 1)) {
        finish();
        return;
      }
      applyDrag(e);
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId === pointerId) finish();
    };
    const visibility = () => {
      if (document.visibilityState !== 'visible') finish();
    };
    cleanupDragRef.current = finish;
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', end, true);
    document.addEventListener('pointercancel', end, true);
    window.addEventListener('blur', finish);
    document.addEventListener('visibilitychange', visibility);
  };
  const onKey = (pane: Pane, axis: Axis) => (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const el = pane.el,
      page = axis === 'y' ? el.clientHeight : el.clientWidth,
      current = axis === 'y' ? el.scrollTop : el.scrollLeft,
      max = axis === 'y' ? pane.maxY : pane.maxX;
    let next: number | undefined;
    if (event.key === (axis === 'y' ? 'ArrowUp' : 'ArrowLeft')) next = current - 40;
    else if (event.key === (axis === 'y' ? 'ArrowDown' : 'ArrowRight')) next = current + 40;
    else if (event.key === 'PageUp') next = current - page;
    else if (event.key === 'PageDown') next = current + page;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = max;
    if (next == null) return;
    event.preventDefault();
    el[axis === 'y' ? 'scrollTop' : 'scrollLeft'] = Math.max(0, Math.min(max, next));
    paint();
  };
  useEffect(() => {
    resizeRef.current = new ResizeObserver(() => paint());
    scan(document.body);
    paint();
    const onScroll = () => paint(),
      onResize = () => paint();
    const mo = new MutationObserver((records) => {
      let changed = false;
      for (const record of records) {
        if (overlayMutation(record)) continue;
        changed = true;
        if (record.type === 'childList') {
          for (const node of record.removedNodes) unregisterTree(node);
          for (const node of record.addedNodes) scan(node);
        } else if (record.target instanceof HTMLElement) scan(record.target);
      }
      if (changed) paint();
    });
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    mo.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
      attributeFilter: ['class', 'style', 'hidden'],
    });
    return () => {
      cleanupDragRef.current();
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      mo.disconnect();
      resizeRef.current?.disconnect();
      entriesRef.current.clear();
      window.cancelAnimationFrame(rafRef.current);
    };
  }, []);
  return (
    <>
      {panes.map((pane) => (
        <div
          key={pane.id}
          className="overlay-scroll fixed overflow-hidden pointer-events-none"
          style={
            {
              top: pane.top,
              left: pane.left,
              width: pane.width,
              height: pane.height,
              borderRadius: pane.radius,
              zIndex: pane.zIndex,
            } as CSSProperties
          }
        >
          {pane.v && (
            <div
              className="overlay-scroll-thumb overlay-scroll-thumb-y absolute pointer-events-auto touch-none cursor-default outline-none"
              role="scrollbar"
              tabIndex={0}
              aria-label={t('scrollbar.vertical')}
              aria-controls={pane.controlId}
              aria-orientation="vertical"
              aria-valuemin={0}
              aria-valuemax={Math.round(pane.maxY)}
              aria-valuenow={Math.round(pane.el.scrollTop)}
              style={pane.v}
              onKeyDown={onKey(pane, 'y')}
              onPointerDown={startDrag(pane.el, 'y')}
            />
          )}{' '}
          {pane.h && (
            <div
              className="overlay-scroll-thumb overlay-scroll-thumb-x absolute pointer-events-auto touch-none cursor-default outline-none"
              role="scrollbar"
              tabIndex={0}
              aria-label={t('scrollbar.horizontal')}
              aria-controls={pane.controlId}
              aria-orientation="horizontal"
              aria-valuemin={0}
              aria-valuemax={Math.round(pane.maxX)}
              aria-valuenow={Math.round(pane.el.scrollLeft)}
              style={pane.h}
              onKeyDown={onKey(pane, 'x')}
              onPointerDown={startDrag(pane.el, 'x')}
            />
          )}
        </div>
      ))}
    </>
  );
}
