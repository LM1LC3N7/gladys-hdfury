// -----------------------------------------------------------------------------
// The texts users read in Gladys (configuration button, connection status),
// in English and French.
// -----------------------------------------------------------------------------

const both = (en, fr) => ({ en, fr });
const list = (items) => items.join(', ');

export const T = {
  noBox: both(
    'No HDFury box known yet: type their IP addresses in the configuration (the box must be on and on the network).',
    'Aucun boîtier HDFury connu : saisissez leurs adresses IP dans la configuration (le boîtier doit être allumé et sur le réseau).',
  ),
  check: (lines, interval) => ({
    en: [...lines.map((l) => l.en), `Refresh every ${interval} s`].join(' · '),
    fr: [...lines.map((l) => l.fr), `Rafraîchissement toutes les ${interval} s`].join(' · '),
  }),
  checkLine: (label, outcome) => {
    if (outcome.error === 'unknown_address') {
      return both(
        `${label}: address unknown (another box answers at the old one)`,
        `${label} : adresse inconnue (un autre boîtier répond à l'ancienne)`,
      );
    }
    if (outcome.error) {
      return both(
        `${label}: not reachable (off, unplugged or wrong address)`,
        `${label} : injoignable (éteint, débranché ou mauvaise adresse)`,
      );
    }
    if (outcome.unknown) {
      return both(`${label}: not read yet`, `${label} : pas encore lu`);
    }
    const en = ['answers'];
    const fr = ['répond'];
    if (outcome.tx0) {
      en.push(`TX0 ${outcome.tx0}`);
      fr.push(`TX0 ${outcome.tx0}`);
    }
    if (outcome.ageSeconds !== undefined) {
      en.push(`read ${outcome.ageSeconds} s ago`);
      fr.push(`lu il y a ${outcome.ageSeconds} s`);
    }
    return both(`${label}: ${en.join(', ')}`, `${label} : ${fr.join(', ')}`);
  },
  unreachable: (names) =>
    both(
      `Not reachable (off, unplugged or wrong address), asked again at every refresh: ${list(names)}.`,
      `Injoignables (éteints, débranchés ou mauvaise adresse), redemandés à chaque rafraîchissement : ${list(names)}.`,
    ),
  noAnswerAt: (addresses) =>
    both(
      `No HDFury box answers yet at: ${list(addresses)} (tried again every minute at most).`,
      `Aucun boîtier HDFury ne répond encore à : ${list(addresses)} (nouvel essai au plus chaque minute).`,
    ),
  noSerialAt: (addresses) =>
    both(
      `A box answers at ${list(addresses)} but its serial number is unreadable: it is not added (tried again every minute at most).`,
      `Un boîtier répond à ${list(addresses)} mais son numéro de série est illisible : il n'est pas ajouté (nouvel essai au plus chaque minute).`,
    ),
  addressUnknown: (names) =>
    both(
      `Address unknown (another box answers at the old one): ${list(names)}. Type the new address in the configuration.`,
      `Adresse inconnue (un autre boîtier répond à l'ancienne) : ${list(names)}. Saisissez la nouvelle adresse dans la configuration.`,
    ),
  sameBox: (pairs) =>
    both(
      `The same box answers at two typed addresses, the first one is kept: ${list(pairs)}. Remove one of them from the configuration.`,
      `Le même boîtier répond à deux adresses saisies, la première est gardée : ${list(pairs)}. Retirez-en une de la configuration.`,
    ),
  identityUnconfirmed: (names) =>
    both(
      `Serial number unreadable at the last read (identity not confirmed: only "Online" is published, commands refused): ${list(names)}.`,
      `Numéro de série illisible à la dernière lecture (identité non confirmée : seul « En ligne » est publié, commandes refusées) : ${list(names)}.`,
    ),
  invalidEntries: (entries) =>
    both(
      `Ignored in the configuration (invalid): ${list(entries)}.`,
      `Ignorés dans la configuration (invalides) : ${list(entries)}.`,
    ),
  dataReset: both(
    'The saved box list was unreadable and was reset; the boxes are found again from their addresses.',
    'La liste enregistrée des boîtiers était illisible et a été réinitialisée ; les boîtiers sont retrouvés par leurs adresses.',
  ),
};
