'use strict';
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, RoleSelectMenuBuilder,
  StringSelectMenuBuilder, ChannelType, MessageFlags, PermissionFlagsBits: P, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { randomBytes } = require('node:crypto');
const { isAdmin, privateProblem, UserError } = require('./util');
const { services, fresh, PRESETS, logAccess } = require('./routes');
const row = (...components) => new ActionRowBuilder().addComponents(...components);
const REQUIRED = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.EmbedLinks, P.AttachFiles];
class Setup {
  constructor(client, store) { this.client = client; this.store = store; this.sessions = new Map(); }
  checkGuild(guildId) {
    const id = this.store.state.config?.guildId || process.env.GUILD_ID?.trim();
    if (id && id !== guildId) throw new UserError('Ce bot est associé à un autre serveur.');
  }
  async start(message) {
    if (!isAdmin(message.member)) throw new UserError('Seuls les administrateurs peuvent utiliser !setup.');
    this.checkGuild(message.guildId);
    await message.reply({ content: 'Configure tous les services ici : catégories, transcriptions, rôles et mode de réponse. Les utilisateurs choisiront leur service en MP.',
      components: [row(new ButtonBuilder().setCustomId(`setup:start:${message.author.id}`).setLabel('Configurer les services').setStyle(ButtonStyle.Primary))], allowedMentions: { parse: [] } });
  }
  screen(s) {
    const button = (action, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(`setup:${action}:${s.id}`).setLabel(label).setStyle(style);
    const c = s.config.services.find(v => v.id === s.selected);
    if (!c) {
      const list = s.config.services;
      const components = [];
      if (list.length) components.push(row(new StringSelectMenuBuilder().setCustomId(`setup:select:${s.id}`).setPlaceholder('Choisis un service à configurer').addOptions(list.map(v => ({ label: v.name, value: v.id, description: v.categoryId && v.logChannelId && v.staffRoleIds.length ? 'Paramètres renseignés' : 'À compléter' })))));
      components.push(row(button('add', 'Ajouter un service'), button('presets', 'Ajouter les 6 services'), button('save', 'Tout enregistrer', ButtonStyle.Success)));
      return { content: null, embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('Configuration de tous les services')
        .setDescription('Configure chaque service, reviens à cette liste, puis clique **Tout enregistrer**. Rien ne change avant cet enregistrement.\n\n' + (list.map(v => `${v.categoryId && v.logChannelId && v.staffRoleIds.length ? '✅' : '⚙️'} **${v.name}**`).join('\n') || 'Ajoute un service ou les six services proposés.') + '\n\nLes conversations déjà ouvertes conservent leurs rôles et leur mode de réponse. Session valable 60 minutes après ta dernière action.')], components };
    }
    const category = new ChannelSelectMenuBuilder().setCustomId(`setup:category:${s.id}`).setPlaceholder('1 · Catégorie des conversations').addChannelTypes(ChannelType.GuildCategory);
    const logs = new ChannelSelectMenuBuilder().setCustomId(`setup:logs:${s.id}`).setPlaceholder('2 · Salon privé des transcriptions').addChannelTypes(ChannelType.GuildText);
    const roles = new RoleSelectMenuBuilder().setCustomId(`setup:roles:${s.id}`).setPlaceholder('3 · Rôles autorisés à répondre').setMinValues(1).setMaxValues(5);
    if (c.categoryId) category.setDefaultChannels(c.categoryId);
    if (c.logChannelId) logs.setDefaultChannels(c.logChannelId);
    if (c.staffRoleIds.length) roles.setDefaultRoles(...c.staffRoleIds);
    const mode = new StringSelectMenuBuilder().setCustomId(`setup:mode:${s.id}`).setPlaceholder('4 · Mode de réponse').addOptions(
      { label: 'Réponse directe + commandes', value: 'direct', description: 'Tout message ordinaire du staff est envoyé en MP.', default: c.replyMode === 'direct' },
      { label: 'Commandes !r et !ar uniquement', value: 'commands', description: 'Les messages ordinaires restent internes.', default: c.replyMode === 'commands' });
    return { content: null, embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`Service : ${c.name}`)
      .setDescription('Renseigne les paramètres ci-dessous puis clique **Retour aux services**.\n\nLe salon des transcriptions doit être privé : @everyone sans « Voir le salon », bot et rôles de ce service autorisés. Un salon partagé entre services donne accès à leurs archives aux équipes correspondantes.\n\nEn mode direct, utilise `!note` pour une note interne.')],
      components: [row(category), row(logs), row(roles), row(mode), row(button('back', 'Retour aux services'), button('rename', 'Renommer'), button('remove', 'Retirer ce service', ButtonStyle.Danger))] };
  }
  async handle(i) {
    if (!i.customId?.startsWith('setup:')) return false;
    if (!i.guildId) throw new UserError('La configuration doit être lancée sur le serveur.');
    const [, action, id] = i.customId.split(':');
    const modalAction = ['add', 'rename'].includes(action);
    if (action === 'start') await i.deferReply({ flags: MessageFlags.Ephemeral });
    else if (!modalAction) await i.deferUpdate();
    const member = await i.guild.members.fetch({ user: i.user.id, force: true });
    if (!isAdmin(member)) throw new UserError('Configuration réservée aux administrateurs.');
    this.checkGuild(i.guildId);
    if (action === 'start') {
      if (id !== i.user.id) throw new UserError('Lance ta propre commande !setup pour configurer le bot.');
      for (const [key, s] of this.sessions) if (s.expires < Date.now() || s.owner === i.user.id) this.sessions.delete(key);
      const s = { id: randomBytes(8).toString('hex'), owner: i.user.id, guildId: i.guildId, expires: Date.now() + 3600000,
        revision: this.store.state.config?.revision || 0,
        config: { guildId: i.guildId, services: structuredClone(services(this.store.state.config)) } };
      if (!s.config.services.length) s.config.services = PRESETS.map(fresh);
      this.sessions.set(s.id, s); await i.editReply(this.screen(s)); return true;
    }
    const s = this.sessions.get(id);
    if (!s || s.owner !== i.user.id || s.guildId !== i.guildId || s.expires < Date.now()) throw new UserError('Configuration expirée. Relance !setup.');
    s.expires = Date.now() + 3600000;
    const c = s.config.services.find(v => v.id === s.selected);
    if (modalAction) {
      if (action === 'add' && s.config.services.length >= 25) throw new UserError('Maximum : 25 services.');
      if (action === 'rename' && !c) throw new UserError('Choisis un service.');
      const field = new TextInputBuilder().setCustomId('name').setLabel('Nom du service').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(60);
      if (action === 'rename') field.setValue(c.name);
      await i.showModal(new ModalBuilder().setCustomId(`setup:${action === 'add' ? 'newname' : 'editname'}:${id}:${c?.id || ''}`).setTitle(action === 'add' ? 'Ajouter un service' : 'Renommer le service').addComponents(row(field)));
      return true;
    }
    if (action === 'newname' || action === 'editname') {
      const name = i.fields.getTextInputValue('name').trim();
      if (!name || name.length > 60) throw new UserError('Le nom doit contenir 1 à 60 caractères.');
      const editingId = i.customId.split(':')[3];
      if (s.config.services.some(v => v.name.toLowerCase() === name.toLowerCase() && v.id !== editingId)) throw new UserError('Ce nom existe déjà.');
      if (action === 'newname') {
        if (s.config.services.length >= 25) throw new UserError('Maximum : 25 services.');
        const service = fresh(name); s.config.services.push(service); s.selected = service.id;
      } else {
        const service = s.config.services.find(v => v.id === editingId);
        if (!service) throw new UserError('Ce service a été retiré.');
        service.name = name;
      }
    } else if (action === 'select') s.selected = i.values[0];
    else if (action === 'back') s.selected = null;
    else if (action === 'remove' && c) { s.config.services = s.config.services.filter(v => v.id !== c.id); s.selected = null; }
    else if (action === 'presets') {
      for (const name of PRESETS) if (s.config.services.length < 25 && !s.config.services.some(v => v.name.toLowerCase() === name.toLowerCase())) s.config.services.push(fresh(name));
    } else if (action === 'category' && c) c.categoryId = i.values[0];
    else if (action === 'logs' && c) c.logChannelId = i.values[0];
    else if (action === 'roles' && c) c.staffRoleIds = i.values;
    else if (action === 'mode' && c) c.replyMode = i.values[0];
    else if (action === 'save') {
      const draft = structuredClone(s.config);
      if (!draft.services.length) throw new UserError('Ajoute au moins un service.');
      for (const route of draft.services) {
        try { await this.validate(i.guild, route, draft); }
        catch (error) { if (error instanceof UserError) throw new UserError(`${route.name} : ${error.message}`); throw error; }
      }
      this.checkGuild(i.guildId);
      if ((this.store.state.config?.revision || 0) !== s.revision) throw new UserError('Un administrateur a modifié la configuration. Relance !setup pour récupérer ses changements.');
      // Snapshot old routes before changing access for future tickets.
      require('./routes').migrate(this.store.state);
      this.store.state.config = structuredClone({ ...draft, revision: s.revision + 1 }); this.store.save(); this.sessions.delete(id);
      await i.editReply({ content: `✅ ${draft.services.length} services enregistrés ensemble.\nEnvoie un MP au bot : il te proposera de choisir un service.\n!help affiche les commandes.`, embeds: [], components: [], allowedMentions: { parse: [] } }); return true;
    }
    await i.editReply(this.screen(s)); return true;
  }
  async validate(guild, c, config = { services: [c] }) {
    if (!c.categoryId || !c.logChannelId || !c.staffRoleIds.length) throw new UserError('Sélectionne une catégorie, un salon de transcriptions et au moins un rôle support.');
    const category = await guild.channels.fetch(c.categoryId);
    const log = await guild.channels.fetch(c.logChannelId);
    if (category?.type !== ChannelType.GuildCategory || log?.type !== ChannelType.GuildText) throw new UserError('Catégorie ou salon invalide.');
    await guild.roles.fetch();
    for (const id of c.staffRoleIds) {
      const role = guild.roles.cache.get(id);
      if (!role || id === guild.id || role.managed) throw new UserError('Sélectionne des rôles humains de l’équipe, pas @everyone ou un rôle de bot.');
    }
    const me = await guild.members.fetchMe();
    if (!category.permissionsFor(me)?.has([...REQUIRED, P.ManageChannels])) throw new UserError('Dans la catégorie choisie, autorise le bot à voir, écrire, lire l’historique, joindre des fichiers, intégrer des liens et gérer les salons.');
    if (!log.permissionsFor(me)?.has(REQUIRED)) throw new UserError('Autorise le bot à voir et écrire dans le salon des transcriptions, lire l’historique, intégrer des liens et joindre des fichiers.');
    const problem = privateProblem(log, logAccess(c, config), this.client.user.id, guild);
    if (problem) throw new UserError('Salon des transcriptions : ' + problem);
    for (const id of c.staffRoleIds) if (!log.permissionsFor(guild.roles.cache.get(id))?.has(P.ViewChannel)) throw new UserError(`Autorise le rôle <@&${id}> à voir le salon <#${c.logChannelId}> des transcriptions.`);
  }
}
module.exports = { Setup, REQUIRED };
