/**
 * File: data-table.tsx
 * Description: Data table for the learning platform.
 * Author: TTG Full-Stack Web Boilerplate
 * Date: 2026-08-10
 */
'use client';

import {
  type Column,
  type ColumnDef,
  type ColumnFiltersState,
  type ColumnOrderState,
  flexRender,
  getCoreRowModel,
  type SortingState,
  type Table as TanStackTable,
  useReactTable,
  type VisibilityState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/utils/utils';

export type RowStatus = 'Active' | 'Pending' | 'Paused';

export type DataTableQueryState = {
  sorting: SortingState;
  columnFilters: ColumnFiltersState;
  columnVisibility: VisibilityState;
  columnOrder: ColumnOrderState;
  rowSelection: Record<string, boolean>;
  globalFilter: string;
  pagination: {
    pageIndex: number;
    pageSize: number;
  };
};

export type PersistedDataTableState = DataTableQueryState & {
  version: 1;
};

const DATA_TABLE_STORAGE_KEY = 'table-page:data-table-state:v1';

/** A fresh table view: no sorting, filters or selection, default column order, first page of 12. */
function getDefaultDataTableState(): PersistedDataTableState {
  return {
    version: 1,
    sorting: [],
    columnFilters: [],
    columnVisibility: {},
    columnOrder: [],
    rowSelection: {},
    globalFilter: '',
    pagination: {
      pageIndex: 0,
      pageSize: 12,
    },
  };
}

/**
 * The default view without its storage `version` field — what the page queries with when nothing is
 * saved.
 */
export function getDefaultTableQueryState(): DataTableQueryState {
  // `version` is intentionally dropped from the persisted state.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { version, ...state } = getDefaultDataTableState();
  return state;
}

/**
 * The table view saved in localStorage, field by field, with anything missing or the wrong type
 * replaced by its default. Null when nothing is saved, the saved version is unknown, or storage is
 * unavailable.
 */
export function readPersistedState(): PersistedDataTableState | null {
  try {
    const raw = window.localStorage.getItem(DATA_TABLE_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<PersistedDataTableState>;
    if (parsed.version !== 1) {
      return null;
    }

    return {
      version: 1,
      sorting: Array.isArray(parsed.sorting) ? parsed.sorting : [],
      columnFilters: Array.isArray(parsed.columnFilters) ? parsed.columnFilters : [],
      columnVisibility:
        parsed.columnVisibility && typeof parsed.columnVisibility === 'object'
          ? parsed.columnVisibility
          : {},
      columnOrder: Array.isArray(parsed.columnOrder) ? parsed.columnOrder : [],
      rowSelection:
        parsed.rowSelection && typeof parsed.rowSelection === 'object' ? parsed.rowSelection : {},
      globalFilter: typeof parsed.globalFilter === 'string' ? parsed.globalFilter : '',
      pagination:
        parsed.pagination && typeof parsed.pagination === 'object'
          ? {
              pageIndex:
                typeof parsed.pagination.pageIndex === 'number' ? parsed.pagination.pageIndex : 0,
              pageSize:
                typeof parsed.pagination.pageSize === 'number' ? parsed.pagination.pageSize : 12,
            }
          : { pageIndex: 0, pageSize: 12 },
    };
  } catch {
    return null;
  }
}

/** Saves the table view to localStorage so it survives a reload. */
function writePersistedState(state: PersistedDataTableState) {
  window.localStorage.setItem(DATA_TABLE_STORAGE_KEY, JSON.stringify(state));
}

/**
 * Applies a TanStack-style updater, which is either a new value or a function of the previous one.
 */
function resolveUpdater<T>(updater: T | ((previous: T) => T), previous: T): T {
  return typeof updater === 'function' ? (updater as (previous: T) => T)(previous) : updater;
}

/** Column ids in the order the columns were defined (by `id`, falling back to `accessorKey`). */
function getDefaultColumnOrder<TData, TValue>(columns: ColumnDef<TData, TValue>[]) {
  return columns
    .map((column) => {
      if ('id' in column && column.id) {
        return column.id;
      }

      if ('accessorKey' in column && column.accessorKey) {
        return String(column.accessorKey);
      }

      return '';
    })
    .filter(Boolean);
}

/** Copies just the query fields out of a table state, leaving anything else behind. */
function toQueryState(state: DataTableQueryState): DataTableQueryState {
  return {
    sorting: state.sorting,
    columnFilters: state.columnFilters,
    columnVisibility: state.columnVisibility,
    columnOrder: state.columnOrder,
    rowSelection: state.rowSelection,
    globalFilter: state.globalFilter,
    pagination: state.pagination,
  };
}

export interface DataTableColumnHeaderProps<
  TData,
  TValue,
> extends React.HTMLAttributes<HTMLDivElement> {
  column: Column<TData, TValue>;
  title: string;
  isDragging?: boolean;
  draggable?: boolean;
  onDragStart?: (event: React.DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
  onDragEnter?: (event: React.DragEvent<HTMLElement>) => void;
  onDrop?: (event: React.DragEvent<HTMLElement>) => void;
}

/**
 * A column header that toggles sorting when clicked and, when `draggable`, can be dragged to
 * reorder columns.
 */
export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
  isDragging = false,
  draggable = false,
  onDragStart,
  onDragEnd,
  onDragEnter,
  onDrop,
}: DataTableColumnHeaderProps<TData, TValue>) {
  if (!column.getCanSort()) {
    return (
      <div
        className={cn(className, isDragging && 'opacity-50')}
        draggable={draggable}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragEnter={onDragEnter}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
      >
        {title}
      </div>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        '-ml-3 h-8 justify-start data-[state=open]:bg-accent',
        isDragging && 'opacity-50',
        className,
      )}
      onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragEnter={onDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <span className="truncate">{title}</span>
      {column.getIsSorted() === 'asc' ? (
        <ArrowUp className="h-4 w-4" />
      ) : column.getIsSorted() === 'desc' ? (
        <ArrowDown className="h-4 w-4" />
      ) : (
        <ArrowUpDown className="h-4 w-4" />
      )}
    </Button>
  );
}

export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  filteredRowCount: number;
  pageCount: number;
  isLoading?: boolean;
  onStateChange?: (state: DataTableQueryState) => void;
}

