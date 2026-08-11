/**
 * File: columns.tsx
 * Description: Columns for the learning platform.
 * Author: TTG Full-Stack Web Boilerplate
 * Date: 2026-08-10
 */
'use client';

import { type ColumnDef } from '@tanstack/react-table';

import { Badge } from '@/components/ui/badge';
import {
  DataTableColumnHeader,
  DataTableSelectionCell,
  DataTableSelectionHeader,
  type RowStatus,
} from '@/pages/private/table/data-table';

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  team: string;
  role: string;
  status: RowStatus;
  lastActiveLabel: string;
  lastActiveMinutes: number;
};

export const columns: ColumnDef<TeamMember>[] = [
  {
    id: 'select',
    header: ({ table }) => <DataTableSelectionHeader table={table} />,
    cell: ({ row }) => <DataTableSelectionCell row={row} />,
    enableSorting: false,
    enableHiding: false,
    meta: { title: '' },
  },
  {
    accessorKey: 'id',
    header: ({ column }) => <DataTableColumnHeader column={column} title="ID" />,
    cell: ({ row }) => (
      <span className="font-mono text-xs text-muted-foreground">{row.original.id}</span>
    ),
    meta: { title: 'ID' },
  },
  {
    accessorKey: 'name',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
    cell: ({ row }) => <span className="font-medium text-foreground">{row.original.name}</span>,
    meta: { title: 'Name' },
  },
  {
    accessorKey: 'email',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Email" />,
    cell: ({ row }) => <span className="text-muted-foreground">{row.original.email}</span>,
    meta: { title: 'Email' },
  },
  {
    accessorKey: 'team',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Team" />,
    cell: ({ row }) => <span className="text-foreground">{row.original.team}</span>,
    meta: { title: 'Team' },
  },
  {
    accessorKey: 'role',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Role" />,
    cell: ({ row }) => <span className="text-foreground">{row.original.role}</span>,
    meta: { title: 'Role' },
  },
  {
    accessorKey: 'status',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
    cell: ({ row }) => {
      const variant =
        row.original.status === 'Active'
          ? 'default'
          : row.original.status === 'Pending'
            ? 'secondary'
            : 'outline';

      return <Badge variant={variant}>{row.original.status}</Badge>;
    },
    meta: { title: 'Status' },
  },
  {
    accessorKey: 'lastActiveLabel',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Last active" />,
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.lastActiveLabel}</span>
    ),
    meta: { title: 'Last active' },
  },
];
