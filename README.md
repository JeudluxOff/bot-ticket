# Modmail Préfecture — version 2.1 — plusieurs services

Un bot de support **par messages privés**, en français, pour un seul serveur Discord.
Un utilisateur écrit au bot → il choisit un service dans un menu → un salon privé est créé dans la catégorie de ce service → les réponses de l’équipe repartent en MP. Son premier message est conservé. Après fermeture, il peut choisir à nouveau.
L’utilisateur peut être un membre ordinaire, un membre du support ou un administrateur. Le bot n’exige pas qu’il ait un rôle particulier.

## Installation sur ton hébergement FadeHost

### 1. Remplacer le code dans GitHub

1. Si tu utilises déjà notre V2 avec `state-v2.json`, conserve le même `DATA_DIR` : la configuration et les conversations sont migrées automatiquement. Si tu utilises un autre ancien script, ferme et conserve ses tickets utiles avant le remplacement.
2. Décompresse le ZIP sur ton ordinateur.
3. Ouvre le dépôt `JeudluxOff/bot-ticket` sur GitHub.
4. **Add file → Upload files** : dépose le contenu de l’archive à la racine du dépôt.
5. Remplace bien `index.js` et `package.json`, ajoute `package-lock.json`, le dossier `lib`, ce guide et le dossier `test`. Ne dépose pas seulement le ZIP et ne mets pas le projet dans un sous-dossier supplémentaire.
6. Valide avec **Commit changes**.

Le dossier `lib` est indispensable : il contient le relais des messages, le setup et les sauvegardes.
Ne téléverse ni `node_modules`, ni le dossier des données, ni un fichier contenant ton token.

### 2. Variables FadeHost

Ouvre le bot → **Environment**. Conserve ton vrai token existant et configure :

```text
DISCORD_TOKEN=TON_TOKEN_EXISTANT
DATA_DIR=/data/storage/modmail
```

`TON_TOKEN_EXISTANT` est une indication : ne remplace pas ton vrai token par ce texte.
Aucun identifiant de salon, catégorie ou rôle n’est nécessaire dans FadeHost : ils se choisissent avec `!setup`.
Les anciennes variables `TICKET_CATEGORY_ID`, `LOG_CHANNEL_ID`, `STAFF_ROLE_ID` et `SUPPORT_ROLE_ID` sont ignorées par cette version et peuvent être retirées.
`GUILD_ID` est facultatif : s’il reste renseigné, il doit correspondre au bon serveur, car il limite le premier setup et les commandes à ce serveur.

Clique sur **Save & redeploy**, ou utilise **Redeploy** pour récupérer le nouveau code. Un simple Restart peut relancer l’ancien code sans récupérer la dernière version GitHub.
Commande de démarrage : `npm start`. Runtime : **Node.js 22.12 ou ultérieur** (ta version Node 22.23.3 convient).

La console doit afficher :

```text
✅ Connecté en tant que ... — Modmail v2.1
Configuration requise : lance !setup sur ton serveur.
```

### 3. Discord Developer Portal

Dans l’application du bot → **Bot** → **Privileged Gateway Intents**, active **Message Content Intent**.
Cette nouvelle version ne demande pas Server Members Intent ; il peut rester activé, mais il n’est plus requis par le code.
Le bot doit être installé sur le serveur (Guild Install), pas uniquement sur un compte utilisateur.

Permissions du bot :

- Voir les salons
- Envoyer des messages
- Lire l’historique des messages
- Intégrer des liens
- Joindre des fichiers
- Gérer les salons
- Gérer les messages
- Ajouter des réactions (pour les confirmations ✅ ; leur échec ne bloque pas le relais)

Autorise aussi ces permissions dans la catégorie et les salons utilisés, si leurs permissions locales diffèrent de celles du serveur.

### 4. Préparer les emplacements

Crée ou choisis :

- Les catégories de tes services : **Ticket Support**, **Ticket Modération**, **Ticket Plainte**, **Ticket Remboursement**, **Ticket Développement**, **Ticket Responsable**. Tu peux utiliser tes catégories existantes.
- Un salon textuel privé de transcriptions pour chaque service, ou un salon partagé si les équipes doivent pouvoir lire les archives des services concernés.
- Un ou plusieurs rôles par service (1 à 5), attribués aux personnes autorisées à répondre.
- Facultatif : un salon privé **commandes-support** pour les commandes hors conversation.

