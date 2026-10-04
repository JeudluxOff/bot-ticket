'use strict';
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, RoleSelectMenuBuilder,
  StringSelectMenuBuilder, ChannelType, MessageFlags, PermissionFlagsBits: P, EmbedBuilder } = require('discord.js');
const { randomBytes } = require('node:crypto');
const { isAdmin, privateProblem, UserError } = require('./util');
const row = component => new ActionRowBuilder().addComponents(component);
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
    await message.reply({ content: 'Configuration du support par MP. Clique ci-dessous pour choisir la catégorie, les transcriptions, les rôles et le mode de réponse.',
      components: [row(new ButtonBuilder().setCustomId(`setup:start:${message.author.id}`).setLabel('Configurer le bot').setStyle(ButtonStyle.Primary))], allowedMentions: { parse: [] } });
  }
  screen(session) {
    const c = session.config;
    const category = new ChannelSelectMenuBuilder().setCustomId(`setup:category:${session.id}`).setPlaceholder('1 · Catégorie des conversations').addChannelTypes(ChannelType.GuildCategory);
    const logs = new ChannelSelectMenuBuilder().setCustomId(`setup:logs:${session.id}`).setPlaceholder('2 · Salon privé des transcriptions').addChannelTypes(ChannelType.GuildText);
    const roles = new RoleSelectMenuBuilder().setCustomId(`setup:roles:${session.id}`).setPlaceholder('3 · Rôles de l’équipe autorisés à répondre').setMinValues(1).setMaxValues(5);
    if (c.categoryId) category.setDefaultChannels(c.categoryId);
    if (c.logChannelId) logs.setDefaultChannels(c.logChannelId);
    if (c.staffRoleIds.length) roles.setDefaultRoles(...c.staffRoleIds);
    const mode = new StringSelectMenuBuilder().setCustomId(`setup:mode:${session.id}`).setPlaceholder('4 · Mode de réponse').addOptions(
      { label: 'Réponse directe + commandes', value: 'direct', description: 'Tout message ordinaire du staff est envoyé en MP.', default: c.replyMode === 'direct' },
      { label: 'Commandes !r et !ar uniquement', value: 'commands', description: 'Les messages ordinaires restent des discussions internes.', default: c.replyMode === 'commands' });
    return { content: null, embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('Configurer le support par MP')
      .setDescription('Sélectionne les quatre paramètres puis valide. Les administrateurs ont aussi accès au support.\n\n**Le salon des transcriptions doit être privé** : @everyone sans « Voir le salon », bot et rôles support autorisés.\n\nEn mode direct, tous les messages ordinaires du staff partent en MP. Utilise `!note` pour une note interne.')],
      components: [row(category), row(logs), row(roles), row(mode), row(new ButtonBuilder().setCustomId(`setup:save:${session.id}`).setLabel('Enregistrer').setStyle(ButtonStyle.Success),)]
    };
  }
  async handle(i) {
    if (!i.customId?.startsWith('setup:')) return false;
    if (!i.guildId) throw new UserError('La configuration doit être lancée sur le serveur.');
    const [, action, id] = i.customId.split(':');
    if (action === 'start') await i.deferReply({ flags: MessageFlags.Ephemeral });
    else await i.deferUpdate();
    const member = await i.guild.members.fetch({ user: i.user.id, force: true });
    if (!isAdmin(member)) throw new UserError('Configuration réservée aux administrateurs.');
    this.checkGuild(i.guildId);
    if (action === 'start') {
      if (id !== i.user.id) throw new UserError('Lance ta propre commande !setup pour configurer le bot.');
      for (const [key, s] of this.sessions) if (s.expires < Date.now() || s.owner === i.user.id) this.sessions.delete(key);
      const session = { id: randomBytes(8).toString('hex'), owner: i.user.id, guildId: i.guildId, expires: Date.now() + 15 * 60000,
        config: structuredClone(this.store.state.config || { guildId: i.guildId, categoryId: null, logChannelId: null, staffRoleIds: [], replyMode: 'direct' }) };
      this.sessions.set(session.id, session);
      await i.editReply(this.screen(session)); return true;
    }
    const s = this.sessions.get(id);
    if (!s || s.owner !== i.user.id || s.guildId !== i.guildId || s.expires < Date.now()) throw new UserError('Configuration expirée. Relance !setup.');
    if (action === 'category') s.config.categoryId = i.values[0];
    else if (action === 'logs') s.config.logChannelId = i.values[0];
    else if (action === 'roles') s.config.staffRoleIds = i.values;
    else if (action === 'mode') s.config.replyMode = i.values[0];
    else if (action === 'save') {
      await this.validate(i.guild, s.config);
      // Changing permissions with active tickets could expose earlier conversations.
      const previous = this.store.state.config;
      const accessChanged = previous && (JSON.stringify([...previous.staffRoleIds].sort()) !== JSON.stringify([...s.config.staffRoleIds].sort()) || previous.replyMode !== s.config.replyMode);
      if (Object.keys(this.store.state.tickets).length && accessChanged) throw new UserError('Ferme les conversations en cours avant de changer les rôles ou le mode de réponse. La catégorie et le salon de transcriptions peuvent être réparés immédiatement.');
      this.checkGuild(i.guildId);
      this.store.state.config = s.config; this.store.save(); this.sessions.delete(id);
      await i.editReply({ content: `✅ Configuration enregistrée.\nCatégorie : <#${s.config.categoryId}>\nTranscriptions : <#${s.config.logChannelId}>\nÉquipe : ${s.config.staffRoleIds.map(r => `<@&${r}>`).join(', ')}\nMode : **${s.config.replyMode === 'direct' ? 'réponse directe' : 'commandes uniquement'}**\n\nLe bot est prêt : envoie-lui un MP pour tester. Tape !help dans un salon de l’équipe pour voir les commandes.`, embeds: [], components: [], allowedMentions: { parse: [] } }); return true;
    }
    await i.editReply(this.screen(s)); return true;
  }
  async validate(guild, c) {
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
    const problem = privateProblem(log, c, this.client.user.id, guild);
    if (problem) throw new UserError('Salon des transcriptions : ' + problem);
    for (const id of c.staffRoleIds) if (!log.permissionsFor(guild.roles.cache.get(id))?.has(P.ViewChannel)) throw new UserError('Autorise les rôles support à voir le salon des transcriptions.');
  }
}
module.exports = { Setup, REQUIRED };
