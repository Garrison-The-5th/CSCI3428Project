/**
 * File: table-service.ts
 * Description: Table service for the learning platform.
 * Author: TTG Full-Stack Web Boilerplate
 * Date: 2026-08-10
 */
type RowStatus = 'Active' | 'Pending' | 'Paused';

export type TeamMemberRecord = {
  id: string;
  name: string;
  email: string;
  team: string;
  role: string;
  status: RowStatus;
  lastActiveLabel: string;
  lastActiveMinutes: number;
};

type TableSort = {
  id: string;
  desc: boolean;
};

type TableFilter = {
  id: string;
  value: string;
};

type TableSummary = {
  totalCount: number;
  activeCount: number;
  teamCount: number;
};

/**
 * Demo data for the table page: 24 generated team members. Names, teams, roles
 * and statuses cycle through the lists below so every combination of filter and
 * sort has something to show, and `lastActiveMinutes` grows with the index so
 * the "last active" column spans minutes, hours and days.
 */
const MEMBERS: TeamMemberRecord[] = Array.from({ length: 24 }, (_, index) => {
  const seed = index + 1;
  const firstNames = [
    'Avery',
    'Noah',
    'Mia',
    'Ethan',
    'Sara',
    'Liam',
    'Olivia',
    'Lucas',
    'Amelia',
    'Henry',
    'Chloe',
    'Mason',
  ];
  const lastNames = [
    'Chen',
    'Patel',
    'Ramirez',
    'Brooks',
    'Gomez',
    'Wong',
    'Taylor',
    'Nguyen',
    'Martinez',
    'Wilson',
    'Parker',
    'Bennett',
  ];
  const teams = ['Product', 'Engineering', 'Operations', 'Support', 'Design'];
  const roles = [
    'Design Lead',
    'Full Stack Developer',
    'Project Coordinator',
    'Support Specialist',
    'Platform Engineer',
    'UX Researcher',
    'Product Manager',
    'QA Analyst',
  ];
  const statuses: RowStatus[] = ['Active', 'Pending', 'Paused'];
  const lastActiveMinutes = seed * 17;

  return {
    id: `USR-${1041 + seed}`,
    name: `${firstNames[index % firstNames.length]} ${lastNames[index % lastNames.length]}`,
    email:
      `${firstNames[index % firstNames.length].toLowerCase()}.` +
      `${lastNames[index % lastNames.length].toLowerCase()}@example.com`,
    team: teams[index % teams.length],
    role: roles[index % roles.length],
    status: statuses[index % statuses.length],
    lastActiveMinutes,
    lastActiveLabel:
      lastActiveMinutes < 60
        ? `${lastActiveMinutes} min ago`
        : lastActiveMinutes < 24 * 60
          ? `${Math.max(1, Math.round(lastActiveMinutes / 60))} hr ago`
          : `${Math.max(1, Math.round(lastActiveMinutes / (24 * 60)))} days ago`,
  };
});

/**
 * Reads a JSON-encoded array from a query string parameter. Anything missing,
 * malformed or not an array comes back as an empty list, so a bad query never
 * fails the request — it just applies no sorting or filtering.
 */
