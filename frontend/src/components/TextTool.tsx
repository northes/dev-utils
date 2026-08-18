import {useEffect, useMemo, useRef, useState} from 'react'
import {Popover, PopoverContent, PopoverTrigger} from './ui/popover'
import {Button} from './ui/button'
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from './ui/table'
import {useTranslation} from 'react-i18next'
import {CaretDown, CaretUp, Copy, Trash} from '@phosphor-icons/react'
import CodeMirror from '@uiw/react-codemirror'
import {EditorView} from '@codemirror/view'
import {quietEditorTheme} from './codeMirrorTheme'
import {type PendingAction, Reveal, ToolActionBar, type ToolId, ToolLayout, useFocusOnActivate} from './shared'
import {toast} from './AppToast'

const countDetails = (characters: string[]) => Array.from(characters.reduce((counts, character) => counts.set(character, (counts.get(character) ?? 0) + 1), new Map<string, number>())).sort(([left], [right]) => left.localeCompare(right, 'zh-CN'))
const words = (value: string) => value.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) ?? []
type CaseMode = 'upper' | 'lower' | 'lineUpper' | 'lineLower' | 'wordUpper' | 'wordLower'
const caseModes: CaseMode[] = ['upper', 'lower', 'lineUpper', 'lineLower', 'wordUpper', 'wordLower']
type SortDescriptor = {column: 'entry' | 'count'; direction: 'ascending' | 'descending'}
const transformCase = (value: string, mode: CaseMode) => mode === 'upper' ? value.toUpperCase() : mode === 'lower' ? value.toLowerCase() : mode === 'lineUpper' ? value.replace(/(^|\n)([^\n])/g, (_, start, character) => start + character.toUpperCase()) : mode === 'lineLower' ? value.replace(/(^|\n)([^\n])/g, (_, start, character) => start + character.toLowerCase()) : mode === 'wordUpper' ? value.replace(/[A-Za-z]+/g, word => word[0].toUpperCase() + word.slice(1).toLowerCase()) : value.replace(/[A-Za-z]+/g, word => word[0].toLowerCase() + word.slice(1))

