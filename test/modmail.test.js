'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Collection, PermissionsBitField, PermissionFlagsBits: P, ChannelType, Events } = require('discord.js');
const { EventEmitter } = require('node:events');
const { Store, transcript } = require('../lib/store');
const { Modmail } = require('../lib/service');
const { Setup } = require('../lib/setup');
const { createBot } = require('../index');
const { duration, parseCommand, Queue, UserError } = require('../lib/util');
const IDS = { guild: '100000000000000001', category: '100000000000000002', logs: '100000000000000003', role: '100000000000000004', staff: '100000000000000005', user: '100000000000000006', bot: '100000000000000007', other: '100000000000000008' };
const bit = values => new PermissionsBitField(values);
function env(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'modmail-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory);
  store.state.config = { guildId: IDS.guild, categoryId: IDS.category, logChannelId: IDS.logs, staffRoleIds: [IDS.role], replyMode: 'direct' }; store.save();
  const channels = new Collection(), users = new Collection(), members = new Collection(); let next = 100;
  const client = new EventEmitter(); client.user = { id: IDS.bot, tag: 'Bot#0000' }; client.destroy = () => {};
  const guild = { id: IDS.guild, maximumUploadLimit: 8000000, roles: { cache: new Collection([[IDS.role, { id: IDS.role, managed: false, permissions: bit([]) }]]), async fetch() { return this.cache; } }, members: {
    async fetch(arg) { const id = typeof arg === 'string' ? arg : arg.user; if (!members.has(id)) throw Object.assign(new Error('No member'), { code: 10007 }); return members.get(id); }, async fetchMe() { return members.get(IDS.bot); }
  } };
  function makeChannel(id, dm = false) {
    const sent = [], messages = new Collection();
    const c = { id, guild: dm ? null : guild, type: dm ? ChannelType.DM : ChannelType.GuildText, sent, failSend: false, deleted: false,
      permissionOverwrites: { cache: new Collection([[IDS.guild, { id: IDS.guild, type: 0, deny: bit([P.ViewChannel]), allow: bit([]) }], [IDS.role, { id: IDS.role, type: 0, deny: bit([]), allow: bit([P.ViewChannel]) }]]) },
      permissionsFor() { return bit(PermissionsBitField.All); }, isDMBased: () => dm,
      async send(payload) {
        if (c.failSend) throw Object.assign(new Error('Send denied'), { code: 50013 });
        for (const e of payload.embeds || []) e.toJSON();
        for (const component of payload.components || []) component.toJSON();
        const m = { id: String(next++), payload, attachments: new Collection(), url: `https://discord.com/channels/${IDS.guild}/${id}/${next}`,
          async edit(p) { Object.assign(m.payload, p); return m; }, async delete() { messages.delete(m.id); } };
        sent.push(payload); messages.set(m.id, m); return m;
      }, messages: { async fetch(id) { if (!messages.has(id)) throw Object.assign(new Error('Missing message'), { code: 10008 }); return messages.get(id); }, async delete(id) { if (!messages.delete(id)) throw Object.assign(new Error('Missing message'), { code: 10008 }); } },
      async delete() { if (c.failDelete) throw Object.assign(new Error('Cannot delete'), { code: 50013 }); c.deleted = true; channels.delete(id); },
      async setParent(id, options) { c.parentId = id; c.moveOptions = options; return c; }
    }; channels.set(id, c); return c;
  }
  guild.channels = { cache: channels, async fetch(id) { if (!id) return channels; return channels.get(id) || null; }, async create(options) {
    const c = makeChannel(String(next++)); c.createdOptions = options;
    c.permissionOverwrites.cache = new Collection(options.permissionOverwrites.map(o => [o.id, { ...o, type: o.id === IDS.role || o.id === IDS.guild ? 0 : 1, allow: bit(o.allow || []), deny: bit(o.deny || []) }]));
    return c;
  } };
  client.guilds = { async fetch() { return guild; } }; client.channels = { async fetch(id) { return channels.get(id) || null; } }; client.users = { async fetch(id) { if (!users.has(id)) throw Object.assign(new Error('Unknown user'), { code: 10013 }); return users.get(id); } };
  function makeUser(id, username) {
    const dm = makeChannel('dm-' + id, true); const user = { id, username, tag: username, bot: false, async createDM() { return dm; }, send: p => dm.send(p) }; users.set(id, user); return user;
  }
  const user = makeUser(IDS.user, 'Joueur'), staffUser = makeUser(IDS.staff, 'Agent'), other = makeUser(IDS.other, 'Visiteur');
  const staff = { id: IDS.staff, user: staffUser, displayName: 'Agent Alpha', permissions: bit([]), roles: { cache: new Collection([[IDS.role, {}]]) } };
  const outsider = { id: IDS.other, user: other, displayName: 'Visiteur', permissions: bit([]), roles: { cache: new Collection() } };
  const admin = { ...staff, permissions: bit([P.Administrator]) };
  members.set(IDS.staff, staff); members.set(IDS.other, outsider); members.set(IDS.bot, { id: IDS.bot });
  const cat = makeChannel(IDS.category); cat.type = ChannelType.GuildCategory; cat.name = 'Tickets';
  const logs = makeChannel(IDS.logs); const team = makeChannel('team');
  const service = new Modmail(client, store);
  function msg(text, channel, actor = staffUser, member = staff) { return { id: String(next++), content: text, author: actor, member, guildId: channel.guild?.id, guild: channel.guild, channelId: channel.id, channel,
    attachments: new Collection(), stickers: new Collection(), react: async () => {}, reply: p => channel.send(p) }; }
  const dm = channels.get('dm-' + IDS.user);
  return { store, directory, service, client, guild, channels, members, logs, team, user, staff, staffUser, outsider, other, admin, dm, msg,
    incoming: text => service.incoming(msg(text, dm, user, null)),
    command: (text, channel = team, actor = staffUser, member = staff) => service.command(msg(text, channel, actor, member), parseCommand(text)), makeChannel };
}