Pour `transcriptions` et `commandes-support`, dans **Modifier le salon → Permissions** :

- `@everyone` : refuse **Voir le salon**.
- Les rôles sélectionnés pour les services utilisant ce salon : autorise **Voir le salon**, **Envoyer des messages**, **Lire l’historique**.
- Le rôle du bot : autorise voir, envoyer, lire, intégrer des liens et joindre des fichiers.
- Retire les autorisations de visibilité des autres rôles ou utilisateurs. Les rôles ayant Administrateur restent acceptés.

Un salon « privé » qui autorise explicitement un autre utilisateur ou un rôle non sélectionné sera refusé par le bot. Le diagnostic précise l’ID concerné.
Les administrateurs Discord ont toujours accès aux salons malgré les interdictions ; le bot ne peut pas contourner cette règle Discord.

### 5. Configuration guidée

Avec un compte administrateur, envoie sur ton serveur :

```text
!setup
```

Clique sur **Configurer les services**. Le panneau est visible uniquement par toi. À la première installation, six services sont proposés : Support, Modération, Plainte, Remboursement, Développement et Responsable. Après migration de la V2, ton ancien réglage devient le service Support : utilise **Ajouter les 6 services** pour ajouter les autres sans doublon.

Sélectionne un service dans la liste. Renseigne ses quatre menus :

1. **Catégorie des conversations**.
2. **Salon privé des transcriptions**.
3. **Rôles de l’équipe autorisés à répondre** (1 à 5).
4. **Mode de réponse**.

Modes disponibles :

- **Réponse directe + commandes** : tout message ordinaire envoyé par le staff dans un salon de conversation est envoyé en MP. C’est le mode proposé par défaut. Utilise `!note` pour une note interne.
- **Commandes !r et !ar uniquement** : seuls `!r`, `!ar` et les messages automatiques envoient des MP. Les messages ordinaires restent dans le salon et sont archivés comme discussion interne.

Clique **Retour aux services**, configure le suivant, puis clique **Tout enregistrer**. Tous les services sont validés et enregistrés ensemble : un service incomplet empêche la validation de l’ensemble. Retire les services inutilisés avec **Retirer ce service**. Tu peux ajouter et renommer des services, jusqu’à 25.

Aucun panneau public de création de tickets n’est nécessaire : le menu de choix arrive dans les MP du bot. La session de setup reste valable 60 minutes après ta dernière action.
Un membre support n’a pas besoin d’être administrateur pour répondre. Seuls le setup, l’affichage de configuration et la modification des textes automatiques sont réservés aux administrateurs.

### 6. Test réel après installation

1. Envoie `Bonjour, ceci est un test` en MP au bot.
2. Choisis un service dans le menu reçu en MP. Vérifie que le premier message apparaît dans un salon de la catégorie de ce service.
3. Dans le salon créé, envoie `!r Bonjour, nous avons reçu ta demande`.
4. Vérifie que la réponse arrive dans tes MP.
5. Teste `!ar Test anonyme` : le MP affiche **Équipe support**.
6. Teste une pièce jointe.
7. Ajoute `!note Note interne de test` : elle ne doit pas apparaître en MP.
8. Lance `!close` : le salon disparaît après l’envoi du fichier dans le salon de transcriptions du service.
9. En MP, le menu revient. Choisis un autre service et vérifie que la nouvelle conversation utilise la bonne catégorie et les bons rôles.

Tu peux faire ce test avec ton propre compte administrateur. Pour contrôler les accès, fais aussi un essai avec un membre support sans Administrateur et un membre ordinaire.

## Toutes les commandes

Dans le salon d’une conversation, l’utilisateur concerné est reconnu automatiquement.

