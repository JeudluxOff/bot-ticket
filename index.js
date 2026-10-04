const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  ChannelType,
  Collection,
  AttachmentBuilder
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const ms = require('ms');

const config = {
  token: process.env.DISCORD_TOKEN,
  guildId: process.env.GUILD_ID,
  ticketCategoryId: process.env.TICKET_CATEGORY_ID,
  logChannelId: process.env.LOG_CHANNEL_ID,
  staffRoleId: process.env.STAFF_ROLE_ID,
  supportRoleId: process.env.SUPPORT_ROLE_ID
};

if (!config.token) {
  console.error('DISCORD_TOKEN manquant');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User]
});

const dataPath = path.join(__dirname, 'data');
if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath);

const ticketsFile = path.join(dataPath, 'tickets.json');
const blocksFile = path.join(dataPath, 'blocks.json');
const notesFile = path.join(dataPath, 'notes.json');

function load(file) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, '{}');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function save(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let tickets = load(ticketsFile);
let blocks = load(blocksFile);
let notes = load(notesFile);

const closeTimers = new Collection();
const alertUsers = new Collection();

function isStaff(member) {
  if (!member) return false;
  return member.roles.cache.has(config.staffRoleId) ||
         member.roles.cache.has(config.supportRoleId) ||
         member.permissions.has(PermissionFlagsBits.Administrator);
}

function isBlocked(userId) {
  const block = blocks[userId];
  if (!block) return false;
  if (block.until && Date.now() > block.until) {
    delete blocks[userId];
    save(blocksFile, blocks);
    return false;
  }
  return true;
}

async function generateTranscript(channel, ticket) {
  const messages = await channel.messages.fetch({ limit: 100 });
  const sorted = [...messages.values()].reverse();

  let transcript = `TRANSCRIPT\n`;
  transcript += `Salon: ${channel.name}\n`;
  transcript += `Utilisateur: ${ticket.userId}\n`;
  transcript += `Cree le: ${new Date(ticket.createdAt).toLocaleString('fr-FR')}\n`;
  transcript += `Ferme le: ${new Date().toLocaleString('fr-FR')}\n\n`;

  for (const msg of sorted) {
    const time = msg.createdAt.toLocaleString('fr-FR');
    const author = msg.author.tag;
    const content = msg.content || '[Fichier ou embed]';
    transcript += `[${time}] ${author}: ${content}\n`;
  }

  return transcript;
}

async function createTicket(source, user) {
  if (isBlocked(user.id)) {
    const reply = { content: 'Tu es bloque et ne peux plus creer de tickets.', ephemeral: true };
    return source.reply ? source.reply(reply) : source.channel.send(reply.content);
  }

  const existing = Object.values(tickets).find(t => t.userId === user.id && !t.closed);
  if (existing) {
    const reply = { content: `Tu as deja un ticket ouvert : <#${existing.channelId}>`, ephemeral: true };
    return source.reply ? source.reply(reply) : source.channel.send(reply.content);
  }

  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) return;

  const category = guild.channels.cache.get(config.ticketCategoryId);

  const channel = await guild.channels.create({
    name: `ticket-${user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 90),
    type: ChannelType.GuildText,
    parent: category?.id,
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
      { id: config.staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] },
      { id: config.supportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] }
    ]
  });

  tickets[channel.id] = {
    userId: user.id,
    channelId: channel.id,
    createdAt: Date.now(),
    closed: false
  };
  save(ticketsFile, tickets);

  const embed = new EmbedBuilder()
    .setTitle('Ticket ouvert')
    .setDescription(`Bonjour ${user},\n\nUn membre du staff va te repondre sous peu.`)
    .setColor(0x57F287)
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('close_ticket')
      .setLabel('Fermer le ticket')
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({ content: `${user} | <@&${config.staffRoleId}>`, embeds: [embed], components: [row] });

  const logChannel = guild.channels.cache.get(config.logChannelId);
  if (logChannel) {
    logChannel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle('Nouveau ticket')
          .setDescription(`Utilisateur : ${user.tag} (${user.id})\nSalon : ${channel}`)
          .setColor(0x5865F2)
          .setTimestamp()
      ]
    });
  }

  if (source.reply) {
    await source.reply({ content: `Ton ticket a ete cree : ${channel}`, ephemeral: true });
  } else if (source.channel?.isDMBased()) {
    await source.channel.send(`Ton ticket a ete cree : ${channel}`);
  } else {
    await source.reply(`Ton ticket a ete cree : ${channel}`);
  }
}

async function closeTicket(channel, closer, silent = false) {
  const ticket = tickets[channel.id];
  if (!ticket || ticket.closed) return;

  ticket.closed = true;
  ticket.closedAt = Date.now();
  ticket.closedBy = closer.id;
  save(ticketsFile, tickets);

  const transcriptText = await generateTranscript(channel, ticket);
  const transcriptFile = new AttachmentBuilder(Buffer.from(transcriptText, 'utf-8'), {
    name: `transcript-${channel.name}.txt`
  });

  if (!silent) {
    const user = await client.users.fetch(ticket.userId).catch(() => null);
    if (user) {
      try {
        await user.send({
          embeds: [
            new EmbedBuilder()
              .setTitle('Ticket ferme')
              .setDescription(`Ton ticket a ete ferme par ${closer.tag}.`)
              .setColor(0xED4245)
              .setTimestamp()
          ],
          files: [transcriptFile]
        });
      } catch {}
    }
  }

  const logChannel = channel.guild.channels.cache.get(config.logChannelId);
  if (logChannel) {
    await logChannel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle('Ticket ferme')
          .setDescription(`Salon : ${channel.name}\nUtilisateur : <@${ticket.userId}>\nFerme par : ${closer.tag}`)
          .setColor(0xED4245)
          .setTimestamp()
      ],
      files: [transcriptFile]
    });
  }

  setTimeout(() => channel.delete().catch(() => {}), 4000);
}

client.once('ready', () => {
  console.log(`Connecte en tant que ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId === 'open_ticket') {
    await createTicket(interaction, interaction.user);
  }

  if (interaction.customId === 'close_ticket') {
    const ticket = tickets[interaction.channel.id];
    if (!ticket) return;

    if (!isStaff(interaction.member) && ticket.userId !== interaction.user.id) {
      return interaction.reply({ content: 'Tu ne peux pas fermer ce ticket.', ephemeral: true });
    }
    await closeTicket(interaction.channel, interaction.user, false);
    await interaction.reply({ content: 'Ticket en cours de fermeture...', ephemeral: true });
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.channel.isDMBased()) {
    const existing = Object.values(tickets).find(t => t.userId === message.author.id && !t.closed);
    if (existing) {
      const channel = client.channels.cache.get(existing.channelId);
      if (channel) {
        const embed = new EmbedBuilder()
          .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
          .setDescription(message.content || '[Fichier ou embed]')
          .setColor(0x57F287)
          .setTimestamp();

        await channel.send({ embeds: [embed] });

        const alerts = alertUsers.get(existing.channelId);
        if (alerts && alerts.size > 0) {
          const pings = [...alerts].map(id => `<@${id}>`).join(' ');
          await channel.send(`${pings} - Le joueur a repondu.`);
        }
      }
      return message.react('✅').catch(() => {});
    }

    await createTicket(message, message.author);
    return;
  }

  if (!message.content.startsWith('!')) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift()?.toLowerCase();

  if (command === 'ticket' || command === 'new') {
    return createTicket(message, message.author);
  }

  if (command === 'setup' && message.member.permissions.has(PermissionFlagsBits.Administrator)) {
    const embed = new EmbedBuilder()
      .setTitle('Support')
      .setDescription('Clique sur le bouton pour ouvrir un ticket.\nTu peux aussi m\'envoyer un message prive.')
      .setColor(0x5865F2);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('open_ticket')
        .setLabel('Ouvrir un ticket')
        .setStyle(ButtonStyle.Primary)
    );

    await message.channel.send({ embeds: [embed], components: [row] });
    return message.delete().catch(() => {});
  }

  const ticket = tickets[message.channel.id];
  if (!ticket) return;

  if (command === 'r') {
    if (!isStaff(message.member)) return;
    const content = args.join(' ');
    if (!content) return message.reply('Utilisation : !r [message]');

    const embed = new EmbedBuilder()
      .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
      .setDescription(content)
      .setColor(0x5865F2)
      .setTimestamp();

    await message.channel.send({ embeds: [embed] });
    await message.delete().catch(() => {});
    return;
  }

  if (command === 'ar') {
    if (!isStaff(message.member)) return;
    const content = args.join(' ');
    if (!content) return message.reply('Utilisation : !ar [message]');

    const embed = new EmbedBuilder()
      .setAuthor({ name: 'Support', iconURL: client.user.displayAvatarURL() })
      .setDescription(content)
      .setColor(0x5865F2)
      .setTimestamp();

    await message.channel.send({ embeds: [embed] });
    await message.delete().catch(() => {});
    return;
  }

  if (command === 'close') {
    if (!isStaff(message.member) && ticket.userId !== message.author.id) {
      return message.reply('Tu ne peux pas fermer ce ticket.');
    }

    if (args[0]?.toLowerCase() === 'cancel') {
      const timer = closeTimers.get(message.channel.id);
      if (timer) {
        clearTimeout(timer);
        closeTimers.delete(message.channel.id);
        return message.reply('Fermeture programmee annulee.');
      }
      return message.reply('Aucune fermeture programmee.');
    }

    const silent = args.includes('-s');
    const timeArg = args.find(a => a !== '-s');

    if (timeArg) {
      const time = ms(timeArg);
      if (!time) return message.reply('Temps invalide. Exemple : !close 15m');

      await message.reply(`Le ticket sera ferme dans ${timeArg}.`);
      const timer = setTimeout(() => closeTicket(message.channel, message.author, silent), time);
      closeTimers.set(message.channel.id, timer);
      return;
    }

    await closeTicket(message.channel, message.author, silent);
    return;
  }

  if (command === 'block') {
    if (!isStaff(message.member)) return;
    const duration = args[0] ? ms(args[0]) : null;

    blocks[ticket.userId] = {
      by: message.author.id,
      at: Date.now(),
      until: duration ? Date.now() + duration : null
    };
    save(blocksFile, blocks);

    const text = duration ? `pendant ${args[0]}` : 'definitivement';
    return message.reply(`Utilisateur bloque ${text}.`);
  }

  if (command === 'unblock') {
    if (!isStaff(message.member)) return;
    delete blocks[ticket.userId];
    save(blocksFile, blocks);
    return message.reply('Utilisateur debloque.');
  }

  if (command === 'logs') {
    if (!isStaff(message.member)) return;
    const userTickets = Object.values(tickets).filter(t => t.userId === ticket.userId);
    if (!userTickets.length) return message.reply('Aucun ticket trouve.');

    const embed = new EmbedBuilder()
      .setTitle('Historique des tickets')
      .setDescription(userTickets.map(t =>
        `<#${t.channelId}> - ${t.closed ? 'Ferme' : 'Ouvert'} - <t:${Math.floor(t.createdAt / 1000)}:R>`
      ).join('\n'))
      .setColor(0x5865F2);
    return message.reply({ embeds: [embed] });
  }

  if (command === 'id') {
    return message.reply(`ID de l'utilisateur : ${ticket.userId}`);
  }

  if (command === 'note') {
    if (!isStaff(message.member)) return;
    const text = args.join(' ');
    if (!text) return message.reply('Utilisation : !note [texte]');

    if (!notes[ticket.userId]) notes[ticket.userId] = [];
    const noteId = Date.now().toString(36);
    notes[ticket.userId].push({
      id: noteId,
      text,
      by: message.author.id,
      at: Date.now()
    });
    save(notesFile, notes);
    return message.reply(`Note ajoutee (ID: ${noteId})`);
  }

  if (command === 'notes') {
    if (!isStaff(message.member)) return;
    const targetId = args[0] || ticket.userId;
    const userNotes = notes[targetId] || [];
    if (!userNotes.length) return message.reply('Aucune note trouvee.');

    const embed = new EmbedBuilder()
      .setTitle(`Notes de ${targetId}`)
      .setDescription(userNotes.map(n =>
        `ID: ${n.id}\n${n.text}\nPar <@${n.by}> - <t:${Math.floor(n.at / 1000)}:R>`
      ).join('\n\n'))
      .setColor(0xFEE75C);
    return message.reply({ embeds: [embed] });
  }

  if (command === 'delete_note') {
    if (!isStaff(message.member)) return;
    const noteId = args[0];
    if (!noteId) return message.reply('Utilisation : !delete_note [note_id]');

    let found = false;
    for (const uid in notes) {
      const idx = notes[uid].findIndex(n => n.id === noteId);
      if (idx !== -1) {
        notes[uid].splice(idx, 1);
        found = true;
        break;
      }
    }
    if (found) {
      save(notesFile, notes);
      return message.reply('Note supprimee.');
    }
    return message.reply('Note introuvable.');
  }

  if (command === 'move') {
    if (!isStaff(message.member)) return;
    const catName = args.join(' ');
    if (!catName) return message.reply('Utilisation : !move [nom_categorie]');

    const category = message.guild.channels.cache.find(c =>
      c.type === ChannelType.GuildCategory && c.name.toLowerCase() === catName.toLowerCase()
    );
    if (!category) return message.reply('Categorie introuvable.');

    await message.channel.setParent(category.id);
    return message.reply(`Ticket deplace dans ${category.name}.`);
  }

  if (command === 'alert') {
    if (!isStaff(message.member)) return;

    if (args[0]?.toLowerCase() === 'cancel') {
      const set = alertUsers.get(message.channel.id);
      if (set) {
        set.delete(message.author.id);
        if (set.size === 0) alertUsers.delete(message.channel.id);
      }
      return message.reply('Alerte annulee.');
    }

    if (!alertUsers.has(message.channel.id)) alertUsers.set(message.channel.id, new Set());
    alertUsers.get(message.channel.id).add(message.author.id);
    return message.reply('Tu seras ping quand le joueur repondra.');
  }
});

client.login(config.token);
