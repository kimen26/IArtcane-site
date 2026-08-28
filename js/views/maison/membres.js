// ═══════════════════════════════════════════════════════════════════════════
// IArtcane — views/maison/membres.js : M3 — Membres et invitations.
//
// Deux pavés Admin / Lecteur · liste des membres (rôle en select, retrait,
// « un dernier admin ne peut pas se retirer lui-même ») · inviter un membre
// (RPC invite_member si le compte existe déjà, sinon insert maison_invitations)
// · invitations en attente (relance → relance_le = now()).
//
// E-mail normalisé à l'écriture (trim + minuscules) : l'unicité (owner_id, email)
// de maison_invitations (migration 0027) est sensible à la casse.
// ═══════════════════════════════════════════════════════════════════════════
import { $, esc, toast } from '../../core/dom.js';
import { enregistrer } from '../../core/feedback.js';
import { S, canWrite } from '../../core/state.js';
import { sb } from '../../core/data.js';
import { M, hooks, normEmail } from './etat.js';

export function rendre(zone) {
  const lecture = !canWrite();
  const membres = M.membres;
  const nAdmins = membres.filter(m => m.role === 'admin').length;
  const moi = S.user?.id;

  const rows = membres.map(m => {
    const initiale = (m.nom.trim().charAt(0) || '?').toUpperCase();
    // Un dernier admin ne peut pas se retirer lui-même (garde UI ; RLS 0012 en dernier ressort).
    const dernierAdminMoi = m.member_id === moi && m.role === 'admin' && nAdmins <= 1;
    return `
      <div class="ms-mbr" data-mid="${esc(m.member_id)}">
        <div class="ms-mbr-avatar">${esc(initiale)}</div>
        <div class="ms-mbr-id">
          <div class="ms-mbr-name">${esc(m.nom)}</div>
        </div>
        <div class="ms-mbr-actions">
          <select class="ms-select ms-mbr-role" ${lecture || dernierAdminMoi ? 'disabled' : ''}>
            <option value="admin" ${m.role === 'admin' ? 'selected' : ''}>admin</option>
            <option value="lecteur" ${m.role === 'lecteur' ? 'selected' : ''}>lecteur</option>
          </select>
          <button class="ms-mbr-del" ${lecture || dernierAdminMoi ? 'disabled' : ''} aria-label="Retirer ${esc(m.nom)}">
            <span class="ms-mbr-del-bar"></span>
          </button>
        </div>
      </div>`;
  }).join('');

  const invits = M.invitations.map(v => `
    <div class="ms-invite" data-iid="${esc(v.id)}">
      <div class="ms-invite-avatar">?</div>
      <div class="ms-invite-id">
        <div class="ms-invite-mail">${esc(v.email)}</div>
        <div class="ms-invite-meta">${esc(v.role)} · ${v.relance_le ? 'relancée ' : 'envoyée '}${esc(dateRelative(v.relance_le ?? v.created_at))}</div>
      </div>
      <button class="ms-invite-relance" ${lecture ? 'disabled' : ''}>Relancer</button>
    </div>`).join('');

  zone.innerHTML = `
    <div class="ms-card">
      <div class="ms-sec-title">
        <span>Membres</span><span class="ms-count">${membres.length}</span><span class="ms-rule"></span>
      </div>
      <div class="ms-roles">
        <div class="ms-role-pave">
          <div class="ms-role-title">Admin</div>
          <div class="ms-role-txt">Modifie tout : catalogue, membres, nom de la maison.</div>
        </div>
        <div class="ms-role-pave">
          <div class="ms-role-title">Lecteur</div>
          <div class="ms-role-txt">Voit tout le catalogue, ne modifie rien.</div>
        </div>
      </div>
      <div class="ms-mbr-list">
        ${rows || '<div class="ms-note">Aucun membre pour l\'instant — invite le premier ci-dessous.</div>'}
      </div>
      <p class="ms-note ms-note-faint">Un dernier admin ne peut pas se retirer lui-même.</p>
    </div>

    <div class="ms-card">
      <div class="ms-sec-title"><span>Inviter un membre</span><span class="ms-rule"></span></div>
      <p class="ms-note">Le compte doit déjà exister (créé au premier magic link). Sinon l'invitation reste en attente jusqu'à sa première connexion.</p>
      <div class="ms-field-row">
        <input type="email" id="ms-invite-email" class="ms-input" placeholder="email@exemple.fr" autocomplete="off" ${lecture ? 'disabled' : ''}>
        <select class="ms-select" id="ms-invite-role" ${lecture ? 'disabled' : ''}>
          <option value="admin">admin</option>
          <option value="lecteur">lecteur</option>
        </select>
        <button class="ms-btn ms-btn-primary" id="ms-invite-btn" ${lecture ? 'disabled' : ''}>Inviter</button>
      </div>
      <div id="ms-invite-msg" class="ms-invite-msg"></div>
    </div>

    ${M.invitations.length ? `
    <div class="ms-card">
      <div class="ms-sec-title"><span>Invitation${M.invitations.length > 1 ? 's' : ''} en attente</span><span class="ms-rule"></span></div>
      <div class="ms-invite-list">${invits}</div>
    </div>` : ''}`;

  if (!lecture) brancher(zone);
}