| Commande | Résultat |
|---|---|
| `!menu` (en MP uniquement) | Réaffiche les services avant une nouvelle conversation |
| `!help`, `!aide`, `!commands` | Affiche les commandes et le mode de réponse |
| `!r texte` | Réponse avec le nom d’affichage du membre support |
| `!ar texte` | Réponse sous le nom Équipe support |
| `!close` | Archive les échanges, avertit en MP puis supprime le salon |
| `!close 15m` | Programme la fermeture |
| `!close cancel` | Annule la fermeture programmée |
| `!close -s` | Ferme sans notification en MP |
| `!close 15m -s` | Programme une fermeture silencieuse |
| `!block` | Bloque les nouveaux MP sans limite de durée |
| `!block 7d` | Bloque temporairement les MP |
| `!unblock` | Débloque l’utilisateur |
| `!logs` | Historique des conversations et liens des transcriptions |
| `!id` | Identifiant Discord de l’utilisateur |
| `!note texte` | Ajoute une note interne persistante |
| `!notes [ID]` | Affiche les notes de l’utilisateur ou de l’ID indiqué |
| `!delete_note identifiant` | Supprime une note du dossier utilisateur |
| `!move nom catégorie` | Déplace le salon en conservant ses permissions |
| `!alert` | Te mentionne à chaque nouvelle réponse en MP |
| `!alert cancel` | Désactive tes alertes |
| `!edit numéro nouveau texte` | Modifie le texte d’une réponse déjà envoyée en MP |
| `!delete numéro` | Supprime une réponse envoyée en MP |
| `!open ID nom du service` | Ouvre une conversation à l’initiative du staff et avertit l’utilisateur en MP |
| `!!wipe` | Envoie le formulaire de demande de wipe |
| `!!mortrp` | Envoie le formulaire de demande de mort RP |
| `!setup` | Configuration guidée, administrateurs uniquement |
| `!config` | Affiche les réglages, administrateurs uniquement |
| `!template wipe` | Affiche le texte automatique wipe |
| `!template wipe nouveau texte` | Change ce texte, administrateurs uniquement |
| `!template mortrp nouveau texte` | Change le texte mort RP, administrateurs uniquement |

Les deux formulaires sont des propositions génériques en français : adapte-les aux règles de ton serveur avec `!template`.
Les réponses automatiques sont anonymes côté utilisateur. Leur auteur réel figure dans l’archive interne.

### Commandes depuis un autre salon

Dans un **salon privé réservé à l’équipe**, ajoute l’identifiant de l’utilisateur après la commande :

```text
!open 123456789012345678 Support
!r 123456789012345678 Bonjour, comment pouvons-nous t’aider ?
!ar 123456789012345678 Ta demande est en cours d’étude.
!close 123456789012345678 15m
!block 123456789012345678 7d
!unblock 123456789012345678
!note 123456789012345678 Informations internes
!notes 123456789012345678
!logs 123456789012345678
!edit 123456789012345678 3 Nouveau texte
!delete 123456789012345678 3
!move 123456789012345678 Administration
!alert 123456789012345678
!!wipe 123456789012345678
```

Les identifiants ci-dessus sont fictifs. Remplace-les par les vrais ID Discord.
Le numéro d’une réponse est affiché dans le pied du message du bot. `!edit` et `!delete` concernent uniquement les réponses envoyées par le bot, pas les messages originaux du joueur.
`!edit` garde les pièces jointes déjà envoyées ; pour les changer, supprime la réponse puis envoie-en une nouvelle.

## Comportements importants

