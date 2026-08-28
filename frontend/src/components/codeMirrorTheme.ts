import {
  codeFolding,
  foldable,
  foldEffect,
  foldedRanges,
  getIndentUnit,
  HighlightStyle,
  syntaxHighlighting,
  syntaxTree,
  unfoldEffect,
} from '@codemirror/language';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { indentationMarkers } from '@replit/codemirror-indentation-markers';

const indentMarkerColor = 'color-mix(in srgb, var(--muted-foreground) 20%, transparent)';
const indentMarkerActive = 'color-mix(in srgb, var(--primary) 30%, transparent)';
const indentGuides = indentationMarkers({
  highlightActiveBlock: true,
  hideFirstIndent: false,
  markerType: 'fullScope',
  thickness: 1,
  activeThickness: 1.5,
  colors: {
    light: indentMarkerColor,
    dark: indentMarkerColor,
    activeLight: indentMarkerActive,
    activeDark: indentMarkerActive,
  },
});

const quietBase = EditorView.theme({
  '&': { backgroundColor: 'var(--card)', color: 'var(--foreground)' },
  '.cm-content': { caretColor: 'var(--primary)' },
  '.cm-cursor,.cm-dropCursor': { borderLeftColor: 'var(--primary)' },
  '&.cm-focused .cm-selectionBackground,.cm-selectionBackground,.cm-content ::selection': {
    backgroundColor: 'color-mix(in srgb,var(--primary) 24%,transparent)',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb,var(--primary) 5%,transparent)' },
  '.cm-gutters': {
    backgroundColor: 'var(--muted)',
    color: 'var(--muted-foreground)',
    borderColor: 'var(--border)',
  },
  '.cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb,var(--primary) 8%,transparent)' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 12%, transparent)',
    borderColor: 'var(--border)',
    color: 'var(--primary)',
  },
  '.cm-indent-markers::before': {
    left: '6px',
    zIndex: '0',
  },
  '.cm-indent-guide-foldable': {
    cursor: 'pointer',
    '--indent-marker-bg-color': indentMarkerActive,
    '--indent-marker-active-bg-color': indentMarkerActive,
  },
});
const quietSyntax = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword], color: 'var(--destructive)' },
  {
    tag: [tags.name, tags.variableName, tags.propertyName, tags.attributeName],
    color: 'var(--foreground)',
  },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: 'var(--primary)',
  },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--warning)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--success)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--warning)' },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment],
    color: 'var(--muted-foreground)',
    fontStyle: 'italic',
  },
  { tag: [tags.punctuation, tags.bracket, tags.separator], color: 'var(--foreground)' },
  { tag: [tags.invalid], color: 'var(--destructive)', textDecoration: 'underline' },
]);
function visualIndentColumns(text: string, tabSize: number) {
  let col = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\t') col += tabSize - (col % tabSize);
    else if (ch === ' ' || ch === '\u00A0') col += 1;
    else break;
  }
  return col;
}

function clickedGuideColumn(view: EditorView, event: MouseEvent, lineFrom: number) {
  const start = view.coordsAtPos(lineFrom);
  if (!start) return null;
  const unit = getIndentUnit(view.state);
  if (unit <= 0) return null;
  const ch = view.defaultCharacterWidth;
  if (ch <= 0) return null;
  const relX = event.clientX - start.left;
  const level = Math.round((relX / ch - 0.5) / unit);
  if (level < 0) return null;
  const guideX = (level * unit + 0.5) * ch;
  const hitSlop = Math.min(Math.max(4, ch * 0.4), unit * ch * 0.4);
  if (Math.abs(relX - guideX) > hitSlop) return null;
  return level * unit;
}

function foldRangeForGuide(view: EditorView, lineFrom: number, column: number) {
  if (syntaxTree(view.state).length === 0) return null;
  let block = view.lineBlockAt(lineFrom);
  for (;;) {
    const range = foldable(view.state, block.from, block.to);
    if (range && range.to > lineFrom) {
      const openLine = view.state.doc.lineAt(range.from);
      if (visualIndentColumns(openLine.text, view.state.tabSize) === column) return range;
    }
    if (!block.from) return null;
    block = view.lineBlockAt(block.from - 1);
  }
}

function matchingFold(view: EditorView, range: { from: number; to: number }) {
  let found: { from: number; to: number } | null = null;
  foldedRanges(view.state).between(range.from, range.to, (start, end) => {
    if (start === range.from && end === range.to) found = { from: start, to: end };
  });
  return found;
}

function pointerFoldTarget(view: EditorView, event: MouseEvent) {
  if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return null;
  const target = event.target;
  if (!(target instanceof Element)) return null;
  if (target.closest('.cm-foldPlaceholder, .cm-gutter')) return null;
  if (!target.closest('.cm-indent-markers')) return null;
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos == null) return null;
  const line = view.state.doc.lineAt(pos);
  const indentCols = visualIndentColumns(line.text, view.state.tabSize);
  const indentEnd = line.from + leadingWhitespaceLength(line.text);
  if (line.text.trim() && pos >= indentEnd) return null;
  const column = clickedGuideColumn(view, event, line.from);
  if (column == null) return null;
  if (line.text.trim() && column >= indentCols) return null;
  const range = foldRangeForGuide(view, line.from, column);
  return range ? { range } : null;
}

function leadingWhitespaceLength(text: string) {
  const match = /^[ \t]*/.exec(text);
  return match ? match[0].length : 0;
}

const indentGuideFold = ViewPlugin.fromClass(
  class {
    hot: HTMLElement | null = null;
    clear() {
      this.hot?.classList.remove('cm-indent-guide-foldable');
      this.hot = null;
    }
    setHot(line: HTMLElement | null) {
      if (this.hot === line) return;
      this.clear();
      if (!line) return;
      this.hot = line;
      line.classList.add('cm-indent-guide-foldable');
    }
    destroy() {
      this.clear();
    }
  },
  {
    eventHandlers: {
      mousemove(event, view) {
        if (event.buttons) {
          this.clear();
          return false;
        }
        const hit = pointerFoldTarget(view, event);
        const line = hit
          ? ((event.target as Element).closest('.cm-indent-markers') as HTMLElement | null)
          : null;
        this.setHot(line);
        return false;
      },
      mouseleave() {
        this.clear();
        return false;
      },
      mousedown(event, view) {
        if (event.button !== 0) return false;
        const hit = pointerFoldTarget(view, event);
        if (!hit) return false;
        const folded = matchingFold(view, hit.range);
        view.dispatch({
          effects: folded ? unfoldEffect.of(folded) : foldEffect.of(hit.range),
        });
        event.preventDefault();
        return true;
      },
    },
  },
);

export const quietEditorTheme = [
  indentGuides,
  codeFolding(),
  indentGuideFold,
  quietBase,
  syntaxHighlighting(quietSyntax),
];
