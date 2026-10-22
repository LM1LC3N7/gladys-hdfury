# Boîtiers HDFury pour Gladys

Suivez vos boîtiers HDMI **HDFury** (VRRoom, Vertex2, Diva, Arcana…) depuis
Gladys, en local, sans aucun cloud : signaux d'entrée et de sortie
(résolution, HDR, couleur), formats audio, écrans et barre de son branchés,
mode de fonctionnement et entrée de chaque sortie, hotplug et redémarrage.

> **Important.** Cette intégration n'a jamais été testée avec un vrai
> boîtier : elle a été écrite d'après la bibliothèque `hdfury` (celle de Home
> Assistant) et testée avec un faux boîtier seulement. Vos retours sont les
> bienvenus. Intégration non officielle, sans lien avec HDFury.

## Installation

1. Branchez le boîtier sur votre réseau (prise LAN) et donnez-lui une
   **adresse IP fixe** dans votre box (bail DHCP réservé).
2. Vérifiez que sa page web s'ouvre dans un navigateur à cette adresse
   (`http://192.168.1.60` par exemple) : l'intégration lit la même interface.
3. Dans Gladys, installez l'intégration **HDFury**, ouvrez sa configuration et
   saisissez les adresses IP, séparées par des virgules (port 80 par défaut,
   un autre sous la forme `192.168.1.60:8080`).
4. Les boîtiers apparaissent dans l'onglet **Découverte** : créez-les.

Chaque boîtier est identifié par son **numéro de série** (lu sur sa page
`brdinfo`, comme Home Assistant) : son adresse peut changer, saisissez alors
la nouvelle. Un boîtier dont le numéro de série est illisible n'est pas
ajouté (le statut de l'intégration le dit, nouvel essai au plus chaque
minute). Le nom de l'appareil reprend le nom d'hôte du boîtier
(`HDFury VRROOM-02`).

## Ce que vous obtenez

| Fonction                           | Type Gladys                  | Remarque                                                          |
| ---------------------------------- | ---------------------------- | ----------------------------------------------------------------- |
| En ligne                           | état binaire (lecture seule) | 1 quand le boîtier a répondu à la dernière lecture                |
| Mode de fonctionnement             | liste                        | Mode 0 à 5 (splitter, matrice…), VRRoom                           |
| Entrée de TX0, entrée de TX1       | liste                        | Input 0 à 3, ou copie de l'autre sortie                           |
| Hotplug                            | bouton                       | relance la négociation HDMI des sources et des écrans             |
| Reboot                             | bouton                       | refusé tant que l'option « Autoriser le redémarrage » est éteinte |
| Signal des entrées RX0, RX1        | texte (lecture seule)        | par exemple `4K59.937 593MHz 422 BT2020 12b 2.2`                  |
| Signal des sorties TX0, TX1        | texte (lecture seule)        | résolution, fréquence, couleur, profondeur, HDR                   |
| Audio TX0, TX1, sortie audio, eARC | texte (lecture seule)        | par exemple `bitstream 48kHz`                                     |
| Écrans TX0, TX1, appareil audio    | texte (lecture seule)        | ce que l'écran ou la barre de son annonce (EDID)                  |
| Formats audio TX0, TX1, sortie     | texte (lecture seule)        | les formats audio annoncés                                        |

Les textes sont ceux du boîtier, en anglais. Un boîtier n'offre que les
fonctions que sa page d'informations contient (un Diva ou un Arcana en a
moins qu'un VRRoom) ; une fonction apparue n'est jamais retirée ensuite.
Aucun **interrupteur** : un « éteins tout » d'un assistant vocal ou d'une
scène ne redémarre jamais un boîtier.

## Commandes

Avant chaque commande, la page `brdinfo` du boîtier est relue : son numéro de
série doit être celui de l'appareil. Un autre boîtier à cette adresse : rien
n'est envoyé, et l'adresse est oubliée. Un numéro de série illisible : rien
n'est envoyé (l'identité n'est pas vérifiée), mais l'adresse est gardée ; à
une lecture de fond, seul « En ligne » est alors publié (les textes lus ne
sont pas attribués au boîtier) et le statut le signale. Le même boîtier
saisi sous deux adresses reste à la première, et le statut le signale.