- Une seule conversation active par utilisateur. Aucun salon n’est créé avant le choix du service. Jusqu’à 20 messages sont conservés en attente, y compris après redémarrage ; au-delà, le bot demande de choisir avant de continuer.
- Après chaque fermeture normale, le menu revient en MP. Après une fermeture silencieuse, il revient au prochain message. `!menu` permet de le réafficher. Les anciens menus ne peuvent pas ouvrir une nouvelle conversation après une clôture.
- Les membres des rôles du service peuvent répondre sans être administrateurs. Les autres équipes ne peuvent pas répondre ni consulter ses notes par commandes.
- Les notes et l’historique consultés dans une conversation sont limités à son service. Les commandes hors conversation doivent être lancées dans un salon privé adapté aux rôles des données demandées. Pour ajouter une note, une conversation doit être ouverte.
- `!open ID nom du service` permet au staff d’ouvrir une conversation ; le nom est facultatif si un seul service lui est accessible.
- `!move` change seulement la catégorie du salon : les rôles, le service et la destination des transcriptions restent les mêmes.
- Les messages simultanés d’un même utilisateur sont traités dans l’ordre.
- Les fichiers ordinaires sont transférés ; les fichiers trop gros ou impossibles à recopier sont fournis par lien. Les stickers sont représentés par leur nom/lien.
- Les modifications ou suppressions faites directement par l’utilisateur dans ses MP ne sont pas synchronisées : la transcription conserve la version reçue. Les modifications via `!edit` sont bien historisées.
- Une réponse entrante annule automatiquement la fermeture programmée.
- Les échéances sont vérifiées toutes les 15 secondes. Elles restent enregistrées après redémarrage ; la fermeture peut donc intervenir jusqu’à environ 15 secondes après l’heure prévue, hors panne Discord.
- `!block` est global à tous les services et bloque les MP entrants, y compris pour une conversation déjà ouverte. Il ne ferme pas automatiquement le salon et n’empêche pas le staff d’envoyer une réponse explicative.
- Les notes et discussions internes ne partent jamais en MP. La transcription complète est envoyée uniquement dans le salon de l’équipe.
- La transcription n’est pas limitée aux 100 derniers messages. Elle inclut les échanges enregistrés, les auteurs, les corrections par commandes et les notes.
- Les anciennes versions/suppressions restent dans l’archive interne pour le suivi. Supprimer une note ne réécrit pas les archives déjà constituées.
- Une copie texte et JSON est aussi conservée dans le dossier `archives` du stockage persistant.
- Les fichiers joints sont référencés par liens dans la transcription. Ce n’est pas une sauvegarde permanente des fichiers binaires : les liens Discord peuvent expirer.
- Si l’envoi de la transcription échoue, la conversation reste en clôture et le salon est conservé. Le bot réessaie toutes les 15 secondes. Le joueur est invité à réessayer après la clôture.
- Si un salon de conversation est supprimé manuellement, le prochain MP peut recréer un salon. L’historique conservé reste dans la transcription.
- Si un salon de conversation devient public, le relais entrant est suspendu jusqu’à correction des permissions.
- Un MP sortant dont la livraison est incertaine après une interruption n’est pas renvoyé automatiquement : la console demande une vérification pour éviter les doublons.
- Limite anti-spam : 8 messages entrants par utilisateur sur 10 secondes. Un message refusé doit être renvoyé par l’utilisateur.
- Le bot traite les MP qu’il reçoit réellement ; il ne peut pas lire les MP envoyés pendant qu’il était hors ligne.

## Stockage et changements de configuration

Le fichier `state-v2.json` est écrit de façon atomique et possède une copie `.bak` de l’état précédent. Une sauvegarde locale n’est pas une sauvegarde externe : conserve régulièrement le dossier `DATA_DIR`.

Sur FadeHost, **ne stocke pas les données à côté du code dans `/data/app`** : ce dossier est remis à l’état du dépôt lors d’un redéploiement. Utilise `DATA_DIR=/data/storage/modmail`.
Lance une seule instance du bot sur ce dossier de données. Cette version vise un serveur de petite ou moyenne taille ; pour un très gros volume, une base de données et une stratégie de rétention seront préférables.

`!setup` peut être utilisé avec des conversations ouvertes. Celles-ci conservent leurs rôles, leur mode de réponse et leur catégorie de restauration ; les nouveaux réglages s’appliquent aux prochaines conversations. La destination des transcriptions suit la configuration actuelle du service, ce qui permet de réparer un salon de transcriptions supprimé. Retirer un service du menu ne supprime pas ses conversations actives.

Si `state-v2.json` est corrompu, le bot s’arrête sans le remplacer par un fichier vide. Arrête le bot, conserve une copie du fichier abîmé, puis restaure une sauvegarde valide.

## Tests inclus

```bash
npm ci
npm test
```

40 tests automatisés couvrent le premier MP, les accès, la configuration interactive, le relais, les fichiers, les notes, les commandes, les transcriptions de plus de 100 messages et les redémarrages.
Ils utilisent de faux objets Discord pour ne pas contacter de vrais utilisateurs. L’intégration avec ton token, ton serveur et les permissions réelles doit être validée avec le test manuel ci-dessus.

## Exécution locale (facultative)

Node.js 22.12 minimum. Le fichier `.env.example` sert de modèle ; l’hébergement lit les variables de son panneau, pas ce fichier.
En local, crée `.env` avec ton token et `DATA_DIR=./data`, puis utilise :

```bash
npm ci
node --env-file=.env index.js
```

## Références techniques

- Discord.js 14.27 : https://discord.js.org/docs/packages/discord.js/14.27.0
- Hébergement FadeHost : https://fadehost.com/docs/discord-bot-hosting/
- Persistance des fichiers FadeHost : https://fadehost.com/docs/app-hosting/#storage-what-survives-a-deploy
