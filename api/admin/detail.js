import { runAdminRoute } from '../../lib/server/admin-routes.js';
import { sendError } from '../../lib/server/lib.js';

export default async function handler(req, res) {
  try {
    return await runAdminRoute('detail', req, res);
  } catch (error) {
    return sendError(res, error);
  }
}