test('first DM creates one private ticket and relays the initial text', async t => {
  const e = env(t); await e.incoming('Bonjour, je souhaite de l’aide.');
  const ticket = e.store.ticketForUser(IDS.user); assert.ok(ticket);
  assert.equal(ticket.events.find(v => v.type === 'entrant').text, 'Bonjour, je souhaite de l’aide.');
  assert.equal(ticket.events.find(v => v.type === 'entrant').status, 'reçu');
  const ch = e.channels.get(ticket.channelId);
  assert.ok(ch.createdOptions.permissionOverwrites.find(o => o.id === IDS.guild).deny.includes(P.ViewChannel));
  assert.ok(ch.createdOptions.permissionOverwrites.find(o => o.id === IDS.user).deny.includes(P.ViewChannel));
  assert.equal(e.dm.sent.length, 1);
});

test('simultaneous DMs do not create duplicate conversations', async t => {
  const e = env(t); await Promise.all([e.incoming('Premier'), e.incoming('Deuxième')]);
  assert.equal(Object.keys(e.store.state.tickets).length, 1);
  assert.deepEqual(e.store.ticketForUser(IDS.user).events.filter(v => v.type === 'entrant').map(v => v.text), ['Premier', 'Deuxième']);
});

test('staff without Administrator can reply, anonymously reply, edit and delete', async t => {
  const e = env(t); await e.incoming('Bonjour');
  const ticket = e.store.ticketForUser(IDS.user), ch = e.channels.get(ticket.channelId);
  await e.command('!r Bonjour à toi', ch); await e.command('!ar Réponse confidentielle', ch);
  const replies = ticket.events.filter(v => v.type === 'sortant');
  assert.equal(replies.length, 2); assert.equal(e.dm.sent.at(-1).embeds[0].toJSON().author.name, 'Équipe support');
  assert.equal(e.dm.sent.at(-2).embeds[0].toJSON().author.name, 'Agent Alpha');
  await e.command(`!edit ${replies[1].number} Texte corrigé`, ch);
  const dmMessage = await e.dm.messages.fetch(replies[1].dmMessageId);
  assert.equal(dmMessage.payload.embeds[0].toJSON().description, 'Texte corrigé');
  await e.command(`!delete ${replies[1].number}`, ch); assert.equal(replies[1].deleted, true);
  await assert.rejects(e.dm.messages.fetch(replies[1].dmMessageId));
});

test('outsider and public channel cannot execute staff commands', async t => {
  const e = env(t); await e.incoming('Bonjour');
  await assert.rejects(e.command(`!r ${IDS.user} Intrusion`, e.team, e.other, e.outsider), /réservée/);
  e.team.permissionOverwrites.cache.clear();
  await assert.rejects(e.command(`!notes ${IDS.user}`), /privé/);
});

