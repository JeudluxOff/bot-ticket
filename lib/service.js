'use strict';
const { EmbedBuilder, AttachmentBuilder, ChannelType, PermissionFlagsBits: P } = require('discord.js');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { UserError, userId, duration, first, chunks, isAdmin, isStaff, privateProblem, attachmentData, messageText, Queue } = require('./util');
const { helpEmbeds } = require('./help');
const NO_MENTIONS = { parse: [], repliedUser: false };
const NO_CHANNEL = 10003;
const NO_MESSAGE = 10008;

class Modmail {
  constructor(client, store) { this.client = client; this.store = store; this.queue = new Queue(); this.rate = new Map(); }
  get config() { return this.store.state.config; }
  async guild() {
    if (!this.config) throw new UserError('Le support n’est pas encore configuré. Un administrateur doit lancer !setup sur le serveur.');
    return this.client.guilds.fetch(this.config.guildId);
  }
  async channel(id) {
    try { return await this.client.channels.fetch(id); }
    catch (e) { if (Number(e.code) === NO_CHANNEL) return null; throw e; }
  }
  async say(channel, text) {
    for (const part of chunks(text)) await channel.send({ content: part, allowedMentions: NO_MENTIONS });
  }
  async assertPrivate(channel) {
    const guild = await this.guild();
    await guild.roles.fetch();
    const problem = privateProblem(channel, this.config, this.client.user.id, guild);
    if (problem) throw new UserError('Utilise un salon privé de l’équipe. ' + problem);
  }
  async help(message) {
    if (!this.config || !isStaff(message.member, this.config)) {
      return this.say(message.channel, 'Pour contacter l’équipe, envoie un message privé à ce bot en décrivant ta demande.');
    }
    // The command list itself contains no conversation information.
    await message.channel.send({ embeds: helpEmbeds(this.config), allowedMentions: NO_MENTIONS });
  }
  overwrites(guild, customerId) {
    const allow = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks];
    const result = [{ id: guild.id, deny: [P.ViewChannel] },
      { id: this.client.user.id, allow: [...allow, P.ManageChannels, P.ManageMessages] },
      ...this.config.staffRoleIds.map(id => ({ id, allow }))];
    // A staff user contacting support must also stay in DM (server admins always bypass channel permissions).
    if (customerId !== this.client.user.id) result.push({ id: customerId, deny: [P.ViewChannel, P.SendMessages] });
    return result;
  }
  async create(user, opener = null) {
    const existing = this.store.ticketForUser(user.id);
    if (existing) return existing;
    if (user.bot) throw new UserError('Impossible d’ouvrir une conversation avec un bot.');
    if (this.store.blocked(user.id)) throw new UserError('Cet utilisateur est bloqué. Utilise !unblock avant de rouvrir une conversation.');
    const guild = await this.guild();
    const category = await guild.channels.fetch(this.config.categoryId);
    if (category?.type !== ChannelType.GuildCategory) throw new UserError('La catégorie a été supprimée. Un administrateur doit vérifier !config.');
    const number = this.store.state.nextTicket++;
    const ticket = { number, userId: user.id, userName: user.tag || user.username, channelId: null, createdAt: Date.now(), status: 'open', nextMessage: 1, events: [], alerts: [], closeAt: null };
    const channel = await guild.channels.create({ name: `mp-${String(number).padStart(4, '0')}-${user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 95), type: ChannelType.GuildText,
      parent: category.id, topic: `Support par MP · dossier ${number} · utilisateur ${user.id}`, permissionOverwrites: this.overwrites(guild, user.id), reason: 'Nouvelle conversation Modmail' });
    ticket.channelId = channel.id;
    this.store.state.tickets[number] = ticket;
    this.store.addEvent(ticket, 'ouverture', { text: opener ? 'Ouverture à l’initiative de l’équipe.' : 'Ouverture à la réception du premier MP.', authorId: opener?.id || user.id });
    await channel.send({ content: this.config.staffRoleIds.map(id => `<@&${id}>`).join(' '),
      allowedMentions: { roles: this.config.staffRoleIds, users: [], parse: [] },
      embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`Conversation #${number}`)
        .setDescription(`**Utilisateur :** ${user.username}\n**ID :** ${user.id}\n\n${this.config.replyMode === 'direct' ? '**Tout message ordinaire de l’équipe est envoyé en MP.**\n' : '**Utilise !r ou !ar pour envoyer un MP.**\n'}
!ar texte : réponse anonyme\n!note texte : note interne\n!help : toutes les commandes\n!close : transcription puis fermeture\n\nL’utilisateur échange uniquement en MP. Les transcriptions et notes sont internes.`)]
    }).catch(e => console.error('En-tête conversation :', e.code || e.name));
    return ticket;
  }
  async ensureChannel(ticket) {
    let channel = await this.channel(ticket.channelId);
    if (channel) { await this.assertPrivate(channel); return channel; }
    const guild = await this.guild();
    channel = await guild.channels.create({ name: `mp-${String(ticket.number).padStart(4, '0')}-restaure`, type: ChannelType.GuildText,
      parent: this.config.categoryId, permissionOverwrites: this.overwrites(guild, ticket.userId), reason: 'Restauration d’une conversation supprimée manuellement' });
    ticket.channelId = channel.id;
    this.store.addEvent(ticket, 'restauration', { text: 'Salon supprimé manuellement : nouveau salon créé. L’historique antérieur reste dans la transcription.' });
    await this.say(channel, 'Conversation restaurée après suppression manuelle du salon. Les anciens échanges restent enregistrés. !help pour les commandes.');
    return channel;
  }
  embed(event, internal = false) {
    const name = event.type === 'entrant' ? event.authorName : event.anonymous ? 'Équipe support' : event.authorName;
    const embed = new EmbedBuilder().setColor(event.type === 'entrant' ? 0x35b78b : 0x5865f2)
      .setAuthor({ name: (internal && event.anonymous ? `${name} · agent : ${event.authorName}` : name || 'Support').slice(0, 256) })
      .setDescription((event.text || '📎 Pièce jointe').slice(0, 4000)).setTimestamp(event.at)
      .setFooter({ text: `Message #${event.number}${event.editedAt ? ' · modifié' : ''}${internal ? ' · ' + (event.type === 'entrant' ? 'MP reçu' : 'MP envoyé') : ''}` });
    return embed;
  }
  async payload(event, internal, uploadLimit = 8 * 1024 * 1024) {
    const embed = this.embed(event, internal);
    const files = [], links = [];
    if (event.text?.length > 4000) files.push(new AttachmentBuilder(Buffer.from(event.text, 'utf8'), { name: `message-${event.number}-complet.txt` }));
    // Re-upload normal attachments so they are visible directly at the destination.
    for (const a of event.attachments || []) {
      if (a.size <= uploadLimit && files.length < 10) files.push({ attachment: a.url, name: a.name });
      else links.push(a);
    }
    if (links.length) embed.addFields({ name: 'Fichiers volumineux (liens)', value: links.map((a, n) => `[Fichier ${n + 1}](${a.url})`).join('\n').slice(0, 1024) });
    return { embeds: [embed], files, allowedMentions: NO_MENTIONS };
  }
  async deliver(channel, event, internal) {
    const payload = await this.payload(event, internal, channel.guild?.maximumUploadLimit || 8 * 1024 * 1024);
    // Stable nonce prevents duplicate delivery on a short network retry.
    const nonce = `${event.id.replace(/-/g, '').slice(0, 23)}${internal ? 'i' : 'd'}`;
    try { return await channel.send({ ...payload, nonce, enforceNonce: true }); }
    catch (e) {
      if (!payload.files.length || [50007, 50013, 50001, 10003].includes(Number(e.code))) throw e;
      // Failed media transfer: keep the message useful with links, not a false success.
      const embed = this.embed(event, internal);
      const urls = (event.attachments || []).map((a, n) => `[Pièce jointe ${n + 1}](${a.url})`).join('\n');
      if (urls) embed.addFields({ name: 'Pièces jointes (liens)', value: urls.slice(0, 1024) });
      return channel.send({ embeds: [embed], allowedMentions: NO_MENTIONS, nonce, enforceNonce: true });
    }
  }
  async incoming(message) {
    return this.queue.run(message.author.id, async () => {
      if (!this.config) return this.say(message.channel, 'Le support n’est pas encore configuré. Réessaie quand l’équipe aura terminé la configuration.');
      if (message.content.trim() === '!help' || message.content.trim() === '!aide') return this.say(message.channel, 'Écris simplement ta demande ici, avec des fichiers si nécessaire. L’équipe te répondra dans ces messages privés. Tes échanges seront archivés pour le suivi du support.');
      const block = this.store.blocked(message.author.id);
      if (block) return this.say(message.channel, `Tu ne peux pas contacter le support actuellement.${block.until ? ` Fin du blocage : <t:${Math.floor(block.until / 1000)}:F>.` : ''}`);
      const recent = (this.rate.get(message.author.id) || []).filter(t => t > Date.now() - 10000);
      if (recent.length >= 8) return this.say(message.channel, 'Tu envoies trop de messages. Patiente quelques secondes puis renvoie ton dernier message.');
      recent.push(Date.now()); this.rate.set(message.author.id, recent);
      let ticket = this.store.ticketForUser(message.author.id);
      const isNew = !ticket;
      if (ticket && ticket.status !== 'open') return this.say(message.channel, 'Ta conversation est en cours de clôture. Réessaie dans quelques instants ; ce message n’a pas été transmis.');
      ticket ||= await this.create(message.author);
      if (ticket.events.some(e => e.sourceMessageId === message.id)) return;
      if (ticket.closeAt) {
        ticket.closeAt = null;
        this.store.addEvent(ticket, 'annulation_fermeture', { text: 'Fermeture programmée annulée : nouvelle réponse de l’utilisateur.' });
      }
      const event = this.store.addEvent(ticket, 'entrant', { number: ticket.nextMessage++, text: messageText(message), authorId: message.author.id,
        authorName: message.author.username, sourceMessageId: message.id, attachments: attachmentData(message), status: 'en_attente' });
      const channel = await this.ensureChannel(ticket);
      try {
        const mirrored = await this.deliver(channel, event, true);
        event.staffMessageId = mirrored.id; event.status = 'reçu'; this.store.save();
      } catch (e) {
        await this.say(message.channel, 'Ton message est enregistré, mais son affichage à l’équipe est retardé. Le bot réessaiera automatiquement.').catch(() => {});
        throw e;
      }
      if (isNew) await this.say(message.channel, `✅ Ta conversation #${ticket.number} est ouverte. Ton premier message a été transmis. Continue à écrire ici : l’équipe te répondra par MP. Les échanges sont archivés pour le suivi du support.`);
      await message.react('✅').catch(() => {});
      if (ticket.alerts.length) {
        const guild = await this.guild(); const allowed = [];
        for (const id of ticket.alerts) {
          const member = await guild.members.fetch(id).catch(() => null);
          if (isStaff(member, this.config) && id !== ticket.userId) allowed.push(id);
        }
        ticket.alerts = allowed; this.store.save();
        if (allowed.length) await channel.send({ content: allowed.map(id => `<@${id}>`).join(' ') + ' — nouvelle réponse en MP.', allowedMentions: { users: allowed, roles: [], parse: [] } });
      }
    });
  }
  async send(ticket, member, text, attachments = [], anonymous = false) {
    if (ticket.status !== 'open') throw new UserError('Cette conversation est en cours de clôture.');
    if (!text && !attachments.length) throw new UserError('Ajoute un texte ou une pièce jointe.');
    if (text.length > 4000) throw new UserError('Message trop long : 4 000 caractères maximum. Envoie-le en plusieurs messages.');
    const user = await this.client.users.fetch(ticket.userId);
    const dm = await user.createDM();
    const event = this.store.addEvent(ticket, 'sortant', { number: ticket.nextMessage++, authorId: member.id,
      authorName: member.displayName || member.user?.username || member.username, text, attachments, anonymous, status: 'en_attente' });
    let delivered;
    try { delivered = await this.deliver(dm, event, false); }
    catch (e) { event.status = 'échec_envoi'; this.store.save(); throw e; }
    event.dmMessageId = delivered.id; event.dmChannelId = dm.id; event.status = 'envoyé';
    // Store destination URLs: links in the transcript refer to the relayed attachment.
    if (delivered.attachments?.size) event.attachments = attachmentData(delivered);
    this.store.save();
    try {
      const channel = await this.ensureChannel(ticket);
      const mirror = await this.deliver(channel, event, true); event.staffMessageId = mirror.id; this.store.save();
    } catch (e) {
      console.error('Copie équipe en attente :', e.code || e.name);
      // DM succeeded: never ask to resend a message already delivered.
    }
    return event;
  }
  async edit(ticket, actor, number, text) {
    if (ticket.status !== 'open') throw new UserError('Conversation en cours de clôture.');
    const e = ticket.events.find(e => e.type === 'sortant' && e.number === Number(number));
    if (!e || !e.dmMessageId || e.deleted) throw new UserError('Numéro de réponse introuvable ou réponse déjà supprimée.');
    if (!text || text.length > 4000) throw new UserError('Utilisation : !edit numéro nouveau texte (1 à 4 000 caractères).');
    const dm = await this.client.channels.fetch(e.dmChannelId);
    const msg = await dm.messages.fetch(e.dmMessageId);
    const edited = { ...e, text, editedAt: Date.now() };
    await msg.edit({ embeds: [this.embed(edited)], allowedMentions: NO_MENTIONS });
    e.revisions ||= []; e.revisions.push({ text: e.text, at: Date.now(), by: actor.id }); e.text = text; e.editedAt = edited.editedAt;
    this.store.addEvent(ticket, 'modification', { authorId: actor.id, text: `Réponse #${number} modifiée.` });
    const channel = await this.ensureChannel(ticket);
    if (e.staffMessageId) await channel.messages.fetch(e.staffMessageId).then(m => m.edit({ embeds: [this.embed(e, true)], allowedMentions: NO_MENTIONS })).catch(() => {});
  }
  async deleteReply(ticket, actor, number) {
    if (ticket.status !== 'open') throw new UserError('Conversation en cours de clôture.');
    const e = ticket.events.find(e => e.type === 'sortant' && e.number === Number(number));
    if (!e || !e.dmMessageId || e.deleted) throw new UserError('Numéro de réponse introuvable ou réponse déjà supprimée.');
    const dm = await this.client.channels.fetch(e.dmChannelId);
    try { await dm.messages.delete(e.dmMessageId); } catch (error) { if (Number(error.code) !== NO_MESSAGE) throw error; }
    e.deleted = true;
    this.store.addEvent(ticket, 'suppression', { authorId: actor.id, text: `Réponse #${number} supprimée côté utilisateur ; contenu conservé dans l’archive interne.` });
    const channel = await this.ensureChannel(ticket);
    if (e.staffMessageId) await channel.messages.fetch(e.staffMessageId).then(m => m.edit({ content: `Réponse #${number} supprimée en MP par <@${actor.id}>. Contenu conservé dans l’archive interne.`, embeds: [], attachments: [], allowedMentions: NO_MENTIONS })).catch(() => {});
  }
  async close(ticket, closer, silent = false) {
    if (ticket.status === 'closed') return;
    if (ticket.status === 'open') {
      ticket.status = 'closing'; ticket.closeAt = null; ticket.closedAt = Date.now(); ticket.closedBy = closer.id; ticket.silent = silent;
      ticket.closure = { uploaded: 0, urls: [], notified: false };
      this.store.addEvent(ticket, 'fermeture', { authorId: closer.id, text: silent ? 'Fermeture silencieuse.' : 'Fermeture avec notification prévue.' });
    }
    // A local copy plus a successful staff upload must exist before channel deletion.
    if (!ticket.closure.snapshot) { this.store.archive(ticket); ticket.closure.snapshot = true; this.store.save(); }
    const text = fs.readFileSync(path.join(this.store.directory, 'archives', `conversation-${ticket.number}.txt`), 'utf8');
    const guild = await this.guild();
    const logs = await guild.channels.fetch(this.config.logChannelId);
    if (logs?.type !== ChannelType.GuildText) throw new UserError('Salon de transcriptions introuvable : le salon de conversation est conservé.');
    await this.assertPrivate(logs);
    const parts = chunks(text, 900000);
    for (let idx = ticket.closure.uploaded; idx < parts.length; idx++) {
      const post = await logs.send({ content: `📁 Conversation #${ticket.number} · utilisateur ${ticket.userId} · archive ${idx + 1}/${parts.length}`,
        files: [new AttachmentBuilder(Buffer.from(parts[idx], 'utf8'), { name: `conversation-${ticket.number}-${idx + 1}.txt` })],
        allowedMentions: NO_MENTIONS, nonce: `archive-${ticket.number}-${idx}`, enforceNonce: true });
      ticket.closure.urls.push(post.url); ticket.closure.uploaded = idx + 1; this.store.save();
    }
    if (!ticket.silent && !ticket.closure.notified) {
      try {
        const user = await this.client.users.fetch(ticket.userId);
        await user.send({ content: `🔒 Ta conversation #${ticket.number} avec le support est fermée. Tu peux nous écrire à nouveau pour une autre demande.`, allowedMentions: NO_MENTIONS,
          nonce: `closed-${ticket.number}`, enforceNonce: true });
        ticket.closure.notified = true;
      } catch (e) { ticket.closure.notificationFailed = Number(e.code) || e.name; }
      this.store.save();
    }
    const channel = await this.channel(ticket.channelId);
    if (channel) await channel.delete('Conversation archivée dans le salon des transcriptions');
    ticket.status = 'closed';
    const { atomicWrite } = require('./store');
    atomicWrite(path.join(this.store.directory, 'archives', `conversation-${ticket.number}.json`), JSON.stringify(ticket, null, 2));
    this.store.state.history.push({ number: ticket.number, userId: ticket.userId, createdAt: ticket.createdAt, closedAt: ticket.closedAt, closedBy: ticket.closedBy, logUrls: ticket.closure.urls });
    delete this.store.state.tickets[ticket.number]; this.store.save();
  }
  async tick() {
    // All due dates live on disk; no fragile setTimeout for long durations.
    for (const t of Object.values(this.store.state.tickets)) {
      await this.queue.run(t.userId, async () => {
        const current = this.store.ticketForUser(t.userId);
        if (current !== t) return;
        if (t.status === 'closing' || (t.closeAt && t.closeAt <= Date.now())) {
          try { await this.close(t, { id: t.closedBy || t.scheduledBy || this.client.user.id }, t.silent || false); }
          catch (e) { console.error(`Clôture #${t.number} reportée :`, e.code || e.message); }
          return;
        }
        const pending = t.events.filter(e => (e.type === 'entrant' && e.status === 'en_attente') || (e.type === 'sortant' && e.status === 'envoyé' && !e.staffMessageId && !e.deleted));
        if (!pending.length) return;
        try {
          const channel = await this.ensureChannel(t);
          for (const e of pending) {
            const m = await this.deliver(channel, e, true); e.staffMessageId = m.id;
            if (e.type === 'entrant') e.status = 'reçu'; this.store.save();
          }
        } catch (e) { console.error(`Relais #${t.number} reporté :`, e.code || e.name); }
      });
    }
    for (const [id, times] of this.rate) if (times.at(-1) < Date.now() - 60000) this.rate.delete(id);
  }
  async direct(message) {
    const ticket = this.store.ticketForChannel(message.channelId);
    if (!ticket || !isStaff(message.member, this.config)) return;
    return this.queue.run(ticket.userId, async () => {
      await this.assertPrivate(message.channel);
      if (this.config.replyMode === 'commands') {
        this.store.addEvent(ticket, 'discussion_interne', { authorId: message.author.id, authorName: message.member.displayName,
          text: messageText(message), attachments: attachmentData(message) });
        return;
      }
      await this.send(ticket, message.member, messageText(message), attachmentData(message));
      await message.react('✅').catch(() => {});
    });
  }
  async command(message, command) {
    const { name } = command;
    if (['help', 'aide', 'commands'].includes(name)) return this.help(message);
    if (!this.config) throw new UserError('Un administrateur doit lancer !setup avant d’utiliser le support.');
    if (message.guildId !== this.config.guildId) throw new UserError('Ce serveur n’est pas celui configuré pour le support.');
    if (!isStaff(message.member, this.config)) throw new UserError('Commande réservée aux rôles support et aux administrateurs.');
    await this.assertPrivate(message.channel);
    const current = this.store.ticketForChannel(message.channelId);
    if (name === 'config') {
      if (!isAdmin(message.member)) throw new UserError('Commande réservée aux administrateurs.');
      return this.say(message.channel, `Catégorie : <#${this.config.categoryId}>\nTranscriptions : <#${this.config.logChannelId}>\nRôles : ${this.config.staffRoleIds.map(id => `<@&${id}>`).join(', ')}\nMode : ${this.config.replyMode === 'direct' ? 'réponse directe' : '!r / !ar uniquement'}\nModification : !setup (après clôture des conversations ouvertes).`);
    }
    if (name === 'template') {
      if (!isAdmin(message.member)) throw new UserError('Commande réservée aux administrateurs.');
      const [key, text] = first(command.rest);
      if (!['wipe', 'mortrp'].includes(key)) throw new UserError('Utilisation : !template wipe [texte] ou !template mortrp [texte].');
      if (!text) return this.say(message.channel, this.store.state.templates[key]);
      if (text.length > 4000) throw new UserError('Maximum : 4 000 caractères.');
      this.store.state.templates[key] = text; this.store.save();
      return this.say(message.channel, `✅ Message automatique ${key} enregistré.`);
    }
    if (name === 'delete_note') {
      const id = command.rest.trim();
      let owner;
      for (const [uid, notes] of Object.entries(this.store.state.notes)) if (notes.some(n => n.id === id)) owner = uid;
      if (!owner) throw new UserError('Note introuvable. Utilise !notes pour obtenir son identifiant.');
      return this.queue.run(owner, async () => {
        this.store.state.notes[owner] = this.store.state.notes[owner].filter(n => n.id !== id); this.store.save();
        const t = this.store.ticketForUser(owner);
        if (t) this.store.addEvent(t, 'suppression_note', { authorId: message.author.id, text: `Note ${id} supprimée du dossier utilisateur.` });
        return this.say(message.channel, '✅ Note supprimée du dossier. Les archives de conversations déjà fermées restent inchangées.');
      });
    }
    const known = ['open', 'r', 'ar', 'close', 'block', 'unblock', 'logs', 'id', 'note', 'notes', 'move', 'alert', 'edit', 'delete', '!wipe', '!mortrp'];
    if (!known.includes(name)) throw new UserError('Commande inconnue. Tape !help. Rien n’a été envoyé en MP.');
    let target = current?.userId, rest = command.rest;
    const [firstArg, remainder] = first(rest);
    if (!current || name === 'open' || name === 'notes' && firstArg) {
      target = userId(firstArg); rest = remainder;
      if (!target) throw new UserError('Dans un salon de l’équipe, ajoute l’identifiant : !' + name + ' ID [arguments].');
    }
    return this.queue.run(target, async () => {
      let t = this.store.ticketForUser(target);
      if (name === 'open') {
        if (t) return this.say(message.channel, `Conversation déjà existante : <#${t.channelId}>.`);
        const user = await this.client.users.fetch(target);
        t = await this.create(user, message.author);
        await this.send(t, message.member, 'L’équipe support a ouvert une conversation avec toi. Tu peux répondre directement ici.', [], true);
        return this.say(message.channel, `✅ Conversation ouverte : <#${t.channelId}>.`);
      }
      if (name === 'block') {
        const until = rest.trim() ? Date.now() + duration(rest.trim()) : null;
        this.store.state.blocks[target] = { by: message.author.id, at: Date.now(), until }; this.store.save();
        if (t) this.store.addEvent(t, 'blocage', { authorId: message.author.id, text: until ? `Blocage jusqu’au ${new Date(until).toISOString()}.` : 'Blocage permanent.' });
        return this.say(message.channel, `🚫 ${target} bloqué ${until ? 'jusqu’au <t:' + Math.floor(until / 1000) + ':F>' : 'sans limite de durée'}. Les prochains MP ne seront pas transmis.`);
      }
      if (name === 'unblock') {
        delete this.store.state.blocks[target]; this.store.save();
        if (t) this.store.addEvent(t, 'déblocage', { authorId: message.author.id });
        return this.say(message.channel, '✅ Utilisateur débloqué.');
      }
      if (name === 'id') return this.say(message.channel, `ID Discord : ${target}`);
      if (name === 'note') {
        if (!rest) throw new UserError('Utilisation : !note texte.');
        const note = { id: randomUUID().slice(0, 8), text: rest, by: message.author.id, at: Date.now() };
        this.store.state.notes[target] ||= []; this.store.state.notes[target].push(note); this.store.save();
        if (t) this.store.addEvent(t, 'note_interne', { text: rest, authorId: message.author.id, noteId: note.id });
        return this.say(message.channel, `📝 Note interne enregistrée : ${note.id}.`);
      }
      if (name === 'notes') {
        const notes = this.store.state.notes[target] || [];
        return this.say(message.channel, notes.length ? notes.map(n => `**${n.id}** · <@${n.by}> · <t:${Math.floor(n.at / 1000)}:f>\n${n.text}`).join('\n\n') : 'Aucune note.');
      }
      if (name === 'logs') {
        const history = this.store.state.history.filter(h => h.userId === target);
        const text = history.map(h => `#${h.number} · <t:${Math.floor(h.createdAt / 1000)}:f>\n${h.logUrls.join('\n')}`).join('\n\n');
        return this.say(message.channel, `Historique de ${target}\n${t ? `En cours : <#${t.channelId}>\n` : ''}${text || 'Aucune conversation clôturée.'}`);
      }
      if (!t) throw new UserError('Aucune conversation ouverte pour cet utilisateur. Utilise !open ID.');
      if (name === 'close') {
        if (rest.trim() === 'cancel') {
          if (t.status !== 'open') throw new UserError('La clôture et l’archivage ont déjà commencé.');
          t.closeAt = null; this.store.addEvent(t, 'annulation_fermeture', { authorId: message.author.id });
          return this.say(message.channel, '✅ Fermeture programmée annulée.');
        }
        const args = rest.trim().split(/\s+/).filter(Boolean);
        const silent = args.includes('-s'); const times = args.filter(a => a !== '-s');
        if (times.length > 1) throw new UserError('Utilisation : !close [15m] [-s] ou !close cancel.');
        if (times.length) {
          if (t.status !== 'open') throw new UserError('La clôture a déjà commencé.');
          t.closeAt = Date.now() + duration(times[0]); t.scheduledBy = message.author.id; t.silent = silent;
          this.store.addEvent(t, 'fermeture_programmée', { authorId: message.author.id, text: `Échéance : ${new Date(t.closeAt).toISOString()} ; silencieux : ${silent}.` });
          return this.say(message.channel, `⏳ Fermeture prévue <t:${Math.floor(t.closeAt / 1000)}:R>. Une réponse de l’utilisateur annulera cette fermeture.`);
        }
        await this.say(message.channel, 'Archivage en cours. Le salon sera supprimé après envoi de la transcription.');
        await this.close(t, message.author, silent); return;
      }
      if (name === 'r' || name === 'ar' || name.startsWith('!')) {
        const text = name.startsWith('!') ? this.store.state.templates[name.slice(1)] : rest;
        const e = await this.send(t, message.member, text, attachmentData(message), name === 'ar' || name.startsWith('!'));
        return this.say(message.channel, `✅ Réponse #${e.number} envoyée en MP${e.staffMessageId ? '.' : ' ; copie dans le salon en attente.'}`);
      }
      if (name === 'edit') {
        const [number, text] = first(rest); await this.edit(t, message.author, number, text);
        return this.say(message.channel, `✅ Réponse #${number} modifiée en MP.`);
      }
      if (name === 'delete') {
        await this.deleteReply(t, message.author, rest.trim()); return this.say(message.channel, `✅ Réponse #${rest.trim()} supprimée en MP.`);
      }
      if (t.status !== 'open') throw new UserError('La clôture de cette conversation est en cours.');
      if (name === 'alert') {
        if (rest && rest.trim() !== 'cancel') throw new UserError('Utilisation : !alert ou !alert cancel.');
        t.alerts = rest.trim() === 'cancel' ? t.alerts.filter(id => id !== message.author.id) : [...new Set([...t.alerts, message.author.id])]; this.store.save();
        return this.say(message.channel, rest.trim() === 'cancel' ? '🔕 Tes alertes sont désactivées.' : '🔔 Tu seras mentionné à chaque prochaine réponse en MP.');
      }
      if (name === 'move') {
        const guild = await this.guild(); const all = await guild.channels.fetch();
        const matches = [...all.values()].filter(c => c?.type === ChannelType.GuildCategory && (c.id === rest.trim() || c.name.toLowerCase() === rest.trim().toLowerCase()));
        if (matches.length !== 1) throw new UserError('Catégorie introuvable ou nom ambigu. Utilise son nom exact ou son ID.');
        const channel = await this.ensureChannel(t);
        await channel.setParent(matches[0].id, { lockPermissions: false });
        this.store.addEvent(t, 'déplacement', { authorId: message.author.id, text: `Déplacé dans ${matches[0].name} ; permissions privées conservées.` });
        return this.say(message.channel, `✅ Conversation déplacée dans ${matches[0].name}.`);
      }
    });
  }
}
module.exports = { Modmail, NO_MENTIONS };
