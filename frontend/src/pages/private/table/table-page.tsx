/**
 * File: table-page.tsx
 * Description: Table page for the learning platform.
 * Author: TTG Full-Stack Web Boilerplate
 * Date: 2026-08-10
 */
import { useEffect, useMemo, useState } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { columns, type TeamMember } from '@/pages/private/table/columns';
import {
  DataTable,
  type DataTableQueryState,
  getDefaultTableQueryState,
  readPersistedState,
} from '@/pages/private/table/data-table';
import HttpHelper from '@/utils/http-helper';

type TableSummary = {
  totalCount: number;
  activeCount: number;
  teamCount: number;
};

type TableResponse = {
  rows: TeamMember[];
  filteredCount: number;
  pageCount: number;
  pageIndex: number;
  pageSize: number;
  summary: TableSummary;
};

type TableQueryState = Pick<
  DataTableQueryState,
  'sorting' | 'columnFilters' | 'globalFilter' | 'pagination'
>;

/** The query to start with: the saved table view if there is one, otherwise the defaults. */
const getInitialQueryState = (): TableQueryState => {
  const persisted = readPersistedState();
  if (!persisted) {
    const defaults = getDefaultTableQueryState();
    return {
      sorting: defaults.sorting,
      columnFilters: defaults.columnFilters,
      globalFilter: defaults.globalFilter,
      pagination: defaults.pagination,
    };
  }

  return {
    sorting: persisted.sorting,
    columnFilters: persisted.columnFilters,
    globalFilter: persisted.globalFilter,
    pagination: persisted.pagination,
  };
};

/** Deep equality of two queries, so an unchanged view does not trigger a refetch. */
const sameQueryState = (left: TableQueryState, right: TableQueryState) =>
  JSON.stringify(left) === JSON.stringify(right);

/** Just the fields the server query needs from the table's full state. */
const toQueryState = (state: DataTableQueryState): TableQueryState => ({
  sorting: state.sorting,
  columnFilters: state.columnFilters,
  globalFilter: state.globalFilter,
  pagination: state.pagination,
});

/** The table query as URL parameters; sorting and filters are sent as JSON strings. */
const buildQueryString = (query: TableQueryState) => {
  const params = new URLSearchParams();
  params.set('pageIndex', String(query.pagination.pageIndex));
  params.set('pageSize', String(query.pagination.pageSize));
  params.set('globalFilter', query.globalFilter);
  params.set('sorting', JSON.stringify(query.sorting));
  params.set('columnFilters', JSON.stringify(query.columnFilters));
  return params.toString();
};

/**
 * The team members table page: holds the current query, fetches the matching page from the server
 * whenever it changes, and shows the summary counts.
 */
const TablePage = () => {
  const [queryState, setQueryState] = useState<TableQueryState>(getInitialQueryState);
  const [rows, setRows] = useState<TeamMember[]>([]);
  const [summary, setSummary] = useState<TableSummary>({
    totalCount: 0,
    activeCount: 0,
    teamCount: 0,
  });
  const [filteredCount, setFilteredCount] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const delay = window.setTimeout(async () => {
      try {
        setLoading(true);
        setError(null);

        const response = (await HttpHelper.get(
          `table-members?${buildQueryString(queryState)}`,
        )) as TableResponse;

        if (!active) {
          return;
        }

        setRows(response.rows ?? []);
        setSummary(
          response.summary ?? {
            totalCount: 0,
            activeCount: 0,
            teamCount: 0,
          },
        );
        setFilteredCount(response.filteredCount ?? response.rows?.length ?? 0);
        setPageCount(response.pageCount ?? 1);
      } catch (fetchError) {
        if (!active) {
          return;
        }

        const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
        setError(message);
        setRows([]);
        setFilteredCount(0);
        setPageCount(1);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }, 200);

    return () => {
      active = false;
      window.clearTimeout(delay);
    };
  }, [queryState]);

  const stats = useMemo(
    () => [
      {
        label: 'Total members',
        value: String(summary.totalCount),
        detail: 'People currently available in the table.',
      },
      {
        label: 'Active',
        value: String(summary.activeCount),
        detail: 'Rows marked active in the full dataset.',
      },
      {
        label: 'Teams',
        value: String(summary.teamCount),
        detail: 'Distinct teams represented in the full dataset.',
      },
    ],
    [summary],
  );

  return (
    <div className="page-container">
      <div className="mb-8">
        <h1 className="page-title mt-2 font-bold text-foreground">Table dashboard</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          A shadcn data table built with TanStack Table and the official shadcn UI primitives.
          Sorting and filtering are handled server-side.
        </p>
      </div>

      {error && (
        <div
          className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm
            text-danger"
        >
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.label} className="rounded-2xl border-border bg-light-gray shadow-sm">
            <CardContent className="p-5">
              <p className="text-sm font-medium text-muted-foreground">{stat.label}</p>
              <p className="mt-2 text-3xl font-semibold text-foreground">{stat.value}</p>
              <p className="mt-2 text-sm text-muted-foreground">{stat.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-6">
        <DataTable
          columns={columns}
          data={rows}
          filteredRowCount={filteredCount}
          pageCount={pageCount}
          isLoading={loading}
          onStateChange={(state) => {
            const nextQuery = toQueryState(state);
            setQueryState((current) => (sameQueryState(current, nextQuery) ? current : nextQuery));
          }}
        />
      </div>
    </div>
  );
};

export default TablePage;