test('internal notes never reach the customer, including in the staff transcript', async t => {
  const e = env(t); await e.incoming('Bonjour');
  const ticket = e.store.ticketForUser(IDS.user), ch = e.channels.get(ticket.channelId); const count = e.dm.sent.length;
  await e.command('!note Réservé équipe', ch); await e.command('!notes', ch);
  assert.equal(e.dm.sent.length, count);
  await e.command('!close', ch);
  assert.equal(e.dm.sent.length, count + 1);
  assert.ok(!e.dm.sent.at(-1).files);
  const archive = e.logs.sent[0].files[0].attachment.toString(); assert.match(archive, /Réservé équipe/);
  assert.ok(!Object.keys(e.store.state.tickets).length); assert.ok(ch.deleted);
});

test('failed transcript upload preserves the ticket channel and retries safely', async t => {
  const e = env(t); await e.incoming('Bonjour'); const ticket = e.store.ticketForUser(IDS.user), ch = e.channels.get(ticket.channelId);
  e.logs.failSend = true; await assert.rejects(e.command('!close', ch));
  assert.equal(ch.deleted, false); assert.equal(ticket.status, 'closing');
  assert.ok(fs.existsSync(path.join(e.directory, 'archives', `conversation-${ticket.number}.txt`)));
  e.logs.failSend = false; await e.service.tick(); assert.equal(ch.deleted, true); assert.equal(e.logs.sent.length, 1);
});

test('failed channel deletion resumes without duplicate transcript upload', async t => {
  const e = env(t); await e.incoming('Bonjour'); const ticket = e.store.ticketForUser(IDS.user), ch = e.channels.get(ticket.channelId);
  ch.failDelete = true; await assert.rejects(e.command('!close -s', ch)); assert.equal(e.logs.sent.length, 1);
  ch.failDelete = false; await e.service.tick(); assert.equal(e.logs.sent.length, 1); assert.ok(ch.deleted);
});

test('scheduled closure survives restart, including silent flag', async t => {
  const e = env(t); await e.incoming('Bonjour'); const ticket = e.store.ticketForUser(IDS.user), ch = e.channels.get(ticket.channelId);
  await e.command('!close 30d -s', ch); assert.ok(ticket.closeAt > Date.now() + 25 * 86400000);
  ticket.closeAt = Date.now() - 100; e.store.save(); const count = e.dm.sent.length;
  const reloaded = new Store(e.directory); const resumed = new Modmail(e.client, reloaded); await resumed.tick();
  assert.equal(e.dm.sent.length, count); assert.ok(ch.deleted); assert.equal(reloaded.state.history.length, 1);
});

test('customer reply cancels scheduled closure; cancel command works', async t => {
  const e = env(t); await e.incoming('Bonjour'); const ticket = e.store.ticketForUser(IDS.user), ch = e.channels.get(ticket.channelId);
  await e.command('!close 15m', ch); await e.incoming('Encore une question'); assert.equal(ticket.closeAt, null);
  await e.command('!close 15m', ch); await e.command('!close cancel', ch); assert.equal(ticket.closeAt, null);
});

test('block prevents replies and new tickets; invalid duration does not block', async t => {
  const e = env(t); await assert.rejects(e.command(`!block ${IDS.user} nope`)); assert.equal(e.store.blocked(IDS.user), false);
  await e.command(`!block ${IDS.user} 7d`); await e.incoming('Bloqué'); assert.equal(e.store.ticketForUser(IDS.user), undefined);
  await e.command(`!unblock ${IDS.user}`); await e.incoming('Débloqué'); const ticket = e.store.ticketForUser(IDS.user);
  await e.command('!block', e.channels.get(ticket.channelId)); const count = ticket.events.length; await e.incoming('Toujours bloqué'); assert.equal(ticket.events.length, count);
});

test('expired block is removed after restart', t => {
  const e = env(t); e.store.state.blocks[IDS.user] = { until: Date.now() - 1 }; e.store.save();
  assert.equal(new Store(e.directory).blocked(IDS.user), false);
});

test('direct reply relays text while command mode keeps discussion internal', async t => {
  const e = env(t); await e.incoming('Bonjour'); const ticket = e.store.ticketForUser(IDS.user), ch = e.channels.get(ticket.channelId);
  await e.service.direct(e.msg('Réponse directe', ch)); assert.equal(e.dm.sent.at(-1).embeds[0].toJSON().description, 'Réponse directe');
  const count = e.dm.sent.length; e.store.state.config.replyMode = 'commands';
  await e.service.direct(e.msg('Discussion équipe', ch)); assert.equal(e.dm.sent.length, count);
  assert.match(transcript(ticket), /Discussion équipe/);
});

test('unknown commands do not leak to DM', async t => {
  const e = env(t); await e.incoming('Bonjour'); const ch = e.channels.get(e.store.ticketForUser(IDS.user).channelId), count = e.dm.sent.length;
  await assert.rejects(e.command('!noye secret', ch), /inconnue/); assert.equal(e.dm.sent.length, count);
});

