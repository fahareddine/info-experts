import { runAdminRoute } from '../../lib/server/admin-routes.js';
import { ApiError, sendError } from '../../lib/server/lib.js';

export default async function handler(req, res) {
  const action = String(req.query?.action || '').trim();
  const route = action === 'login' || action === 'logout' || action === 'session' ? action : null;

  try {
    if (!route) {
      throw new ApiError(400, 'Action auth invalide. Valeurs acceptées : login, logout, session.');
    }
    return await runAdminRoute(route, req, res);
  } catch (error) {
    return sendError(res, error);
  }
}
