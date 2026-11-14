import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, KeyRound, LockKeyhole, Plus, RefreshCw, Search, Shield, UserRound, X } from 'lucide-react';
import { AuthUser } from '../store';
import { apiClient } from '../services/apiClient';

type AdminSite = { id: string; name: string; site_code: string };
type UserRole = { assignment_id: string; role_id: string; name: string; site_id: string | null; site_name: string | null };
type ManagedUser = {
  id: string; email: string; first_name: string; last_name: string; phone: string | null;
  is_active: boolean; is_locked: boolean; last_login_at: string | null; roles: UserRole[];
};
type Permission = { code: string; module: string; description: string | null };
type RoleGrant = { code: string; site_id: string | null; data_scope: 'TENANT' | 'SITE' | 'OWN' };
type ManagedRole = { id: string; name: string; description: string | null; is_system_role: boolean; permissions: RoleGrant[] };
type UserFilter = { q: string; status: string; roleId: string; siteId: string };
type RoleGrantEditor = { dataScope: 'TENANT' | 'SITE' | 'OWN'; siteIds: string[] };
type UserAuditEntry = {
  id: string;
  action_type: string;
  user_email: string;
  created_at: string;
  details: unknown;
};

const button = 'rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50';
const input = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500';
const siteScopePermissions = new Set([
  'users:read',
  'customers:read', 'customers:update', 'customers:archive',
  'sites:read', 'sites:update', 'sites:archive', 'sites:restore',
  'shifts:read', 'shifts:manage', 'logbook:read', 'logbook:create',
  'planning:read', 'planning:manage', 'planning:publish',
  'planning:swaps:manage', 'planning:swaps:approve',
  'planning:covers:manage', 'planning:covers:approve',
  'planning:actuals:manage', 'planning:actuals:approve', 'planning:reports:read',
  'planning:exceptions:manage', 'planning:exceptions:approve',
  'keys:read', 'keys:manage',
  'employees:read', 'employees:update', 'employees:archive',
  'employees:restore', 'qualifications:manage', 'employees:absence:manage',
  'employees:absence:approve',
  'documents:read', 'documents:update', 'documents:download',
  'documents:archive', 'documents:restore', 'documents:approve',
  'sop:read', 'sop:create', 'sop:update', 'sop:manage', 'sop:submit', 'sop:review',
  'sop:approve', 'sop:publish', 'sop:archive', 'sop:acknowledge', 'sop:assign',
  'handovers:read', 'handovers:create', 'handover:create', 'handovers:update', 'handovers:confirm',
  'handovers:tasks', 'handovers:manage',
  'alarm:read', 'alarm:manage', 'alarm:report', 'alarm:respond',
  'alarm:action:create', 'alarm:assign', 'alarm:notifications:read', 'alarm:escalation:manage',
  'emergency_plan:publish', 'emergency_contact:read', 'emergency_contact:manage',
  'patrol:read', 'patrol:create', 'patrol:manage', 'patrol:dashboard:read', 'patrol:analytics:read',
  'patrol:checkpoint:read', 'patrol:checkpoint:manage', 'patrol:route:read',
  'patrol:route:manage', 'patrol:round:read', 'patrol:round:perform',
  'patrol:round:start', 'patrol:round:complete', 'patrol:history:read',
  'patrol:scan-attempt:read', 'patrol:exception:read', 'patrol:exception:create',
  'patrol:audit'
]);
const ownScopePermissions = new Set([
  'employees:read', 'logbook:read', 'keys:read',
  'documents:read', 'documents:download', 'patrol:round:read'
]);