function parseJsonArray<T>(value: string | undefined): T[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/** Parses a base-10 integer from a query parameter, falling back to `defaultValue`. */
function parseInteger(value: unknown, defaultValue: number) {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

/** Trimmed, lower-cased string form of any value, for case-insensitive comparison. */
function normalizeText(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

/**
 * Looks up a column by its id. An explicit switch rather than `member[field]`
 * so a client-supplied column id can only ever reach the known fields; an
 * unknown id returns undefined and is ignored by the filters and sorts.
 */
function getFieldValue(member: TeamMemberRecord, field: string) {
  switch (field) {
    case 'id':
      return member.id;
    case 'name':
      return member.name;
    case 'email':
      return member.email;
    case 'team':
      return member.team;
    case 'role':
      return member.role;
    case 'status':
      return member.status;
    case 'lastActiveLabel':
      return member.lastActiveLabel;
    case 'lastActiveMinutes':
      return member.lastActiveMinutes;
    default:
      return undefined;
  }
}

/**
 * True when the search box term appears in any field of the row. An empty term matches everything.
 */
function matchesGlobalFilter(member: TeamMemberRecord, term: string) {
  if (!term) {
    return true;
  }

  const needle = term.toLowerCase();
  return Object.values(member).some((value) => String(value).toLowerCase().includes(needle));
}

/**
 * True when the row passes every per-column filter (a case-insensitive
 * substring match). Filters on unknown columns are skipped rather than
 * excluding every row.
 */
function matchesColumnFilters(member: TeamMemberRecord, filters: TableFilter[]) {
  return filters.every((filter) => {
    const value = getFieldValue(member, filter.id);
    if (value === undefined || value === null) {
      return true;
    }

    return String(value).toLowerCase().includes(filter.value.toLowerCase());
  });
}

/** Sorts statuses by workflow order (Active, Pending, Paused) rather than alphabetically. */
function compareStatus(left: RowStatus, right: RowStatus) {
  const order: Record<RowStatus, number> = {
    Active: 0,
    Pending: 1,
    Paused: 2,
  };

  return order[left] - order[right];
}

/**
 * Multi-column comparator. Each sort in `sorting` is tried in turn and the
 * first one that tells the rows apart decides; later sorts only break ties.
 *
 * Status sorts by workflow order, "last active" sorts by the underlying minutes
 * (the label text would put "10 days ago" before "2 hr ago"), numbers compare
 * numerically, and everything else uses a natural, case-insensitive compare.
 */
function compareMembers(left: TeamMemberRecord, right: TeamMemberRecord, sorting: TableSort[]) {
  for (const sort of sorting) {
    const leftValue = getFieldValue(left, sort.id);
    const rightValue = getFieldValue(right, sort.id);

    let result = 0;
    if (sort.id === 'status' && typeof leftValue === 'string' && typeof rightValue === 'string') {
      result = compareStatus(leftValue as RowStatus, rightValue as RowStatus);
    } else if (sort.id === 'lastActiveLabel') {
      result = left.lastActiveMinutes - right.lastActiveMinutes;
    } else if (typeof leftValue === 'number' && typeof rightValue === 'number') {
      result = leftValue - rightValue;
    } else {
      result = normalizeText(leftValue).localeCompare(normalizeText(rightValue), undefined, {
        numeric: true,
        sensitivity: 'base',
      });
    }

    if (result !== 0) {
      return sort.desc ? -result : result;
    }
  }

  return 0;
}

/** Headline counts for the whole data set, unaffected by the current filters. */
function createSummary(): TableSummary {
  return {
    totalCount: MEMBERS.length,
    activeCount: MEMBERS.filter((member) => member.status === 'Active').length,
    teamCount: new Set(MEMBERS.map((member) => member.team)).size,
  };
}

export default class TableService {
  /**
   * One page of the members table, server side: filter, then sort, then slice.
   *
   * The page size is clamped to 1–100, and a page index past the end is pulled
   * back to the last page, so narrowing a filter while on page 5 lands on the
   * last page that still has rows instead of an empty one.
   */
  static async list(query: {
    sorting?: string;
    columnFilters?: string;
    globalFilter?: string;
    pageIndex?: string;
    pageSize?: string;
  }) {
    const sorting = parseJsonArray<TableSort>(query.sorting);
    const columnFilters = parseJsonArray<TableFilter>(query.columnFilters).filter(
      (filter) => typeof filter.id === 'string' && typeof filter.value === 'string',
    );
    const globalFilter = normalizeText(query.globalFilter);
    const pageIndex = Math.max(parseInteger(query.pageIndex, 0), 0);
    const pageSize = Math.min(Math.max(parseInteger(query.pageSize, 12), 1), 100);

    const filtered = MEMBERS.filter(
      (member) =>
        matchesGlobalFilter(member, globalFilter) && matchesColumnFilters(member, columnFilters),
    );
    const sorted = [...filtered].sort((left, right) => compareMembers(left, right, sorting));
    const filteredCount = sorted.length;
    const pageCount = Math.max(1, Math.ceil(filteredCount / pageSize));
    const safePageIndex = Math.min(pageIndex, pageCount - 1);
    const startIndex = safePageIndex * pageSize;
    const rows = sorted.slice(startIndex, startIndex + pageSize);

    return {
      rows,
      filteredCount,
      pageCount,
      pageIndex: safePageIndex,
      pageSize,
      summary: createSummary(),
    };
  }
}
