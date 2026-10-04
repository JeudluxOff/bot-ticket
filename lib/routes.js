'use strict';
const { randomBytes } = require('node:crypto');
const PRESETS = ['Support', 'Modération', 'Plainte', 'Remboursement', 'Développement', 'Responsable'];
const fresh = name => ({ id: randomBytes(6).toString('hex'), name, categoryId: null, logChannelId: null, staffRoleIds: [], replyMode: 'direct' });
function services(config) {
  if (!config) return [];
  return config.services || [{ id: 'support', name: 'Support', categoryId: config.categoryId, logChannelId: config.logChannelId, staffRoleIds: config.staffRoleIds || [], replyMode: config.replyMode || 'direct' }];
}
function aggregate(config) { return { ...config, staffRoleIds: [...new Set(services(config).flatMap(s => s.staffRoleIds))] }; }
function routeFor(ticket, config) { return ticket.route || services(config).find(s => s.id === ticket.serviceId) || services(config)[0]; }
function logAccess(route, config) {
  return { staffRoleIds: [...new Set([...route.staffRoleIds, ...services(config).filter(s => s.logChannelId === route.logChannelId).flatMap(s => s.staffRoleIds)])] };
}
function migrate(state) {
  state.pending ||= {};
  if (!state.config) return;
  const routes = services(state.config);
  state.config = { guildId: state.config.guildId, revision: state.config.revision || 0, services: routes };
  for (const ticket of Object.values(state.tickets)) {
    ticket.serviceId ||= routes[0].id;
    ticket.route ||= structuredClone(routes.find(s => s.id === ticket.serviceId) || routes[0]);
  }
  for (const item of [...state.history, ...Object.values(state.notes).flat()]) {
    item.serviceId ||= routes[0].id;
    item.staffRoleIds ||= [...routes[0].staffRoleIds];
  }
}
module.exports = { PRESETS, fresh, services, aggregate, routeFor, logAccess, migrate };