export default function TextTool({active, theme, record, pending, clearPending}: {
    active: boolean;
    theme: string;
    record: (tool: ToolId, action: string, detail: string, input: string) => void;
    pending: PendingAction | null;
    clearPending: () => void
}) {
    const {t} = useTranslation();
    const [value, setValue] = useState('');
    const consumed = useRef<PendingAction | null>(null);
    const inputView = useRef<EditorView | null>(null);
    useFocusOnActivate(active, () => inputView.current?.focus());
    const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({column: 'count', direction: 'descending'});
    const cmTheme = quietEditorTheme;
    const extensions = useMemo(() => [EditorView.lineWrapping], []);
    const stats = useMemo(() => {
        const characters = [...value];
        const wordList = words(value);
        const details: Array<[string, string[]]> = [['chinese', characters.filter(character => /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(character))], ['english', characters.filter(character => /[A-Za-z]/.test(character))], ['digits', characters.filter(character => /\d/.test(character))], ['words', wordList], ['punctuation', characters.filter(character => /[\p{P}]/u.test(character))]];
        return [...details.map(([key, items]) => ({
            key,
            count: items.length,
            details: countDetails(items),
            detail: items.length > 0
        })), {key: 'lines', count: value ? value.split(/\r?\n/).length : 0, details: [], detail: false}, {
            key: 'bytes',
            count: new TextEncoder().encode(value).length,
            details: [],
            detail: false
        }]
    }, [value]);
    const sortDetails = (details: Array<[string, number]>) => [...details].sort(([leftName, leftCount], [rightName, rightCount]) => {
        const order = sortDescriptor.column === 'count' ? leftCount - rightCount : leftName.localeCompare(rightName, 'zh-CN');
        return sortDescriptor.direction === 'descending' ? -order : order
    });
    const toggleSort = (column: 'entry' | 'count') => setSortDescriptor(d => d.column === column ? {column, direction: d.direction === 'ascending' ? 'descending' : 'ascending'} : {column, direction: 'ascending'});
    const copyDetail = (character: string, count: number) => {
        const copied = `${character}: ${count}`;
        navigator.clipboard?.writeText(copied);
        toast(t('toast.copied', {value: copied}));
        record('text', t('textTool.copied'), copied, value)
    };
    const copy = () => {
        navigator.clipboard?.writeText(value);
        toast(t('toast.copied', {value: `${[...value].length} ${t('textTool.characters')}`}));
        record('text', t('textTool.copy'), `${[...value].length} ${t('textTool.characters')}`, value)
    };
    const apply = (action: string, transform: (v: string) => string) => {
        const next = transform(value);
        setValue(next);
        record('text', action, `${[...next].length} ${t('textTool.characters')}`, next)
    };
    const applyCase = (mode: CaseMode) => {
        const next = transformCase(value, mode);
        if (next !== value) {
            setValue(next);
            record('text', t(`textTool.caseModes.${mode}`), `${[...next].length} ${t('textTool.characters')}`, next)
        }
    }
    useEffect(() => {
        if (!pending || pending.tool !== 'text' || consumed.current === pending) return;
        consumed.current = pending;
        clearPending();
        if (pending.action === 'clear') {
            setValue('');
            record('text', t('textTool.cleared'), t('textTool.cleared'), '');
            return
        }
        if (pending.action === 'copy') {
            const toCopy = value.trim() || pending.input;
            if (!toCopy.trim()) {
                toast(t('toast.clipboardEmpty'), {description: t('toast.clipboardEmptyDesc'), variant: 'warning'});
                return
            }
            navigator.clipboard?.writeText(toCopy);
            toast(t('toast.copied', {value: `${[...toCopy].length} ${t('textTool.characters')}`}));
            record('text', t('textTool.copy'), `${[...toCopy].length} ${t('textTool.characters')}`, toCopy);
            return
        }
        const labels: Record<string, string> = {
            trim: t('textTool.trimmed'),
            removeSpaces: t('textTool.removedSpaces'),
            compress: t('textTool.compressedSpaces'),
            compressLine: t('textTool.compressedLine'),
            count: t('textTool.count'),
            lineUpper: t('textTool.caseModes.lineUpper'),
            lineLower: t('textTool.caseModes.lineLower'),
            wordUpper: t('textTool.caseModes.wordUpper'),
            wordLower: t('textTool.caseModes.wordLower'),
            upper: t('textTool.caseModes.upper'),
            lower: t('textTool.caseModes.lower')
        };
        const transforms: Record<string, (s: string) => string> = {
            trim: s => s.trim(),
            removeSpaces: s => s.replace(/[ \t]+/g, ''),
            compress: s => s.replace(/ {2,}/g, ' '),
            compressLine: s => s.replace(/\r\n?|\n/g, ' '),
            upper: s => transformCase(s, 'upper'),
            lower: s => transformCase(s, 'lower'),
            lineUpper: s => transformCase(s, 'lineUpper'),
            lineLower: s => transformCase(s, 'lineLower'),
            wordUpper: s => transformCase(s, 'wordUpper'),
            wordLower: s => transformCase(s, 'wordLower'),
            count: s => s
        };
        const transform = transforms[pending.action];
        if (transform) {
            const next = transform(value);
            if (next !== value) setValue(next);
            record('text', labels[pending.action] ?? pending.action, `${[...next].length} ${t('textTool.characters')}`, next);
            return
        }
        setValue(pending.input)
    }, [pending])
    return <Reveal index={0} fill active={active}><ToolLayout title={t('textTool.title')} desc={t('textTool.subtitle')}
                                                              className="text-page"
                                                              footer={<ToolActionBar label={t('textTool.actions')}
                                                                                     actions={[{
                                                                                         key: 'clear',
                                                                                         label: t('textTool.clear'),
                                                                                         icon: Trash,
                                                                                         variant: 'secondary',
                                                                                         disabled: !value,
                                                                                         onPress: () => {
                                                                                             setValue('');
                                                                                             record('text', t('textTool.cleared'), t('textTool.cleared'), '')
                                                                                         }
                                                                                     }, {
                                                                                         key: 'case',
                                                                                         label: t('textTool.case'),
                                                                                         type: 'select',
                                                                                         disabled: !value,
                                                                                         options: caseModes.map(key => ({
                                                                                             key,
                                                                                             label: t(`textTool.caseModes.${key}`)
                                                                                         })),
                                                                                         onSelect: value => {
                                                                                             if (caseModes.includes(value as CaseMode)) applyCase(value as CaseMode)
                                                                                         }
                                                                                     }, {
                                                                                         key: 'trim',
                                                                                         label: t('textTool.trim'),
                                                                                         variant: 'secondary',
                                                                                         disabled: !value,
                                                                                         onPress: () => apply(t('textTool.trimmed'), v => v.trim())
                                                                                     }, {
                                                                                         key: 'compressSpaces',
                                                                                         label: t('textTool.compressSpaces'),
                                                                                         variant: 'secondary',
                                                                                         disabled: !value,
                                                                                         onPress: () => apply(t('textTool.compressedSpaces'), v => v.replace(/ {2,}/g, ' '))
                                                                                     }, {
                                                                                         key: 'removeSpaces',
                                                                                         label: t('textTool.removeSpaces'),
                                                                                         variant: 'secondary',
                                                                                         disabled: !value,
                                                                                         onPress: () => apply(t('textTool.removedSpaces'), v => v.replace(/[ \t]+/g, ''))
                                                                                     }, {
                                                                                         key: 'compressLine',
                                                                                         label: t('textTool.compressLine'),
                                                                                         variant: 'secondary',
                                                                                         disabled: !value,
                                                                                          onPress: () => apply(t('textTool.compressedLine'), v => v.replace(/\r\n?|\n/g, ' '))
                                                                                      }, {
                                                                                          key: 'copy',
                                                                                          label: t('textTool.copy'),
                                                                                          icon: Copy,
                                                                                          variant: 'primary',
                                                                                          disabled: !value,
                                                                                          onPress: copy
                                                                                      }]}/>}>
        <div className="editor text-cm-pane"><span>{t('textTool.input')}</span><CodeMirror className="text-cm"
                                                                                           height="100%"
                                                                                           value={value}
                                                                                           onChange={setValue}
                                                                                           onCreateEditor={view => {
                                                                                               inputView.current = view
                                                                                           }}
                                                                                           theme={cmTheme}
                                                                                           extensions={extensions}
                                                                                           basicSetup={{
                                                                                               lineNumbers: true,
                                                                                               foldGutter: false,
                                                                                               highlightActiveLine: false,
                                                                                               highlightActiveLineGutter: false,
                                                                                               autocompletion: false,
                                                                                               closeBrackets: false
                                                                                           }}/></div>
        <div className="text-stat-grid">{stats.map(stat => <div className="text-stat-item" key={stat.key}>{stat.detail ?
            <Popover><PopoverTrigger asChild>
    <Button variant="ghost" className="stat-detail-trigger"
            aria-label={t('textTool.showDetails', {label: t(`textTool.${stat.key}`)})}>
        <span>{t(`textTool.${stat.key}`)}</span><strong>{stat.count.toLocaleString()}</strong></Button>
</PopoverTrigger><PopoverContent className="text-stat-dialog-popover w-[min(320px,calc(100vw-32px))] p-0">{stat.details.length ?
    <Table className="text-stat-table"><TableHeader><TableRow><TableHead className="text-left"><Button variant="ghost" onClick={() => toggleSort('entry')} className="h-auto w-full justify-start gap-1 rounded-sm px-1 py-0 text-left">{t('textTool.detailEntry')}{sortDescriptor.column === 'entry' && (sortDescriptor.direction === 'ascending' ? <CaretUp size={10} weight="bold"/> : <CaretDown size={10} weight="bold"/>)}</Button></TableHead><TableHead className="text-right"><Button variant="ghost" onClick={() => toggleSort('count')} className="h-auto w-full justify-end gap-1 rounded-sm px-1 py-0 text-right">{t('textTool.detailCount')}{sortDescriptor.column === 'count' && (sortDescriptor.direction === 'ascending' ? <CaretUp size={10} weight="bold"/> : <CaretDown size={10} weight="bold"/>)}</Button></TableHead></TableRow></TableHeader><TableBody>{sortDetails(stat.details).map(([character, count]) =>
        <TableRow key={character} onClick={() => copyDetail(character, count)} className="cursor-pointer"><TableCell>{character}</TableCell><TableCell className="text-right">{count.toLocaleString()}</TableCell></TableRow>)}</TableBody></Table> :
    <p>{t('textTool.noDetails')}</p>}</PopoverContent></Popover> : <>
                <span>{t(`textTool.${stat.key}`)}</span><strong>{stat.count.toLocaleString()}</strong></>}</div>)}</div>
    </ToolLayout>


    </Reveal>

}
