import { runAdminRoute } from '../../lib/server/admin-routes.js';
import { ApiError, sendError } from '../../lib/server/lib.js';

const ENTITY_ROUTE = {
  payment: 'payment-action',
  appointment: 'appointment-action',
  order: 'order-action',
  note: 'note',
  customer: 'customer-action',
  customerInteraction: 'customer-interaction-action',
  maintenance: 'cleanup-test-data',
};

export default async function handler(req, res) {
  const entity = String(req.query?.entity || '').trim();
  const route = ENTITY_ROUTE[entity];

  try {
    if (!route) {
      throw new ApiError(400, 'Entity admin invalide. Valeurs acceptées : payment, appointment, order, note, customer, customerInteraction, maintenance.');
    }
    return await runAdminRoute(route, req, res);
  } catch (error) {
    return sendError(res, error);
  }
}
