import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
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
export const quietEditorTheme = [indentGuides, quietBase, syntaxHighlighting(quietSyntax)];
