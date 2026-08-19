export const NOTIFICATIONS_INVALIDATED_EVENT = 'munera:notifications-invalidated';

export function invalidateNotifications() {
  window.dispatchEvent(new Event(NOTIFICATIONS_INVALIDATED_EVENT));
}
