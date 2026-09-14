/* ==========================================================
   Analyse d'annonce vs marché local
   - Géocodage : api-adresse.data.gouv.fr (Base Adresse Nationale)
   - Ventes comparables : api.cquest.org/dvf (DVF / DGFiP, non garanti)
   ========================================================== */
(function () {
  'use strict';

  const VERSION = 'v4 — 13/09/2026';
  const $ = (id) => document.getElementById(id);
  const HISTORIQUE_KEY = 'analyseAnnonceHistorique';

  /* ---------- Helpers ---------- */

  const eur = (n) => Math.round(n).toLocaleString('fr-FR') + ' €';
  const signedEur = (n) => (n >= 0 ? '+' : '') + eur(n);
  const pct = (n) => (n > 0 ? '+' : '') + n.toFixed(1) + ' %';
  const num = (id) => parseFloat($(id).value) || 0;

  function setStatus(el, message, type, asHtml) {
    el.className = type ? 'status show ' + type : 'status';
    if (asHtml) el.innerHTML = message;
    else el.textContent = message;
  }

  /* ---------- Détection depuis le texte collé ---------- */

  function parseAnnonceTexte(texte) {
    const found = {};

    // Prix : plus grosse somme en € dans une fourchette plausible
    // (évite de confondre avec charges, taxe foncière, honoraires…)
    const prixTrouves = [...texte.matchAll(/(\d[\d\s.,]{2,9})\s*€/g)]
      .map((m) => parseInt(m[1].replace(/[^\d]/g, ''), 10))
      .filter((n) => n >= 10000 && n <= 5000000);
    if (prixTrouves.length) found.prix = Math.max(...prixTrouves);

    // Surface : on privilégie celle qualifiée d'habitable / Carrez.
    // NB : pas de \b après m² — ² n'est pas un caractère de mot, la limite
    // de mot ne se déclenche pas et la détection échouerait.
    const M2 = '(?:m²|m2|㎡)';
    const qualifiee = texte.match(
      new RegExp(
        `(\\d{1,4}(?:[.,]\\d+)?)\\s*${M2}[^.]{0,20}(?:habitable|carrez)` +
        `|(?:habitable|carrez)[^.]{0,20}?(\\d{1,4}(?:[.,]\\d+)?)\\s*${M2}`,
        'i'
      )
    );
    const brute = texte.match(new RegExp(`(\\d{1,4}(?:[.,]\\d+)?)\\s*${M2}`, 'i'));
    const valSurface = qualifiee ? qualifiee[1] || qualifiee[2] : brute && brute[1];
    if (valSurface) found.surface = parseFloat(valSurface.replace(',', '.'));

    // DPE : lettre A-G annoncée comme telle
    const dpe = texte.match(
      /(?:DPE|GES|diagnostic de performance [ée]nerg[ée]tique|classe [ée]nerg[ée]tique)\s*[:\-–]?\s*([A-G])\b/i
    );
    if (dpe) found.dpe = dpe[1].toUpperCase();

    // Type : le premier des deux mots qui apparaît
    const iMaison = texte.search(/maison|pavillon|villa/i);
    const iAppart = texte.search(/appartement|studio|duplex/i);
    if (iMaison !== -1 && (iAppart === -1 || iMaison < iAppart)) found.typeLocal = 'Maison';
    else if (iAppart !== -1) found.typeLocal = 'Appartement';

    return found;
  }

  $('detecter').addEventListener('click', () => {
    const texte = $('annonceTexte').value;
    const statusEl = $('detectStatus');

    if (!texte.trim()) {
      setStatus(statusEl, "Colle d'abord le texte de l'annonce ci-dessus.", 'error');
      return;
    }

    const found = parseAnnonceTexte(texte);
    const trouves = [];

    if (found.prix) {
      $('prix').value = found.prix;
      trouves.push('prix ' + found.prix.toLocaleString('fr-FR') + ' €');
    }
    if (found.surface) {
      $('surface').value = found.surface;
      trouves.push('surface ' + found.surface + ' m²');
    }
    if (found.dpe) {
      $('dpe').value = found.dpe;
      trouves.push('DPE ' + found.dpe);
    }
    if (found.typeLocal) {
      $('typeLocal').value = found.typeLocal;
      trouves.push('type ' + found.typeLocal);
    }

    setStatus(
      statusEl,
      trouves.length
        ? 'Détecté : ' + trouves.join(' · ') + ". Vérifie les champs, et saisis l'adresse à la main."
        : 'Rien détecté avec certitude — renseigne les champs à la main ci-dessous.',
      trouves.length ? 'ok' : 'error'
    );
  });

  /* ---------- Lignes de ventes comparables ---------- */

  function checkAnalyserVisible() {
    const has = $('comps').querySelectorAll('.comp-row').length > 0;
    $('analyser').style.display = has ? 'block' : 'none';
  }

  // Les valeurs sont affectées en propriété (pas via innerHTML) pour qu'une
  // adresse contenant un guillemet ne casse pas le balisage.
  function champ(cls, type, placeholder, valeur, readonly) {
    const input = document.createElement('input');
    input.className = cls;
    input.type = type;
    if (type === 'number') input.inputMode = 'numeric';
    input.placeholder = placeholder;
    input.value = valeur ?? '';
    input.readOnly = !!readonly;
    return input;
  }

  function addCompRow(data, isManual) {
    const row = document.createElement('div');
    row.className = 'comp-row';

    row.append(
      champ('c-label', 'text', 'Adresse / repère', data && data.label, !isManual),
      champ('c-prix', 'number', 'Prix €', data && data.prix, false),
      champ('c-surface', 'number', 'Surface m²', data && data.surface, false),
      champ('c-date', 'text', 'Date', data && data.date, true)
    );

    const suppr = document.createElement('button');
    suppr.type = 'button';
    suppr.className = 'btn-remove';
    suppr.textContent = 'Retirer';
    suppr.addEventListener('click', () => {
      row.remove();
      checkAnalyserVisible();
    });
    row.appendChild(suppr);

    $('comps').appendChild(row);
    checkAnalyserVisible();
  }

  $('addComp').addEventListener('click', () => addCompRow(null, true));

  /* ---------- Champs conditionnels ---------- */

  $('statutFiscal').addEventListener('change', (e) => {
    $('tauxISWrap').style.display = e.target.value === 'marchand' ? 'flex' : 'none';
  });

  $('anneeConstruction').addEventListener('input', (e) => {
    const annee = parseInt(e.target.value, 10);
    $('checkAmiante').style.display = !annee || annee < 1997 ? 'flex' : 'none';
    $('checkPlomb').style.display = !annee || annee < 1949 ? 'flex' : 'none';
  });

  /* ---------- Appels réseau ---------- */

  async function geocodeAdresse(adresse) {
    const url =
      'https://api-adresse.data.gouv.fr/search/?q=' + encodeURIComponent(adresse) + '&limit=1';
    const res = await fetch(url);
    if (!res.ok) throw new Error('géocodage HTTP ' + res.status);
    const data = await res.json();
    if (!data.features || !data.features.length) throw new Error('adresse introuvable');
    const f = data.features[0];
    return {
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
      label: f.properties.label,
      citycode: f.properties.citycode || ''
    };
  }

  // Les ventes sont normalisées vers une forme commune, quelle que soit la
  // source : { date, valeur, surface, type, adresse }.
  // Aucune des deux API n'est garantie disponible, d'où la bascule automatique.

  function bbox(lat, lon, dist) {
    const dLat = dist / 111320;
    const dLon = dist / (111320 * Math.cos((lat * Math.PI) / 180));
    return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
  }

  function typeDepuisLibelle(texte) {
    const t = (texte || '').toUpperCase();
    if (t.includes('MAISON')) return 'Maison';
    if (t.includes('APPARTEMENT')) return 'Appartement';
    return '';
  }

  // Distance entre deux points (formule de haversine), en mètres
  function distanceM(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(lat2 - lat1);
    const dLon = rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // Parseur CSV minimal gérant les champs entre guillemets
  function parseCSV(texte) {
    const lignes = [];
    let champ = '';
    let ligne = [];
    let dansGuillemets = false;

    for (let i = 0; i < texte.length; i++) {
      const ch = texte[i];
      if (dansGuillemets) {
        if (ch === '"') {
          if (texte[i + 1] === '"') { champ += '"'; i++; }
          else dansGuillemets = false;
        } else champ += ch;
      } else if (ch === '"') {
        dansGuillemets = true;
      } else if (ch === ',') {
        ligne.push(champ); champ = '';
      } else if (ch === '\n') {
        ligne.push(champ); lignes.push(ligne); ligne = []; champ = '';
      } else if (ch !== '\r') {
        champ += ch;
      }
    }
    if (champ || ligne.length) { ligne.push(champ); lignes.push(ligne); }

    if (!lignes.length) return [];
    const entetes = lignes[0];
    return lignes.slice(1).filter((l) => l.length === entetes.length).map((l) => {
      const o = {};
      entetes.forEach((h, i) => { o[h] = l[i]; });
      return o;
    });
  }

  // Un fichier DVF contient une ligne par parcelle/lot : une même vente y
  // apparaît plusieurs fois. On regroupe par mutation et on ne garde que les
  // ventes portant sur un seul logement, sinon le prix au m² n'a pas de sens.
  function regrouperMutations(lignes) {
    const parMutation = new Map();
    lignes.forEach((l) => {
      const id = l.id_mutation;
      if (!parMutation.has(id)) parMutation.set(id, []);
      parMutation.get(id).push(l);
    });

    const ventes = [];
    parMutation.forEach((rows) => {
      const logements = rows.filter(
        (r) => r.type_local === 'Maison' || r.type_local === 'Appartement'
      );
      // une seule ligne de logement distincte = vente d'un bien unique
      const uniques = [...new Map(logements.map((r) => [r.id_parcelle + '|' + r.surface_reelle_bati, r])).values()];
      if (uniques.length !== 1) return;

      const r = uniques[0];
      ventes.push({
        date: r.date_mutation,
        valeur: parseFloat(r.valeur_fonciere),
        surface: parseFloat(r.surface_reelle_bati),
        type: r.type_local,
        adresse: [r.adresse_numero, r.adresse_nom_voie].filter(Boolean).join(' '),
        vente: /vente/i.test(r.nature_mutation || ''),
        lat: parseFloat(r.latitude),
        lon: parseFloat(r.longitude)
      });
    });
    return ventes;
  }

  const SOURCES = [
    {
      nom: 'Fichiers DVF Etalab (officiel)',
      // Fichiers statiques par commune et par année : pas de restriction CORS,
      // contrairement aux API, et données tenues à jour par data.gouv.fr.
      async recuperer({ lat, lon, dist, citycode, annees }) {
        if (!citycode) throw new Error('code commune inconnu');
        const dep = citycode.startsWith('97') ? citycode.slice(0, 3) : citycode.slice(0, 2);
        const courante = new Date().getFullYear();

        const tentatives = [];
        for (let a = courante; a > courante - annees - 2 && tentatives.length < annees + 2; a--) {
          tentatives.push(a);
        }

        // On garde le détail par année : un fichier absent (404) et un blocage
        // réseau/CORS ne se corrigent pas de la même façon.
        const journal = [];
        const resultats = await Promise.all(
          tentatives.map(async (annee) => {
            try {
              const res = await fetch(
                `https://files.data.gouv.fr/geo-dvf/latest/csv/${annee}/communes/${dep}/${citycode}.csv`
              );
              if (!res.ok) {
                journal.push(`${annee}: HTTP ${res.status}`);
                return [];
              }
              const ventes = regrouperMutations(parseCSV(await res.text()));
              journal.push(`${annee}: ${ventes.length} ventes`);
              return ventes;
            } catch (e) {
              journal.push(`${annee}: ${e.message}`);
              return [];
            }
          })
        );

        const toutes = resultats.flat();
        if (!toutes.length) throw new Error(journal.join(', '));
        // filtrage par rayon réel autour du point
        return toutes.filter(
          (v) => !isNaN(v.lat) && !isNaN(v.lon) && distanceM(lat, lon, v.lat, v.lon) <= dist
        );
      }
    },
    {
      nom: 'Cerema DVF+ (officiel)',
      url: (lat, lon, dist) =>
        'https://apidf-preprod.cerema.fr/dvf_opendata/geomutations/?in_bbox=' +
        bbox(lat, lon, dist).join(','),
      normalise: (data) =>
        (data.features || data.results || []).map((f) => {
          const p = f.properties || f;
          return {
            date: p.datemut,
            valeur: parseFloat(p.valeurfonc),
            surface: parseFloat(p.sbati),
            type: typeDepuisLibelle(p.libtypbien),
            adresse: p.l_adresse ? [].concat(p.l_adresse)[0] : '',
            vente: !p.libnatmut || /vente/i.test(p.libnatmut)
          };
        })
    },
    {
      nom: 'api.cquest.org (communautaire)',
      url: (lat, lon, dist) => `https://api.cquest.org/dvf?lat=${lat}&lon=${lon}&dist=${dist}`,
      normalise: (data) =>
        (data.features || data.resultats || []).map((f) => {
          const p = f.properties || f;
          return {
            date: p.date_mutation,
            valeur: parseFloat(p.valeur_fonciere),
            surface: parseFloat(p.surface_reelle_bati),
            type: p.type_local || '',
            adresse: [p.adresse_numero, p.adresse_nom_voie].filter(Boolean).join(' '),
            vente: /vente/i.test(p.nature_mutation || '')
          };
        })
    }
  ];

  // Une vente n'est exploitable que si prix, surface et date sont lisibles.
  // Ce filtre garantit aussi qu'une réponse au format inattendu est traitée
  // comme « pas de donnée », et déclenche la bascule vers la source suivante.
  function estExploitable(v) {
    return v && v.valeur > 0 && v.surface > 0 && !!v.date && !isNaN(new Date(v.date));
  }

  // Deux familles de sources : fichiers statiques (recuperer) et API (url + normalise).
  async function interroger(source, ctx) {
    let ventes;
    if (source.recuperer) {
      ventes = await source.recuperer(ctx);
    } else {
      const res = await fetch(source.url(ctx.lat, ctx.lon, ctx.dist));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      ventes = source.normalise(await res.json());
    }
    return ventes.filter(estExploitable);
  }

  // Essaie chaque source dans l'ordre, renvoie la première qui répond avec des données
  async function fetchDVF(ctx) {
    const echecs = [];
    for (const source of SOURCES) {
      try {
        const ventes = await interroger(source, ctx);
        if (ventes.length) return { ventes, source: source.nom };
        echecs.push(`${source.nom} : aucune donnée`);
      } catch (e) {
        echecs.push(`${source.nom} : ${e.message}`);
      }
    }
    throw new Error(echecs.join(' · '));
  }

  /* ---------- Diagnostic des sources ---------- */

  document.getElementById('testerSources').addEventListener('click', async () => {
    const el = $('sourcesStatus');
    setStatus(el, '<span class="spinner"></span>Test des sources en cours…', 'info', true);

    // Point de test : Denain, commune de taille modeste (fichier léger)
    const lignes = ['Version du code : ' + VERSION, ''];
    for (const source of SOURCES) {
      const t0 = Date.now();
      try {
        const ventes = await interroger(source, {
          lat: 50.3289, lon: 3.3947, dist: 2000, citycode: '59172', annees: 3
        });
        lignes.push(`✔ ${source.nom} — ${ventes.length} ventes en ${Date.now() - t0} ms`);
        const datees = ventes.map((v) => v.date).filter(Boolean).sort();
        if (datees.length) {
          lignes.push(`   données de ${datees[0].slice(0, 7)} à ${datees[datees.length - 1].slice(0, 7)}`);
        }
      } catch (e) {
        lignes.push(`✗ ${source.nom} — ${e.message}`);
      }
    }
    const ok = lignes.some((l) => l.startsWith('✔'));
    setStatus(el, lignes.join('\n'), ok ? 'ok' : 'error');
  });

  /* ---------- Liquidité du secteur ---------- */

  function afficherLiquidite(ventes) {
    const el = $('liquiditeInfo');
    const dates = ventes.map((v) => new Date(v.date)).filter((d) => !isNaN(d));

    if (dates.length < 2) {
      setStatus(el, '', null);
      return;
    }

    const spanAns = Math.max(
      (Math.max(...dates) - Math.min(...dates)) / (1000 * 60 * 60 * 24 * 365),
      0.5
    );
    const parAn = ventes.length / spanAns;

    let niveau, classe;
    if (parAn < 2) {
      niveau = 'secteur calme, la revente peut prendre du temps';
      classe = 'error';
    } else if (parAn < 6) {
      niveau = 'rythme de transactions courant';
      classe = 'info';
    } else {
      niveau = 'marché actif, plutôt rassurant pour la revente';
      classe = 'ok';
    }

    setStatus(
      el,
      `Liquidité : ${ventes.length} ventes tous types sur ~${spanAns.toFixed(1)} an(s) ` +
        `dans ce rayon, soit ~${parAn.toFixed(1)}/an — ${niveau}.`,
      classe
    );
  }

  /* ---------- Recherche des comparables ---------- */

  $('chercher').addEventListener('click', async () => {
    const adresse = $('adresse').value.trim();
    const surface = num('surface');
    const typeLocal = $('typeLocal').value;
    const rayon = $('rayon').value;
    const statusEl = $('status');

    if (!adresse) {
      setStatus(statusEl, "Renseigne l'adresse de l'annonce.", 'error');
      return;
    }
    if (!surface) {
      setStatus(statusEl, 'Renseigne la surface pour filtrer les biens comparables.', 'error');
      return;
    }

    $('comps').innerHTML = '';
    checkAnalyserVisible();
    $('compsCard').style.display = '';
    $('compsCard').open = true;
    setStatus($('liquiditeInfo'), '', null);
    setStatus(statusEl, '<span class="spinner"></span>Géocodage de l\'adresse…', 'info', true);

    let geo;
    try {
      geo = await geocodeAdresse(adresse);
    } catch (e) {
      setStatus(
        statusEl,
        `Géocodage impossible (${e.message}). Vérifie l'adresse, ou ajoute des ventes manuellement.`,
        'error'
      );
      return;
    }

    setStatus(
      statusEl,
      `<span class="spinner"></span>Recherche des ventes autour de ${geo.label}…`,
      'info',
      true
    );

    let brut, sourceUtilisee;
    try {
      const reponse = await fetchDVF({
        lat: geo.lat,
        lon: geo.lon,
        dist: Number(rayon),
        citycode: geo.citycode,
        annees: parseInt($('anneeMax').value, 10) >= 99 ? 5 : parseInt($('anneeMax').value, 10)
      });
      brut = reponse.ventes;
      sourceUtilisee = reponse.source;
    } catch (e) {
      setStatus(
        statusEl,
        `Aucune source DVF n'a répondu. Détail — ${e.message}. ` +
          'Utilise le bouton « Tester les sources » ci-dessous, ou ajoute des ventes ' +
          'manuellement via app.dvf.etalab.gouv.fr.',
        'error'
      );
      return;
    }

    const anneeMaxVal = parseInt($('anneeMax').value, 10) || 99;
    const dateLimite = new Date();
    dateLimite.setFullYear(dateLimite.getFullYear() - anneeMaxVal);

    const ventes = brut
      .filter((v) => v.vente && v.date)
      .filter((v) => anneeMaxVal >= 99 || new Date(v.date) >= dateLimite);

    afficherLiquidite(ventes);

    const comparables = ventes
      .filter(
        (v) =>
          v.type === typeLocal &&
          v.surface >= surface * 0.6 &&
          v.surface <= surface * 1.5 &&
          v.valeur > 1000
      )
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 12);

    const periodeLabel = anneeMaxVal >= 99 ? 'sans limite de date' : `sur les ${anneeMaxVal} dernière(s) année(s)`;

    if (!comparables.length) {
      setStatus(
        statusEl,
        `Aucune vente comparable dans un rayon de ${rayon} m (${periodeLabel}) pour ${typeLocal.toLowerCase()} ` +
          'de surface proche. Essaie un rayon plus large, une période plus longue, ou ajoute des ventes manuellement.',
        'error'
      );
      return;
    }

    setStatus(
      statusEl,
      `${comparables.length} vente(s) trouvée(s) autour de ${geo.label} (${periodeLabel}), ` +
        `source : ${sourceUtilisee}. Vérifie la liste avant d'analyser.`,
      'ok'
    );

    comparables.forEach((v) => {
      addCompRow(
        {
          label: v.adresse || '',
          prix: Math.round(v.valeur),
          surface: v.surface,
          date: (v.date || '').slice(0, 10)
        },
        false
      );
    });
  });

  /* ---------- Valeur verte (effet du DPE) ---------- */

  const LETTRES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

  // Coefficient de valeur d'une étiquette par rapport à l'étiquette de
  // référence du marché. Chaque lettre gagnée vaut +g% (composé) :
  // à 8,8%/lettre, A vaut 1,66× G, ce qui recoupe le ratio 1,7 mesuré
  // par les Notaires de France entre maisons A-B et F-G.
  function coefDpe(etiquette, reference, gainParLettre) {
    const ecart = LETTRES.indexOf(reference) - LETTRES.indexOf(etiquette);
    return Math.pow(1 + gainParLettre / 100, ecart);
  }

  function afficherDpe(valeurBase, dpeActuel, dpeCible, reference, gainParLettre, travaux) {
    const card = $('dpeCard');

    if (!dpeCible || dpeCible === dpeActuel) {
      card.style.display = 'none';
      return valeurBase;
    }
    card.style.display = 'block';

    const sansGain = valeurBase * coefDpe(dpeActuel, reference, gainParLettre);
    const avecGain = valeurBase * coefDpe(dpeCible, reference, gainParLettre);
    const creee = avecGain - sansGain;
    const sauts = LETTRES.indexOf(dpeActuel) - LETTRES.indexOf(dpeCible);

    $('dpeHint').textContent =
      `Les comparables DVF sont supposés de classe ${reference} en moyenne. Le bien part de ${dpeActuel}, ` +
      `visé en ${dpeCible} — soit ${Math.abs(sauts)} lettre(s) ${sauts > 0 ? 'gagnée(s)' : 'perdue(s)'} ` +
      `à ${gainParLettre}% l'unité.`;
    $('reventeSansDpe').textContent = eur(sansGain);
    $('reventeAvecDpe').textContent = eur(avecGain);
    $('gainDpe').textContent = signedEur(creee);

    const el = $('dpeVerdict');
    if (sauts <= 0) {
      setStatus(el, 'Le DPE visé est moins bon que l\'actuel — vérifie la saisie.', 'error');
    } else if (creee >= travaux && travaux > 0) {
      setStatus(
        el,
        `La valeur créée (${eur(creee)}) dépasse le budget travaux (${eur(travaux)}) : la rénovation ` +
          'se paie d\'elle-même, sans compter les aides (MaPrimeRénov\', CEE) à vérifier de ton côté.',
        'ok'
      );
    } else if (travaux > 0) {
      setStatus(
        el,
        `La valeur créée (${eur(creee)}) ne couvre pas seule le budget travaux (${eur(travaux)}). ` +
          'Le reste doit venir de la décote à l\'achat, ou des aides à la rénovation.',
        'info'
      );
    } else {
      setStatus(el, `Saut d\'étiquette valorisé à ${eur(creee)}. Renseigne un budget travaux pour le comparer.`, 'info');
    }

    return avecGain;
  }

  /* ---------- Blocs de résultats ---------- */

  function afficherVerdict(ecartPct, nbComps) {
    const el = $('verdict');
    el.className = 'verdict';

    if (ecartPct <= -8) {
      el.classList.add('good');
      $('verdictLabel').textContent = 'Potentiellement sous-coté';
      $('verdictDetail').textContent =
        `Le prix est ${Math.abs(ecartPct).toFixed(1)}% sous le marché local (${nbComps} ventes) — ` +
        "à creuser, en vérifiant qu'il n'y a pas une raison cachée : travaux, vice, urgence du vendeur.";
    } else if (ecartPct <= 5) {
      el.classList.add('mid');
      $('verdictLabel').textContent = 'Dans le marché';
      $('verdictDetail').textContent =
        `Le prix est aligné avec le secteur (écart de ${ecartPct.toFixed(1)}%, ${nbComps} ventes). ` +
        "L'intérêt dépendra surtout de l'état du bien et du DPE.";
    } else {
      el.classList.add('bad');
      $('verdictLabel').textContent = 'Potentiellement surcoté';
      $('verdictDetail').textContent =
        `Le prix dépasse le marché local de ${ecartPct.toFixed(1)}% (${nbComps} ventes). ` +
        'Il y a matière à négocier, ou à passer ton chemin si le vendeur ne bouge pas.';
    }
  }

  function afficherFacteurs(d) {
    const liste = $('facteurs');
    liste.innerHTML = '';

    const ajouter = (texte, tag, classe) => {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = texte;
      const badge = document.createElement('span');
      badge.className = 'tag ' + classe;
      badge.textContent = tag;
      li.append(label, badge);
      liste.appendChild(li);
    };

    ajouter(
      `Écart au marché : ${d.ecartPct.toFixed(1)}%`,
      d.ecartPct <= -5 ? 'favorable' : d.ecartPct >= 5 ? 'défavorable' : 'neutre',
      d.ecartPct <= -5 ? 'ok' : d.ecartPct >= 5 ? 'risk' : 'watch'
    );

    if (d.dpe === 'F' || d.dpe === 'G') {
      ajouter(
        `DPE ${d.dpe} — passoire thermique, rénovation énergétique probable, restrictions de location`,
        'risque élevé',
        'risk'
      );
    } else if (d.dpe === 'E') {
      ajouter(`DPE ${d.dpe} — coûts énergétiques et futures obligations possibles`, 'à surveiller', 'watch');
    } else if (d.dpe === 'D') {
      ajouter(`DPE ${d.dpe} — correct, léger point de vigilance selon l'usage prévu`, 'neutre', 'watch');
    } else {
      ajouter(`DPE ${d.dpe} — bonne performance énergétique`, 'favorable', 'ok');
    }

    if (d.jours >= 45) {
      ajouter(
        `En ligne depuis ${d.jours} jours — le bien traîne, le vendeur est souvent plus ouvert`,
        'levier de négo',
        'ok'
      );
    } else if (d.jours > 0) {
      ajouter(`En ligne depuis ${d.jours} jours — pas de signal fort de blocage`, 'neutre', 'watch');
    }

    if (d.travaux > 0) {
      const partTravaux = (d.travaux / d.prix) * 100;
      ajouter(
        `Travaux estimés : ${d.travaux.toLocaleString('fr-FR')} € (${partTravaux.toFixed(1)}% du prix)`,
        partTravaux > 15 ? 'lourd' : 'à intégrer',
        partTravaux > 15 ? 'risk' : 'watch'
      );
    }
  }

  function afficherFiscalite(margeAvantImpot, dureeMois) {
    const statut = $('statutFiscal').value;
    const card = $('fiscaliteCard');

    if (statut === 'aucun') {
      card.style.display = 'none';
      return;
    }
    card.style.display = 'block';

    const base = Math.max(0, margeAvantImpot);
    let totalImpot, texte, labelImpot;

    if (statut === 'particulier') {
      const ans = Math.floor(dureeMois / 12);
      // Abattements pour durée de détention (art. 150 VC CGI)
      const abattIR = ans <= 5 ? 0 : ans <= 21 ? (ans - 5) * 6 : 100;
      const abattPS =
        ans <= 5 ? 0 : ans <= 21 ? (ans - 5) * 1.65 : ans === 22 ? 28 : ans <= 30 ? 28 + (ans - 22) * 9 : 100;

      totalImpot = base * (1 - abattIR / 100) * 0.19 + base * (1 - abattPS / 100) * 0.172;
      labelImpot = 'Impôt estimé (IR + PS)';
      texte =
        'Plus-value immobilière hors résidence principale : 19% d\'IR + 17,2% de prélèvements ' +
        `sociaux, avec abattement pour durée de détention (${ans} an(s) pleine(s) ici). ` +
        'Calculé ici sur la marge de l\'opération, pas sur la plus-value au sens strict.';
    } else {
      const tauxIS = num('tauxIS');
      const tva = base * (0.2 / 1.2); // marge réputée TTC
      totalImpot = tva + Math.max(0, margeAvantImpot - tva) * (tauxIS / 100);
      labelImpot = 'TVA + impôt sur résultat';
      texte =
        `Marchand de biens : TVA sur marge (20%, extraite de la marge TTC), puis ${tauxIS}% ` +
        'sur le résultat restant. Ne remplace pas un calcul fait avec ton comptable.';
    }

    $('fiscaliteHint').textContent = texte;
    $('impotLabel').textContent = labelImpot;
    $('plusValueBrute').textContent = eur(margeAvantImpot);
    $('impotTotal').textContent = eur(totalImpot);
    $('margeNetteImpot').textContent = signedEur(margeAvantImpot - totalImpot);
  }

  function afficherDivision(surface, valeurEnBloc) {
    const lots = parseInt($('nombreLots').value, 10) || 1;
    const card = $('divisionCard');

    if (lots <= 1) {
      card.style.display = 'none';
      return;
    }
    card.style.display = 'block';

    const coutDivision = num('coutDivision');
    const surcote = num('surcotePetitesSurfaces');
    const surfaceParLot = surface / lots;
    const valeurDivisee = valeurEnBloc * (1 + surcote / 100);
    const gain = valeurDivisee - valeurEnBloc - coutDivision;

    $('divisionHint').textContent =
      `${lots} lots de ${surfaceParLot.toFixed(0)} m² en moyenne. La valeur divisée suppose une ` +
      `surcote de ${surcote}% au m² pour les petites surfaces — c'est l'hypothèse à challenger en ` +
      'regardant le prix réel des studios et T2 du secteur.';
    $('surfaceParLot').textContent = surfaceParLot.toFixed(0) + ' m²';
    $('valeurEnBloc').textContent = eur(valeurEnBloc);
    $('valeurDivisee').textContent = eur(valeurDivisee);
    $('gainDivision').textContent = signedEur(gain);

    const el = $('divisionVerdict');
    if (surfaceParLot < 20) {
      setStatus(
        el,
        `Lots moyens de ${surfaceParLot.toFixed(0)} m² — sous 20-25 m², le financement bancaire ` +
          'des futurs acheteurs devient difficile, ce qui peut ralentir la revente malgré le gain théorique.',
        'error'
      );
    } else if (gain > 0) {
      setStatus(
        el,
        `La division dégage un gain théorique de ${eur(gain)} par rapport à une revente en bloc, ` +
          'coût de division déduit. Reste à valider le PLU et les autorisations avant de t\'engager.',
        'ok'
      );
    } else {
      setStatus(
        el,
        `Avec ce coût de division et cette surcote, diviser rapporte ${eur(gain)} — la revente en ` +
          'bloc est probablement plus simple et pas moins rentable.',
        'error'
      );
    }
  }

  /* ---------- Analyse ---------- */

  let derniereAnalyse = null;
  let derniereAnalyseResume = '';

  $('analyser').addEventListener('click', () => {
    const prix = num('prix');
    const surface = num('surface');
    const dpe = $('dpe').value;
    const jours = num('jours');
    const travaux = num('travaux');

    if (!prix || !surface) {
      setStatus($('status'), "Renseigne au moins le prix et la surface de l'annonce.", 'error');
      return;
    }

    // Prix au m² des comparables retenus
    const comps = [];
    $('comps')
      .querySelectorAll('.comp-row')
      .forEach((row) => {
        const p = parseFloat(row.querySelector('.c-prix').value);
        const s = parseFloat(row.querySelector('.c-surface').value);
        if (p > 0 && s > 0) comps.push(p / s);
      });

    if (!comps.length) {
      setStatus(
        $('status'),
        'Il faut au moins une vente comparable valide (prix et surface renseignés).',
        'error'
      );
      return;
    }

    const prixM2Annonce = prix / surface;

    // Médiane plutôt que moyenne : sur un petit échantillon, une vente
    // atypique (bien rénové, vente entre proches) déplacerait tout le résultat.
    const tries = [...comps].sort((a, b) => a - b);
    const milieu = Math.floor(tries.length / 2);
    const prixM2Marche =
      tries.length % 2 ? tries[milieu] : (tries[milieu - 1] + tries[milieu]) / 2;
    const prixM2Min = tries[0];
    const prixM2Max = tries[tries.length - 1];
    const dispersion = prixM2Marche > 0 ? ((prixM2Max - prixM2Min) / prixM2Marche) * 100 : 0;

    const ecartPct = ((prixM2Annonce - prixM2Marche) / prixM2Marche) * 100;

    // --- Coût de portage ---
    const dureeMois = num('dureeDetention');
    const dureeAns = dureeMois / 12;
    const montantEmprunte = Math.max(0, prix + travaux - num('apport'));
    const interets = montantEmprunte * (num('tauxEmprunt') / 100) * dureeAns;
    const assurance = montantEmprunte * (num('assuranceEmprunt') / 100) * dureeAns;
    const taxeProrata = num('taxeFonciere') * dureeAns;
    const coutPortage = interets + assurance + taxeProrata;

    $('montantEmprunte').textContent = eur(montantEmprunte);
    $('coutPortage').textContent = eur(coutPortage);
    $('portageHint').textContent =
      `Sur ${dureeMois} mois : intérêts ${eur(interets)} + assurance ${eur(assurance)} + ` +
      `taxe foncière ${eur(taxeProrata)}. Intérêts calculés sur le capital, sans amortissement mensuel.`;

    // --- Marge de négociation suggérée ---
    const dpeExtra = { A: 0, B: 0, C: 0, D: 2, E: 5, F: 9, G: 13 }[dpe];
    const joursExtra = jours >= 90 ? 5 : jours >= 45 ? 3 : jours >= 20 ? 1 : 0;
    const negoBasse = Math.max(0, ecartPct);
    const negoHaute = negoBasse + dpeExtra + joursExtra;

    // --- Rentabilité : une seule source de vérité pour la marge ---
    const fraisNotairePct = num('fraisNotaire');
    const fraisReventePct = num('fraisRevente');
    const margeViseePct = num('margeVisee');

    const valeurBase = prixM2Marche * surface;
    const valeurRevente = afficherDpe(
      valeurBase,
      dpe,
      $('dpeCible').value,
      $('dpeReference').value,
      num('gainParLettre'),
      travaux
    );
    const produitNet = valeurRevente * (1 - fraisReventePct / 100);
    const coutAcquisition = prix * (1 + fraisNotairePct / 100);

    const seuilTravaux = produitNet - coutAcquisition - coutPortage;
    const marge = seuilTravaux - travaux;
    const travauxMaxVise = seuilTravaux - prix * (margeViseePct / 100);

    afficherVerdict(ecartPct, comps.length);

    $('prixM2').textContent = eur(prixM2Annonce).replace(' €', ' €/m²');
    $('prixM2Comp').textContent =
      eur(prixM2Marche).replace(' €', ' €/m²') + ` (${comps.length})`;
    $('dispersionInfo').textContent =
      comps.length < 2
        ? "Une seule vente comparable : le prix de marché repose entièrement dessus, à prendre avec beaucoup de prudence."
        : `Médiane de ${comps.length} ventes, allant de ${eur(prixM2Min).replace(' €', ' €/m²')} à ` +
          `${eur(prixM2Max).replace(' €', ' €/m²')}` +
          (dispersion > 60
            ? ` — écart très large (${dispersion.toFixed(0)}%) : les biens retenus ne se ressemblent pas beaucoup, vérifie la liste.`
            : '.');
    $('ecart').textContent = pct(ecartPct);
    $('marge').textContent =
      negoHaute > 0.5 ? `${negoBasse.toFixed(0)} à ${negoHaute.toFixed(0)} %` : 'Peu de marge';

    afficherFacteurs({ ecartPct, dpe, jours, travaux, prix });

    const dpeAjuste = Math.abs(valeurRevente - valeurBase) > 1;
    $('travauxHint').textContent =
      `Revente estimée à ${eur(valeurRevente)}` +
      (dpeAjuste ? ' (prix du secteur ajusté du saut de DPE)' : ' (prix moyen du secteur)') +
      `, frais de notaire (${fraisNotairePct}%), de revente (${fraisReventePct}%) et coût de ` +
      `portage (${eur(coutPortage)}) déduits.`;
    $('valeurRevente').textContent = eur(valeurRevente);
    $('margeActuelle').textContent = signedEur(marge);
    $('seuilTravaux').textContent = eur(seuilTravaux);
    $('travauxMaxVise').textContent = eur(travauxMaxVise);

    const travauxEl = $('travauxVerdict');
    if (seuilTravaux <= 0) {
      setStatus(
        travauxEl,
        "Même sans travaux, l'achat dépasse déjà la valeur de revente estimée du secteur, " +
          'frais et portage compris. Aucune marge de manœuvre.',
        'error'
      );
    } else if (travaux <= travauxMaxVise) {
      setStatus(
        travauxEl,
        `Ton budget travaux tient sous le seuil de ta marge visée de ${margeViseePct}% — ` +
          `il reste ${eur(travauxMaxVise - travaux)} de marge de manœuvre avant de l'entamer.`,
        'ok'
      );
    } else if (travaux <= seuilTravaux) {
      setStatus(
        travauxEl,
        `Ton budget dépasse le seuil de ta marge visée, mais l'opération reste positive ` +
          `(${signedEur(marge)}). Tu peux monter jusqu'à ${eur(seuilTravaux)} de travaux avant marge nulle.`,
        'info'
      );
    } else {
      setStatus(
        travauxEl,
        `Avec ce budget travaux, l'opération devient négative (${signedEur(marge)}) — le seuil de ` +
          `rentabilité est à ${eur(seuilTravaux)} de travaux, pas au-delà.`,
        'error'
      );
    }

    afficherFiscalite(marge, dureeMois);
    afficherDivision(surface, valeurBase);

    derniereAnalyse = {
      date: new Date().toLocaleDateString('fr-FR'),
      adresse: $('adresse').value.trim(),
      prix,
      surface,
      prixM2: Math.round(prixM2Annonce),
      ecartPct,
      marge: Math.round(marge)
    };

    derniereAnalyseResume = [
      `Analyse — ${derniereAnalyse.adresse || 'adresse non renseignée'}`,
      `Prix ${prix.toLocaleString('fr-FR')} € · ${surface} m² · ${Math.round(prixM2Annonce)} €/m²`,
      `Marché secteur : ${Math.round(prixM2Marche)} €/m² (médiane de ${comps.length} ventes, ${Math.round(prixM2Min)}-${Math.round(prixM2Max)}) · écart ${pct(ecartPct)}`,
      `Verdict : ${$('verdictLabel').textContent}`,
      `Négociation suggérée : ${$('marge').textContent}`,
      `Coût de portage : ${eur(coutPortage)}`,
      `Marge (travaux et portage déduits) : ${signedEur(marge)}`,
      `Seuil travaux à marge nulle : ${eur(seuilTravaux)}`
    ].join('\n');

    setStatus($('copieStatus'), '', null);
    $('results').style.display = 'block';
    $('results').scrollIntoView({ behavior: 'smooth' });
  });

  /* ---------- Copie du résumé ---------- */

  $('copierResume').addEventListener('click', async () => {
    const el = $('copieStatus');
    if (!derniereAnalyseResume) {
      setStatus(el, "Lance d'abord une analyse.", 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(derniereAnalyseResume);
      setStatus(el, 'Résumé copié.', 'ok');
    } catch (e) {
      setStatus(el, 'Copie automatique refusée par le navigateur. Voici le texte :\n\n' + derniereAnalyseResume, 'error');
    }
  });

  /* ---------- Historique ---------- */

  function getHistorique() {
    try {
      const brut = JSON.parse(localStorage.getItem(HISTORIQUE_KEY) || '[]');
      return Array.isArray(brut) ? brut : [];
    } catch (e) {
      return [];
    }
  }

  function setHistorique(liste) {
    try {
      localStorage.setItem(HISTORIQUE_KEY, JSON.stringify(liste));
    } catch (e) {
      /* stockage plein ou désactivé : l'historique reste en mémoire pour cette session */
    }
  }

  function renderHistorique() {
    const liste = getHistorique();
    const container = $('historiqueListe');
    container.innerHTML = '';
    $('historiqueVide').style.display = liste.length ? 'none' : 'block';

    liste
      .map((item, index) => ({ item, index }))
      .reverse()
      .forEach(({ item, index }) => {
        const row = document.createElement('div');
        row.className = 'hist-row';

        const titre = document.createElement('span');
        titre.className = 'h-nom';
        titre.textContent = item.adresse || '(sans adresse)';

        const meta = document.createElement('span');
        meta.className = 'h-meta';
        meta.textContent = `${item.date} · ${item.prix.toLocaleString('fr-FR')} € · ${pct(item.ecartPct)}`;

        const suppr = document.createElement('button');
        suppr.type = 'button';
        suppr.className = 'btn-remove';
        suppr.textContent = 'Retirer';
        suppr.addEventListener('click', () => {
          const l = getHistorique();
          l.splice(index, 1);
          setHistorique(l);
          renderHistorique();
        });

        row.append(titre, meta, suppr);
        container.appendChild(row);
      });

    const bloc = $('comparaisonBloc');
    if (liste.length >= 2) {
      bloc.style.display = 'block';
      const options = liste
        .map((item, i) => {
          const opt = document.createElement('option');
          opt.value = String(i);
          opt.textContent = `${item.adresse || '(sans adresse)'} — ${item.date}`;
          return opt;
        });
      ['compareA', 'compareB'].forEach((id, colonne) => {
        const select = $(id);
        select.innerHTML = '';
        options.forEach((opt) => select.appendChild(opt.cloneNode(true)));
        select.selectedIndex = Math.max(0, liste.length - 2 + colonne);
      });
    } else {
      bloc.style.display = 'none';
      $('comparaisonResultat').innerHTML = '';
    }
  }

  $('enregistrerAnalyse').addEventListener('click', () => {
    if (!derniereAnalyse) return;
    const liste = getHistorique();
    liste.push(derniereAnalyse);
    setHistorique(liste);
    renderHistorique();
  });

  $('lancerComparaison').addEventListener('click', () => {
    const liste = getHistorique();
    const a = liste[parseInt($('compareA').value, 10)];
    const b = liste[parseInt($('compareB').value, 10)];
    const sortie = $('comparaisonResultat');
    sortie.innerHTML = '';

    if (!a || !b || $('compareA').value === $('compareB').value) {
      const p = document.createElement('p');
      p.className = 'note';
      p.textContent = 'Choisis deux biens différents.';
      sortie.appendChild(p);
      return;
    }

    const ul = document.createElement('ul');
    ul.className = 'factors';

    const ligne = (label, valA, valB, fort) => {
      const li = document.createElement('li');
      const g = document.createElement('span');
      g.textContent = label;
      const d = document.createElement('span');
      d.style.textAlign = 'right';
      d.style.whiteSpace = 'nowrap';
      d.textContent = `${valA}  vs  ${valB}`;
      if (fort) {
        g.style.fontWeight = '700';
        d.style.fontWeight = '700';
      }
      li.append(g, d);
      ul.appendChild(li);
    };

    ligne('Bien', a.adresse || 'A', b.adresse || 'B', true);
    ligne('Prix', a.prix.toLocaleString('fr-FR') + ' €', b.prix.toLocaleString('fr-FR') + ' €');
    ligne('Surface', a.surface + ' m²', b.surface + ' m²');
    ligne('Prix/m²', (a.prixM2 || 0).toLocaleString('fr-FR') + ' €', (b.prixM2 || 0).toLocaleString('fr-FR') + ' €');
    ligne('Écart marché', pct(a.ecartPct), pct(b.ecartPct));
    ligne('Marge', signedEur(a.marge || 0), signedEur(b.marge || 0));

    sortie.appendChild(ul);
  });

  renderHistorique();

  /* ---------- Barre d'action flottante ---------- */

  const analyserBtn = $('analyser');
  const bar = $('actionbar');
  $('analyserSticky').addEventListener('click', () => analyserBtn.click());
  new MutationObserver(() => {
    bar.classList.toggle('show', analyserBtn.style.display !== 'none');
  }).observe(analyserBtn, { attributes: true, attributeFilter: ['style'] });

  // Une section repliée s'ouvre dès qu'on écrit dedans
  document.querySelectorAll('.step').forEach((step) => {
    step.addEventListener('focusin', () => {
      step.open = true;
    });
  });
})();
