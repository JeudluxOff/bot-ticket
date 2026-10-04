'use strict';
const { EmbedBuilder } = require('discord.js');
function helpEmbeds(config) {
  return [new EmbedBuilder().setColor(0x5865f2).setTitle('Support · commandes')
    .setDescription(`Les utilisateurs écrivent **en MP au bot**. Les salons sont réservés à l’équipe.\nMode actuel : **${config?.replyMode === 'direct' ? 'réponse directe : tout message ordinaire de l’équipe part en MP' : 'réponse par !r ou !ar uniquement'}**.\nLes commandes et notes internes ne sont jamais relayées comme des messages ordinaires.`)
    .addFields(
      { name: 'Répondre et corriger', value: '`!r texte` — réponse avec ton nom\n`!ar texte` — réponse anonyme côté utilisateur\n`!edit numéro nouveau texte` — modifie un MP envoyé\n`!delete numéro` — supprime un MP envoyé\nJoins tes fichiers au message ou à la commande !r / !ar.' },
      { name: 'Fermer', value: '`!close` — archive puis supprime le salon\n`!close 15m` — programme la fermeture\n`!close cancel` — annule la fermeture\n`!close -s` — ferme sans avertissement en MP\n`!close 15m -s` — combine les deux\nUne réponse de l’utilisateur annule une fermeture programmée.' },
      { name: 'Gérer', value: '`!open ID` — ouvre une conversation et avertit en MP\n`!logs` — historique et liens des transcriptions\n`!block [durée]` — bloque les MP entrants (7d, 2h…)\n`!unblock` — débloque\n`!id` — identifiant de l’utilisateur' }
    ), new EmbedBuilder().setColor(0x5865f2).setTitle('Support · outils internes')
    .addFields(
      { name: 'Notes et organisation', value: '`!note texte` — ajoute une note interne\n`!notes [ID]` — affiche les notes\n`!delete_note identifiant` — supprime une note\n`!move nom catégorie` — déplace le salon en gardant ses droits\n`!alert` — te mentionne à chaque réponse de l’utilisateur\n`!alert cancel` — désactive tes alertes' },
      { name: 'Messages automatiques', value: '`!!wipe` — envoie le formulaire de demande de wipe\n`!!mortrp` — envoie le formulaire de mort RP\nCes messages sont envoyés sous le nom Équipe support.' },
      { name: 'Configuration (administrateurs)', value: '`!setup` — configuration guidée\n`!config` — affiche les réglages\n`!template wipe nouveau texte` — change le texte wipe\n`!template mortrp nouveau texte` — change le texte mort RP\n`!template wipe` — consulte le texte enregistré' },
      { name: 'En dehors d’une conversation', value: 'Dans un **salon privé réservé à l’équipe**, ajoute l’ID après la commande :\n`!r ID Bonjour` · `!close ID 15m` · `!logs ID`\n`!block ID 7d` · `!note ID texte` · `!edit ID 3 texte`\n`!!wipe ID` · `!alert ID` · `!move ID catégorie`\n`!delete_note identifiant` fonctionne également.' },
      { name: 'Aide', value: '`!help`, `!aide` ou `!commands`. Les numéros pour !edit et !delete sont affichés sur chaque réponse du bot. Les transcriptions complètes et notes sont réservées à l’équipe.' }
    )];
}
module.exports = { helpEmbeds };