test('open by ID, canned responses, notes, deletion, logs and id', async t => {
  const e = env(t); await e.command(`!open ${IDS.user}`); const ticket = e.store.ticketForUser(IDS.user);
  await e.command(`!!wipe ${IDS.user}`); assert.match(e.dm.sent.at(-1).embeds[0].toJSON().description, /wipe/);
  await e.command(`!!mortrp ${IDS.user}`); assert.match(e.dm.sent.at(-1).embeds[0].toJSON().description, /mort RP/);
  await e.command(`!note ${IDS.user} Note durable`); const note = e.store.state.notes[IDS.user][0];
  await e.command(`!delete_note ${note.id}`); assert.equal(e.store.state.notes[IDS.user].length, 0);
  await e.command(`!id ${IDS.user}`); assert.match(e.team.sent.at(-1).content, new RegExp(IDS.user));
  await e.command(`!close ${IDS.user} -s`); await e.command(`!logs ${IDS.user}`); assert.match(e.team.sent.at(-1).content, /https:\/\/discord.com/);
  assert.equal(ticket.status, 'closed');
});

test('alerts are persisted and can be cancelled; moved tickets keep overwrites', async t => {
  const e = env(t); await e.incoming('Bonjour'); const ticket = e.store.ticketForUser(IDS.user), ch = e.channels.get(ticket.channelId);
  await e.command('!alert', ch); assert.deepEqual(new Store(e.directory).ticketForUser(IDS.user).alerts, [IDS.staff]);
  await e.incoming('Réponse'); assert.ok(ch.sent.some(p => p.allowedMentions?.users?.includes(IDS.staff)));
  await e.command('!alert cancel', ch); assert.deepEqual(ticket.alerts, []);
  await e.command('!move Tickets', ch); assert.equal(ch.moveOptions.lockPermissions, false);
});

test('more than 100 exchanges are preserved in transcript', async t => {
  const e = env(t); const ticket = await e.service.create(e.user);
  for (let i = 0; i < 145; i++) e.store.addEvent(ticket, 'entrant', { text: `texte-${i}`, number: i + 1 });
  await e.service.close(ticket, e.staffUser, true);
  const text = e.logs.sent[0].files[0].attachment.toString(); assert.match(text, /texte-0\n/); assert.match(text, /texte-144\n/);
});

test('failed DM reports failure without marking as sent', async t => {
  const e = env(t); await e.incoming('Bonjour'); const ticket = e.store.ticketForUser(IDS.user), ch = e.channels.get(ticket.channelId);
  e.dm.failSend = true; await assert.rejects(e.command('!r Bonjour', ch));
  const event = ticket.events.find(v => v.type === 'sortant'); assert.equal(event.status, 'échec_envoi'); assert.equal(event.dmMessageId, undefined);
});

test('failed staff mirror retries without resending the DM', async t => {
  const e = env(t); await e.incoming('Bonjour'); const ticket = e.store.ticketForUser(IDS.user), ch = e.channels.get(ticket.channelId);
  ch.failSend = true; const count = e.dm.sent.length; await e.service.send(ticket, e.staff, 'Message unique'); assert.equal(e.dm.sent.length, count + 1);
  ch.failSend = false; await e.service.tick(); assert.equal(e.dm.sent.length, count + 1);
  assert.ok(ticket.events.find(v => v.type === 'sortant').staffMessageId);
});

test('setup components serialize and reject public transcript destination', async t => {
  const e = env(t); const setup = new Setup(e.client, e.store);
  const screen = setup.screen({ id: 'abc', config: e.store.state.config }); assert.equal(screen.components.length, 5);
  screen.components.forEach(c => c.toJSON()); await setup.validate(e.guild, e.store.state.config);
  e.logs.permissionOverwrites.cache.clear(); await assert.rejects(setup.validate(e.guild, e.store.state.config), /transcriptions/);
});

test('setup is restricted to administrators and session owner', async t => {
  const e = env(t); const setup = new Setup(e.client, e.store);
  await assert.rejects(setup.start(e.msg('!setup', e.team)), /administrateurs/);
  const message = e.msg('!setup', e.team, e.staffUser, e.admin); await setup.start(message);
  e.members.set(IDS.staff, e.admin);
  const i = { deferReply: async () => {}, customId: 'setup:start:' + IDS.other, guildId: IDS.guild, guild: e.guild, user: e.staffUser };
  await assert.rejects(setup.handle(i), /propre commande/);
});

