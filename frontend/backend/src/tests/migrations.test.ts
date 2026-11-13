import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { runMigrations } from '../migrations/runner';
import { env } from '../config/env';

jest.setTimeout(180000);

const REAL_MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

const createdDatabases: string[] = [];
const tempDirs: string[] = [];
const noopLogger = () => {};

function migrationUrl(): string {
  if (!env.DATABASE_MIGRATION_URL) {
    throw new Error('DATABASE_MIGRATION_URL fehlt in der Testumgebung.');
  }
  return env.DATABASE_MIGRATION_URL;
}

function withDatabaseName(name: string, connectionString = migrationUrl()): string {
  const url = new URL(connectionString);
  url.pathname = `/${name}`;
  return url.toString();
}

async function createTestDatabase(): Promise<string> {
  const name = `secops_migtest_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const admin = new Client({ connectionString: withDatabaseName('postgres') });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  createdDatabases.push(name);
  return name;
}

async function dropTestDatabase(name: string): Promise<void> {
  const admin = new Client({ connectionString: withDatabaseName('postgres') });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

async function queryInDatabase<T extends Record<string, unknown> = Record<string, unknown>>(
  name: string,
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const client = new Client({ connectionString: withDatabaseName(name) });
  await client.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows as T[];
  } finally {
    await client.end();
  }
}

function makeMigrationsDir(extraFiles: Record<string, string> = {}, excludedFiles: string[] = []): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secops-migrations-'));
  fs.cpSync(REAL_MIGRATIONS_DIR, dir, { recursive: true });
  for (const filename of excludedFiles) fs.rmSync(path.join(dir, filename));
  for (const [filename, content] of Object.entries(extraFiles)) {
    fs.writeFileSync(path.join(dir, filename), content);
  }
  tempDirs.push(dir);
  return dir;
}

async function historyRows(dbName: string): Promise<Array<{ version: string; filename: string; checksum: string }>> {
  return queryInDatabase(dbName, 'SELECT version, filename, checksum FROM schema_migrations ORDER BY version');
}

async function tableExists(dbName: string, table: string): Promise<boolean> {
  const rows = await queryInDatabase<{ present: boolean }>(
    dbName,
    `SELECT to_regclass('public.' || quote_ident($1)) IS NOT NULL AS present`,
    [table]
  );
  return rows[0].present;
}

afterEach(async () => {
  for (const name of createdDatabases.splice(0)) {
    await dropTestDatabase(name);
  }
});

afterAll(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('SecurityOps 2.0 – Versionssicherer Migrationsrunner', () => {
  test('1. Erster Lauf wendet alle Migrationen an und protokolliert sie', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir();

    const result = await runMigrations({
      connectionString: withDatabaseName(db),
      migrationsDir: dir,
      logger: noopLogger
    });

    expect(result.applied).toEqual(['001', '002', '003', '004', '005', '006', '007', '009', '011', '012', '013', '014', '015', '016', '017', '018']);
    expect(result.baselined).toEqual([]);

    const history = await historyRows(db);
    expect(history.map((row) => row.version)).toEqual(['001', '002', '003', '004', '005', '006', '007', '009', '011', '012', '013', '014', '015', '016', '017', '018']);
    expect(history.every((row) => /^[0-9a-f]{64}$/.test(row.checksum))).toBe(true);
    expect(await tableExists(db, 'sync_conflict_resolution_receipts')).toBe(true);
    expect(await tableExists(db, 'documents')).toBe(true);
    expect(await tableExists(db, 'employee_site_assignments')).toBe(true);
    expect(await tableExists(db, 'emergency_plans')).toBe(true);
    expect(await tableExists(db, 'alarm_incidents')).toBe(true);
    expect(await tableExists(db, 'emergency_management_events')).toBe(true);
    const identityColumns = await queryInDatabase<{ table_name: string; column_name: string }>(
      db,
      `SELECT table_name,column_name FROM information_schema.columns
       WHERE table_schema='public' AND
         ((table_name='employees' AND column_name='account_user_id')
          OR (table_name='handover_confirmations' AND column_name='payload_hash'))
       ORDER BY table_name,column_name`
    );
    expect(identityColumns).toEqual([
      { table_name: 'employees', column_name: 'account_user_id' },
      { table_name: 'handover_confirmations', column_name: 'payload_hash' }
    ]);
    for (const table of [
      'alarm_types', 'emergency_contacts', 'emergency_plan_versions', 'alarm_event_assignments',
      'alarm_event_actions', 'alarm_event_status_history', 'alarm_escalation_rules',
      'alarm_escalation_steps', 'alarm_escalation_jobs', 'alarm_notifications', 'alarm_mutation_receipts'
    ]) expect(await tableExists(db, table)).toBe(true);
    const alarmSecurity = await queryInDatabase<{ relname: string; row_security: boolean; force_row_security: boolean }>(
      db,
      `SELECT c.relname,c.relrowsecurity AS row_security,c.relforcerowsecurity AS force_row_security
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relname IN (
         'emergency_plans','alarm_incidents','emergency_management_events','alarm_types','emergency_contacts',
         'emergency_plan_versions','alarm_event_assignments','alarm_event_actions','alarm_event_status_history',
         'alarm_escalation_rules','alarm_escalation_steps','alarm_escalation_jobs','alarm_notifications',
         'alarm_mutation_receipts')
       ORDER BY c.relname`
    );
    expect(alarmSecurity).toHaveLength(14);
    expect(alarmSecurity.every((row) => row.row_security && row.force_row_security)).toBe(true);
    const alarmPrivileges = await queryInDatabase<{ can_update: boolean; can_delete: boolean }>(
      db,
      `SELECT has_table_privilege('secops_app_user','public.alarm_event_actions','UPDATE') AS can_update,
              has_table_privilege('secops_app_user','public.alarm_event_actions','DELETE') AS can_delete`
    );
    expect(alarmPrivileges).toEqual([{ can_update: false, can_delete: false }]);
    const sopSecurity = await queryInDatabase<{
      relname: string;
      row_security: boolean;
      force_row_security: boolean;
    }>(
      db,
      `SELECT c.relname, c.relrowsecurity AS row_security, c.relforcerowsecurity AS force_row_security
       FROM pg_class c
       JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public'
         AND c.relname IN ('sop_instructions','sop_versions','sop_events','sop_assignment_targets','sop_assignments')
       ORDER BY c.relname`
    );
    expect(sopSecurity).toHaveLength(5);
    expect(sopSecurity.every((row) => row.row_security && row.force_row_security)).toBe(true);
    const employeeSiteSecurity = await queryInDatabase<{ row_security: boolean; force_row_security: boolean }>(
      db,
      `SELECT c.relrowsecurity AS row_security, c.relforcerowsecurity AS force_row_security
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relname='employee_site_assignments'`
    );
    expect(employeeSiteSecurity).toEqual([{ row_security: true, force_row_security: true }]);
    const immutablePrivileges = await queryInDatabase<{
      table_name: string;
      can_update: boolean;
      can_delete: boolean;
    }>(
      db,
      `SELECT table_name,
         has_table_privilege('secops_app_user', format('public.%I', table_name), 'UPDATE') AS can_update,
         has_table_privilege('secops_app_user', format('public.%I', table_name), 'DELETE') AS can_delete
       FROM unnest(ARRAY['sop_versions','sop_events']) AS t(table_name)
       ORDER BY table_name`
    );
    expect(immutablePrivileges).toEqual([
      { table_name: 'sop_events', can_update: false, can_delete: false },
      { table_name: 'sop_versions', can_update: false, can_delete: false }
    ]);

    const dmsSecurity = await queryInDatabase<{
      row_security: boolean;
      force_row_security: boolean;
      can_read_documents: boolean;
      can_update_audit: boolean;
      can_delete_audit: boolean;
    }>(db, `
      SELECT c.relrowsecurity AS row_security, c.relforcerowsecurity AS force_row_security,
             has_table_privilege('secops_app_user', 'public.documents', 'SELECT') AS can_read_documents,
             has_table_privilege('secops_app_user', 'public.document_audit_events', 'UPDATE') AS can_update_audit,
             has_table_privilege('secops_app_user', 'public.document_audit_events', 'DELETE') AS can_delete_audit
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='documents'
    `);
    expect(dmsSecurity[0]).toEqual({
      row_security: true,
      force_row_security: true,
      can_read_documents: true,
      can_update_audit: false,
      can_delete_audit: false
    });
    const handoverTables = await queryInDatabase<{ relname: string; row_security: boolean; force_row_security: boolean }>(
      db,
      `SELECT c.relname, c.relrowsecurity AS row_security, c.relforcerowsecurity AS force_row_security
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relname = ANY($1::text[]) ORDER BY c.relname`,
      [['handovers','handover_participants','handover_events','handover_confirmations',
        'handover_tasks','handover_task_events','handover_documents']]
    );
    expect(handoverTables).toHaveLength(7);
    expect(handoverTables.every(row => row.row_security && row.force_row_security)).toBe(true);
    const handoverAuditPrivileges = await queryInDatabase<{ table_name: string; can_update: boolean; can_delete: boolean }>(
      db,
      `SELECT table_name,
         has_table_privilege('secops_app_user', format('public.%I', table_name), 'UPDATE') AS can_update,
         has_table_privilege('secops_app_user', format('public.%I', table_name), 'DELETE') AS can_delete
       FROM unnest(ARRAY['handover_events','handover_confirmations','handover_task_events',
         'handover_participants','handover_documents']) AS t(table_name) ORDER BY table_name`
    );
    expect(handoverAuditPrivileges.every(row => !row.can_update && !row.can_delete)).toBe(true);
    const handoverPermissions = await queryInDatabase<{ permission: string }>(
      db,
      `SELECT code AS permission FROM permissions WHERE code LIKE 'handovers:%' ORDER BY code`
    );
    expect(handoverPermissions.map(row => row.permission)).toEqual([
      'handovers:confirm', 'handovers:create', 'handovers:manage',
      'handovers:read', 'handovers:tasks', 'handovers:update'
    ]);
  });

  test('014 backfills historical employee/site shift associations without assigning unrelated employees', async () => {
    const db = await createTestDatabase();
    const migrationsDir = makeMigrationsDir({}, [
      '014_employee_site_assignments.sql',
      '015_alarm_emergency_management.sql',
      '016_alarm_lifecycle_and_offline.sql'
    ]);
    await runMigrations({ connectionString: withDatabaseName(db), migrationsDir, logger: noopLogger });

    const tenantId = randomUUID();
    const clientId = randomUUID();
    const siteId = randomUUID();
    const assignedEmployeeId = randomUUID();
    const unassignedEmployeeId = randomUUID();
    const suffix = randomUUID();
    const setup = new Client({ connectionString: withDatabaseName(db) });
    await setup.connect();
    try {
      await setup.query(
        `INSERT INTO tenants (id,name,subdomain,tax_number,bwr_register_id)
         VALUES ($1,'Membership backfill',$2,$3,$4)`,
        [tenantId, `${suffix}.test`, `TAX-${suffix}`, `REG-${suffix}`]
      );
      await setup.query(
        `INSERT INTO clients (id,tenant_id,client_number,company_name,contact_person,email,phone,address,contract_start,contract_end)
         VALUES ($1,$2,$3,'Backfill client','Test Person',$4,'+49 30 000','Test address',DATE '2020-01-01',DATE '2030-01-01')`,
        [clientId,tenantId,`CLIENT-${suffix}`,`${suffix}@example.test`]
      );
      await setup.query(
        `INSERT INTO sites (id,tenant_id,client_id,site_code,name,address)
         VALUES ($1,$2,$3,$4,'Historical shift site','Test address')`,
        [siteId,tenantId,clientId,`SITE-${suffix}`]
      );
      await setup.query(
        `INSERT INTO employees (id,tenant_id,personnel_number,first_name,last_name,email,phone,date_of_joining)
         VALUES ($1,$2,$3,'Assigned','Employee',$4,'+49 30 001',DATE '2019-01-01'),
                ($5,$2,$6,'Unassigned','Employee',$7,'+49 30 002',DATE '2019-01-01')`,
        [assignedEmployeeId,tenantId,`EMP-A-${suffix}`,`assigned-${suffix}@example.test`,
          unassignedEmployeeId,`EMP-U-${suffix}`,`unassigned-${suffix}@example.test`]
      );
      await setup.query(
        `INSERT INTO shifts (tenant_id,site_id,employee_id,shift_date,start_time,end_time,status,required_qualification)
         VALUES ($1,$2,$3,DATE '2020-01-01','08:00','16:00','Abgeschlossen','Allgemeine Qualifikation'),
                ($1,$2,$3,DATE '2021-01-01','08:00','16:00','Abgeschlossen','Allgemeine Qualifikation')`,
        [tenantId,siteId,assignedEmployeeId]
      );
    } finally {
      await setup.end();
    }

    await runMigrations({
      connectionString: withDatabaseName(db),
      migrationsDir: REAL_MIGRATIONS_DIR,
      logger: noopLogger
    });
    const memberships = await queryInDatabase<{ employee_id: string; site_id: string }>(
      db,
      'SELECT employee_id,site_id FROM employee_site_assignments WHERE tenant_id=$1 ORDER BY employee_id',
      [tenantId]
    );
    expect(memberships).toEqual([{ employee_id: assignedEmployeeId, site_id: siteId }]);
  });

  test('DMS- und Handover-RLS sowie zusammengesetzte Mandanten-FKs verhindern Cross-Tenant-Zugriff', async () => {
    const db = await createTestDatabase();
    await runMigrations({ connectionString: withDatabaseName(db), migrationsDir: makeMigrationsDir(), logger: noopLogger });
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const userId = randomUUID();
    const setup = new Client({ connectionString: withDatabaseName(db) });
    await setup.connect();
    try {
      await setup.query(
        `INSERT INTO tenants (id,name,subdomain,tax_number,bwr_register_id)
         VALUES ($1,'Tenant A',$2,'A-123','A-REG'),($3,'Tenant B',$4,'B-123','B-REG')`,
        [tenantA, `${tenantA}.test`, tenantB, `${tenantB}.test`]
      );
      await setup.query(
        `INSERT INTO users (id,email,password_hash,first_name,last_name)
         VALUES ($1,$2,'test-hash','DMS','Test')`,
        [userId, `${userId}@example.test`]
      );
      await setup.query('SET session_replication_role = replica');
      try {
        await setup.query(
          `INSERT INTO handover_events (tenant_id,handover_id,actor_user_id,action)
           VALUES ($1,$2,$3,'created')`,
          [tenantB, randomUUID(), userId]
        );
      } finally {
        await setup.query('SET session_replication_role = origin');
      }
    } finally {
      await setup.end();
    }

    const client = new Client({ connectionString: withDatabaseName(db, env.DATABASE_URL) });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_tenant',$1,true)", [tenantA]);
      const categoryA = await client.query(
        'INSERT INTO document_categories (tenant_id,name,created_by) VALUES ($1,$2,$3) RETURNING id',
        [tenantA, `Category A ${tenantA}`, userId]
      );
      await client.query("SELECT set_config('app.current_tenant',$1,true)", [tenantB]);
      const categoryB = await client.query(
        'INSERT INTO document_categories (tenant_id,name,created_by) VALUES ($1,$2,$3) RETURNING id',
        [tenantB, `Category B ${tenantB}`, userId]
      );

      await client.query("SELECT set_config('app.current_tenant',$1,true)", [tenantA]);
      const visibleCategories = await client.query('SELECT id FROM document_categories');
      expect(visibleCategories.rows.map((row) => row.id)).toEqual([categoryA.rows[0].id]);
      const visibleHandoverEvents = await client.query('SELECT tenant_id FROM handover_events');
      expect(visibleHandoverEvents.rows).toEqual([]);

      await client.query('SAVEPOINT cross_tenant_document');
      await expect(client.query(
        `INSERT INTO documents (tenant_id,title,category_id,created_by)
         VALUES ($1,'Cross-tenant reference',$2,$3)`,
        [tenantA, categoryB.rows[0].id, userId]
      )).rejects.toMatchObject({ code: '23503' });
      await client.query('ROLLBACK TO SAVEPOINT cross_tenant_document');
      await client.query('SAVEPOINT cross_tenant_handover');
      await expect(client.query(
        `INSERT INTO handover_events (tenant_id,handover_id,actor_user_id,action)
         VALUES ($1,$2,$3,'created')`,
        [tenantB, randomUUID(), userId]
      )).rejects.toMatchObject({ code: '42501' });
      await client.query('ROLLBACK TO SAVEPOINT cross_tenant_handover');
      await client.query('ROLLBACK');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      await client.end();
    }
  });

  test('Mitarbeiter-Kontozuordnungen sind tenantgebunden und pro Konto eindeutig', async () => {
    const db = await createTestDatabase();
    await runMigrations({ connectionString: withDatabaseName(db), migrationsDir: makeMigrationsDir(), logger: noopLogger });
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const userA = randomUUID();
    const userB = randomUUID();
    const roleId = randomUUID();
    const employeeA = randomUUID();
    const employeeB = randomUUID();
    const suffix = randomUUID();
    const admin = new Client({ connectionString: withDatabaseName(db) });
    await admin.connect();
    try {
      await admin.query(
        `INSERT INTO tenants (id,name,subdomain,tax_number,bwr_register_id)
         VALUES ($1,'Identity Tenant A',$2,$3,$4),($5,'Identity Tenant B',$6,$7,$8)`,
        [tenantA,`identity-a-${suffix}.test`,`IDENTITY-A-${suffix}`,`IDENTITY-AR-${suffix}`,
          tenantB,`identity-b-${suffix}.test`,`IDENTITY-B-${suffix}`,`IDENTITY-BR-${suffix}`]
      );
      await admin.query(
        `INSERT INTO users (id,email,password_hash,first_name,last_name)
         VALUES ($1,$2,'test-hash','Account','A'),($3,$4,'test-hash','Account','B')`,
        [userA,`${userA}@example.test`,userB,`${userB}@example.test`]
      );
      await admin.query(
        'INSERT INTO roles (id,name,description) VALUES ($1,$2,$3)',
        [roleId,`I-${suffix}`,'Migration integration test role']
      );
      await admin.query(
        `INSERT INTO user_roles (user_id,role_id,tenant_id)
         VALUES ($1,$3,$2),($4,$3,$5)`,
        [userA,tenantA,roleId,userB,tenantB]
      );
      await admin.query(
        `INSERT INTO employees
           (id,tenant_id,personnel_number,first_name,last_name,email,phone,date_of_joining)
         VALUES ($1,$3,$4,'Employee','One',$5,'+49 30 001',DATE '2020-01-01'),
                ($2,$3,$6,'Employee','Two',$7,'+49 30 002',DATE '2020-01-01')`,
        [employeeA,employeeB,tenantA,`EMP-A-${suffix}`,`${suffix}-a@example.test`,
          `EMP-B-${suffix}`,`${suffix}-b@example.test`]
      );
      await admin.query('UPDATE employees SET account_user_id=$1 WHERE id=$2', [userA,employeeA]);
      await expect(admin.query(
        'UPDATE employees SET account_user_id=$1 WHERE id=$2',
        [userA,employeeB]
      )).rejects.toMatchObject({ code: '23505' });
      await expect(admin.query(
        'UPDATE employees SET account_user_id=$1 WHERE id=$2',
        [userB,employeeB]
      )).rejects.toMatchObject({ code: '23503' });
    } finally {
      await admin.end();
    }
  });

  test('Alarmpläne, Vorfälle und Ereignisse sind mandantenisoliert und Ereignisse unveränderlich', async () => {
    const db = await createTestDatabase();
    await runMigrations({ connectionString: withDatabaseName(db), migrationsDir: makeMigrationsDir(), logger: noopLogger });
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const userId = randomUUID();
    const clientA = randomUUID();
    const clientB = randomUUID();
    const siteA = randomUUID();
    const siteB = randomUUID();
    const planA = randomUUID();
    const planB = randomUUID();
    const incidentA = randomUUID();
    const incidentB = randomUUID();
    const admin = new Client({ connectionString: withDatabaseName(db) });
    await admin.connect();
    try {
      for (const [tenantId, suffix] of [[tenantA, 'A'], [tenantB, 'B']] as const) {
        await admin.query(
          `INSERT INTO tenants (id,name,subdomain,tax_number,bwr_register_id)
           VALUES ($1,$2,$3,$4,$5)`,
          [tenantId,`Alarm Tenant ${suffix}`,`alarm-${suffix}-${tenantId}.test`,`ALARM-${suffix}-${tenantId}`,`BWR-${suffix}-${tenantId}`]
        );
      }
      await admin.query(
        `INSERT INTO users (id,email,password_hash,first_name,last_name)
         VALUES ($1,$2,'test-hash','Alarm','Tester')`,
        [userId,`${userId}@example.test`]
      );
      for (const [tenantId, clientId, siteId, suffix] of [
        [tenantA,clientA,siteA,'A'], [tenantB,clientB,siteB,'B']
      ] as const) {
        await admin.query(
          `INSERT INTO alarm_types (tenant_id,code,label,is_system)
           VALUES ($1,'bma','Brandmeldeanlage (BMA)',true)`,
          [tenantId]
        );
        await admin.query(
          `INSERT INTO clients (id,tenant_id,client_number,company_name,contact_person,email,phone,address,contract_start,contract_end)
           VALUES ($1,$2,$3,$4,'Test Contact',$5,'+49 30 000','Test address',DATE '2026-01-01',DATE '2027-01-01')`,
          [clientId,tenantId,`ALARM-${suffix}`,`Alarm Client ${suffix}`,`${suffix.toLowerCase()}@example.test`]
        );
        await admin.query(
          `INSERT INTO sites (id,tenant_id,client_id,site_code,name,address)
           VALUES ($1,$2,$3,$4,$5,'Test address')`,
          [siteId,tenantId,clientId,`ALARM-SITE-${suffix}`,`Alarm Site ${suffix}`]
        );
      }
      for (const [tenantId, siteId, planId, incidentId, suffix] of [
        [tenantA,siteA,planA,incidentA,'A'], [tenantB,siteB,planB,incidentB,'B']
      ] as const) {
        await admin.query(
          `INSERT INTO emergency_plans
             (id,tenant_id,customer_id,site_id,alarm_type_id,scenario,action_steps,contacts,created_by,updated_by)
           SELECT $1,$2,s.client_id,s.id,t.id,'bma','["Alarm prüfen"]'::jsonb,'[]'::jsonb,$4,$4
           FROM sites s JOIN alarm_types t ON t.tenant_id=s.tenant_id AND t.code='bma'
           WHERE s.tenant_id=$2 AND s.id=$3`,
          [planId,tenantId,siteId,userId]
        );
        await admin.query(
          `INSERT INTO alarm_incidents
             (id,tenant_id,customer_id,site_id,alarm_type_id,emergency_plan_id,scenario,severity,title,reported_by,captured_at)
           SELECT $1,$2,s.client_id,s.id,t.id,$4,'bma','Dringend',$5,$6,CURRENT_TIMESTAMP
           FROM sites s JOIN alarm_types t ON t.tenant_id=s.tenant_id AND t.code='bma'
           WHERE s.tenant_id=$2 AND s.id=$3`,
          [incidentId,tenantId,siteId,planId,`Alarm ${suffix}`,userId]
        );
        await admin.query(
          `INSERT INTO emergency_management_events
             (tenant_id,alarm_incident_id,actor_user_id,action)
           VALUES ($1,$2,$3,'incident_reported')`,
          [tenantId,incidentId,userId]
        );
        await admin.query(
          `INSERT INTO emergency_management_events
             (tenant_id,alarm_incident_id,actor_user_id,action)
           VALUES ($1,$2,$3,'incident_status_changed')`,
          [tenantId,incidentId,userId]
        );
        await admin.query(
          `INSERT INTO alarm_event_status_history
             (tenant_id,alarm_incident_id,from_status,to_status,actor_user_id,reason)
           VALUES ($1,$2,NULL,'neu',$3,'Alarm aufgenommen')`,
          [tenantId,incidentId,userId]
        );
        await admin.query(
          `INSERT INTO alarm_event_actions
             (tenant_id,alarm_incident_id,actor_user_id,action_type,description)
           VALUES ($1,$2,$3,'note','Alarm aufgenommen')`,
          [tenantId,incidentId,userId]
        );
      }
    } finally {
      await admin.end();
    }

    const app = new Client({ connectionString: withDatabaseName(db, env.DATABASE_URL) });
    await app.connect();
    try {
      await app.query('BEGIN');
      await app.query("SELECT set_config('app.current_tenant',$1,true)", [tenantA]);
      const visible = await app.query(
        `SELECT (SELECT count(*)::int FROM emergency_plans) AS plans,
                (SELECT count(*)::int FROM alarm_incidents) AS incidents,
                (SELECT count(*)::int FROM emergency_management_events) AS events,
                (SELECT count(*)::int FROM alarm_event_status_history) AS status_history,
                (SELECT count(*)::int FROM alarm_event_actions) AS actions,
                (SELECT bool_or(id=$1) FROM alarm_incidents) AS sees_tenant_b`,
        [incidentB]
      );
      expect(visible.rows[0]).toEqual({ plans: 1, incidents: 1, events: 2, status_history: 1, actions: 1, sees_tenant_b: false });
      await app.query("SELECT set_config('app.current_tenant','00000000-0000-0000-0000-000000000000',true)");
      const withoutTenant = await app.query('SELECT count(*)::int AS count FROM alarm_event_actions');
      expect(withoutTenant.rows[0].count).toBe(0);
      await app.query('ROLLBACK');
    } finally {
      await app.end();
    }

    const integrity = new Client({ connectionString: withDatabaseName(db) });
    await integrity.connect();
    try {
      await expect(integrity.query(
        `INSERT INTO emergency_plans (tenant_id,customer_id,site_id,alarm_type_id,scenario,action_steps,created_by,updated_by)
         VALUES ($1,$4,$2,(SELECT id FROM alarm_types WHERE tenant_id=$1 AND code='bma'),
           'bma','["Invalid foreign site"]'::jsonb,$3,$3)`,
        [tenantA,siteB,userId,clientA]
      )).rejects.toMatchObject({ code: '23503' });

      await expect(integrity.query(
        'UPDATE emergency_management_events SET details=$1::jsonb WHERE tenant_id=$2 AND alarm_incident_id=$3',
        ['{"tampered":true}',tenantA,incidentA]
      )).rejects.toThrow(/unveränderlich/);
      await expect(integrity.query(
        'UPDATE alarm_event_status_history SET reason=$1 WHERE tenant_id=$2 AND alarm_incident_id=$3',
        ['tampered',tenantA,incidentA]
      )).rejects.toThrow(/unveränderlich/);
    } finally {
      await integrity.end();
    }
  });

  test('2. Zweiter Lauf führt keine Migration erneut aus', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir();

    await runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger });
    const before = await historyRows(db);

    const second = await runMigrations({
      connectionString: withDatabaseName(db),
      migrationsDir: dir,
      logger: noopLogger
    });

    expect(second.applied).toEqual([]);
    expect(second.baselined).toEqual([]);
    expect(second.skipped).toEqual(['001', '002', '003', '004', '005', '006', '007', '009', '011', '012', '013', '014', '015', '016', '017', '018']);

    const after = await historyRows(db);
    expect(after).toEqual(before);
  });

  test('Permission-Migration übernimmt Legacy-Rollen sicher und ist wiederholbar', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir();
    const migrationFile = path.join(dir, '009_customer_write_permissions.sql');
    const migrationSql = fs.readFileSync(migrationFile, 'utf8');
    fs.unlinkSync(migrationFile);

    await runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger });

    const roleWithCreate = await queryInDatabase<{ id: string }>(
      db,
      `INSERT INTO roles (name) VALUES ('legacy_customer_writer') RETURNING id`
    );
    const readOnlyRole = await queryInDatabase<{ id: string }>(
      db,
      `INSERT INTO roles (name) VALUES ('legacy_customer_reader') RETURNING id`
    );
    await queryInDatabase(db, `INSERT INTO permissions (code, module) VALUES ('customers:create', 'customers'), ('customers:read', 'customers')`);
    await queryInDatabase(
      db,
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions WHERE code = 'customers:create'`,
      [roleWithCreate[0].id]
    );
    await queryInDatabase(
      db,
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions WHERE code = 'customers:read'`,
      [readOnlyRole[0].id]
    );

    const client = new Client({ connectionString: withDatabaseName(db) });
    await client.connect();
    try {
      await client.query(migrationSql);
      await client.query(migrationSql);
    } finally {
      await client.end();
    }

    const effective = await queryInDatabase<{ role: string; permission: string }>(
      db,
      `SELECT r.name AS role, p.code AS permission
       FROM role_permissions rp JOIN roles r ON r.id=rp.role_id
       JOIN permissions p ON p.id=rp.permission_id
       WHERE r.name IN ('legacy_customer_writer', 'legacy_customer_reader')
       ORDER BY r.name, p.code`
    );
    expect(effective.filter((entry) => entry.role === 'legacy_customer_writer').map((entry) => entry.permission))
      .toEqual(['customers:archive', 'customers:create', 'customers:update']);
    expect(effective.filter((entry) => entry.role === 'legacy_customer_reader').map((entry) => entry.permission))
      .toEqual(['customers:read']);
    const newPermissionCounts = await queryInDatabase<{ code: string; count: string }>(
      db,
      `SELECT p.code, COUNT(rp.role_id)::text AS count FROM permissions p
       LEFT JOIN role_permissions rp ON rp.permission_id=p.id
       WHERE p.code IN ('customers:update', 'customers:archive')
       GROUP BY p.code ORDER BY p.code`
    );
    expect(newPermissionCounts).toEqual([
      { code: 'customers:archive', count: '1' },
      { code: 'customers:update', count: '1' }
    ]);
  });

  test('Offline-Rechte-Migration übernimmt logbook:create nur für bestehende Schreiber', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir();
    const migrationFile = path.join(dir, '011_operational_sync_permissions.sql');
    const migrationSql = fs.readFileSync(path.join(REAL_MIGRATIONS_DIR, '011_operational_sync_permissions.sql'), 'utf8');
    fs.unlinkSync(migrationFile);
    await runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger });

    const legacyWriter = await queryInDatabase<{ id: string }>(db, `INSERT INTO roles (name) VALUES ('legacy_offline_writer') RETURNING id`);
    const reader = await queryInDatabase<{ id: string }>(db, `INSERT INTO roles (name) VALUES ('offline_reader') RETURNING id`);
    await queryInDatabase(db, `INSERT INTO permissions (code,module) VALUES ('logbook:create','logbook'),('logbook:read','logbook') ON CONFLICT (code) DO NOTHING`);
    await queryInDatabase(db, `INSERT INTO role_permissions (role_id,permission_id) SELECT $1,id FROM permissions WHERE code='logbook:create'`, [legacyWriter[0].id]);
    await queryInDatabase(db, `INSERT INTO role_permissions (role_id,permission_id) SELECT $1,id FROM permissions WHERE code='logbook:read'`, [reader[0].id]);

    const client = new Client({ connectionString: withDatabaseName(db) });
    await client.connect();
    try { await client.query(migrationSql); await client.query(migrationSql); } finally { await client.end(); }

    const effective = await queryInDatabase<{ role: string; permission: string }>(db,
      `SELECT r.name AS role,p.code AS permission FROM role_permissions rp JOIN roles r ON r.id=rp.role_id
       JOIN permissions p ON p.id=rp.permission_id WHERE r.name IN ('legacy_offline_writer','offline_reader') ORDER BY r.name,p.code`);
    expect(effective.filter((entry) => entry.role === 'legacy_offline_writer').map((entry) => entry.permission))
      .toEqual(['handover:create', 'logbook:create', 'patrol:create']);
    expect(effective.filter((entry) => entry.role === 'offline_reader').map((entry) => entry.permission)).toEqual(['logbook:read']);
  });

  test('3. Neue Migration wird erkannt und angewendet', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir();

    await runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger });

    fs.writeFileSync(path.join(dir, '010_neue_marker_tabelle.sql'), 'CREATE TABLE migration_marker_006 (id INT);\n');

    const second = await runMigrations({
      connectionString: withDatabaseName(db),
      migrationsDir: dir,
      logger: noopLogger
    });

    expect(second.applied).toEqual(['010']);
    expect(await tableExists(db, 'migration_marker_006')).toBe(true);

    const history = await historyRows(db);
    expect(history.map((row) => row.version)).toEqual(['001', '002', '003', '004', '005', '006', '007', '009', '010', '011', '012', '013', '014', '015', '016', '017', '018']);
  });

  test('4. Fehlerhafte Migration wird nicht registriert und zurückgerollt', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir({
      '010_fehlerhaft.sql': 'CREATE TABLE migration_failure_marker (id INT);\nSELECT * FROM tabelle_die_nicht_existiert;\n'
    });

    await expect(
      runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger })
    ).rejects.toThrow(/fehlgeschlagen und wurde zurückgerollt/);

    const history = await historyRows(db);
    expect(history.map((row) => row.version)).toEqual(['001', '002', '003', '004', '005', '006', '007', '009']);
    expect(await tableExists(db, 'migration_failure_marker')).toBe(false);
  });

  test('5. Nachträglich geänderte Migration wird abgelehnt', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir();

    await runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger });

    const file = path.join(dir, '001_initial_schema.sql');
    fs.appendFileSync(file, '\n-- nachträgliche Änderung\n');

    await expect(
      runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger })
    ).rejects.toThrow(/nachträglich verändert/);
  });

  test('6. Gleichzeitige Runner werden serialisiert und wenden jede Migration einmal an', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir({
      '010_langsam.sql': 'SELECT pg_sleep(1);\nCREATE TABLE concurrency_marker (id INT);\n'
    });

    const [first, second] = await Promise.all([
      runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger }),
      runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger })
    ]);

    const appliedSix = [first, second].filter((result) => result.applied.includes('007'));
    expect(appliedSix).toHaveLength(1);

    const rows = await queryInDatabase<{ count: string }>(
      db,
      `SELECT COUNT(*)::text AS count FROM schema_migrations WHERE version = '007'`
    );
    expect(rows[0].count).toBe('1');
    expect(await tableExists(db, 'concurrency_marker')).toBe(true);
  });

  test('7. Bestehende Datenbank mit 001–005 wird als Baseline übernommen', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir();
    const alarmMigrationPath = path.join(dir,'015_alarm_emergency_management.sql');
    const alarmMigration = fs.readFileSync(alarmMigrationPath,'utf8');
    fs.unlinkSync(alarmMigrationPath);
    const alarmLifecycleMigrationPath = path.join(dir, '016_alarm_lifecycle_and_offline.sql');
    const alarmLifecycleMigration = fs.readFileSync(alarmLifecycleMigrationPath, 'utf8');
    fs.unlinkSync(alarmLifecycleMigrationPath);
    const employeeSiteMigrationPath = path.join(dir, '014_employee_site_assignments.sql');
    const employeeSiteMigration = fs.readFileSync(employeeSiteMigrationPath, 'utf8');
    fs.unlinkSync(employeeSiteMigrationPath);
    fs.rmSync(path.join(dir, '011_operational_sync_permissions.sql'), { force: true });
    const dmsMigrationPath = path.join(dir, '012_document_management.sql');
    const dmsMigration = fs.readFileSync(dmsMigrationPath, 'utf8');
    fs.unlinkSync(dmsMigrationPath);
    const sopMigrationPath = path.join(dir, '013_sop_instructions.sql');
    const sopMigration = fs.readFileSync(sopMigrationPath, 'utf8');
    fs.unlinkSync(sopMigrationPath);
    const handoverMigrationPath = path.join(dir, '017_handover_management.sql');
    const handoverMigration = fs.readFileSync(handoverMigrationPath, 'utf8');
    fs.unlinkSync(handoverMigrationPath);
    const handoverIdentityMigrationPath = path.join(dir, '018_handover_confirmation_identity.sql');
    const handoverIdentityMigration = fs.readFileSync(handoverIdentityMigrationPath, 'utf8');
    fs.unlinkSync(handoverIdentityMigrationPath);
    const employeeMigrationPath = path.join(dir, '007_employee_lifecycle.sql');
    const employeeMigration = fs.readFileSync(employeeMigrationPath, 'utf8');
    fs.unlinkSync(employeeMigrationPath);
    await runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger });
    fs.writeFileSync(employeeMigrationPath, employeeMigration);
    fs.writeFileSync(dmsMigrationPath, dmsMigration);
    fs.writeFileSync(sopMigrationPath, sopMigration);
    fs.writeFileSync(employeeSiteMigrationPath, employeeSiteMigration);
    fs.writeFileSync(handoverMigrationPath, handoverMigration);
    fs.writeFileSync(handoverIdentityMigrationPath, handoverIdentityMigration);
    fs.writeFileSync(alarmMigrationPath, alarmMigration);
    fs.writeFileSync(alarmLifecycleMigrationPath, alarmLifecycleMigration);

    await queryInDatabase(
      db,
      `INSERT INTO tenants (name, subdomain, tax_number, bwr_register_id)
       VALUES ('Baseline-Test', 'baseline-test', 'DE-BASE-1', 'BWR-BASE-1')`
    );
    await queryInDatabase(db, 'DROP TABLE schema_migrations');

    const result = await runMigrations({
      connectionString: withDatabaseName(db),
      migrationsDir: dir,
      logger: noopLogger
    });

    expect(result.applied).toEqual(['005', '006', '007', '009', '012', '013', '014', '015', '016', '017', '018']);
    expect(result.baselined).toEqual(['001', '002', '003', '004']);

    const tenants = await queryInDatabase<{ name: string }>(db, 'SELECT name FROM tenants');
    expect(tenants.some((row) => row.name === 'Baseline-Test')).toBe(true);

    const history = await historyRows(db);
    expect(history.map((row) => row.version)).toEqual(['001', '002', '003', '004', '005', '006', '007', '009', '012', '013', '014', '015', '016', '017', '018']);
  });

  test('8. Unvollständige Baseline führt zu sicherem Abbruch', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir();
    const sql001 = fs.readFileSync(path.join(REAL_MIGRATIONS_DIR, '001_initial_schema.sql'), 'utf8');

    await queryInDatabase(db, sql001);

    await expect(
      runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger })
    ).rejects.toThrow(/nicht exakt|nicht eindeutig|unvollständig/);

    const history = await historyRows(db);
    expect(history).toHaveLength(0);
  });

  test('9. Doppelte und ungültige Versionskennungen werden erkannt', async () => {
    const duplicateDir = makeMigrationsDir({
      '010_erste.sql': 'CREATE TABLE dup_a (id INT);',
      '010_zweite.sql': 'CREATE TABLE dup_b (id INT);'
    });

    await expect(
      runMigrations({ connectionString: withDatabaseName(await createTestDatabase()), migrationsDir: duplicateDir, logger: noopLogger })
    ).rejects.toThrow(/Doppelte Migrationsversion/);

    const invalidDir = makeMigrationsDir({ 'ungueltig.sql': 'CREATE TABLE invalid (id INT);' });

    await expect(
      runMigrations({ connectionString: withDatabaseName(await createTestDatabase()), migrationsDir: invalidDir, logger: noopLogger })
    ).rejects.toThrow(/Ungültiger Migrationsdateiname/);
  });

  async function createFullBaselineDatabase(): Promise<{ db: string; dir: string }> {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir({}, [
      '014_employee_site_assignments.sql',
      '015_alarm_emergency_management.sql',
      '016_alarm_lifecycle_and_offline.sql',
      '017_handover_management.sql',
      '018_handover_confirmation_identity.sql'
    ]);
    fs.rmSync(path.join(dir, '011_operational_sync_permissions.sql'), { force: true });
    fs.rmSync(path.join(dir, '012_document_management.sql'), { force: true });
    fs.rmSync(path.join(dir, '013_sop_instructions.sql'), { force: true });
    await runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger });
    return { db, dir };
  }

  /** Entfernt die Historie, damit der Runner den Ist-Zustand erneut als Baseline prüfen muss. */
  async function expectBaselineRejected(db: string, dir: string, pattern: RegExp): Promise<void> {
    await queryInDatabase(db, 'DROP TABLE schema_migrations');
    await expect(
      runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger })
    ).rejects.toThrow(pattern);
  }

  test('10. Fehlende RLS-Policy verhindert die Baseline', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(db, 'DROP POLICY tenant_isolation_permissive ON clients');

    await expectBaselineRejected(db, dir, /RLS-Policy fehlt: clients/);
  });

  test('11. Veränderte RLS-Policy verhindert die Baseline', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(
      db,
      `DROP POLICY tenant_isolation_permissive ON clients;
       CREATE POLICY tenant_isolation_permissive ON clients
         AS PERMISSIVE FOR ALL TO PUBLIC USING (true) WITH CHECK (true);`
    );

    await expectBaselineRejected(db, dir, /RLS-Policy clients: USING-Ausdruck weicht ab/);
  });

  test('12. Trigger an falscher Tabelle verhindert die Baseline', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(
      db,
      `DROP TRIGGER trg_guardbook_entries_immutable ON guardbook_entries;
       CREATE TRIGGER trg_guardbook_entries_immutable
         BEFORE DELETE OR UPDATE ON tasks
         FOR EACH ROW EXECUTE FUNCTION prevent_guardbook_tampering();`
    );

    await expectBaselineRejected(db, dir, /Trigger trg_guardbook_entries_immutable: Tabelle "tasks"/);
  });

  test('13. Falsche Trigger-Funktion verhindert die Baseline', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(
      db,
      `DROP TRIGGER trg_guardbook_entries_immutable ON guardbook_entries;
       CREATE TRIGGER trg_guardbook_entries_immutable
         BEFORE DELETE OR UPDATE ON guardbook_entries
         FOR EACH ROW EXECUTE FUNCTION prevent_revision_tampering();`
    );

    await expectBaselineRejected(db, dir, /Trigger trg_guardbook_entries_immutable: Funktion "prevent_revision_tampering"/);
  });

  test('14. Veränderte Constraint-Definition verhindert die Baseline', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(
      db,
      `ALTER TABLE tasks DROP CONSTRAINT uq_tasks_client_mutation;
       ALTER TABLE tasks ADD CONSTRAINT uq_tasks_client_mutation UNIQUE (client_mutation_id, tenant_id);`
    );

    await expectBaselineRejected(db, dir, /Constraint uq_tasks_client_mutation: Definition weicht ab/);
  });

  test('15. Fehlende Berechtigung verhindert die Baseline', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(db, 'REVOKE DELETE ON shifts FROM secops_app_user');

    await expectBaselineRejected(db, dir, /Recht DELETE auf shifts: false statt true/);
  });

  test('16. Abweichende Berechtigung verhindert die Baseline', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(db, 'GRANT DELETE ON guardbook_entries TO secops_app_user');

    await expectBaselineRejected(db, dir, /Recht DELETE auf guardbook_entries: true statt false/);
  });

  test('17. Fehlende Baseline-Migrationsdatei wird nicht akzeptiert', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir();
    fs.rmSync(path.join(dir, '004_operational_delete_privileges.sql'));

    await expect(
      runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger })
    ).rejects.toThrow(/Baseline-Migration 004 .* fehlt/);

    const rows = await queryInDatabase<{ tbl: string | null }>(
      db,
      `SELECT to_regclass('public.schema_migrations')::text AS tbl`
    );
    expect(rows[0].tbl).toBeNull();
  });

  test('18. Abweichender Dateiname der Baseline-Migration wird nicht akzeptiert', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir();
    fs.renameSync(
      path.join(dir, '004_operational_delete_privileges.sql'),
      path.join(dir, '004_andere_datei.sql')
    );

    await expect(
      runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger })
    ).rejects.toThrow(/Baseline-Migration 004 hat den erwarteten Dateinamen/);
  });

  test('19. Bestehende Daten bleiben bei abgelehnter Baseline unverändert', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(
      db,
      `INSERT INTO tenants (name, subdomain, tax_number, bwr_register_id)
       VALUES ('Bestandsdaten', 'bestand', 'DE-BEST-1', 'BWR-BEST-1')`
    );
    await queryInDatabase(db, 'DROP POLICY tenant_isolation_permissive ON clients');

    await expectBaselineRejected(db, dir, /RLS-Policy fehlt: clients/);

    const tenants = await queryInDatabase<{ name: string }>(db, 'SELECT name FROM tenants');
    expect(tenants.some((row) => row.name === 'Bestandsdaten')).toBe(true);

    const count = await queryInDatabase<{ count: string }>(
      db,
      `SELECT COUNT(*)::text AS count FROM schema_migrations`
    );
    expect(count[0].count).toBe('0');
  });

  test('20. Abweichender Dateiname in der Historie wird abgelehnt', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(db, `UPDATE schema_migrations SET filename = '003_umbenannt.sql' WHERE version = '003'`);

    await expect(
      runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger })
    ).rejects.toThrow(/Inkonsistenter Dateiname für Version 003/);
  });

  test('21. Abweichende Versionskennung in der Historie wird abgelehnt', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(db, `UPDATE schema_migrations SET version = '3' WHERE version = '003'`);

    await expect(
      runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger })
    ).rejects.toThrow(/Inkonsistente Versionskennung: Datenbank meldet "3"/);
  });

  test('22. Zusätzliche permissive RLS-Policy verhindert die Baseline', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(
      db,
      `CREATE POLICY extra_permissive ON clients
         AS PERMISSIVE FOR SELECT TO PUBLIC USING (true)`
    );

    await expectBaselineRejected(db, dir, /RLS-Policy clients: 2 Policies gefunden .*extra_permissive.*PERMISSIVE/);
  });

  test('23. Zusätzliche restrictive RLS-Policy verhindert die Baseline', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(
      db,
      `CREATE POLICY extra_restrictive ON clients
         AS RESTRICTIVE FOR SELECT TO PUBLIC USING (true)`
    );

    await expectBaselineRejected(db, dir, /RLS-Policy clients: 2 Policies gefunden .*extra_restrictive.*RESTRICTIVE/);
  });

  test('24. Mehrere zusätzliche Policies werden vollständig erkannt', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(
      db,
      `CREATE POLICY extra_a ON clients AS PERMISSIVE FOR SELECT TO PUBLIC USING (true);
       CREATE POLICY extra_b ON clients AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (true);`
    );

    await expectBaselineRejected(
      db,
      dir,
      /RLS-Policy clients: 3 Policies gefunden .*extra_a.*extra_b/
    );
  });

  test('25. Eine tatsächlich leere Datenbank wird weiterhin akzeptiert', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir();

    const result = await runMigrations({
      connectionString: withDatabaseName(db),
      migrationsDir: dir,
      logger: noopLogger
    });

    expect(result.applied).toEqual(['001', '002', '003', '004', '005', '006', '007', '009', '011', '012', '013', '014', '015', '016', '017', '018']);
    expect(result.baselined).toEqual([]);
    expect((await historyRows(db))).toHaveLength(16);
  });

  test('26. Fremde Tabelle verhindert die Einstufung als leere Datenbank', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir();
    await queryInDatabase(db, `CREATE TABLE fremde_tabelle (id INT); INSERT INTO fremde_tabelle VALUES (1);`);

    await expect(
      runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger })
    ).rejects.toThrow(/Unerwartetes Objekt im Schema public: Tabelle "fremde_tabelle"/);

    const rows = await queryInDatabase<{ count: string }>(db, 'SELECT COUNT(*)::text AS count FROM fremde_tabelle');
    expect(rows[0].count).toBe('1');
  });

  test('27. Vorhandene View ohne erwartete Tabellen verhindert die Einstufung als leer', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir();
    await queryInDatabase(db, 'CREATE VIEW fremde_view AS SELECT 1 AS x');

    await expect(
      runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger })
    ).rejects.toThrow(/Unerwartetes Objekt im Schema public: View "fremde_view"/);
  });

  test('28. Bestehende Daten bleiben bei abgelehnter Leer-Erkennung unverändert', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir();
    await queryInDatabase(db, `CREATE TABLE bestandsdaten (id INT, wert TEXT); INSERT INTO bestandsdaten VALUES (1, 'bleibt');`);

    await expect(
      runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger })
    ).rejects.toThrow(/Unerwartetes Objekt im Schema public/);

    const rows = await queryInDatabase<{ wert: string }>(db, 'SELECT wert FROM bestandsdaten');
    expect(rows[0].wert).toBe('bleibt');

    const count = await queryInDatabase<{ count: string }>(
      db,
      `SELECT COUNT(*)::text AS count FROM schema_migrations`
    );
    expect(count[0].count).toBe('0');
  });

  test('29. Echte Fremdtabelle (file_fdw) verhindert die Einstufung als leere Datenbank', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir();
    const csvPath = `/tmp/secops_fdw_${db}.csv`;

    // Echter Foreign-Data-Wrapper + Foreign Server + Foreign Table im Schema public.
    // Der Test läuft ausschließlich in einer isolierten Testdatenbank mit der
    // administrativen (Superuser-)Rolle der ephemeren PostgreSQL-Instanz.
    await queryInDatabase(db, `
      CREATE EXTENSION IF NOT EXISTS file_fdw;
      CREATE SERVER secops_file_server FOREIGN DATA WRAPPER file_fdw;
      COPY (SELECT 1 AS id, 'fdw-zeile' AS name) TO '${csvPath}' WITH (FORMAT csv, HEADER true);
      CREATE FOREIGN TABLE fremde_fdw_tabelle (id INT, name TEXT)
        SERVER secops_file_server
        OPTIONS (filename '${csvPath}', format 'csv', header 'true');
    `);

    const before = await queryInDatabase<{ relkind: string }>(
      db,
      `SELECT relkind FROM pg_class
        WHERE relname = 'fremde_fdw_tabelle' AND relnamespace = 'public'::regnamespace`
    );
    expect(before).toHaveLength(1);
    expect(before[0].relkind).toBe('f');

    await expect(
      runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger })
    ).rejects.toThrow(/Unerwartetes Objekt im Schema public: Fremdtabelle "fremde_fdw_tabelle"/);

    // Keine Migration darf als ausgeführt eingetragen worden sein.
    const history = await queryInDatabase<{ count: string }>(
      db,
      `SELECT COUNT(*)::text AS count FROM schema_migrations`
    );
    expect(history[0].count).toBe('0');

    // Die Fremdtabelle muss nach dem Abbruch unverändert vorhanden und nutzbar sein.
    const after = await queryInDatabase<{ relkind: string }>(
      db,
      `SELECT relkind FROM pg_class
        WHERE relname = 'fremde_fdw_tabelle' AND relnamespace = 'public'::regnamespace`
    );
    expect(after).toHaveLength(1);
    expect(after[0].relkind).toBe('f');

    const rows = await queryInDatabase<{ id: number; name: string }>(db, 'SELECT id, name FROM fremde_fdw_tabelle');
    expect(rows).toEqual([{ id: 1, name: 'fdw-zeile' }]);
  });

  test('30. Eigenständiger Composite Type verhindert die Einstufung als leere Datenbank', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir();
    await queryInDatabase(db, 'CREATE TYPE fremder_composite AS (a INT, b TEXT)');

    let message: string | null = null;
    try {
      await runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBeTruthy();
    expect(message).toMatch(/Zusammengesetzter Typ "fremder_composite"/);
    // Der Zeilentyp darf nicht zusätzlich als Tabelle/Relation gemeldet werden.
    expect(message!.split('Zusammengesetzter Typ "fremder_composite"').length - 1).toBe(1);

    const type = await queryInDatabase<{ typname: string | null }>(
      db,
      `SELECT to_regtype('public.fremder_composite')::text AS typname`
    );
    expect(type[0].typname).toBe('fremder_composite');

    const history = await queryInDatabase<{ count: string }>(
      db,
      `SELECT COUNT(*)::text AS count FROM schema_migrations`
    );
    expect(history[0].count).toBe('0');
  });

  test('31. Eigenständiger Range Type verhindert die Einstufung als leere Datenbank', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir();
    await queryInDatabase(db, 'CREATE TYPE fremder_range AS RANGE (subtype = int4)');

    let message: string | null = null;
    try {
      await runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBeTruthy();
    expect(message).toMatch(/Range-Typ "fremder_range"/);

    const type = await queryInDatabase<{ typname: string | null }>(
      db,
      `SELECT to_regtype('public.fremder_range')::text AS typname`
    );
    expect(type[0].typname).toBe('fremder_range');
  });

  test('32. Multirange Type (PostgreSQL 16) wird erkannt', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir();
    await queryInDatabase(db, 'CREATE TYPE fremder_range AS RANGE (subtype = int4)');

    const multirange = await queryInDatabase<{ typname: string; typtype: string }>(
      db,
      `SELECT typname, typtype FROM pg_type
        WHERE typnamespace = 'public'::regnamespace AND typname = 'fremder_multirange'`
    );
    expect(multirange).toHaveLength(1);
    expect(multirange[0].typtype).toBe('m');

    let message: string | null = null;
    try {
      await runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBeTruthy();
    expect(message).toMatch(/Multirange-Typ "fremder_multirange"/);
  });

  test('33. Bestehende Objekte bleiben bei abgelehntem Composite Type unverändert', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir();
    await queryInDatabase(
      db,
      `CREATE TYPE bestands_typ AS (id INT);
       CREATE TABLE bestandsdaten (id INT, wert TEXT);
       INSERT INTO bestandsdaten VALUES (1, 'bleibt');`
    );

    await expect(
      runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger })
    ).rejects.toThrow(/Zusammengesetzter Typ "bestands_typ"/);

    const type = await queryInDatabase<{ typname: string | null }>(
      db,
      `SELECT to_regtype('public.bestands_typ')::text AS typname`
    );
    expect(type[0].typname).toBe('bestands_typ');

    const rows = await queryInDatabase<{ wert: string }>(db, 'SELECT wert FROM bestandsdaten');
    expect(rows[0].wert).toBe('bleibt');

    const history = await queryInDatabase<{ count: string }>(
      db,
      `SELECT COUNT(*)::text AS count FROM schema_migrations`
    );
    expect(history[0].count).toBe('0');
  });

  async function captureMigrationError(db: string, dir: string): Promise<string> {
    try {
      await runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger });
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    throw new Error('Runner hätte die Baseline ablehnen müssen, hat sie aber akzeptiert.');
  }

  test('34. Korrekte bestehende SecurityOps-Baseline wird weiterhin akzeptiert', async () => {
    const { db, dir } = await createFullBaselineDatabase();

    const result = await runMigrations({
      connectionString: withDatabaseName(db),
      migrationsDir: dir,
      logger: noopLogger
    });

    expect(result.applied).toEqual([]);
    expect(result.baselined).toEqual([]);
    expect(result.skipped).toEqual(['001', '002', '003', '004', '005', '006', '007', '009']);
  });

  test('35. Zusätzlicher Composite Type in gültiger Baseline wird erkannt', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(db, 'CREATE TYPE zusatz_composite AS (a INT)');

    const message = await captureMigrationError(db, dir);
    expect(message).toMatch(/Zusammengesetzter Typ "zusatz_composite"/);

    const type = await queryInDatabase<{ typname: string | null }>(
      db,
      `SELECT to_regtype('public.zusatz_composite')::text AS typname`
    );
    expect(type[0].typname).toBe('zusatz_composite');

    const history = await queryInDatabase<{ count: string }>(
      db,
      `SELECT COUNT(*)::text AS count FROM schema_migrations`
    );
    expect(history[0].count).toBe('8');
  });

  test('36. Zusätzlicher Range Type in gültiger Baseline wird erkannt', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(db, 'CREATE TYPE zusatz_range AS RANGE (subtype = int4)');

    const message = await captureMigrationError(db, dir);
    expect(message).toMatch(/Range-Typ "zusatz_range"/);
    // PostgreSQL legt automatisch einen Multirange-Typ an.
    expect(message).toMatch(/Multirange-Typ "zusatz_multirange"/);

    const type = await queryInDatabase<{ typname: string | null }>(
      db,
      `SELECT to_regtype('public.zusatz_range')::text AS typname`
    );
    expect(type[0].typname).toBe('zusatz_range');
  });

  test('37. Zusätzlicher Multirange Type in gültiger Baseline wird erkannt', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(db, 'CREATE TYPE zusatz_range AS RANGE (subtype = int4)');

    const multirange = await queryInDatabase<{ typtype: string }>(
      db,
      `SELECT typtype FROM pg_type
        WHERE typnamespace = 'public'::regnamespace AND typname = 'zusatz_multirange'`
    );
    expect(multirange).toHaveLength(1);
    expect(multirange[0].typtype).toBe('m');

    const message = await captureMigrationError(db, dir);
    expect(message).toMatch(/Multirange-Typ "zusatz_multirange"/);
  });

  test('38. Daten und Objekte bleiben nach abgelehnter Baseline unverändert', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(
      db,
      `INSERT INTO tenants (name, subdomain, tax_number, bwr_register_id)
       VALUES ('Bestand', 'bestand-typ', 'DE-TYP-1', 'BWR-TYP-1')`
    );
    const before = await historyRows(db);
    await queryInDatabase(db, 'CREATE TYPE bestands_typ AS (id INT)');

    const message = await captureMigrationError(db, dir);
    expect(message).toMatch(/Zusammengesetzter Typ "bestands_typ"/);

    const tenants = await queryInDatabase<{ name: string }>(db, 'SELECT name FROM tenants');
    expect(tenants.some((row) => row.name === 'Bestand')).toBe(true);

    const type = await queryInDatabase<{ typname: string | null }>(
      db,
      `SELECT to_regtype('public.bestands_typ')::text AS typname`
    );
    expect(type[0].typname).toBe('bestands_typ');

    const after = await historyRows(db);
    expect(after).toEqual(before);
  });

  test('39. Keine doppelten Meldungen für automatisch erzeugte Tabellen-Zeilentypen', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(db, 'CREATE TYPE einzel_typ AS (a INT)');

    const message = await captureMigrationError(db, dir);
    expect(message.split('Zusammengesetzter Typ "einzel_typ"').length - 1).toBe(1);
    expect(message).not.toMatch(/Zusammengesetzter Typ "tasks"/);
    expect(message).not.toMatch(/"schema_migrations"/);
  });

  test('40. Erweiterungstypen erzeugen keinen Fehlalarm', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    // citext legt einen Basistyp + Array-Typ in public an; beides ist erlaubt.
    await queryInDatabase(db, 'CREATE EXTENSION IF NOT EXISTS citext');

    const result = await runMigrations({
      connectionString: withDatabaseName(db),
      migrationsDir: dir,
      logger: noopLogger
    });

    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual(['001', '002', '003', '004', '005', '006', '007', '009']);
  });

  test('41. Zusätzliche Tabelle in gültiger Baseline wird erkannt', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(db, 'CREATE TABLE fremde_tabelle (id INT)');

    const message = await captureMigrationError(db, dir);
    expect(message).toMatch(/Unerwartetes Objekt im Schema public: Tabelle "fremde_tabelle"/);
    expect(await historyRows(db)).toHaveLength(8);
  });

  test('42. Zusätzliche View in gültiger Baseline wird erkannt', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(db, 'CREATE VIEW fremde_view AS SELECT 1 AS x');

    const message = await captureMigrationError(db, dir);
    expect(message).toMatch(/Unerwartetes Objekt im Schema public: View "fremde_view"/);
    expect(await historyRows(db)).toHaveLength(8);
  });

  test('43. Zusätzliche Sequenz in gültiger Baseline wird erkannt', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(db, 'CREATE SEQUENCE fremde_sequenz');

    const message = await captureMigrationError(db, dir);
    expect(message).toMatch(/Unerwartetes Objekt im Schema public: Sequenz "fremde_sequenz"/);
    expect(await historyRows(db)).toHaveLength(8);
  });

  test('44. Zusätzliche Funktion in gültiger Baseline wird erkannt', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(db, `CREATE FUNCTION fremde_funktion() RETURNS integer LANGUAGE sql AS 'SELECT 1'`);

    const message = await captureMigrationError(db, dir);
    expect(message).toMatch(/Unerwartetes Objekt im Schema public: Funktion\/Prozedur "fremde_funktion"/);
    expect(await historyRows(db)).toHaveLength(8);
  });

  test('45. Daten und Migrationseinträge bleiben nach abgelehnter Baseline unverändert', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(
      db,
      `INSERT INTO tenants (name, subdomain, tax_number, bwr_register_id)
       VALUES ('Bestandsobjekt', 'bestand-objekt', 'DE-OBJ-1', 'BWR-OBJ-1')`
    );
    const before = await historyRows(db);

    await queryInDatabase(
      db,
      `CREATE TABLE bestandstabelle (id INT);
       INSERT INTO bestandstabelle VALUES (1);`
    );

    const message = await captureMigrationError(db, dir);
    expect(message).toMatch(/Unerwartetes Objekt im Schema public: Tabelle "bestandstabelle"/);

    const tenants = await queryInDatabase<{ name: string }>(db, 'SELECT name FROM tenants');
    expect(tenants.some((row) => row.name === 'Bestandsobjekt')).toBe(true);

    const rows = await queryInDatabase<{ id: number }>(db, 'SELECT id FROM bestandstabelle');
    expect(rows).toEqual([{ id: 1 }]);

    const after = await historyRows(db);
    expect(after).toEqual(before);
  });

  test('46. Gültige Datenbank mit zusätzlicher Migration 007 wird akzeptiert', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir({ '010_neue_tabelle.sql': 'CREATE TABLE neue_tabelle (id INT);' });

    const first = await runMigrations({
      connectionString: withDatabaseName(db),
      migrationsDir: dir,
      logger: noopLogger
    });
    expect(first.applied).toEqual(['001', '002', '003', '004', '005', '006', '007', '009', '010', '011', '012', '013', '014', '015', '016', '017', '018']);

    const second = await runMigrations({
      connectionString: withDatabaseName(db),
      migrationsDir: dir,
      logger: noopLogger
    });
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(['001', '002', '003', '004', '005', '006', '007', '009', '010', '011', '012', '013', '014', '015', '016', '017', '018']);
  });

  test('47. Fremdes Objekt bei Migration oberhalb 004 wird erkannt', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir({ '010_neue_tabelle.sql': 'CREATE TABLE neue_tabelle (id INT);' });

    await runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger });
    await queryInDatabase(db, 'CREATE TABLE fremd_tabelle (id INT)');

    const message = await captureMigrationError(db, dir);
    expect(message).toMatch(/Unerwartetes Objekt im Schema public: Tabelle "fremd_tabelle"/);
    expect(message).not.toMatch(/"neue_tabelle"/);
    expect(await historyRows(db)).toHaveLength(17);
  });

  test('48. Fremde Funktion mit gleichem Namen, aber anderer Signatur wird erkannt', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(
      db,
      `CREATE FUNCTION prevent_guardbook_tampering(x integer) RETURNS integer LANGUAGE sql AS 'SELECT $1'`
    );

    const message = await captureMigrationError(db, dir);
    expect(message).toMatch(
      /Unerwartetes Objekt im Schema public: Funktion\/Prozedur "prevent_guardbook_tampering" mit Signatur "prevent_guardbook_tampering\(integer\)"/
    );
  });

  test('49. View anstelle einer erwarteten Tabelle wird erkannt', async () => {
    const { db, dir } = await createFullBaselineDatabase();
    await queryInDatabase(db, 'DROP TABLE audit_logs CASCADE; CREATE VIEW audit_logs AS SELECT 1 AS id;');

    const message = await captureMigrationError(db, dir);
    expect(message).toMatch(/Relation "audit_logs" hat Typ "View" statt "Tabelle"/);
  });

  test('50. Daten und Migrationseinträge bleiben bei Objektabweichung unverändert', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir({ '010_neue_tabelle.sql': 'CREATE TABLE neue_tabelle (id INT);' });

    await runMigrations({ connectionString: withDatabaseName(db), migrationsDir: dir, logger: noopLogger });
    await queryInDatabase(
      db,
      `INSERT INTO tenants (name, subdomain, tax_number, bwr_register_id)
       VALUES ('Bestand', 'bestand-529', 'DE-529-1', 'BWR-529-1')`
    );
    const before = await historyRows(db);

    await queryInDatabase(db, 'CREATE TABLE fremd_tabelle (id INT); INSERT INTO fremd_tabelle VALUES (1);');

    const message = await captureMigrationError(db, dir);
    expect(message).toMatch(/Tabelle "fremd_tabelle"/);

    const tenants = await queryInDatabase<{ name: string }>(db, 'SELECT name FROM tenants');
    expect(tenants.some((row) => row.name === 'Bestand')).toBe(true);

    const rows = await queryInDatabase<{ id: number }>(db, 'SELECT id FROM fremd_tabelle');
    expect(rows).toEqual([{ id: 1 }]);

    const after = await historyRows(db);
    expect(after).toEqual(before);
  });

  test('51. Migration mit Kommentarzeichen in Zeichenketten wird korrekt erkannt', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir({
      '010_kommentar.sql': `CREATE TABLE kommentar_tabelle (id INT, note TEXT DEFAULT '-- kein Kommentar /* auch nicht */');`
    });

    const first = await runMigrations({
      connectionString: withDatabaseName(db),
      migrationsDir: dir,
      logger: noopLogger
    });
    expect(first.applied).toContain('007');

    const second = await runMigrations({
      connectionString: withDatabaseName(db),
      migrationsDir: dir,
      logger: noopLogger
    });
    expect(second.applied).toEqual([]);
    expect(await tableExists(db, 'kommentar_tabelle')).toBe(true);
  });

  test('52. Dollar-quoted Funktionskörper mit Fake-DDL wird nicht als Objekt erkannt', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir({
      '010_funktion.sql': `
        CREATE FUNCTION body_fn() RETURNS void LANGUAGE plpgsql AS $body$
        BEGIN
          -- CREATE TABLE fake_table (id int);
          /* CREATE TABLE fake_table2 (id int); */
          RAISE NOTICE 'CREATE TABLE fake_table3 (id int)';
        END
        $body$;
      `
    });

    const first = await runMigrations({
      connectionString: withDatabaseName(db),
      migrationsDir: dir,
      logger: noopLogger
    });
    expect(first.applied).toContain('007');

    const second = await runMigrations({
      connectionString: withDatabaseName(db),
      migrationsDir: dir,
      logger: noopLogger
    });
    expect(second.applied).toEqual([]);
    expect(await tableExists(db, 'fake_table')).toBe(false);

    const functions = await queryInDatabase<{ proname: string }>(
      db,
      `SELECT p.proname FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'body_fn'`
    );
    expect(functions).toHaveLength(1);
  });

  test('53. Gequotete und schemaqualifizierte Objekte werden korrekt zugeordnet', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir({
      '010_quoted.sql': `
        CREATE SCHEMA IF NOT EXISTS anderesschema;
        CREATE TABLE public."NeueTabelle" (id INT);
        CREATE TABLE "Tasks" (id INT);
        CREATE TABLE anderesschema.priv_table (id INT);
      `
    });

    const first = await runMigrations({
      connectionString: withDatabaseName(db),
      migrationsDir: dir,
      logger: noopLogger
    });
    expect(first.applied).toContain('007');

    const second = await runMigrations({
      connectionString: withDatabaseName(db),
      migrationsDir: dir,
      logger: noopLogger
    });
    expect(second.applied).toEqual([]);

    expect(await tableExists(db, 'NeueTabelle')).toBe(true);
    expect(await tableExists(db, 'Tasks')).toBe(true);
    expect(await tableExists(db, 'priv_table')).toBe(false);
  });

  test('54. DEFAULT-, VARIADIC- und benutzerdefinierte Parametertypen werden korrekt verglichen', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir({
      '010_parameter.sql': `
        CREATE TYPE param_typ AS ENUM ('a');
        CREATE FUNCTION def_fn(x integer DEFAULT 5, y integer DEFAULT 6)
          RETURNS integer LANGUAGE sql AS 'SELECT 1';
        CREATE FUNCTION var_fn(VARIADIC y param_typ[])
          RETURNS integer LANGUAGE sql AS 'SELECT 1';
        CREATE FUNCTION nested_fn(a numeric(10,2), b text)
          RETURNS integer LANGUAGE sql AS 'SELECT 1';
      `
    });

    const first = await runMigrations({
      connectionString: withDatabaseName(db),
      migrationsDir: dir,
      logger: noopLogger
    });
    expect(first.applied).toContain('007');

    const second = await runMigrations({
      connectionString: withDatabaseName(db),
      migrationsDir: dir,
      logger: noopLogger
    });
    expect(second.applied).toEqual([]);

    await queryInDatabase(
      db,
      `CREATE FUNCTION def_fn(x text) RETURNS integer LANGUAGE sql AS 'SELECT 1'`
    );

    const message = await captureMigrationError(db, dir);
    expect(message).toMatch(/def_fn\(text\)/);
  });

  test('55. Gequotete und schemaqualifizierte Parametertypen werden korrekt verglichen', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir({
      '010_quoted_params.sql': `
        CREATE SCHEMA "MeinSchema";
        CREATE TYPE "MeinSchema"."MeinTyp" AS ENUM ('a');
        CREATE TYPE public."OeffentlicherTyp" AS ENUM ('b');
        CREATE FUNCTION quoted_fn("Parametername" "MeinSchema"."MeinTyp")
          RETURNS integer LANGUAGE sql AS 'SELECT 1';
        CREATE FUNCTION quoted_fn2("Parametername" public."OeffentlicherTyp")
          RETURNS integer LANGUAGE sql AS 'SELECT 1';
        CREATE FUNCTION quoted_fn3("Parametername" integer)
          RETURNS integer LANGUAGE sql AS 'SELECT 1';
        CREATE FUNCTION array_fn(x integer[])
          RETURNS integer LANGUAGE sql AS 'SELECT 1';
        CREATE FUNCTION numeric_fn(x numeric(10,2))
          RETURNS integer LANGUAGE sql AS 'SELECT 1';
        CREATE FUNCTION overload_fn(x "MeinSchema"."MeinTyp")
          RETURNS integer LANGUAGE sql AS 'SELECT 1';
        CREATE FUNCTION overload_fn(x public."OeffentlicherTyp")
          RETURNS integer LANGUAGE sql AS 'SELECT 1';
      `
    });

    const first = await runMigrations({
      connectionString: withDatabaseName(db),
      migrationsDir: dir,
      logger: noopLogger
    });
    expect(first.applied).toContain('007');

    const second = await runMigrations({
      connectionString: withDatabaseName(db),
      migrationsDir: dir,
      logger: noopLogger
    });
    expect(second.applied).toEqual([]);

    await queryInDatabase(
      db,
      `CREATE FUNCTION quoted_fn(x integer) RETURNS integer LANGUAGE sql AS 'SELECT 1'`
    );

    const message = await captureMigrationError(db, dir);
    expect(message).toMatch(/quoted_fn\(integer\)/);
  });

  test('56. Typmodifikatoren bei quoted und schemaqualifizierten Typen werden korrekt verglichen', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir({
      '010_typmods.sql': `
        CREATE SCHEMA "MeinSchema";
        CREATE TYPE "MeinSchema"."MeinTyp" AS ENUM ('a');
        CREATE TYPE public."OeffentlicherTyp" AS ENUM ('b');
        CREATE FUNCTION mod_fn(x numeric(10,2), y varchar(255))
          RETURNS integer LANGUAGE sql AS 'SELECT 1';
        CREATE FUNCTION quoted_mod_fn(x "MeinSchema"."MeinTyp", y public."OeffentlicherTyp")
          RETURNS integer LANGUAGE sql AS 'SELECT 1';
        CREATE FUNCTION array_mod_fn(x numeric(10,2)[], y integer[])
          RETURNS integer LANGUAGE sql AS 'SELECT 1';
        CREATE FUNCTION overload_mod(x numeric(10,2))
          RETURNS integer LANGUAGE sql AS 'SELECT 1';
        CREATE FUNCTION overload_mod(x integer)
          RETURNS integer LANGUAGE sql AS 'SELECT 1';
      `
    });

    const first = await runMigrations({
      connectionString: withDatabaseName(db),
      migrationsDir: dir,
      logger: noopLogger
    });
    expect(first.applied).toContain('007');

    const second = await runMigrations({
      connectionString: withDatabaseName(db),
      migrationsDir: dir,
      logger: noopLogger
    });
    expect(second.applied).toEqual([]);

    await queryInDatabase(
      db,
      `CREATE FUNCTION mod_fn(x integer) RETURNS integer LANGUAGE sql AS 'SELECT 1'`
    );

    const message = await captureMigrationError(db, dir);
    expect(message).toMatch(/mod_fn\(integer\)/);
  });

  test('57. Array-Typ-Aliase und mehrdimensionale Arrays werden korrekt verglichen', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir({
      '010_array_aliases.sql': `
        CREATE SCHEMA "MeinSchema";
        CREATE TYPE "MeinSchema"."MeinTyp" AS ENUM ('a');
        CREATE FUNCTION alias_array_fn(x int[], y varchar(255)[])
          RETURNS integer LANGUAGE sql AS 'SELECT 1';
        CREATE FUNCTION multi_array_fn(x int[][])
          RETURNS integer LANGUAGE sql AS 'SELECT 1';
        CREATE FUNCTION quoted_array_fn(x "MeinSchema"."MeinTyp"[])
          RETURNS integer LANGUAGE sql AS 'SELECT 1';
        CREATE FUNCTION overload_array_fn(x int[])
          RETURNS integer LANGUAGE sql AS 'SELECT 1';
        CREATE FUNCTION overload_array_fn(x varchar(255)[])
          RETURNS integer LANGUAGE sql AS 'SELECT 1';
      `
    });

    const first = await runMigrations({
      connectionString: withDatabaseName(db),
      migrationsDir: dir,
      logger: noopLogger
    });
    expect(first.applied).toContain('007');

    const second = await runMigrations({
      connectionString: withDatabaseName(db),
      migrationsDir: dir,
      logger: noopLogger
    });
    expect(second.applied).toEqual([]);

    await queryInDatabase(
      db,
      `CREATE FUNCTION alias_array_fn(x integer[]) RETURNS integer LANGUAGE sql AS 'SELECT 1'`
    );

    const message = await captureMigrationError(db, dir);
    expect(message).toMatch(/alias_array_fn\(integer\[\]\)/);
  });

  test('58. Vollständige Alias-Normalisierung wird von PostgreSQL 16 bestätigt', async () => {
    const db = await createTestDatabase();
    const dir = makeMigrationsDir({
      '010_aliases.sql': `
        CREATE FUNCTION alias_canonical_fn(
          a int, b integer, c int2, d smallint, e int8, f bigint,
          g float(24), h real, i float, j double precision,
          k varchar(10), l character varying(20), m varbit(5), n bpchar,
          o timestamptz, p timestamp with time zone, q timetz, r time with time zone
        ) RETURNS integer LANGUAGE sql AS 'SELECT 1';
        CREATE FUNCTION overload_alias_fn(x int) RETURNS integer LANGUAGE sql AS 'SELECT 1';
        CREATE FUNCTION overload_alias_fn(x bigint) RETURNS integer LANGUAGE sql AS 'SELECT 1';
        CREATE FUNCTION overload_alias_fn(x varchar(10)) RETURNS integer LANGUAGE sql AS 'SELECT 1';
        CREATE FUNCTION overload_alias_fn(x text) RETURNS integer LANGUAGE sql AS 'SELECT 1';
      `
    });

    const first = await runMigrations({
      connectionString: withDatabaseName(db),
      migrationsDir: dir,
      logger: noopLogger
    });
    expect(first.applied).toContain('007');

    const second = await runMigrations({
      connectionString: withDatabaseName(db),
      migrationsDir: dir,
      logger: noopLogger
    });
    expect(second.applied).toEqual([]);

    await queryInDatabase(
      db,
      `CREATE FUNCTION alias_canonical_fn(x bigint) RETURNS integer LANGUAGE sql AS 'SELECT 1'`
    );

    const message = await captureMigrationError(db, dir);
    expect(message).toMatch(/alias_canonical_fn\(bigint\)/);
  });
});