function dateRelative(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const jours = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (jours <= 0) return "aujourd'hui";
  if (jours === 1) return 'hier';
  if (jours < 7) return `il y a ${jours} jours`;
  if (jours < 31) return `il y a ${Math.floor(jours / 7)} sem.`;
  return d.toLocaleDateString('fr-FR');
}

function brancher(zone) {
  // Changement de rôle.
  zone.querySelectorAll('.ms-mbr').forEach(row => {
    const mid = row.dataset.mid;
    const membre = M.membres.find(m => m.member_id === mid);
    const sel = $('.ms-mbr-role', row);
    sel.addEventListener('change', async () => {
      const nv = sel.value;
      if (!confirm(`Passer ${membre.nom} en rôle « ${nv} » ?`)) { hooks.rendre?.(); return; }
      const ok = await enregistrer(() => sb.from('collection_members').update({ role: nv })
        .eq('owner_id', S.tenantId).eq('member_id', mid), 'Rôle du membre', { silencieuxSiOk: true });
      if (!ok) { hooks.recharger?.(); return; }
      membre.role = nv;
      toast(`✓ ${membre.nom} est maintenant ${nv}`);
      hooks.rendre?.();
    });
    $('.ms-mbr-del', row).addEventListener('click', async () => {
      if (!confirm(`Retirer ${membre.nom} de la maison ?\nIl ne verra plus le catalogue.`)) return;
      const ok = await enregistrer(() => sb.from('collection_members').delete()
        .eq('owner_id', S.tenantId).eq('member_id', mid), 'Membre retiré', { silencieuxSiOk: true });
      if (!ok) return;
      toast(`${membre.nom} retiré de la maison`);
      hooks.recharger?.();
    });
  });

  // Inviter : compte existant → RPC invite_member (rattachement immédiat) ;
  // compte inexistant → insert maison_invitations (invitation en attente).
  $('#ms-invite-btn').addEventListener('click', async () => {
    const email = normEmail($('#ms-invite-email').value);
    const role = $('#ms-invite-role').value;
    const msg = $('#ms-invite-msg');
    if (!email) { $('#ms-invite-email').focus(); return; }

    const { data, error } = await sb.rpc('invite_member', { p_email: email, p_role: role, p_owner: S.tenantId });
    if (!error) {
      msg.innerHTML = `<div class="ms-msg-ok">✓ ${esc(email)} : ${esc(data ?? 'ajouté')} (${esc(role)}).</div>`;
      toast(`✓ ${email} ${data ?? 'ajouté'}`);
      hooks.recharger?.();
      return;
    }
    // Compte pas encore créé → on matérialise l'attente.
    if (/inexistant/i.test(error.message)) {
      const okIns = await enregistrer(() => sb.from('maison_invitations')
        .upsert({ owner_id: S.tenantId, email, role }, { onConflict: 'owner_id,email' }), 'Invitation', { silencieuxSiOk: true });
      if (!okIns) return;
      msg.innerHTML = `<div class="ms-msg-ok">✓ Invitation en attente pour ${esc(email)} — visible dès sa première connexion.</div>`;
      toast(`Invitation en attente : ${email}`);
      $('#ms-invite-email').value = '';
      hooks.recharger?.();
      return;
    }
    msg.innerHTML = `<div class="ms-msg-err">${esc(error.message)}</div>`;
  });

  // Relancer une invitation en attente → relance_le = now().
  zone.querySelectorAll('.ms-invite').forEach(row => {
    $('.ms-invite-relance', row).addEventListener('click', async () => {
      const iid = row.dataset.iid;
      const ok = await enregistrer(() => sb.from('maison_invitations')
        .update({ relance_le: new Date().toISOString() })
        .eq('owner_id', S.tenantId).eq('id', iid), 'Invitation relancée', { silencieuxSiOk: true });
      if (!ok) return;
      toast('✓ Invitation relancée');
      hooks.recharger?.();
    });
  });
}
