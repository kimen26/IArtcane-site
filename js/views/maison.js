// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/maison.js : nom, membres, rôles (owner + admin, D-036)
// Gestion de la maison courante. Un admin a exactement les mêmes droits
// qu'un owner : inviter, changer les rôles, retirer des membres, renommer.
// Un lecteur voit tout mais ne peut rien modifier (RLS 0012 + UI en lecture seule).
// ═══════════════════════════════════════════════════════════════════════════
import { $, $$, esc, toast } from '../core/dom.js';
import { S } from '../core/state.js';
import { sb } from '../core/data.js';
import { loadViewCss } from '../core/css.js';

// CSS de la vue chargé par la vue (D-041) : aucun <link> dans index.html,
// donc aucun fichier transverse touché par un chantier sur cet écran.
await loadViewCss('maison');

export function mount() {
  loadMaison();
}

async function loadMaison() {
  const body = $('#maison-body');
  body.innerHTML = '<div class="skeleton" style="height:220px"></div>';
  const [{ data: t }, { data: membres, error }] = await Promise.all([
    sb.from('tenants').select('name').eq('owner_id', S.tenantId).maybeSingle(),
    sb.from('collection_members').select('member_id,role,created_at').eq('owner_id', S.tenantId).order('created_at'),
  ]);
  if (error) { toast(error.message, true); body.innerHTML = ''; return; }
  // Noms affichés : profiles lisible entre membres d'une maison (policy 0012).
  const ids = (membres ?? []).map(m => m.member_id);
  const { data: profs } = ids.length
    ? await sb.from('profiles').select('id,display_name').in('id', ids)
    : { data: [] };
  const nomDe = id => (profs ?? []).find(p => p.id === id)?.display_name || `membre ${id.slice(0, 8)}…`;
  const rows = (membres ?? []).map(m => `
    <div class="mbr-row" data-mid="${esc(m.member_id)}">
      <span class="mbr-name">${esc(nomDe(m.member_id))}</span>
      <select class="select mbr-role">
        <option value="admin" ${m.role === 'admin' ? 'selected' : ''}>admin</option>
        <option value="lecteur" ${m.role === 'lecteur' ? 'selected' : ''}>lecteur</option>
      </select>
      <button class="btn small danger mbr-del">Retirer</button>
    </div>`).join('');
  body.innerHTML = `
    <div class="panel panel-pad">
      <div class="sec-title">Nom de la maison</div>
      <div class="value-sub">Affiché dans l'en-tête et dans le switcher du menu.</div>
      <div class="mbr-form" style="margin-top:12px">
        <input id="maison-name" value="${esc(t?.name ?? '')}" placeholder="PONAIRE…">
        <button class="btn primary" id="maison-rename">Renommer</button>
      </div>
    </div>
    <div class="panel panel-pad" style="margin-top:18px">
      <div class="sec-title">Membres <span style="font-family:var(--mono);font-size:13px;color:var(--ink-3);font-weight:400">${(membres ?? []).length}</span></div>
      <div class="note">Un <b>admin</b> peut tout modifier (catalogue, membres, nom de la maison). Un <b>lecteur</b> voit tout le catalogue mais ne peut rien modifier.</div>
      <div class="mbr-list">${rows || '<div class="value-sub">Aucun membre pour l\'instant — invite le premier ci-dessous.</div>'}</div>
    </div>
    <div class="panel panel-pad" style="margin-top:18px">
      <div class="sec-title">Inviter un membre</div>
      <div class="value-sub">Le compte doit déjà exister (créé au premier magic link).</div>
      <div class="mbr-form" style="margin-top:12px">
        <input type="email" id="invite-email" placeholder="email@exemple.fr" autocomplete="off">
        <select class="select" id="invite-role">
          <option value="admin">admin</option>
          <option value="lecteur">lecteur</option>
        </select>
        <button class="btn primary" id="invite-btn">Inviter</button>
      </div>
      <div id="invite-msg" style="margin-top:10px"></div>
    </div>`;

  $('#maison-rename').addEventListener('click', async () => {
    const name = $('#maison-name').value.trim();
    if (!name) { toast('Nom vide', true); return; }
    const { error: e } = await sb.from('tenants').upsert({ owner_id: S.tenantId, name });
    if (e) { toast(e.message, true); return; }
    const mienne = S.mesTenants.find(x => x.id === S.tenantId);
    if (mienne) mienne.name = name;
    S.tenantName = name;
    S.refreshMenu?.();
    S.refreshHeader?.();
    toast(`✓ Maison renommée « ${name} »`);
  });

  $$('.mbr-row', body).forEach(row => {
    const mid = row.dataset.mid;
    const sel = $('.mbr-role', row);
    sel.addEventListener('change', async () => {
      const nv = sel.value;
      if (!confirm(`Passer ${nomDe(mid)} en rôle « ${nv} » ?`)) { loadMaison(); return; }
      const { error: e } = await sb.from('collection_members').update({ role: nv })
        .eq('owner_id', S.tenantId).eq('member_id', mid);
      if (e) { toast(e.message, true); loadMaison(); return; }
      toast(`✓ ${nomDe(mid)} est maintenant ${nv}`);
    });
    $('.mbr-del', row).addEventListener('click', async () => {
      if (!confirm(`Retirer ${nomDe(mid)} de la maison ?\nIl ne verra plus le catalogue.`)) return;
      const { error: e } = await sb.from('collection_members').delete()
        .eq('owner_id', S.tenantId).eq('member_id', mid);
      if (e) { toast(e.message, true); return; }
      toast(`${nomDe(mid)} retiré de la maison`);
      loadMaison();
    });
  });

  $('#invite-btn').addEventListener('click', async () => {
    const email = $('#invite-email').value.trim();
    const role = $('#invite-role').value;
    const msg = $('#invite-msg');
    if (!email) { $('#invite-email').focus(); return; }
    const { data, error: e } = await sb.rpc('invite_member', { p_email: email, p_role: role, p_owner: S.tenantId });
    if (e) {
      // Message métier de la RPC (ex. « compte inexistant ») affiché proprement.
      msg.innerHTML = `<div class="login-err">${esc(e.message)}</div>`;
      return;
    }
    msg.innerHTML = `<div class="login-ok">✓ ${esc(email)} : ${esc(data ?? 'ajouté')} (${esc(role)}).</div>`;
    toast(`✓ ${email} ${data ?? 'ajouté'}`);
    loadMaison();
  });
}
