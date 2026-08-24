import * as React from 'react';
import { ColumnDef, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  emptyState?: React.ReactNode;
  onRowClick?: (row: TData) => void;
  className?: string;
  containerClassName?: string;
  tableClassName?: string;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  emptyState,
  onRowClick,
  className,
  containerClassName,
  tableClassName,
}: DataTableProps<TData, TValue>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-hidden rounded-(--radius) border border-border bg-card',
        className,
      )}
    >
      <Table
        containerClassName={cn('min-h-0 overflow-auto [scrollbar-gutter:auto]', containerClassName)}
        className={cn('table-fixed', tableClassName)}
      >
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="h-[34px] bg-muted">
              {headerGroup.headers.map((header) => {
                return (
                  <TableHead
                    key={header.id}
                    className="h-[34px] px-3 py-1 font-mono text-[9px] font-medium uppercase tracking-[.08em] text-muted-foreground"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() && 'selected'}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                onKeyDown={
                  onRowClick
                    ? (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onRowClick(row.original);
                        }
                      }
                    : undefined
                }
                tabIndex={onRowClick ? 0 : undefined}
                className={cn(
                  'h-[52px] border-b border-border/70 transition-none hover:bg-accent',
                  onRowClick &&
                    'cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset',
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="px-3 py-2 first:pl-3.5 last:pr-3.5">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                {emptyState ?? null}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