export const UserAdministration: React.FC<{ authUser: AuthUser }> = ({ authUser }) => {
  const [tab, setTab] = useState<'users' | 'roles'>('users');
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [roles, setRoles] = useState<ManagedRole[]>([]);
  const [sites, setSites] = useState<AdminSite[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [filters, setFilters] = useState<UserFilter>({ q: '', status: '', roleId: '', siteId: '' });
  const [search, setSearch] = useState<UserFilter>(filters);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedUser, setSelectedUser] = useState<ManagedUser | null>(null);
  const [audit, setAudit] = useState<UserAuditEntry[]>([]);
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileForm, setProfileForm] = useState({ firstName: '', lastName: '', phone: '' });
  const [userFormOpen, setUserFormOpen] = useState(false);
  const [userForm, setUserForm] = useState({ email: '', firstName: '', lastName: '', phone: '', roleId: '', siteIds: [] as string[] });
  const [roleAssignment, setRoleAssignment] = useState({ roleId: '', siteId: '' });
  const [roleFormOpen, setRoleFormOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<ManagedRole | null>(null);
  const [roleForm, setRoleForm] = useState({ name: '', description: '', grants: {} as Record<string, RoleGrantEditor> });

  const canManageUsers = authUser.permissions.includes('users:manage');
  const canManageRoles = authUser.permissions.includes('roles:manage');
  const canDelegateAdmin = authUser.permissions.includes('roles:delegate_admin');
  const availablePermissions = useMemo(
    () => permissions.filter(permission =>
      authUser.permissions.includes(permission.code) ||
      (canDelegateAdmin && ['users:manage', 'roles:manage', 'roles:delegate_admin'].includes(permission.code))
    ),
    [permissions, authUser.permissions, canDelegateAdmin]
  );

  const loadRoles = useCallback(async () => {
    const [roleRows, permissionRows, siteRows] = await Promise.all([
      apiClient.get<ManagedRole[]>('/admin/roles'),
      apiClient.get<Permission[]>('/admin/permissions'),
      apiClient.get<AdminSite[]>('/admin/sites')
    ]);
    setRoles(roleRows);
    setPermissions(permissionRows);
    setSites(siteRows);
  }, []);

  const loadUsers = useCallback(async (current: UserFilter) => {
    const query = new URLSearchParams();
    if (current.q.trim()) query.set('q', current.q.trim());
    if (current.status) query.set('status', current.status);
    if (current.roleId) query.set('roleId', current.roleId);
    if (current.siteId) query.set('siteId', current.siteId);
    setUsers(await apiClient.get<ManagedUser[]>(`/admin/users?${query.toString()}`));
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await Promise.all([loadRoles(), loadUsers(search)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Daten konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [loadRoles, loadUsers, search]);

  useEffect(() => { void reload(); }, [reload]);

  const inspectUser = async (user: ManagedUser) => {
    setSelectedUser(user);
    setError('');
    try {
      const [detail, events] = await Promise.all([
        apiClient.get<ManagedUser & { roles: UserRole[] }>(`/admin/users/${user.id}`),
        apiClient.get<UserAuditEntry[]>(`/admin/users/${user.id}/audit`)
      ]);
      setSelectedUser(detail);
      setAudit(events);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Benutzerdetails konnten nicht geladen werden.');
    }
  };

  const runUserAction = async (user: ManagedUser, action: string, confirmation: string) => {
    if (!window.confirm(confirmation)) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await apiClient.post(`/admin/users/${user.id}/${action}`, {});
      setNotice(action === 'password-reset' ? 'Die Passwort-Reset-E-Mail wurde zugestellt.' : 'Benutzerkonto aktualisiert.');
      await reload();
      if (selectedUser?.id === user.id) await inspectUser(user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Änderung fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  };

  const submitUser = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await apiClient.post('/admin/users', {
        email: userForm.email, firstName: userForm.firstName, lastName: userForm.lastName,
        phone: userForm.phone || null, roleId: userForm.roleId, siteIds: userForm.siteIds
      });
      setNotice('Benutzer angelegt. Die Passwort-Reset-E-Mail wurde zugestellt.');
      setUserFormOpen(false);
      setUserForm({ email: '', firstName: '', lastName: '', phone: '', roleId: '', siteIds: [] });
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Benutzer konnte nicht angelegt werden.');
    } finally {
      setSaving(false);
    }
  };

  const saveRole = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    const grants = Object.entries(roleForm.grants).flatMap(([code, grant]) =>
      grant.dataScope === 'TENANT'
        ? [{ code, siteId: null, dataScope: 'TENANT' as const, canDelegate: false }]
        : grant.dataScope === 'OWN'
          ? [{ code, siteId: null, dataScope: 'OWN' as const, canDelegate: false }]
          : grant.siteIds.map(siteId => ({ code, siteId, dataScope: 'SITE' as const, canDelegate: false }))
    );
    if (Object.values(roleForm.grants).some(grant => grant.dataScope === 'SITE' && !grant.siteIds.length)) {
      setError('Wählen Sie für jeden Objekt-Grant mindestens ein Objekt aus.');
      setSaving(false);
      return;
    }
    try {
      if (editingRole) {
        await apiClient.patch(`/admin/roles/${editingRole.id}`, { name: roleForm.name, description: roleForm.description || null, permissions: grants });
      } else {
        await apiClient.post('/admin/roles', { name: roleForm.name, description: roleForm.description || null, permissions: grants });
      }
      setRoleFormOpen(false);
      setEditingRole(null);
      setNotice('Rolle gespeichert. Berechtigungen werden serverseitig geprüft.');
      await loadRoles();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Rolle konnte nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  };

  const beginEditRole = (role?: ManagedRole) => {
    setEditingRole(role ?? null);
    const grants: Record<string, RoleGrantEditor> = {};
    for (const grant of role?.permissions ?? []) {
      const current = grants[grant.code];
      if (grant.data_scope === 'TENANT') {
        grants[grant.code] = { dataScope: 'TENANT', siteIds: [] };
      } else if (current?.dataScope !== 'TENANT' && grant.site_id) {
        grants[grant.code] = {
          dataScope: 'SITE',
          siteIds: [...new Set([...(current?.siteIds ?? []), grant.site_id])]
        };
      } else if (grant.data_scope === 'OWN' && !current) {
        grants[grant.code] = { dataScope: 'OWN', siteIds: [] };
      }
    }
    setRoleForm({
      name: role?.name ?? '',
      description: role?.description ?? '',
      grants
    });
    setRoleFormOpen(true);
  };

  const applyFilters = async (event: FormEvent) => {
    event.preventDefault();
    setSearch(filters);
    setLoading(true);
    setError('');
    try { await loadUsers(filters); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Suche fehlgeschlagen.'); }
    finally { setLoading(false); }
  };

  const editUser = (user: ManagedUser) => {
    setProfileForm({ firstName: user.first_name, lastName: user.last_name, phone: user.phone ?? '' });
    setProfileEditing(true);
    void inspectUser(user);
  };

  const saveUserProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedUser) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await apiClient.patch(`/admin/users/${selectedUser.id}`, {
        firstName: profileForm.firstName,
        lastName: profileForm.lastName,
        phone: profileForm.phone || null
      });
      setProfileEditing(false);
      setNotice('Benutzerinformationen gespeichert.');
      await reload();
      await inspectUser(selectedUser);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Benutzer konnte nicht aktualisiert werden.');
    } finally { setSaving(false); }
  };

  const assignUserRole = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedUser || !roleAssignment.roleId) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await apiClient.post(`/admin/users/${selectedUser.id}/roles`, {
        roleId: roleAssignment.roleId,
        siteIds: roleAssignment.siteId ? [roleAssignment.siteId] : []
      });
      setRoleAssignment({ roleId: '', siteId: '' });
      setNotice('Rolle zugewiesen. Bestehende Sitzungen des Kontos wurden widerrufen.');
      await reload();
      await inspectUser(selectedUser);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Rolle konnte nicht zugewiesen werden.');
    } finally {
      setSaving(false);
    }
  };

  const removeUserRole = async (role: UserRole) => {
    if (!selectedUser || !window.confirm(`Rolle „${role.name}“ wirklich entfernen?`)) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await apiClient.delete(`/admin/users/${selectedUser.id}/roles/${role.assignment_id}`);
      setNotice('Rollenzuordnung entfernt. Bestehende Sitzungen des Kontos wurden widerrufen.');
      await reload();
      await inspectUser(selectedUser);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Rolle konnte nicht entfernt werden.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-5 p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-blue-300"><Shield className="h-5 w-5" /><span className="text-xs font-bold uppercase tracking-[0.18em]">Mandantenverwaltung</span></div>
          <h1 className="mt-2 text-2xl font-bold text-white">Benutzer &amp; Berechtigungen</h1>
          <p className="mt-1 text-sm text-slate-400">Konten, konfigurierbare Rollen und Objektzugriff für {authUser.tenantName}.</p>
        </div>
        <button className={button} onClick={() => void reload()} disabled={loading}><RefreshCw className="mr-2 inline h-4 w-4" />Aktualisieren</button>
      </header>

      {error && <div role="alert" className="flex items-center gap-2 rounded-lg border border-rose-700/70 bg-rose-950/40 p-3 text-sm text-rose-200"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</div>}
      {notice && <div role="status" className="rounded-lg border border-emerald-700/70 bg-emerald-950/30 p-3 text-sm text-emerald-200">{notice}</div>}

      <div className="flex gap-2 border-b border-slate-800">
        <button className={`px-4 py-2 text-sm ${tab === 'users' ? 'border-b-2 border-blue-500 text-white' : 'text-slate-400'}`} onClick={() => setTab('users')}>Benutzer</button>
        <button className={`px-4 py-2 text-sm ${tab === 'roles' ? 'border-b-2 border-blue-500 text-white' : 'text-slate-400'}`} onClick={() => setTab('roles')}>Rollen &amp; Rechte</button>
      </div>

      {tab === 'users' ? (
        <div className="space-y-4">
          <form onSubmit={applyFilters} className="grid gap-2 rounded-xl border border-slate-800 bg-slate-900/60 p-3 md:grid-cols-5">
            <label className="relative md:col-span-2"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" /><input className={`${input} pl-9`} aria-label="Benutzer suchen" placeholder="Name oder E-Mail" value={filters.q} onChange={event => setFilters({ ...filters, q: event.target.value })} /></label>
            <select className={input} aria-label="Status filtern" value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value })}><option value="">Alle Status</option><option value="ACTIVE">Aktiv</option><option value="INACTIVE">Deaktiviert</option><option value="LOCKED">Gesperrt</option></select>
            <select className={input} aria-label="Rolle filtern" value={filters.roleId} onChange={event => setFilters({ ...filters, roleId: event.target.value })}><option value="">Alle Rollen</option>{roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select>
            <select className={input} aria-label="Objekt filtern" value={filters.siteId} onChange={event => setFilters({ ...filters, siteId: event.target.value })}><option value="">Alle Objekte</option>{sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select>
            <div className="flex gap-2 md:col-span-5"><button className={button} type="submit">Filtern</button>{canManageUsers && <button className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500" type="button" onClick={() => setUserFormOpen(true)}><Plus className="mr-1 inline h-4 w-4" />Benutzer anlegen</button>}</div>
          </form>

          {userFormOpen && <form onSubmit={submitUser} className="grid gap-3 rounded-xl border border-blue-800/60 bg-slate-900 p-4 md:grid-cols-2">
            <h2 className="text-sm font-bold md:col-span-2">Neues Benutzerkonto</h2>
            <input className={input} placeholder="E-Mail" type="email" required value={userForm.email} onChange={event => setUserForm({ ...userForm, email: event.target.value })} />
            <input className={input} placeholder="Telefon (optional)" value={userForm.phone} onChange={event => setUserForm({ ...userForm, phone: event.target.value })} />
            <input className={input} placeholder="Vorname" required value={userForm.firstName} onChange={event => setUserForm({ ...userForm, firstName: event.target.value })} />
            <input className={input} placeholder="Nachname" required value={userForm.lastName} onChange={event => setUserForm({ ...userForm, lastName: event.target.value })} />
            <select className={input} required value={userForm.roleId} onChange={event => setUserForm({ ...userForm, roleId: event.target.value })}><option value="">Rolle auswählen</option>{roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select>
            <select className={input} multiple aria-label="Objektzuordnung (optional)" value={userForm.siteIds} onChange={event => setUserForm({ ...userForm, siteIds: Array.from(event.target.selectedOptions, option => option.value) })}>{sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select>
            <p className="text-xs text-slate-400 md:col-span-2">Keine Auswahl bedeutet mandantenweite Rollenzuordnung. Bei Objektwahl wird die Rolle auf die gewählten Objekte beschränkt.</p>
            <div className="flex gap-2 md:col-span-2"><button className={button} disabled={saving}>Benutzer anlegen</button><button type="button" className={button} onClick={() => setUserFormOpen(false)}>Abbrechen</button></div>
          </form>}

          {loading ? <div className="p-8 text-center text-sm text-slate-400">Benutzer werden geladen …</div> : <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-slate-900 text-xs uppercase text-slate-400"><tr><th className="p-3">Benutzer</th><th className="p-3">Rollen / Objekte</th><th className="p-3">Status</th><th className="p-3">Letzte Anmeldung</th><th className="p-3">Aktionen</th></tr></thead>
              <tbody className="divide-y divide-slate-800">{users.map(user => <tr key={user.id} className="bg-slate-950/50">
                <td className="p-3"><button className="font-semibold text-blue-300 hover:text-blue-200" onClick={() => void inspectUser(user)}>{user.first_name} {user.last_name}</button><div className="text-xs text-slate-500">{user.email}</div></td>
                <td className="p-3 text-xs text-slate-300">{user.roles.map(role => `${role.name}${role.site_id ? ` · ${sites.find(site => site.id === role.site_id)?.name ?? 'Objekt'}` : ''}`).join(', ') || 'Keine Rolle'}</td>
                <td className="p-3"><span className={`rounded-full px-2 py-1 text-[10px] ${user.is_locked ? 'bg-rose-950 text-rose-300' : user.is_active ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>{user.is_locked ? 'Gesperrt' : user.is_active ? 'Aktiv' : 'Deaktiviert'}</span></td>
                <td className="p-3 text-xs text-slate-400">{user.last_login_at ? new Date(user.last_login_at).toLocaleString('de-DE') : 'Noch keine Anmeldung'}</td>
                <td className="p-3"><div className="flex flex-wrap gap-1">
                  <button className={button} title="Bearbeiten" disabled={!canManageUsers || saving} onClick={() => void editUser(user)}><UserRound className="h-3.5 w-3.5" /></button>
                  {canManageUsers && <button className={button} title={user.is_active ? 'Deaktivieren' : 'Aktivieren'} disabled={saving} onClick={() => void runUserAction(user, `status/${user.is_active ? 'deactivate' : 'activate'}`, `Konto ${user.is_active ? 'deaktivieren' : 'aktivieren'}?`)}>{user.is_active ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}</button>}
                  {canManageUsers && <button className={button} title={user.is_locked ? 'Entsperren' : 'Sperren'} disabled={saving} onClick={() => void runUserAction(user, `status/${user.is_locked ? 'unlock' : 'lock'}`, `Konto ${user.is_locked ? 'entsperren' : 'sperren'} und bestehende Sitzungen widerrufen?`)}><LockKeyhole className="h-3.5 w-3.5" /></button>}
                  {canManageUsers && <button className={button} title="Passwort-Reset vorbereiten" disabled={saving} onClick={() => void runUserAction(user, 'password-reset', 'Einmaligen Passwort-Reset-Token erstellen und bestehende Sitzungen widerrufen?')}><KeyRound className="h-3.5 w-3.5" /></button>}
                </div></td>
              </tr>)}
              {!users.length && <tr><td className="p-6 text-center text-slate-500" colSpan={5}>Keine Benutzer für diese Filter gefunden.</td></tr>}</tbody>
            </table>
          </div>}

          {selectedUser && <aside className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex items-start justify-between gap-3"><div><h2 className="font-bold text-white">{selectedUser.first_name} {selectedUser.last_name}</h2><p className="text-xs text-slate-400">{selectedUser.email} · {selectedUser.phone || 'Kein Telefon'}</p></div><div className="flex gap-2">{canManageUsers && <button className={button} onClick={() => setProfileEditing(!profileEditing)}>{profileEditing ? 'Bearbeitung schließen' : 'Bearbeiten'}</button>}<button className={button} onClick={() => { setSelectedUser(null); setProfileEditing(false); }}>Schließen</button></div></div>
            {profileEditing && canManageUsers && <form onSubmit={saveUserProfile} className="mt-3 grid gap-2 md:grid-cols-3">
              <input className={input} aria-label="Vorname bearbeiten" required value={profileForm.firstName} onChange={event => setProfileForm({ ...profileForm, firstName: event.target.value })} />
              <input className={input} aria-label="Nachname bearbeiten" required value={profileForm.lastName} onChange={event => setProfileForm({ ...profileForm, lastName: event.target.value })} />
              <input className={input} aria-label="Telefon bearbeiten" value={profileForm.phone} onChange={event => setProfileForm({ ...profileForm, phone: event.target.value })} />
              <button className={button} disabled={saving}>Änderungen speichern</button>
            </form>}
            <p className="mt-3 text-xs font-semibold uppercase text-slate-400">Rollenzuordnungen</p>
            <div className="mt-2 space-y-2">
              {selectedUser.roles.map(role => <div key={role.assignment_id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 p-2 text-sm text-slate-200">
                <span>{role.name}{role.site_name ? ` · ${role.site_name}` : ' · Mandantenweit'}</span>
                {canManageUsers && <button className={button} disabled={saving} onClick={() => void removeUserRole(role)}>Entfernen</button>}
              </div>)}
              {!selectedUser.roles.length && <p className="text-xs text-slate-500">Keine Rollenzuordnung.</p>}
            </div>
            {canManageUsers && <form onSubmit={assignUserRole} className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_auto]">
              <select className={input} aria-label="Rolle zuweisen" required value={roleAssignment.roleId} onChange={event => setRoleAssignment({ ...roleAssignment, roleId: event.target.value })}>
                <option value="">Rolle auswählen</option>{roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}
              </select>
              <select className={input} aria-label="Objekt für Rollenzuweisung" value={roleAssignment.siteId} onChange={event => setRoleAssignment({ ...roleAssignment, siteId: event.target.value })}>
                <option value="">Mandantenweit</option>{sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
              </select>
              <button className={button} disabled={saving || !roleAssignment.roleId}>Rolle zuweisen</button>
            </form>}
            <p className="mt-4 text-xs font-semibold uppercase text-slate-400">Auditverlauf</p>
            <div className="mt-2 divide-y divide-slate-800">{audit.map(entry => <div key={entry.id} className="py-2 text-xs text-slate-300"><span className="font-semibold">{entry.action_type}</span> · {entry.user_email} · {new Date(entry.created_at).toLocaleString('de-DE')}<div className="text-slate-500">{typeof entry.details === 'string' ? entry.details : JSON.stringify(entry.details)}</div></div>)}{!audit.length && <p className="py-2 text-xs text-slate-500">Noch keine Benutzeränderungen protokolliert.</p>}</div>
          </aside>}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(240px,1fr)_2fr]">
          <div className="space-y-2">
            {canManageRoles && <button className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white" onClick={() => beginEditRole()}><Plus className="mr-1 inline h-4 w-4" />Rolle erstellen</button>}
            {roles.map(role => <button key={role.id} className={`w-full rounded-xl border p-3 text-left ${editingRole?.id === role.id ? 'border-blue-600 bg-blue-950/20' : 'border-slate-800 bg-slate-900/50'}`} onClick={() => beginEditRole(role)}><span className="block text-sm font-semibold text-white">{role.name}</span><span className="text-xs text-slate-400">{role.permissions.length} Berechtigungen</span></button>)}
          </div>
          {roleFormOpen && canManageRoles ? <form onSubmit={saveRole} className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex items-center justify-between"><h2 className="font-bold">{editingRole ? 'Rolle bearbeiten' : 'Neue Rolle'}</h2><button className={button} type="button" onClick={() => setRoleFormOpen(false)}>Schließen</button></div>
            {editingRole?.is_system_role && !canDelegateAdmin && <div className="text-xs text-amber-300">Diese Systemrolle kann nur durch einen delegationsberechtigten Systemadministrator geändert werden.</div>}
            <input className={input} placeholder="Rollenname" required value={roleForm.name} onChange={event => setRoleForm({ ...roleForm, name: event.target.value })} />
            <input className={input} placeholder="Beschreibung" value={roleForm.description} onChange={event => setRoleForm({ ...roleForm, description: event.target.value })} />
            <div className="max-h-[50vh] space-y-3 overflow-y-auto rounded-lg border border-slate-800 p-3">
              {Object.entries(availablePermissions.reduce<Record<string, Permission[]>>((groups, permission) => {
                (groups[permission.module] ??= []).push(permission); return groups;
              }, {})).map(([module, rows]) => <fieldset key={module}><legend className="mb-1 text-xs font-bold uppercase text-blue-300">{module}</legend>{rows.map(permission => {
                const grant = roleForm.grants[permission.code];
                return <div key={permission.code} className="space-y-1 py-1 text-xs text-slate-300">
                  <label className="flex items-start gap-2"><input type="checkbox" checked={Boolean(grant)} onChange={event => {
                    const grants = { ...roleForm.grants };
                    if (event.target.checked) grants[permission.code] = { dataScope: 'TENANT', siteIds: [] };
                    else delete grants[permission.code];
                    setRoleForm({ ...roleForm, grants });
                  }} /><span><span className="font-mono">{permission.code}</span>{permission.description && <span className="ml-2 text-slate-500">{permission.description}</span>}</span></label>
                  {grant && <div className="ml-6 grid gap-2 md:grid-cols-2">
                    <select className={input} aria-label={`Datenzugriff für ${permission.code}`} value={grant.dataScope} onChange={event => setRoleForm({
                      ...roleForm,
                      grants: { ...roleForm.grants, [permission.code]: {
                        ...grant,
                        dataScope: event.target.value === 'SITE' ? 'SITE' : event.target.value === 'OWN' ? 'OWN' : 'TENANT'
                      } }
                    })}>
                      <option value="TENANT">Mandantenweit</option>
                      {siteScopePermissions.has(permission.code) && <option value="SITE">Objektbezogen</option>}
                      {ownScopePermissions.has(permission.code) && <option value="OWN">Eigene Daten</option>}
                    </select>
                    {grant.dataScope === 'SITE' && <select className={input} multiple aria-label={`Objekte für ${permission.code}`} value={grant.siteIds} onChange={event => setRoleForm({
                      ...roleForm,
                      grants: { ...roleForm.grants, [permission.code]: { ...grant, siteIds: Array.from(event.target.selectedOptions, option => option.value) } }
                    })}>{sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select>}
                  </div>}
                </div>;
              })}</fieldset>)}
              {!availablePermissions.length && <p className="text-xs text-slate-500">Keine delegierbaren Rechte verfügbar.</p>}
            </div>
            <div className="flex gap-2"><button className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white" disabled={saving}>Rolle speichern</button><button type="button" className={button} onClick={() => setRoleFormOpen(false)}>Abbrechen</button></div>
            <p className="text-xs text-slate-500">Rechteausweitung wird serverseitig verhindert. Administrative Delegation benötigt eine ausdrückliche Systemadministratorberechtigung.</p>
          </form> : <div className="flex min-h-48 items-center justify-center rounded-xl border border-dashed border-slate-800 p-6 text-center text-sm text-slate-500">Rolle auswählen oder eine neue Rolle anlegen. Änderungen werden mandantenbezogen gespeichert.</div>}
        </div>
      )}
    </section>
  );
};
