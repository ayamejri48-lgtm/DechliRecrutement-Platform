/**
 * Vérification logique CACHE-A (miroir RecruiterSessionService).
 * Exécution : node scripts/cache-a-verify.mjs
 */
let pass = 0;
let fail = 0;
function assert(name, cond) {
  if (cond) {
    pass += 1;
    console.log('PASS', name);
  } else {
    fail += 1;
    console.log('FAIL', name);
  }
}

const state = {
  offres: [
    { id: 1, status: 'PUBLISHED', title: 'A' },
    { id: 2, status: 'PUBLISHED', title: 'B' }
  ],
  candByOffre: new Map([
    [1, [{ id: 10, offreId: 1, status: 'PENDING', candidateId: 5 }]],
    [2, [{ id: 20, offreId: 2, status: 'PENDING', candidateId: 6 }]]
  ]),
  snapshot: { key: '1,2', total: 2 },
  totalCache: { key: '1,2', total: 2 }
};

function invalidateAggregates() {
  state.snapshot = null;
  state.totalCache = null;
}

function invalidateCandidatures(offreId) {
  if (offreId != null) {
    state.candByOffre.delete(offreId);
  } else {
    state.candByOffre.clear();
  }
  invalidateAggregates();
}

function patchOffreStatus(id, status) {
  state.offres = state.offres.map((o) =>
    o.id === id ? { ...o, status } : o
  );
  invalidateAggregates();
}

function upsertOffre(offre) {
  const prev = state.offres.find((o) => o.id === offre.id);
  state.offres = prev
    ? state.offres.map((o) => (o.id === offre.id ? offre : o))
    : [offre, ...state.offres];
  if (!prev || prev.status !== offre.status) {
    invalidateAggregates();
  } else if (prev.title !== offre.title) {
    invalidateCandidatures(offre.id);
  }
}

function removeOffreLocal(id) {
  state.offres = state.offres.filter((o) => o.id !== id);
  invalidateCandidatures(id);
}

function acceptedIds() {
  const s = new Set();
  for (const rows of state.candByOffre.values()) {
    for (const r of rows) {
      if (r.status === 'ACCEPTED') s.add(r.candidateId);
    }
  }
  return [...s];
}

// T1 — accept : invalide 1 offre + agrégats
invalidateCandidatures(1);
assert('T1 offre1 cand cleared', !state.candByOffre.has(1));
assert('T1 offre2 cand kept', state.candByOffre.has(2));
assert('T1 aggregates nulled', state.snapshot === null && state.totalCache === null);

// T2 — refetch après ACCEPTED → règle 1 candidat
state.candByOffre.set(1, [
  { id: 10, offreId: 1, status: 'ACCEPTED', candidateId: 5 }
]);
assert('T2 accepted ids', JSON.stringify(acceptedIds()) === '[5]');
assert('T2 block candidate 5', acceptedIds().includes(5));

// T3 — close : pas de clear candidatures
state.snapshot = { key: '1,2', total: 2 };
state.totalCache = { key: '1,2', total: 2 };
const sizeBefore = state.candByOffre.size;
patchOffreStatus(2, 'CLOSED');
assert('T3 cand cache intact on close', state.candByOffre.size === sizeBefore);
assert('T3 aggregates nulled on close', state.snapshot === null);
assert('T3 offre status CLOSED', state.offres.find((o) => o.id === 2)?.status === 'CLOSED');

// T4 — upsert même statut + titre → clear cand de cette offre
state.candByOffre.set(1, [
  { id: 10, offreId: 1, status: 'ACCEPTED', candidateId: 5 }
]);
state.candByOffre.set(2, [
  { id: 20, offreId: 2, status: 'PENDING', candidateId: 6 }
]);
upsertOffre({ id: 2, status: 'CLOSED', title: 'B2' });
assert('T4 title change clears offre2', !state.candByOffre.has(2));
assert('T4 offre1 kept', state.candByOffre.has(1));

// T5 — create draft → aggregates invalidés, pas clear all cand
state.candByOffre.set(2, [
  { id: 20, offreId: 2, status: 'PENDING', candidateId: 6 }
]);
upsertOffre({ id: 3, status: 'DRAFT', title: 'New' });
assert('T5 new draft aggregates null', state.snapshot === null);
assert('T5 other cand kept', state.candByOffre.has(1) && state.candByOffre.has(2));

// T6 — remove local
removeOffreLocal(3);
assert('T6 draft removed', !state.offres.some((o) => o.id === 3));

// T7 — hasAcceptedForOffre simulation (rows locales)
const rows = [
  { id: 10, offreId: 1, status: 'ACCEPTED' },
  { id: 11, offreId: 1, status: 'PENDING' }
];
const hasAcceptedForOffre = (offreId) =>
  rows.some((r) => r.offreId === offreId && r.status === 'ACCEPTED');
assert('T7 1 ACCEPTED / offre', hasAcceptedForOffre(1) === true);
assert('T7 offre2 free', hasAcceptedForOffre(2) === false);

console.log('---');
console.log(`Result: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
