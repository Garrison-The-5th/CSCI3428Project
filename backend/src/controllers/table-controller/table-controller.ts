/**
 * File: table-controller.ts
 * Description: Table controller for the learning platform.
 * Author: TTG Full-Stack Web Boilerplate
 * Modified by: Jacob Matthews <Jacob.Matthews@ttgteams.com>
 * Date: 2026-08-10
 */
import { Request, Response } from 'express';

import { logger } from '@/config/logger';
import { authenticateAndAttachUser } from '@/controllers/auth-controller/auth-middleware';
import { controller, get, use } from '@/controllers/decorators';
import TableService from '@/services/table-service/table-service';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Unknown error';
}

@controller('/table-members')
export default class TableController {
  @get('/')
  @use(authenticateAndAttachUser)
  async getMembers(req: Request, res: Response) {
    try {
      const table = await TableService.list({
        sorting: typeof req.query.sorting === 'string' ? req.query.sorting : undefined,
        columnFilters:
          typeof req.query.columnFilters === 'string' ? req.query.columnFilters : undefined,
        globalFilter:
          typeof req.query.globalFilter === 'string' ? req.query.globalFilter : undefined,
        pageIndex: typeof req.query.pageIndex === 'string' ? req.query.pageIndex : undefined,
        pageSize: typeof req.query.pageSize === 'string' ? req.query.pageSize : undefined,
      });

      return res.status(200).send(table);
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      logger.error({ reason: errorMessage }, 'error getting table members');
      return res.status(500).send({
        errorMessage: 'Something went wrong while fetching table members',
      });
    }
  }
}