/**
 * Server-driven data table: sorting, filtering, paging, column hiding, drag-to-reorder columns and
 * row selection. The view is kept in localStorage, and every change is reported through
 * `onStateChange` so the parent can refetch.
 */
export function DataTable<TData, TValue>({
  columns,
  data,
  filteredRowCount,
  pageCount,
  isLoading = false,
  onStateChange,
}: DataTableProps<TData, TValue>) {
  const persistedState = React.useMemo(() => {
    if (typeof window === 'undefined') {
      return null;
    }

    return readPersistedState();
  }, []);

  const [sorting, setSorting] = React.useState<SortingState>(persistedState?.sorting ?? []);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    persistedState?.columnFilters ?? [],
  );
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(
    persistedState?.columnVisibility ?? {},
  );
  const [rowSelection, setRowSelection] = React.useState<Record<string, boolean>>(
    persistedState?.rowSelection ?? {},
  );
  const [globalFilter, setGlobalFilter] = React.useState(persistedState?.globalFilter ?? '');
  const [columnOrder, setColumnOrder] = React.useState<ColumnOrderState>(
    persistedState?.columnOrder ?? [],
  );
  const [pagination, setPagination] = React.useState(
    persistedState?.pagination ?? {
      pageIndex: 0,
      pageSize: 12,
    },
  );
  const [draggingColumnId, setDraggingColumnId] = React.useState<string | null>(null);
  const tableRef = React.useRef<HTMLTableElement | null>(null);
  const previousColumnPositionsRef = React.useRef<Record<string, number> | null>(null);

  React.useEffect(() => {
    setColumnOrder((current) => {
      if (current.length) {
        return current;
      }

      return getDefaultColumnOrder(columns);
    });
  }, [columns]);

  React.useEffect(() => {
    writePersistedState({
      version: 1,
      sorting,
      columnFilters,
      columnVisibility,
      columnOrder,
      rowSelection,
      globalFilter,
      pagination,
    });
  }, [
    columnFilters,
    columnOrder,
    columnVisibility,
    globalFilter,
    pagination,
    rowSelection,
    sorting,
  ]);

  React.useEffect(() => {
    onStateChange?.(
      toQueryState({
        sorting,
        columnFilters,
        columnVisibility,
        columnOrder,
        rowSelection,
        globalFilter,
        pagination,
      }),
    );
  }, [
    columnFilters,
    columnOrder,
    columnVisibility,
    globalFilter,
    onStateChange,
    pagination,
    rowSelection,
    sorting,
  ]);

  const snapshotColumnPositions = React.useCallback(() => {
    if (!tableRef.current) {
      return;
    }

    const nextPositions: Record<string, number> = {};

    tableRef.current
      .querySelectorAll<HTMLElement>('[data-column-header="true"]')
      .forEach((element) => {
        const columnId = element.dataset.columnId;
        if (columnId) {
          nextPositions[columnId] = element.getBoundingClientRect().left;
        }
      });

    previousColumnPositionsRef.current = nextPositions;
  }, []);

  React.useLayoutEffect(() => {
    const previousPositions = previousColumnPositionsRef.current;
    if (!previousPositions || !tableRef.current) {
      return;
    }

    /**
     * FLIP animation: shifts a column's cells back to where they were, then lets them slide into
     * their new place.
     */
    const animateElements = (columnId: string, deltaX: number) => {
      tableRef.current
        ?.querySelectorAll<HTMLElement>(`[data-column-id="${columnId}"]`)
        .forEach((element) => {
          element.style.transition = 'none';
          element.style.transform = `translateX(${deltaX}px)`;
          element.style.willChange = 'transform';

          requestAnimationFrame(() => {
            element.style.transition = 'transform 220ms ease';
            element.style.transform = 'translateX(0)';
            window.setTimeout(() => {
              element.style.transition = '';
              element.style.willChange = '';
            }, 220);
          });
        });
    };

    Object.entries(previousPositions).forEach(([columnId, previousLeft]) => {
      const header = tableRef.current?.querySelector<HTMLElement>(
        `[data-column-header="true"][data-column-id="${columnId}"]`,
      );
      if (!header) {
        return;
      }

      const nextLeft = header.getBoundingClientRect().left;
      const deltaX = previousLeft - nextLeft;
      if (deltaX !== 0) {
        animateElements(columnId, deltaX);
      }
    });

    previousColumnPositionsRef.current = null;
  }, [columnOrder]);

  const reorderColumn = React.useCallback((sourceId: string, targetId: string) => {
    setColumnOrder((current) => {
      const next = [...current];
      const sourceIndex = next.indexOf(sourceId);
      const targetIndex = next.indexOf(targetId);

      if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
        return current;
      }

      next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, sourceId);

      return next;
    });
  }, []);

  const table = useReactTable({
    data,
    columns,
    manualFiltering: true,
    manualSorting: true,
    manualPagination: true,
    pageCount,
    onSortingChange: (updater) => {
      setSorting((current) => {
        const next = resolveUpdater(updater, current);
        setPagination((paginationState) =>
          paginationState.pageIndex === 0 ? paginationState : { ...paginationState, pageIndex: 0 },
        );
        return next;
      });
    },
    onColumnFiltersChange: (updater) => {
      setColumnFilters((current) => {
        const next = resolveUpdater(updater, current);
        setPagination((paginationState) =>
          paginationState.pageIndex === 0 ? paginationState : { ...paginationState, pageIndex: 0 },
        );
        return next;
      });
    },
    onColumnVisibilityChange: setColumnVisibility,
    onColumnOrderChange: setColumnOrder,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: (updater) => {
      setGlobalFilter((current) => {
        const next = resolveUpdater(updater, current);
        setPagination((paginationState) =>
          paginationState.pageIndex === 0 ? paginationState : { ...paginationState, pageIndex: 0 },
        );
        return next;
      });
    },
    onPaginationChange: (updater) => {
      setPagination((current) => {
        const next = resolveUpdater(updater, current);
        if (next.pageSize !== current.pageSize) {
          return { ...next, pageIndex: 0 };
        }
        return next;
      });
    },
    getCoreRowModel: getCoreRowModel(),
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      columnOrder,
      rowSelection,
      globalFilter,
      pagination,
    },
  });

  /** Begins dragging a column header. */
  const handleDragStart = (columnId: string, event: React.DragEvent<HTMLElement>) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', columnId);
    setDraggingColumnId(columnId);
  };

  /** Ends a column drag. */
  const handleDragEnd = () => {
    setDraggingColumnId(null);
  };

  /**
   * Moves the dragged column into this column's place as soon as it is dragged over, recording
   * positions first so the move animates.
   */
  const handleDragEnter = (columnId: string, event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (draggingColumnId && draggingColumnId !== columnId) {
      snapshotColumnPositions();
      reorderColumn(draggingColumnId, columnId);
    }
  };

  /** Finishes a column drop. The reorder already happened on drag-enter. */
  const handleDrop = (_columnId: string, event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    handleDragEnd();
  };

  /**
   * Restores the default view: no sorting, filters, hidden columns or selection, default column
   * order, first page.
   */
  const resetTableView = () => {
    setSorting([]);
    setColumnFilters([]);
    setColumnVisibility({});
    setRowSelection({});
    setGlobalFilter('');
    setColumnOrder(getDefaultColumnOrder(columns));
    setPagination({ pageIndex: 0, pageSize: 12 });

    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(DATA_TABLE_STORAGE_KEY);
    }
  };

  const selectedCount = Object.values(rowSelection).filter(Boolean).length;
  const showLoading = isLoading && table.getRowModel().rows.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          placeholder="Search members..."
          value={globalFilter}
          onChange={(event) => {
            setGlobalFilter(event.target.value);
            setPagination((current) => ({ ...current, pageIndex: 0 }));
          }}
          className="max-w-sm"
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="sm:ml-auto shadow-sm">
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {table
              .getAllColumns()
              .filter((column) => column.getCanHide())
              .map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  className="capitalize"
                  checked={column.getIsVisible()}
                  onCheckedChange={(value) => column.toggleVisibility(!!value)}
                >
                  {column.id}
                </DropdownMenuCheckboxItem>
              ))}
            <DropdownMenuCheckboxItem
              className="capitalize"
              checked={false}
              onCheckedChange={() => resetTableView()}
            >
              Reset table view
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="bg-light-gray overflow-hidden rounded-md border border-border shadow-sm px-2">
        <Table ref={tableRef}>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={cn(
                      'transition-transform duration-200 ease-out',
                      header.column.id !== 'select' && 'cursor-grab active:cursor-grabbing',
                    )}
                    data-column-id={header.column.id}
                    data-column-header="true"
                  >
                    {header.isPlaceholder ? null : header.column.id === 'select' ? (
                      flexRender(header.column.columnDef.header, header.getContext())
                    ) : (
                      <DataTableColumnHeader
                        column={header.column}
                        title={String(
                          (header.column.columnDef.meta as { title?: string } | undefined)?.title ??
                            header.column.id,
                        )}
                        isDragging={draggingColumnId === header.column.id}
                        draggable
                        onDragStart={(event) => handleDragStart(header.column.id, event)}
                        onDragEnd={handleDragEnd}
                        onDragEnter={(event) => handleDragEnter(header.column.id, event)}
                        onDrop={(event) => handleDrop(header.column.id, event)}
                      />
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {showLoading ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  Loading members...
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      data-column-id={cell.column.id}
                      className="transition-transform duration-200 ease-out"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted-foreground">
          {selectedCount} of {filteredRowCount} row(s) selected.
        </div>

        <div className="flex items-center gap-3">
          <Select
            value={`${table.getState().pagination.pageSize}`}
            onValueChange={(value) => {
              table.setPageSize(Number(value));
              table.setPageIndex(0);
            }}
          >
            <SelectTrigger className="h-9 w-25">
              <SelectValue placeholder={`${table.getState().pagination.pageSize}`} />
            </SelectTrigger>
            <SelectContent side="top">
              {[4, 8, 12, 16].map((size) => (
                <SelectItem key={size} value={`${size}`}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The "select all on this page" checkbox, shown as indeterminate when only some rows are selected.
 */
export function DataTableSelectionHeader<TData>({ table }: { table: TanStackTable<TData> }) {
  return (
    <Checkbox
      checked={
        table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate')
      }
      onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
      aria-label="Select all"
    />
  );
}

/** The checkbox that selects one row. */
export function DataTableSelectionCell<TData>({
  row,
}: {
  row: import('@tanstack/react-table').Row<TData>;
}) {
  return (
    <Checkbox
      checked={row.getIsSelected()}
      onCheckedChange={(value) => row.toggleSelected(!!value)}
      aria-label="Select row"
    />
  );
}
