import {useEffect, useMemo, useRef, useState} from 'react'
import {Popover, type SortDescriptor, Table} from '@heroui/react'
import {useTranslation} from 'react-i18next'
import {Trash} from '@phosphor-icons/react'
import CodeMirror from '@uiw/react-codemirror'
import {EditorView} from '@codemirror/view'
import {tokyoNight} from '@uiw/codemirror-theme-tokyo-night'
import {tokyoNightDay} from '@uiw/codemirror-theme-tokyo-night-day'
import {type PendingAction, Reveal, ToolActionBar, type ToolId, ToolLayout, useFocusOnActivate} from './shared'
import {toast} from './AppToast'

const countDetails = (characters: string[]) => Array.from(characters.reduce((counts, character) => counts.set(character, (counts.get(character) ?? 0) + 1), new Map<string, number>())).sort(([left], [right]) => left.localeCompare(right, 'zh-CN'))
const words = (value: string) => value.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) ?? []
type CaseMode = 'upper' | 'lower' | 'lineUpper' | 'lineLower' | 'wordUpper' | 'wordLower'
const caseModes: CaseMode[] = ['upper', 'lower', 'lineUpper', 'lineLower', 'wordUpper', 'wordLower']
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
    const cmTheme = theme === 'light' ? tokyoNightDay : tokyoNight;
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
    const copyDetail = (character: string, count: number) => {
        const copied = `${character}: ${count}`;
        navigator.clipboard?.writeText(copied);
        toast(t('toast.copied', {value: copied}));
        record('text', t('textTool.copied'), copied, value)
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
        setValue(pending.input);
        if (pending.action === 'restore') return;
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
            const next = transform(pending.input);
            if (next !== pending.input) setValue(next);
            record('text', labels[pending.action] ?? pending.action, `${[...next].length} ${t('textTool.characters')}`, next)
        }
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
            <Popover><Popover.Trigger>
                <button className="stat-detail-trigger"
                        aria-label={t('textTool.showDetails', {label: t(`textTool.${stat.key}`)})}>
                    <span>{t(`textTool.${stat.key}`)}</span><strong>{stat.count.toLocaleString()}</strong></button>
            </Popover.Trigger><Popover.Content className="text-stat-dialog-popover"><Popover.Dialog
                className="text-stat-dialog">{stat.details.length ?
                <Table className="text-stat-table"><Table.ScrollContainer
                    className="scrollbar-thin text-stat-table-scroll"><Table.Content className="text-stat-table-sticky"
                                                                                     aria-label={t('textTool.detailTitle', {label: t(`textTool.${stat.key}`)})}
                                                                                     sortDescriptor={sortDescriptor}
                                                                                     onSortChange={setSortDescriptor}><Table.Header><Table.Column
                    id="entry" isRowHeader allowsSorting>{({sortDirection}) => <Table.SortableColumnHeader
                    sortDirection={sortDirection}>{t('textTool.detailEntry')}</Table.SortableColumnHeader>}</Table.Column><Table.Column
                    id="count" allowsSorting>{({sortDirection}) => <Table.SortableColumnHeader
                    sortDirection={sortDirection}>{t('textTool.detailCount')}</Table.SortableColumnHeader>}</Table.Column></Table.Header><Table.Body>{sortDetails(stat.details).map(([character, count]) =>
                    <Table.Row key={character} id={character} textValue={`${character}: ${count}`}
                               onAction={() => copyDetail(character, count)}><Table.Cell>{character}</Table.Cell><Table.Cell>{count.toLocaleString()}</Table.Cell></Table.Row>)}</Table.Body></Table.Content></Table.ScrollContainer></Table> :
                <p>{t('textTool.noDetails')}</p>}</Popover.Dialog></Popover.Content></Popover> : <>
                <span>{t(`textTool.${stat.key}`)}</span><strong>{stat.count.toLocaleString()}</strong></>}</div>)}</div>
    </ToolLayout>


    </Reveal>

}
