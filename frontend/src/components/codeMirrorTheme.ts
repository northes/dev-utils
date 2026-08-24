import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

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
    backgroundColor: 'var(--accent-soft)',
    borderColor: 'var(--border)',
    color: 'var(--primary)',
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
export const quietEditorTheme = [quietBase, syntaxHighlighting(quietSyntax)];
