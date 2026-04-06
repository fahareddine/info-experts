import { insertRow } from './supabase.js';

export async function logAdminEvent({
  entityType,
  entityReference,
  action,
  actorLabel = 'admin',
  fromStatus = null,
  toStatus = null,
  note = null,
  metadata = {},
}) {
  return insertRow('admin_events', {
    entity_type: entityType,
    entity_reference: entityReference,
    action,
    actor_label: actorLabel,
    from_status: fromStatus,
    to_status: toStatus,
    note,
    metadata,
  });
}