- **Entrée de TX0 / TX1** : les entrées sont relues juste avant ; le boîtier
  reçoit les deux sorties ensemble (`insel`), l'autre sortie étant renvoyée
  telle quelle (seulement si c'est une valeur connue ; deux sorties qui se
  copient l'une l'autre sont refusées). Déjà sélectionnée : rien n'est envoyé.
- **Mode de fonctionnement** : envoyé après la relecture de l'identité.
- Pour l'entrée et le mode, la page d'informations est **relue dans la même
  commande** (2 secondes après l'envoi si le temps le permet, sinon le plus
  tard possible) : la commande n'est un succès que si la valeur relue est
  celle demandée ; sinon, ou si la relecture n'a pas le temps de se faire,
  elle est signalée « envoyée, sans confirmation ».
- **Hotplug** : envoyé après la relecture de l'identité ; il n'y a rien à
  relire : le succès est l'accusé du boîtier (réponse HTTP 200).
- **Reboot** : **désactivé par défaut**. Il faut cocher « Autoriser le
  redémarrage des boîtiers depuis Gladys » ; l'option est revérifiée juste
  avant l'envoi (la décocher pendant qu'une commande attend l'annule). Au
  plus un redémarrage par boîtier toutes les 2 minutes : l'heure est écrite
  dans le dossier de données avant l'envoi (si l'écriture échoue, rien n'est
  envoyé), et tient après un redémarrage de l'intégration. Le succès est
  l'accusé du boîtier (réponse HTTP 200). Un redémarrage coupe l'image et le
  son un moment.

Chaque commande reçoit une réponse en moins de 4 secondes (Gladys attend 5
secondes). Une commande partie sans réponse du boîtier à temps est signalée
« envoyée, sans confirmation » ; une commande qui n'a pas pu partir est
signalée « rien envoyé ». Le boîtier est encore relu 2,5 secondes après
chaque commande (la bibliothèque de référence attend 2 secondes après une
commande avant de relire), 45 secondes après un redémarrage.

## Bouton de la configuration

- **Vérifier les boîtiers** : donne l'état de chaque boîtier. Un boîtier lu
  depuis moins d'un intervalle n'est pas relu : la réponse donne la dernière
  lecture et son âge.

## Rafraîchissement, statut et limites

- Chaque boîtier est lu toutes les 30 secondes par défaut (15 à 600), en deux
  requêtes (`brdinfo`, puis la page d'informations), jamais plus vite : ni la
  reconnexion à Gladys, ni l'enregistrement d'une configuration inchangée, ni
  le bouton, ni un redémarrage de l'intégration (l'heure de la dernière
  tentative est gardée dans le dossier de données) ne relisent plus tôt.
- Un boîtier qui ne répond pas passe « En ligne » à 0, garde ses derniers
  textes, et est cité dans le statut de l'intégration.
- Une réponse plus grande que 32 Ko, ou qui n'est pas un objet JSON, compte
  comme « ne répond pas ». Les textes sont nettoyés (caractères de contrôle
  retirés, 200 caractères au plus).
- Les états envoyés à Gladys restent sous 240 par minute pour toute
  l'intégration (Gladys en accepte 300) ; ce qui ne tient pas part à la
  lecture suivante.

## Données et confidentialité

L'interface du boîtier n'a pas de mot de passe : l'intégration n'en demande
aucun. Elle garde dans `/data/hdfury.json` les boîtiers connus (numéro de
série, adresse, port, nom d'hôte, modèle, micrologiciel, fonctions
offertes, heure du dernier redémarrage envoyé) et l'heure de la dernière
lecture. Rien ne sort de votre réseau local.

## Limites connues

- Pas encore les réglages de la page de configuration du boîtier (bascule
  automatique des entrées, mode HTPC, CEC, OLED, relais, coupure audio…).
- Le relais du boîtier n'est volontairement pas proposé (il peut commander un
  appareil branché dessus).
- Jamais testé avec un vrai boîtier : les réponses réelles peuvent différer.
