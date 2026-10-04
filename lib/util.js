'use strict';
const { PermissionFlagsBits: P } = require('discord.js');

class UserError extends Error {}
const idPattern = /^\d{17,20}$/;
function userId(value = '') {
  const raw = value.replace(/^<@!?|>$/g, '');
  return idPattern.test(raw) ? raw : null;
}
function duration(value) {
  const match = /^(\d+(?:\.\d+)?)(s|m|h|d|j|w)$/i.exec(value || '');
  if (!match) throw new UserError('Durée invalide. Exemples : 15m, 2h, 7d.');
  const result = Number(match[1]) * { s: 1000, m: 60000, h: 3600000, d: 86400000, j: 86400000, w: 604800000 }[match[2].toLowerCase()];
  if (!Number.isSafeInteger(result) || result < 1000 || result > 31536000000)
    throw new UserError('La durée doit être comprise entre 1 seconde et 365 jours.');
  return result;
}
function parseCommand(text) {
  const m = /^(!{1,2})(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  return m ? { name: (m[1] === '!!' ? '!' : '') + m[2].toLowerCase(), rest: m[3] || '' } : null;
}
function first(text) {
  const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  return m ? [m[1], m[2] || ''] : ['', ''];
}
function chunks(text, limit = 1800) {
  const out = [];
  while (text.length > limit) {
    let end = text.lastIndexOf('\n', limit);
    if (end < limit / 2) end = limit;
    // Avoid splitting a surrogate pair.
    if (/^[\uDC00-\uDFFF]$/.test(text[end])) end--;
    out.push(text.slice(0, end)); text = text.slice(end);
  }
  if (text) out.push(text);
  return out;
}
function isAdmin(member) { return !!member?.permissions?.has(P.Administrator); }
function isStaff(member, config) {
  return !!member && (isAdmin(member) || (config?.staffRoleIds || require('./routes').aggregate(config).staffRoleIds).some(id => member.roles.cache.has(id)));
}
// Require explicit privacy; base server permissions cannot silently expose staff data.
function privateProblem(channel, config, botId, guild) {
  const everyone = channel.permissionOverwrites?.cache.get(guild.id);
  if (!everyone?.deny.has(P.ViewChannel)) return 'Refuse « Voir le salon » à @everyone dans les permissions du salon.';
  const allowed = new Set([botId, ...(config.staffRoleIds || require('./routes').aggregate(config).staffRoleIds)]);
  for (const ow of channel.permissionOverwrites.cache.values()) {
    if (!ow.allow.has(P.ViewChannel) || allowed.has(ow.id)) continue;
    const role = guild.roles.cache.get(ow.id);
    if (ow.type === 0 && role?.tags?.botId === botId) continue;
    if (ow.type === 0 && role?.permissions.has(P.Administrator)) continue;
    return `Ce salon autorise un accès supplémentaire (${ow.id}). Réserve-le au bot, aux rôles support sélectionnés et aux administrateurs.`;
  }
  return null;
}
function attachmentData(message) {
  return [...(message.attachments?.values() || [])].map(a => ({ name: a.name || 'fichier', url: a.url, size: a.size, type: a.contentType || '' }));
}
function messageText(message) {
  let text = message.content || '';
  const stickers = [...(message.stickers?.values() || [])];
  if (stickers.length) text += '\n' + stickers.map(s => `[Sticker : ${s.name}] ${s.url || ''}`).join('\n');
  if (!text && !message.attachments?.size) text = '[Message sans texte exploitable : merci de préciser la demande.]';
  return text;
}
function safeError(error) {
  if (error instanceof UserError) return error.message;
  const code = Number(error.code);
  if (code === 50007) return 'Impossible d’envoyer un MP : la personne bloque le bot ou ses messages privés sont fermés.';
  if (code === 50013 || code === 50001) return 'Le bot n’a pas les permissions nécessaires. Vérifie ses accès au salon et à la catégorie.';
  if (code === 10003) return 'Le salon est introuvable. Vérifie la configuration avec !config.';
  if (code === 10013) return 'Utilisateur Discord introuvable. Vérifie son identifiant.';
  return 'L’opération a échoué. Consulte la console FadeHost ; les données enregistrées sont conservées.';
}
class Queue {
  constructor() { this.locks = new Map(); }
  run(key, fn) {
    const previous = this.locks.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(fn);
    this.locks.set(key, current);
    return current.finally(() => { if (this.locks.get(key) === current) this.locks.delete(key); });
  }
}
module.exports = { UserError, userId, duration, parseCommand, first, chunks, isAdmin, isStaff, privateProblem, attachmentData, messageText, safeError, Queue };
