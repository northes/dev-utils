import { useMemo, useState, type ReactNode } from 'react';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { CaretDown, CaretRight } from '@phosphor-icons/react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Button } from './ui/button';

type Props = { value: unknown; t: (key: string) => string };
const isContainer = (value: unknown): value is Record<string, unknown> | unknown[] =>
  value !== null && typeof value === 'object';

const isObjectArray = (value: unknown): value is Record<string, unknown>[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item));

function scalar(value: unknown, t: Props['t']) {
  if (value === null) return <span className="json-table-null">null</span>;
  if (typeof value === 'string')
    return <span className="json-table-string">&quot;{value}&quot;</span>;
  if (typeof value === 'boolean')
    return <span className="json-table-boolean">{String(value)}</span>;
  if (typeof value === 'number') return <span className="json-table-number">{String(value)}</span>;
  return <span className="text-muted-foreground">{t('jsonTool.tablePreviewUnsupported')}</span>;
}

function Value({ value, t, depth = 0 }: Props & { depth?: number }): ReactNode {
  const [expanded, setExpanded] = useState(false);
  if (!isContainer(value)) return scalar(value, t);
  const isArray = Array.isArray(value);
  const entries = isArray
    ? value.map((item, i) => [String(i), item] as const)
    : Object.entries(value);
  const label = isArray
    ? `[${value.length} ${t('jsonTool.tablePreviewItems')}]`
    : `{${Object.keys(value).length} ${t('jsonTool.tablePreviewKeys')}}`;
  return (
    <div className="json-table-nested">
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="mr-1 align-middle"
        aria-label={
          expanded ? t('jsonTool.tablePreviewCollapse') : t('jsonTool.tablePreviewExpand')
        }
        title={expanded ? t('jsonTool.tablePreviewCollapse') : t('jsonTool.tablePreviewExpand')}
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? <CaretDown /> : <CaretRight />}
      </Button>
      <span className="json-table-container-label">{label}</span>
      {expanded && entries.length > 0 && (
        <div className="json-table-child">
          {isArray && isObjectArray(value) ? (
            <ObjectArray value={value as Record<string, unknown>[]} t={t} />
          ) : (
            <KeyValue value={value} t={t} depth={depth + 1} />
          )}
        </div>
      )}
    </div>
  );
}

function KeyValue({ value, t, depth = 0 }: Props & { depth?: number }) {
  const entries = Array.isArray(value)
    ? value.map((item, i) => [String(i), item] as const)
    : Object.entries(value as Record<string, unknown>);
  return (
    <Table containerClassName="overflow-x-visible" className="json-table-key-value">
      <TableBody>
        {entries.map(([key, item]) => (
          <TableRow key={key}>
            <TableHead className="json-table-key">{key}</TableHead>
            <TableCell>
              <Value value={item} t={t} depth={depth} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ObjectArray({ value, t }: Props & { value: Record<string, unknown>[] }) {
  const keys = useMemo(() => [...new Set(value.flatMap((row) => Object.keys(row)))], [value]);
  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () => [
      {
        id: '__rowIndex',
        header: '',
        cell: ({ row }) => <span className="json-table-row-index">{row.index}</span>,
        size: 32,
        enableSorting: false,
        enableHiding: false,
      },
      ...keys.map((key) => ({
        accessorKey: key,
        header: key,
        cell: ({ row }) => <Value value={row.original[key]} t={t} />,
      })),
    ],
    [keys, t],
  );
  const table = useReactTable({ data: value, columns, getCoreRowModel: getCoreRowModel() });
  return (
    <div className="json-table-scroll">
      <Table containerClassName="overflow-x-visible" className="json-table-data">
        <TableHeader className="sticky top-0 z-10 bg-card">
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead key={header.id}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function JsonTablePreview({ value, t }: Props) {
  if (value === null || typeof value !== 'object')
    return <div className="json-table-preview json-table-scalar">{scalar(value, t)}</div>;
  if (Array.isArray(value)) {
    if (value.length === 0)
      return (
        <div className="json-table-preview json-table-empty">
          {t('jsonTool.tablePreviewEmptyArray')}
        </div>
      );
    if (isObjectArray(value)) return <ObjectArray value={value} t={t} />;
    return (
      <div className="json-table-preview">
        <KeyValue value={value} t={t} />
      </div>
    );
  }
  if (Object.keys(value).length === 0)
    return (
      <div className="json-table-preview json-table-empty">
        {t('jsonTool.tablePreviewEmptyObject')}
      </div>
    );
  return (
    <div className="json-table-preview">
      <KeyValue value={value} t={t} />
    </div>
  );
}
