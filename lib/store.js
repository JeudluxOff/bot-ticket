'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function atomicWrite(file, text) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
class Store {
  constructor(directory) {
    this.directory = path.resolve(directory);
    fs.mkdirSync(this.directory, { recursive: true });
    fs.mkdirSync(path.join(this.directory, 'archives'), { recursive: true });
    this.file = path.join(this.directory, 'state-v2.json');
    if (fs.existsSync(this.file)) {
      // Fail closed on corrupt storage; never replace it with an empty database.
      this.state = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (this.state.version !== 2 || !this.state.tickets || !Array.isArray(this.state.history))
        throw new Error('Données Modmail invalides. Restaurer une sauvegarde avant de redémarrer.');
    } else {
      this.state = { version: 2, config: null, nextTicket: 1, tickets: {}, blocks: {}, notes: {}, history: [], templates: {
        wipe: 'Pour ta demande de wipe, précise :\n• Ton pseudo et ton identifiant joueur\n• Le nom de ton personnage\n• La raison de la demande\n• Ce que tu souhaites réinitialiser\n\nAttends la validation de l’équipe avant de procéder.',
        mortrp: 'Pour ta demande de mort RP, précise :\n• Le nom du personnage concerné\n• Le contexte et les raisons RP\n• Les personnes impliquées\n• Les preuves ou documents utiles\n\nLa demande sera étudiée par l’équipe. Ce message ne constitue pas une validation.'
      } };
      this.save();
    }
  }
  save() {
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.bak`);
    atomicWrite(this.file, JSON.stringify(this.state, null, 2));
  }
  ticketForUser(id) { return Object.values(this.state.tickets).find(t => t.userId === id && t.status !== 'closed'); }
  ticketForChannel(id) { return Object.values(this.state.tickets).find(t => t.channelId === id && t.status !== 'closed'); }
  blocked(id, now = Date.now()) {
    const b = this.state.blocks[id];
    if (!b) return false;
    if (b.until && b.until <= now) { delete this.state.blocks[id]; this.save(); return false; }
    return b;
  }
  addEvent(ticket, type, data = {}) {
    const event = { id: randomUUID(), type, at: Date.now(), ...data };
    ticket.events.push(event); this.save(); return event;
  }
  archive(ticket) {
    const base = path.join(this.directory, 'archives', `conversation-${ticket.number}`);
    atomicWrite(base + '.json', JSON.stringify(ticket, null, 2));
    const text = transcript(ticket, this.state.notes[ticket.userId] || []);
    atomicWrite(base + '.txt', text);
    return text;
  }
}
function transcript(t, notes = []) {
  const date = v => new Date(v).toISOString();
  let out = `MODMAIL — TRANSCRIPTION ÉQUIPE\nConversation #${t.number}\nUtilisateur : ${t.userName} (${t.userId})\nOuverture : ${date(t.createdAt)}\nClôture : ${t.closedAt ? date(t.closedAt) : 'en cours'}\n\n`;
  for (const e of t.events) {
    out += `[${date(e.at)}] ${e.type.toUpperCase()}${e.number ? ` #${e.number}` : ''} — ${e.authorName || ''} ${e.authorId ? `(${e.authorId})` : ''}\n`;
    if (e.anonymous) out += 'Identité affichée en MP : Équipe support (auteur réel réservé à l’équipe).\n';
    if (e.status) out += `État : ${e.status}\n`;
    if (e.text) out += e.text + '\n';
    for (const a of e.attachments || []) out += `Fichier : ${a.name} — ${a.url}\n`;
    for (const revision of e.revisions || []) out += `Ancienne version (${date(revision.at)}) : ${revision.text}\n`;
    if (e.deleted) out += 'Message supprimé côté destinataire par commande staff.\n';
    if (e.dmMessageId) out += `Message MP : ${e.dmMessageId}\n`;
    out += '\n';
  }
  out += '\nNOTES INTERNES ASSOCIÉES À L’UTILISATEUR AU MOMENT DE LA CLÔTURE\n';
  for (const n of notes) out += `${n.id} | ${date(n.at)} | ${n.by}\n${n.text}\n\n`;
  out += '\nLes fichiers sont référencés par liens Discord (leur disponibilité n’est pas garantie à long terme).\n';
  return out;
}
module.exports = { Store, atomicWrite, transcript };
