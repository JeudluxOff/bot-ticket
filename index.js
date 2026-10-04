'use strict';
// Node >= 22.12. No token or personal identifier belongs in this file.
const path = require('node:path');
const { Client, GatewayIntentBits, Partials, Events, MessageFlags, Options } = require('discord.js');
const { Store } = require('./lib/store');
const { Modmail, NO_MENTIONS } = require('./lib/service');
const { Setup } = require('./lib/setup');
const { parseCommand, safeError, UserError } = require('./lib/util');

function createBot({ client, store }) {
  const service = new Modmail(client, store);
  const setup = new Setup(client, store);
  client.on(Events.MessageCreate, async message => {
    if (message.author.bot || message.webhookId || message.system) return;
    try {
      if (!message.guildId) {
        if (message.channel.isDMBased()) await service.incoming(message);
        return;
      }
      if (store.state.config && message.guildId !== store.state.config.guildId) return;
      if (process.env.GUILD_ID && message.guildId !== process.env.GUILD_ID.trim()) return;
      const command = parseCommand(message.content);
      if (!command && !store.ticketForChannel(message.channelId)) return;
      // Force-refresh role membership before authorizing a staff action.
      const member = await message.guild.members.fetch({ user: message.author.id, force: true });
      // message.member is a getter in discord.js; fetching updates the guild cache it reads.
      if (!member) return;
      if (command?.name === 'setup') await setup.start(message);
      else if (command) await service.command(message, command);
      else await service.direct(message);
    } catch (error) {
      if (!(error instanceof UserError)) console.error('Message :', error.code || error.name, 'Échec Discord ou stockage');
      await message.reply({ content: '❌ ' + safeError(error), allowedMentions: NO_MENTIONS }).catch(() => {});
    }
  });
  client.on(Events.InteractionCreate, async i => {
    if (!i.isMessageComponent()) return;
    try { await setup.handle(i); }
    catch (error) {
      if (!(error instanceof UserError)) console.error('Configuration :', error.code || error.name);
      const payload = { content: '❌ ' + safeError(error), flags: MessageFlags.Ephemeral, allowedMentions: NO_MENTIONS };
      if (i.replied || i.deferred) await i.followUp(payload).catch(() => {});
      else await i.reply(payload).catch(() => {});
    }
  });
  let interval, ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try { await service.tick(); }
    catch (e) { console.error('Maintenance :', e.code || e.name); }
    finally { ticking = false; }
  };
  client.once(Events.ClientReady, () => {
    console.log(`✅ Connecté en tant que ${client.user.tag} — Modmail v2`);
    console.log(store.state.config ? 'Configuration chargée. !help pour les commandes.' : 'Configuration requise : lance !setup sur ton serveur.');
    console.log(`Données : ${store.directory}`);
    for (const t of Object.values(store.state.tickets)) {
      for (const e of t.events) if (e.type === 'sortant' && e.status === 'en_attente') {
        e.status = 'envoi_incertain_après_redémarrage';
        console.warn(`Vérifier manuellement la livraison du message #${e.number}, conversation #${t.number}. Aucun renvoi automatique.`);
      }
    }
    store.save();
    void tick(); interval = setInterval(tick, 15000); interval.unref();
  });
  client.on(Events.Error, e => console.error('Discord :', e.code || e.name));
  return { service, setup, stop() { clearInterval(interval); store.save(); client.destroy(); } };
}
if (require.main === module) {
  const token = process.env.DISCORD_TOKEN?.trim();
  if (!token) { console.error('DISCORD_TOKEN manquant. Renseigne-le dans Environment sur FadeHost.'); process.exit(1); }
  const directory = process.env.DATA_DIR || (process.cwd().startsWith('/data/app') ? '/data/storage/modmail' : path.join(__dirname, 'data'));
  let store;
  try { store = new Store(directory); }
  catch (e) { console.error('Impossible de charger les données. Vérifie DATA_DIR et state-v2.json. Aucune donnée n’a été écrasée.', e.message); process.exit(1); }
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel, Partials.Message, Partials.User],
    allowedMentions: NO_MENTIONS,
    makeCache: Options.cacheWithLimits({ ...Options.DefaultMakeCacheSettings, MessageManager: 30 }),
    sweepers: { ...Options.DefaultSweeperSettings, messages: { interval: 300, lifetime: 1800 } }
  });
  const bot = createBot({ client, store });
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { bot.stop(); process.exit(0); });
  client.login(token).catch(error => {
    console.error('Connexion impossible :', error.code || error.name, String(error.message).replaceAll(token, '[TOKEN]'));
    process.exit(1);
  });
}
module.exports = { createBot };