test('attachments are relayed and oversized files use links', async t => {
  const e = env(t); const ticket = await e.service.create(e.user);
  const event = await e.service.send(ticket, e.staff, 'Pièces', [{ name: 'photo.png', size: 20, url: 'https://cdn.discordapp.com/attachments/test.png' }, { name: 'large.zip', size: 100000000, url: 'https://cdn.discordapp.com/attachments/large.zip' }]);
  const payload = e.dm.sent.at(-1); assert.equal(payload.files.length, 1); assert.match(payload.embeds[0].toJSON().fields[0].value, /large.zip/); assert.equal(event.status, 'envoyé');
});

test('corrupt state fails closed without overwriting data', t => {
  const e = env(t); fs.writeFileSync(e.store.file, '{bad'); assert.throws(() => new Store(e.directory)); assert.equal(fs.readFileSync(e.store.file, 'utf8'), '{bad');
});

test('parsing durations and command text preserves multiline replies', () => {
  assert.equal(duration('30d'), 2592000000); assert.equal(duration('1j'), 86400000);
  for (const v of ['-1m', '0m', 'bad', '9999d']) assert.throws(() => duration(v));
  assert.deepEqual(parseCommand('!r Bonjour\nDeuxième ligne'), { name: 'r', rest: 'Bonjour\nDeuxième ligne' });
  assert.equal(parseCommand('!!wipe').name, '!wipe');
});

test('setup saves all choices through interactive session and survives restart', async t => {
  const e = env(t); const setup = new Setup(e.client, e.store); e.members.set(IDS.staff, e.admin);
  const config = structuredClone(e.store.state.config); e.store.state.config = null;
  const i = { customId: 'setup:start:' + IDS.staff, guildId: IDS.guild, guild: e.guild, user: e.staffUser,
    deferReply: async () => {}, deferUpdate: async () => {}, editReply: async payload => {
      for (const row of payload.components || []) row.toJSON();
    } };
  await setup.handle(i); const id = [...setup.sessions.keys()][0];
  for (const [action, values] of [['category', [config.categoryId]], ['logs', [config.logChannelId]], ['roles', config.staffRoleIds], ['mode', ['commands']]]) {
    i.customId = `setup:${action}:${id}`; i.values = values; await setup.handle(i);
  }
  i.customId = `setup:save:${id}`; await setup.handle(i);
  const persisted = new Store(e.directory).state.config; assert.equal(persisted.replyMode, 'commands'); assert.deepEqual(persisted.staffRoleIds, [IDS.role]);
});

test('template changes need administrator and are used in canned DM', async t => {
  const e = env(t); await assert.rejects(e.command('!template wipe Nouveau'), /administrateurs/);
  await e.command('!template wipe Nouveau formulaire', e.team, e.staffUser, e.admin);
  await e.command(`!open ${IDS.user}`); await e.command(`!!wipe ${IDS.user}`);
  assert.equal(e.dm.sent.at(-1).embeds[0].toJSON().description, 'Nouveau formulaire');
});

test('a conversation made public stops inbound relay until permissions restored', async t => {
  const e = env(t); await e.incoming('Bonjour'); const ticket = e.store.ticketForUser(IDS.user), ch = e.channels.get(ticket.channelId);
  const old = ch.permissionOverwrites.cache; ch.permissionOverwrites.cache = new Collection(); const count = ch.sent.length;
  await assert.rejects(e.incoming('Ne pas divulguer')); assert.equal(ch.sent.length, count);
  ch.permissionOverwrites.cache = old; await e.service.tick(); assert.ok(ch.sent.some(p => p.embeds?.[0]?.toJSON().description === 'Ne pas divulguer'));
});

test('large incoming message is retained in full and attached as text', async t => {
  const e = env(t); const text = 'a'.repeat(4100); await e.incoming(text);
  const ticket = e.store.ticketForUser(IDS.user), ch = e.channels.get(ticket.channelId);
  assert.equal(ticket.events.find(v => v.type === 'entrant').text, text);
  assert.equal(ch.sent.at(-1).files[0].attachment.toString(), text);
});

test('entrypoint routes non-admin staff messages using fresh guild member', async t => {
  const e = env(t); const bot = createBot({ client: e.client, store: e.store });
  await e.incoming('Bonjour'); const ch = e.channels.get(e.store.ticketForUser(IDS.user).channelId);
  const handler = e.client.listeners(Events.MessageCreate)[0];
  await handler(e.msg('!r Test routage', ch));
  assert.equal(e.dm.sent.at(-1).embeds[0].toJSON().description, 'Test routage');
  bot.stop();
});
