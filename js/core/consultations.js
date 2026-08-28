// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — core/consultations.js : bascule a_nourri=true (HO-061)
//
// Rappel 0026 : a_nourri=false est une donnée utile (« consultées pour rien »,
// palmarès des sources). On ne CRÉE jamais de ligne ici — on ne fait que
// basculer à true une consultation déjà tracée, quand le geste métier qui la
// suit (retenir un comparable, valider une attribution) prouve qu'elle a servi.
// Best-effort : jamais de throw, jamais de toast — le geste métier appelant
// doit aboutir même si ce marquage échoue.
// ═══════════════════════════════════════════════════════════════════════════
import { sb } from './data.js';
import { S } from './state.js';

const JOURS_30 = 30 * 24 * 3600 * 1000;

/**
 * Bascule à true la consultation la plus récente (30 j) qui colle au contexte.
 * Rapprochement, dans cet ordre — première correspondance gagne :
 *   1. même objet_id (30 j)
 *   2. sinon même artiste (texte, insensible casse/espaces, 30 j)
 *   3. sinon rien (retour silencieux)
 * Ne crée jamais de ligne. N'écrit rien si la ligne trouvée est déjà a_nourri=true.
 */
export async function marquerUtile({ objetId, artiste, besoin }) {
  try {
    const depuis = new Date(Date.now() - JOURS_30).toISOString();
    let ligne = null;

    if (objetId) {
      const { data, error } = await sb
        .from('sources_consultations')
        .select('id, a_nourri')
        .eq('owner_id', S.tenantId)
        .eq('objet_id', objetId)
        .gte('created_at', depuis)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      ligne = data?.[0] ?? null;
    }

    if (!ligne && artiste) {
      const cible = String(artiste).trim().toLowerCase();
      const { data, error } = await sb
        .from('sources_consultations')
        .select('id, artiste, a_nourri')
        .eq('owner_id', S.tenantId)
        .gte('created_at', depuis)
        .order('created_at', { ascending: false });
      if (error) throw error;
      ligne = (data ?? []).find(c => String(c.artiste ?? '').trim().toLowerCase() === cible) ?? null;
    }

    if (!ligne || ligne.a_nourri) return;

    const { error } = await sb
      .from('sources_consultations')
      .update({ a_nourri: true })
      .eq('owner_id', S.tenantId)
      .eq('id', ligne.id);
    if (error) throw error;
  } catch (err) {
    console.warn('marquerUtile:', err?.message ?? err, { objetId, artiste, besoin });
  }
}
