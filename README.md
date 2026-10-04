# Modmail Préfecture — version 2

Un bot de support **par messages privés**, en français, pour un seul serveur Discord.
Un utilisateur écrit au bot → un salon privé est créé pour l’équipe → les réponses de l’équipe repartent en MP.
L’utilisateur peut être un membre ordinaire, un membre du support ou un administrateur. Le bot n’exige pas qu’il ait un rôle particulier.

## Installation sur ton hébergement FadeHost

### 1. Remplacer le code dans GitHub

1. Avant de remplacer l’ancienne version, ferme et conserve les anciens tickets utiles. Cette version repart sur un format de données neuf et ne migre pas les tickets de l’ancien script.
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
✅ Connecté en tant que ... — Modmail v2
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

- Une catégorie **CONVERSATIONS** où seront créés les salons `mp-0001-pseudo`.
- Un salon textuel privé **transcriptions**.
- Un ou plusieurs rôles d’équipe, par exemple **Support** et **Administration**. Attribue-les aux personnes autorisées à répondre.
- Facultatif : un salon privé **commandes-support** pour les commandes hors conversation.

Pour `transcriptions` et `commandes-support`, dans **Modifier le salon → Permissions** :

- `@everyone` : refuse **Voir le salon**.
- Les rôles support sélectionnés : autorise **Voir le salon**, **Envoyer des messages**, **Lire l’historique**.
- Le rôle du bot : autorise voir, envoyer, lire, intégrer des liens et joindre des fichiers.
- Retire les autorisations de visibilité des autres rôles ou utilisateurs. Les rôles ayant Administrateur restent acceptés.

Un salon « privé » qui autorise explicitement un autre utilisateur ou un rôle non sélectionné sera refusé par le bot. Le diagnostic précise l’ID concerné.
Les administrateurs Discord ont toujours accès aux salons malgré les interdictions ; le bot ne peut pas contourner cette règle Discord.

### 5. Configuration guidée

Avec un compte administrateur, envoie sur ton serveur :

```text
!setup
```

Clique sur **Configurer le bot**. Un formulaire visible uniquement par toi apparaît, avec quatre menus :

1. **Catégorie des conversations**.
2. **Salon privé des transcriptions**.
3. **Rôles de l’équipe autorisés à répondre** (1 à 5).
4. **Mode de réponse**.

Modes disponibles :

- **Réponse directe + commandes** : tout message ordinaire envoyé par le staff dans un salon de conversation est envoyé en MP. C’est le mode proposé par défaut. Utilise `!note` pour une note interne.
- **Commandes !r et !ar uniquement** : seuls `!r`, `!ar` et les messages automatiques envoient des MP. Les messages ordinaires restent dans le salon et sont archivés comme discussion interne.

Clique **Enregistrer**. Aucun panneau public de création de tickets n’est nécessaire : ce sont les MP qui ouvrent les conversations.
Un membre support n’a pas besoin d’être administrateur pour répondre. Seuls le setup, l’affichage de configuration et la modification des textes automatiques sont réservés aux administrateurs.

### 6. Test réel après installation

1. Envoie `Bonjour, ceci est un test` en MP au bot.
2. Vérifie qu’il confirme l’ouverture et que le premier message apparaît dans la catégorie choisie.
3. Dans le salon créé, envoie `!r Bonjour, nous avons reçu ta demande`.
4. Vérifie que la réponse arrive dans tes MP.
5. Teste `!ar Test anonyme` : le MP affiche **Équipe support**.
6. Teste une pièce jointe.
7. Ajoute `!note Note interne de test` : elle ne doit pas apparaître en MP.
8. Lance `!close` : le salon disparaît après l’envoi du fichier dans `transcriptions`.

Tu peux faire ce test avec ton propre compte administrateur. Pour contrôler les accès, fais aussi un essai avec un membre support sans Administrateur et un membre ordinaire.

## Toutes les commandes

Dans le salon d’une conversation, l’utilisateur concerné est reconnu automatiquement.

| Commande | Résultat |
|---|---|
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
| `!open ID` | Ouvre une conversation à l’initiative du staff et avertit l’utilisateur en MP |
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
!open 123456789012345678
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

- Une seule conversation active par utilisateur. Le premier MP est bien conservé et relayé.
- Les messages simultanés d’un même utilisateur sont traités dans l’ordre.
- Les fichiers ordinaires sont transférés ; les fichiers trop gros ou impossibles à recopier sont fournis par lien. Les stickers sont représentés par leur nom/lien.
- Les modifications ou suppressions faites directement par l’utilisateur dans ses MP ne sont pas synchronisées : la transcription conserve la version reçue. Les modifications via `!edit` sont bien historisées.
- Une réponse entrante annule automatiquement la fermeture programmée.
- Les échéances sont vérifiées toutes les 15 secondes. Elles restent enregistrées après redémarrage ; la fermeture peut donc intervenir jusqu’à environ 15 secondes après l’heure prévue, hors panne Discord.
- `!block` bloque les MP entrants, y compris pour une conversation déjà ouverte. Il ne ferme pas automatiquement le salon et n’empêche pas le staff d’envoyer une réponse explicative.
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

`!setup` peut réparer la catégorie ou le salon des transcriptions même avec des conversations ouvertes. Un changement des rôles autorisés ou du mode de réponse nécessite de fermer les conversations en cours, pour conserver des accès cohérents.

Si `state-v2.json` est corrompu, le bot s’arrête sans le remplacer par un fichier vide. Arrête le bot, conserve une copie du fichier abîmé, puis restaure une sauvegarde valide.

## Tests inclus

```bash
npm ci
npm test
```

28 tests automatisés couvrent le premier MP, les accès, la configuration interactive, le relais, les fichiers, les notes, les commandes, les transcriptions de plus de 100 messages et les redémarrages.
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
