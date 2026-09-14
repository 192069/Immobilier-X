/**
 * Récupère les ventes DVF des communes situées dans un rayon donné,
 * les allège, et les écrit dans data/{code_commune}.csv
 *
 * Tourne sur les serveurs GitHub (aucune restriction réseau, contrairement
 * au navigateur), déclenché par .github/workflows/dvf.yml
 */

import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const CONFIG = JSON.parse(await readFile('dvf.config.json', 'utf8'));
const DOSSIER = 'data';

// Colonnes conservées : le strict nécessaire pour l'analyse côté navigateur.
// Le fichier source en compte 40, on en garde 10.
const COLONNES = [
  'id_mutation',
  'date_mutation',
  'nature_mutation',
  'valeur_fonciere',
  'adresse_numero',
  'adresse_nom_voie',
  'id_parcelle',
  'type_local',
  'surface_reelle_bati',
  'longitude',
  'latitude'
];

const log = (...a) => console.log(...a);

/* ---------- Utilitaires ---------- */

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function fetchAvecReessai(url, { texte = false, essais = 3 } = {}) {
  for (let i = 1; i <= essais; i++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return texte ? await res.text() : await res.json();
    } catch (e) {
      if (i === essais) throw e;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

function parseCSV(texte) {
  const lignes = [];
  let champ = '';
  let ligne = [];
  let guillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (guillemets) {
      if (c === '"') {
        if (texte[i + 1] === '"') { champ += '"'; i++; }
        else guillemets = false;
      } else champ += c;
    } else if (c === '"') guillemets = true;
    else if (c === ',') { ligne.push(champ); champ = ''; }
    else if (c === '\n') { ligne.push(champ); lignes.push(ligne); ligne = []; champ = ''; }
    else if (c !== '\r') champ += c;
  }
  if (champ || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  return lignes;
}

const echappe = (v) => (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);

/* ---------- Étape 1 : communes dans le rayon ---------- */

async function communesDansRayon() {
  const centre = await fetchAvecReessai(
    `https://geo.api.gouv.fr/communes/${CONFIG.centre.code_commune}?fields=centre,nom`
  );
  if (!centre?.centre) throw new Error('Commune centre introuvable : ' + CONFIG.centre.code_commune);

  const [lon0, lat0] = centre.centre.coordinates;
  log(`Centre : ${centre.nom} (${lat0.toFixed(4)}, ${lon0.toFixed(4)}) — rayon ${CONFIG.rayon_km} km`);

  // Un rayon de R km peut déborder sur les départements voisins : on balaie
  // large puis on filtre à la distance réelle.
  const degLat = CONFIG.rayon_km / 111;
  const degLon = CONFIG.rayon_km / (111 * Math.cos((lat0 * Math.PI) / 180));

  const departements = await fetchAvecReessai('https://geo.api.gouv.fr/departements');
  const retenues = [];

  for (const dep of departements) {
    const communes = await fetchAvecReessai(
      `https://geo.api.gouv.fr/departements/${dep.code}/communes?fields=code,nom,centre`
    );
    if (!communes) continue;

    let uneDansLaBoite = false;
    for (const c of communes) {
      if (!c.centre) continue;
      const [lon, lat] = c.centre.coordinates;
      if (Math.abs(lat - lat0) > degLat || Math.abs(lon - lon0) > degLon) continue;
      uneDansLaBoite = true;
      if (distanceKm(lat0, lon0, lat, lon) <= CONFIG.rayon_km) {
        retenues.push({ code: c.code, nom: c.nom, dep: dep.code });
      }
    }
    if (uneDansLaBoite) log(`  ${dep.code} ${dep.nom} : ${retenues.filter((r) => r.dep === dep.code).length} communes`);
  }

  return retenues;
}

/* ---------- Étape 2 : téléchargement et compactage ---------- */

function compacter(texte) {
  const lignes = parseCSV(texte);
  if (lignes.length < 2) return [];

  const entetes = lignes[0];
  const idx = {};
  COLONNES.forEach((nom) => { idx[nom] = entetes.indexOf(nom); });
  if (idx.type_local === -1 || idx.valeur_fonciere === -1) return [];

  return lignes
    .slice(1)
    .filter((l) => {
      if (l.length !== entetes.length) return false;
      const type = l[idx.type_local];
      // Seuls les logements nous intéressent : terrains, dépendances et
      // locaux commerciaux ne servent pas à estimer un prix au m² habitable.
      if (type !== 'Maison' && type !== 'Appartement') return false;
      return parseFloat(l[idx.valeur_fonciere]) > 1000 && parseFloat(l[idx.surface_reelle_bati]) > 0;
    })
    .map((l) => COLONNES.map((nom) => (idx[nom] === -1 ? '' : l[idx[nom]])));
}

async function traiterCommune(commune, annees) {
  const toutes = [];
  for (const annee of annees) {
    const url = `https://files.data.gouv.fr/geo-dvf/latest/csv/${annee}/communes/${commune.dep}/${commune.code}.csv`;
    let texte;
    try {
      texte = await fetchAvecReessai(url, { texte: true });
    } catch (e) {
      log(`    ! ${commune.code} ${annee} : ${e.message}`);
      continue;
    }
    if (!texte) continue;
    toutes.push(...compacter(texte));
  }

  if (!toutes.length) return 0;

  const contenu = [COLONNES.join(','), ...toutes.map((l) => l.map(echappe).join(','))].join('\n');
  await writeFile(`${DOSSIER}/${commune.code}.csv`, contenu + '\n');
  return toutes.length;
}

/* ---------- Exécution ---------- */

const anneeCourante = new Date().getFullYear();
// Les données paraissent avec du décalage : on balaie quelques années de plus
// et on garde ce qui existe réellement.
const annees = [];
for (let a = anneeCourante; a > anneeCourante - CONFIG.annees - 2; a--) annees.push(a);

const communes = await communesDansRayon();
log(`\n${communes.length} communes dans le rayon. Téléchargement des ventes ${annees.join(', ')}…\n`);

if (!existsSync(DOSSIER)) await mkdir(DOSSIER, { recursive: true });

let totalVentes = 0;
let communesAvecDonnees = 0;
const LOT = 8; // quelques requêtes en parallèle, sans saturer le serveur

for (let i = 0; i < communes.length; i += LOT) {
  const lot = communes.slice(i, i + LOT);
  const resultats = await Promise.all(lot.map((c) => traiterCommune(c, annees)));
  resultats.forEach((n, j) => {
    if (n > 0) {
      communesAvecDonnees++;
      totalVentes += n;
      log(`  ${lot[j].code} ${lot[j].nom} : ${n} ventes`);
    }
  });
  log(`— ${Math.min(i + LOT, communes.length)}/${communes.length} communes traitées`);
}

const fichiers = await readdir(DOSSIER);
log(`\nTerminé : ${communesAvecDonnees} communes, ${totalVentes} ventes, ${fichiers.length} fichiers dans ${DOSSIER}/`);

await writeFile(
  `${DOSSIER}/_index.json`,
  JSON.stringify(
    {
      genere_le: new Date().toISOString().slice(0, 10),
      centre: CONFIG.centre,
      rayon_km: CONFIG.rayon_km,
      annees_demandees: annees,
      communes: communesAvecDonnees,
      ventes: totalVentes
    },
    null,
    2
  ) + '\n'
);
