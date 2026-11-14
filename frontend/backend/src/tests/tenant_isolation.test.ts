import { pool, migrationPool, withTenantTransaction, withSystemTransaction } from '../config/database';
import { cleanupTestData } from './testUtils';

describe('PostgreSQL Row-Level Security (RLS) & Multi-Tenant Isolation', () => {
  let tenantA: string;
  let tenantB: string;
  let employeeAId: string;
  let employeeBId: string;
  let sopUserAId: string;
  let sopUserBId: string;
  let sopAId: string;
  let sopA2Id: string;
  let sopBId: string;
  let assignmentAId: string;
  let versionA2Id: string;
  let planningPeriodAId: string;
  let planningShiftAId: string;
  let coverRequestAId: string;
  let actualTimeAId: string;
  let actualTimeRevisionAId: string;
  let planningNotificationAId: string;

  beforeAll(async () => {
    const tA = await pool.query(`
      INSERT INTO tenants (name, subdomain, tax_number, bwr_register_id)
      VALUES ('RLS Test Mandant A', $1, 'DE-RLS-A', 'BWR-RLS-A') RETURNING id;
    `, [`rls-a-${Date.now()}`]);
    tenantA = tA.rows[0].id;

    const tB = await pool.query(`
      INSERT INTO tenants (name, subdomain, tax_number, bwr_register_id)
      VALUES ('RLS Test Mandant B', $1, 'DE-RLS-B', 'BWR-RLS-B') RETURNING id;
    `, [`rls-b-${Date.now()}`]);
    tenantB = tB.rows[0].id;

    await withTenantTransaction(tenantA, async (tx) => {
      await tx.query(`
        INSERT INTO clients (tenant_id, client_number, company_name, contact_person, email, phone, address, contract_start, contract_end)
        VALUES ($1, 'K-A-1', 'A GmbH', 'Hr. A', 'a@a.de', '01', 'Adr A', '2025-01-01', '2026-01-01');
      `, [tenantA]);
    });

    await withTenantTransaction(tenantB, async (tx) => {
      await tx.query(`
        INSERT INTO clients (tenant_id, client_number, company_name, contact_person, email, phone, address, contract_start, contract_end)
        VALUES ($1, 'K-B-1', 'B GmbH', 'Hr. B', 'b@b.de', '02', 'Adr B', '2025-01-01', '2026-01-01');
      `, [tenantB]);
    });

    const employeeA = await migrationPool.query(`
      INSERT INTO employees (tenant_id, personnel_number, first_name, last_name, email, phone, role, date_of_joining)
      VALUES ($1, $2, 'Wache', 'A', 'wache-a@example.test', '+49 30 1', 'Wachdienstmitarbeiter', '2026-01-01') RETURNING id
    `, [tenantA, 'RLS-A-' + Date.now()]);
    const employeeB = await migrationPool.query(`
      INSERT INTO employees (tenant_id, personnel_number, first_name, last_name, email, phone, role, date_of_joining)
      VALUES ($1, $2, 'Wache', 'B', 'wache-b@example.test', '+49 30 2', 'Wachdienstmitarbeiter', '2026-01-01') RETURNING id
    `, [tenantB, 'RLS-B-' + Date.now()]);
    employeeAId = employeeA.rows[0].id;
    employeeBId = employeeB.rows[0].id;
    await migrationPool.query(`
      INSERT INTO employee_absences (tenant_id, employee_id, absence_type, date_from, date_to)
      VALUES ($1, $2, 'VACATION', '2026-12-20', '2026-12-22'), ($3, $4, 'SICKNESS', '2026-12-23', '2026-12-24')
    `, [tenantA, employeeA.rows[0].id, tenantB, employeeB.rows[0].id]);

    const userA = await migrationPool.query(
      `INSERT INTO users (email,password_hash,first_name,last_name)
       VALUES ($1,'unused-test-hash','SOP','A') RETURNING id`,
      [`sop-rls-a-${Date.now()}@example.test`]
    );
    const userB = await migrationPool.query(
      `INSERT INTO users (email,password_hash,first_name,last_name)
       VALUES ($1,'unused-test-hash','SOP','B') RETURNING id`,
      [`sop-rls-b-${Date.now()}@example.test`]
    );
    sopUserAId = userA.rows[0].id;
    sopUserBId = userB.rows[0].id;
    const planningRole = await migrationPool.query(
      `INSERT INTO roles (name,description) VALUES ($1,'Planning notification RLS fixture') RETURNING id`,
      [`PlanningRls_${Date.now()}`]
    );
    await migrationPool.query(
      `INSERT INTO user_roles (user_id,role_id,tenant_id) VALUES ($1,$2,$3),($4,$2,$5)`,
      [sopUserAId, planningRole.rows[0].id, tenantA, sopUserBId, tenantB]
    );
    const planningPeriod = await migrationPool.query(
      `INSERT INTO schedule_periods (tenant_id,name,date_from,date_to,time_zone,created_by)
       VALUES ($1,$2,'2026-01-01','2026-01-31','Europe/Berlin',$3) RETURNING id`,
      [tenantA, `RLS-Planning-${Date.now()}`, sopUserAId]
    );
    planningPeriodAId = planningPeriod.rows[0].id;
    const clientA = await migrationPool.query('SELECT id FROM clients WHERE tenant_id=$1 LIMIT 1', [tenantA]);
    const siteA = await migrationPool.query(
      `INSERT INTO sites (tenant_id,client_id,site_code,name,address,time_zone)
       VALUES ($1,$2,$3,'RLS Planning Site','Test address','Europe/Berlin') RETURNING id`,
      [tenantA, clientA.rows[0].id, `RLS-${Date.now()}`]
    );
    const shiftA = await migrationPool.query(
      `INSERT INTO shifts
        (tenant_id,site_id,shift_date,start_time,end_time,required_qualification,revision_version)
       VALUES ($1,$2,'2026-01-02','08:00','16:00','Security',1) RETURNING id`,
      [tenantA, siteA.rows[0].id]
    );
    planningShiftAId = shiftA.rows[0].id;
    await migrationPool.query(
      `INSERT INTO shift_staffing_assignments (tenant_id,shift_id,employee_id,assigned_by)
       VALUES ($1,$2,$3,$4)`,
      [tenantA, planningShiftAId, employeeAId, sopUserAId]
    );
    const coverRequest = await migrationPool.query(
      `INSERT INTO shift_cover_requests
        (tenant_id,shift_id,shift_revision_version_at_request,reason,requested_by)
       VALUES ($1,$2,1,'RLS fixture',$3) RETURNING id`,
      [tenantA, planningShiftAId, sopUserAId]
    );
    coverRequestAId = coverRequest.rows[0].id;
    const actualTime = await migrationPool.query(
      `INSERT INTO shift_actual_times
        (tenant_id,shift_id,employee_id,actual_start_at,actual_end_at,recorded_by)
       VALUES ($1,$2,$3,'2026-01-02T08:00:00Z','2026-01-02T16:00:00Z',$4) RETURNING id`,
      [tenantA, planningShiftAId, employeeAId, sopUserAId]
    );
    actualTimeAId = actualTime.rows[0].id;
    const actualRevision = await migrationPool.query(
      `UPDATE shift_actual_times
          SET notes='RLS revision fixture',revision_version=revision_version+1
        WHERE tenant_id=$1 AND id=$2 RETURNING revision_version`,
      [tenantA, actualTimeAId]
    );
    const revision = await migrationPool.query(
      `SELECT id FROM shift_actual_time_revisions WHERE tenant_id=$1 AND actual_time_id=$2`,
      [tenantA, actualTimeAId]
    );
    expect(actualRevision.rows[0].revision_version).toBe(2);
    actualTimeRevisionAId = revision.rows[0].id;
    const notification = await migrationPool.query(
      `INSERT INTO planning_notifications
        (tenant_id,recipient_user_id,event_type,entity_type,entity_id,details)
       VALUES ($1,$2,'test.event','shift_actual_time',$3,'{}'::jsonb) RETURNING id`,
      [tenantA, sopUserAId, actualTimeAId]
    );
    planningNotificationAId = notification.rows[0].id;
    await migrationPool.query(
      `INSERT INTO planning_notifications
        (tenant_id,recipient_user_id,event_type,entity_type,entity_id,details)
       VALUES ($1,$2,'test.event','shift_actual_time',$3,'{}'::jsonb)`,
      [tenantB, sopUserBId, actualTimeAId]
    );
    const sopA = await migrationPool.query(
      `INSERT INTO sop_instructions (tenant_id,sop_number,title,created_by,draft_content,status)
       VALUES ($1,$2,'SOP A',$3,'{"text":"A"}'::jsonb,'published') RETURNING id`,
      [tenantA,`RLS-SOP-A-${Date.now()}`,sopUserAId]
    );
    const sopB = await migrationPool.query(
      `INSERT INTO sop_instructions (tenant_id,sop_number,title,created_by,draft_content,status)
       VALUES ($1,$2,'SOP B',$3,'{"text":"B"}'::jsonb,'published') RETURNING id`,
      [tenantB,`RLS-SOP-B-${Date.now()}`,sopUserBId]
    );
    sopAId = sopA.rows[0].id;
    sopBId = sopB.rows[0].id;
    const sopA2 = await migrationPool.query(
      `INSERT INTO sop_instructions (tenant_id,sop_number,title,created_by,draft_content)
       VALUES ($1,$2,'SOP A2',$3,'{"text":"A2"}'::jsonb) RETURNING id`,
      [tenantA,`RLS-SOP-A2-${Date.now()}`,sopUserAId]
    );
    sopA2Id = sopA2.rows[0].id;
    const versionA = await migrationPool.query(
      `INSERT INTO sop_versions
        (tenant_id,sop_id,version_number,sop_number,title,category,content,author_user_id,submitted_by_user_id)
       VALUES ($1,$2,1,'RLS-SOP-A','SOP A','Allgemeine Dienstanweisung','{"text":"A"}'::jsonb,$3,$3)
       RETURNING id`,
      [tenantA,sopAId,sopUserAId]
    );
    const versionB = await migrationPool.query(
      `INSERT INTO sop_versions
        (tenant_id,sop_id,version_number,sop_number,title,category,content,author_user_id,submitted_by_user_id)
       VALUES ($1,$2,1,'RLS-SOP-B','SOP B','Allgemeine Dienstanweisung','{"text":"B"}'::jsonb,$3,$3)
       RETURNING id`,
      [tenantB,sopBId,sopUserBId]
    );
    const versionA2 = await migrationPool.query(
      `INSERT INTO sop_versions
        (tenant_id,sop_id,version_number,sop_number,title,category,content,author_user_id,submitted_by_user_id)
       VALUES ($1,$2,1,'RLS-SOP-A2','SOP A2','Allgemeine Dienstanweisung','{"text":"A2"}'::jsonb,$3,$3)
       RETURNING id`,
      [tenantA,sopA2Id,sopUserAId]
    );
    versionA2Id = versionA2.rows[0].id;
    await migrationPool.query(
      `UPDATE sop_instructions SET current_version_id=$1 WHERE tenant_id=$2 AND id=$3`,
      [versionA.rows[0].id,tenantA,sopAId]
    );
    await migrationPool.query(
      `UPDATE sop_instructions SET current_version_id=$1 WHERE tenant_id=$2 AND id=$3`,
      [versionB.rows[0].id,tenantB,sopBId]
    );
    await migrationPool.query(
      `INSERT INTO sop_assignment_targets (tenant_id,sop_id,target_type,employee_id,created_by)
       VALUES ($1,$2,'employee',$3,$4)`,
      [tenantA,sopAId,employeeAId,sopUserAId]
    );
    await migrationPool.query(
      `INSERT INTO sop_assignment_targets (tenant_id,sop_id,target_type,employee_id,created_by)
       VALUES ($1,$2,'employee',$3,$4)`,
      [tenantB,sopBId,employeeBId,sopUserBId]
    );
    const assignmentA = await migrationPool.query(
      `INSERT INTO sop_assignments (tenant_id,sop_id,version_id,employee_id)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [tenantA,sopAId,versionA.rows[0].id,employeeAId]
    );
    assignmentAId = assignmentA.rows[0].id;
  });

  afterAll(async () => {
    const cleanup = await migrationPool.connect();
    try {
      await cleanup.query('SET session_replication_role = replica');
      for (const [tenantId,sopId] of [[tenantA,sopAId],[tenantA,sopA2Id],[tenantB,sopBId]] as Array<[string,string]>) {
        await cleanup.query('DELETE FROM sop_assignments WHERE tenant_id=$1 AND sop_id=$2',[tenantId,sopId]);
        await cleanup.query('DELETE FROM sop_assignment_targets WHERE tenant_id=$1 AND sop_id=$2',[tenantId,sopId]);
        await cleanup.query('DELETE FROM sop_events WHERE tenant_id=$1 AND sop_id=$2',[tenantId,sopId]);
        await cleanup.query('UPDATE sop_instructions SET current_version_id=NULL,draft_version_id=NULL WHERE tenant_id=$1 AND id=$2',[tenantId,sopId]);
        await cleanup.query('DELETE FROM sop_versions WHERE tenant_id=$1 AND sop_id=$2',[tenantId,sopId]);
        await cleanup.query('DELETE FROM sop_instructions WHERE tenant_id=$1 AND id=$2',[tenantId,sopId]);
      }
      await cleanup.query('DELETE FROM employee_absences WHERE tenant_id=ANY($1::uuid[])',[ [tenantA,tenantB] ]);
      await cleanup.query('DELETE FROM employees WHERE id=ANY($1::uuid[])',[[employeeAId,employeeBId]]);
    } finally {
      await cleanup.query('SET session_replication_role = origin');
      cleanup.release();
    }
    // Administrative Bereinigung inkl. Append-Only-Trigger (nur Testdatenbank).
    await cleanupTestData([tenantA, tenantB],[sopUserAId,sopUserBId]);
    await pool.end();
    await migrationPool.end();
  });

  test('Mandant A sieht keine Daten von Mandant B', async () => {
    const res = await withTenantTransaction(tenantA, async (tx) => {
      return (await tx.query('SELECT * FROM clients')).rows;
    });

    expect(res.length).toBeGreaterThan(0);
    expect(res.every((c) => c.tenant_id === tenantA)).toBe(true);
    expect(res.some((c) => c.tenant_id === tenantB)).toBe(false);
  });

  test('Systemabfrage ohne Tenant-Kontext liefert 0 mandantenspezifische Datensätze', async () => {
    const res = await withSystemTransaction(async (tx) => {
      return (await tx.query('SELECT * FROM clients')).rows;
    });
    expect(res.length).toBe(0);
  });

  test('Neue Abwesenheitstabelle ist durch RLS mandantengebunden', async () => {
    const visible = await withTenantTransaction(tenantA, async (tx) => (await tx.query('SELECT tenant_id FROM employee_absences')).rows);
    expect(visible).toHaveLength(1);
    expect(visible[0].tenant_id).toBe(tenantA);

    const withoutTenant = await withSystemTransaction(async (tx) => (await tx.query('SELECT * FROM employee_absences')).rows);
    expect(withoutTenant).toHaveLength(0);
  });

  test('Planning periods enforce tenant RLS, FORCE RLS, and tenant scoping', async () => {
    const tenantRows = await withTenantTransaction(tenantA, async tx =>
      (await tx.query('SELECT id,tenant_id FROM schedule_periods')).rows
    );
    expect(tenantRows).toEqual([expect.objectContaining({ id: planningPeriodAId, tenant_id: tenantA })]);

    const otherTenantRows = await withTenantTransaction(tenantB, async tx =>
      (await tx.query('SELECT id FROM schedule_periods')).rows
    );
    const systemRows = await withSystemTransaction(async tx =>
      (await tx.query('SELECT id FROM schedule_periods')).rows
    );
    expect(otherTenantRows).toHaveLength(0);
    expect(systemRows).toHaveLength(0);

    const flags = await migrationPool.query(
      `SELECT c.relrowsecurity,c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname='schedule_periods'`
    );
    expect(flags.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  test('All planning tables enforce RLS and reject forged tenant writes', async () => {
    const planningTables = [
      'schedule_periods', 'schedule_templates', 'shift_staffing_requirements',
      'shift_staffing_assignments', 'schedule_rule_profiles', 'schedule_rule_profile_versions',
      'schedule_rule_findings', 'schedule_rule_exceptions', 'shift_swap_requests',
      'planning_audit_events', 'shift_cover_requests', 'shift_actual_times',
      'shift_actual_time_revisions', 'planning_notifications'
    ];
    const flags = await migrationPool.query(
      `SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname`,
      [planningTables]
    );
    expect(flags.rows).toHaveLength(planningTables.length);
    expect(flags.rows.every(row => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    const unscopedRows = await withSystemTransaction(async tx => {
      const results = [];
      for (const table of planningTables) {
        results.push(await tx.query(`SELECT 1 FROM ${table} LIMIT 1`));
      }
      return results;
    });
    expect(unscopedRows.every(result => result.rows.length === 0)).toBe(true);

    const forgedWrites: Array<{ sql: string; params: unknown[] }> = [
      {
        sql: `INSERT INTO schedule_periods (tenant_id,name,date_from,date_to,time_zone,created_by)
              VALUES ($1,$2,'2026-01-01','2026-01-31','Europe/Berlin',$3)`,
        params: [tenantB, `forged-period-${Date.now()}`, sopUserBId]
      },
      {
        sql: `INSERT INTO schedule_templates
                (tenant_id,site_id,name,time_zone,local_start_time,local_end_time,required_qualification,recurrence,created_by)
              VALUES ($1,$2,$3,'Europe/Berlin','08:00','16:00','Security','{"frequency":"DAILY"}'::jsonb,$4)`,
        params: [tenantB, planningShiftAId, `forged-template-${Date.now()}`, sopUserBId]
      },
      {
        sql: `INSERT INTO shift_staffing_requirements (tenant_id,shift_id,qualification_type,required_count)
              VALUES ($1,$2,'Security',1)`,
        params: [tenantB, planningShiftAId]
      },
      {
        sql: `INSERT INTO shift_staffing_assignments (tenant_id,shift_id,employee_id,assigned_by)
              VALUES ($1,$2,$3,$4)`,
        params: [tenantB, planningShiftAId, employeeBId, sopUserBId]
      },
      {
        sql: `INSERT INTO schedule_rule_profiles (tenant_id,name,created_by)
              VALUES ($1,$2,$3)`,
        params: [tenantB, `forged-profile-${Date.now()}`, sopUserBId]
      },
      {
        sql: `INSERT INTO schedule_rule_profile_versions
                (tenant_id,profile_id,version_number,effective_from,source_name,source_reference,rules,created_by)
              VALUES ($1,$2,1,'2026-01-01','test','test','[]'::jsonb,$3)`,
        params: [tenantB, planningShiftAId, sopUserBId]
      },
      {
        sql: `INSERT INTO schedule_rule_findings
                (tenant_id,run_id,rule_code,severity,message)
              VALUES ($1,$2,'test_rule','warning','test')`,
        params: [tenantB, planningShiftAId]
      },
      {
        sql: `INSERT INTO schedule_rule_exceptions (tenant_id,finding_id,reason,requested_by)
              VALUES ($1,$2,'forged request',$3)`,
        params: [tenantB, planningShiftAId, sopUserBId]
      },
      {
        sql: `INSERT INTO shift_swap_requests
                (tenant_id,shift_id,requester_employee_id,proposed_employee_id,requested_by)
              VALUES ($1,$2,$3,$4,$5)`,
        params: [tenantB, planningShiftAId, employeeAId, employeeBId, sopUserBId]
      },
      {
        sql: `INSERT INTO planning_audit_events
                (tenant_id,actor_user_id,event_type,entity_type,entity_id)
              VALUES ($1,$2,'forged','shift',$3)`,
        params: [tenantB, sopUserBId, planningShiftAId]
      },
      {
        sql: `INSERT INTO shift_cover_requests
                (tenant_id,shift_id,shift_revision_version_at_request,reason,requested_by)
              VALUES ($1,$2,1,'forged request',$3)`,
        params: [tenantB, planningShiftAId, sopUserBId]
      },
      {
        sql: `INSERT INTO shift_actual_times
                (tenant_id,shift_id,employee_id,actual_start_at,actual_end_at,recorded_by)
              VALUES ($1,$2,$3,'2026-01-02T08:00:00Z','2026-01-02T16:00:00Z',$4)`,
        params: [tenantB, planningShiftAId, employeeBId, sopUserBId]
      },
      {
        sql: `INSERT INTO planning_notifications
                (tenant_id,recipient_user_id,event_type,entity_type,entity_id)
              VALUES ($1,$2,'forged','shift',$3)`,
        params: [tenantB, sopUserBId, planningShiftAId]
      }
    ];

    for (const write of forgedWrites) {
      await expect(withTenantTransaction(tenantA, tx => tx.query(write.sql, write.params)))
        .rejects.toMatchObject({ code: '42501' });
    }
  });

  test('Cover requests and actual-time records enforce tenant RLS, FORCE RLS, and composite tenant FKs', async () => {
    const tenantRows = await withTenantTransaction(tenantA, async tx => ({
      covers: (await tx.query('SELECT id,tenant_id FROM shift_cover_requests')).rows,
      actuals: (await tx.query('SELECT id,tenant_id FROM shift_actual_times')).rows
    }));
    expect(tenantRows.covers).toEqual([expect.objectContaining({ id: coverRequestAId, tenant_id: tenantA })]);
    expect(tenantRows.actuals).toEqual([expect.objectContaining({ id: actualTimeAId, tenant_id: tenantA })]);

    const otherTenantRows = await withTenantTransaction(tenantB, async tx => ({
      covers: (await tx.query('SELECT id FROM shift_cover_requests')).rows,
      actuals: (await tx.query('SELECT id FROM shift_actual_times')).rows
    }));
    const systemRows = await withSystemTransaction(async tx => ({
      covers: (await tx.query('SELECT id FROM shift_cover_requests')).rows,
      actuals: (await tx.query('SELECT id FROM shift_actual_times')).rows
    }));
    expect(otherTenantRows.covers).toHaveLength(0);
    expect(otherTenantRows.actuals).toHaveLength(0);
    expect(systemRows.covers).toHaveLength(0);
    expect(systemRows.actuals).toHaveLength(0);

    const flags = await migrationPool.query(
      `SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname`,
      [['shift_actual_times', 'shift_cover_requests']]
    );
    expect(flags.rows).toEqual([
      { relname: 'shift_actual_times', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'shift_cover_requests', relrowsecurity: true, relforcerowsecurity: true }
    ]);

    await expect(migrationPool.query(
      `INSERT INTO shift_actual_times
        (tenant_id,shift_id,employee_id,actual_start_at,actual_end_at,recorded_by)
       VALUES ($1,$2,$3,'2026-01-02T08:00:00Z','2026-01-02T16:00:00Z',$4)`,
      [tenantA, planningShiftAId, employeeBId, sopUserAId]
    )).rejects.toMatchObject({ code: '23503' });

    await expect(migrationPool.query(
      `INSERT INTO shift_cover_requests
        (tenant_id,shift_id,shift_revision_version_at_request,requested_employee_id,reason,requested_by)
       VALUES ($1,$2,1,$3,'Cross tenant employee',$4)`,
      [tenantA, planningShiftAId, employeeBId, sopUserAId]
    )).rejects.toMatchObject({ code: '23503' });
  });

  test('Actual-time revisions and planning notifications enforce tenant RLS and recipient ownership', async () => {
    const visible = await withTenantTransaction(tenantA, async tx => ({
      revisions: (await tx.query(
        'SELECT id,tenant_id,actual_time_id FROM shift_actual_time_revisions WHERE actual_time_id=$1',
        [actualTimeAId]
      )).rows,
      notifications: (await tx.query(
        'SELECT id,tenant_id,recipient_user_id FROM planning_notifications'
      )).rows
    }));
    expect(visible.revisions).toEqual([
      expect.objectContaining({ id: actualTimeRevisionAId, tenant_id: tenantA, actual_time_id: actualTimeAId })
    ]);
    expect(visible.notifications).toEqual([
      expect.objectContaining({ id: planningNotificationAId, tenant_id: tenantA, recipient_user_id: sopUserAId })
    ]);
    const otherTenant = await withTenantTransaction(tenantB, async tx => ({
      revisions: (await tx.query('SELECT id FROM shift_actual_time_revisions')).rows,
      notifications: (await tx.query('SELECT id FROM planning_notifications')).rows
    }));
    const system = await withSystemTransaction(async tx => ({
      revisions: (await tx.query('SELECT id FROM shift_actual_time_revisions')).rows,
      notifications: (await tx.query('SELECT id FROM planning_notifications')).rows
    }));
    expect(otherTenant.revisions).toHaveLength(0);
    expect(otherTenant.notifications).toHaveLength(1);
    expect(otherTenant.notifications[0].id).not.toBe(planningNotificationAId);
    expect(system.revisions).toHaveLength(0);
    expect(system.notifications).toHaveLength(0);

    await expect(withTenantTransaction(tenantA, tx => tx.query(
      `INSERT INTO planning_notifications
        (tenant_id,recipient_user_id,event_type,entity_type,entity_id)
       VALUES ($1,$2,'forged.tenant','shift',$3)`,
      [tenantB, sopUserBId, planningShiftAId]
    ))).rejects.toMatchObject({ code: '42501' });
    await expect(migrationPool.query(
      `INSERT INTO planning_notifications
        (tenant_id,recipient_user_id,event_type,entity_type,entity_id)
       VALUES ($1,$2,'cross.tenant.recipient','shift',$3)`,
      [tenantA, sopUserBId, planningShiftAId]
    )).rejects.toMatchObject({ code: '23503' });

    const flags = await migrationPool.query(
      `SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname`,
      [['planning_notifications', 'shift_actual_time_revisions']]
    );
    expect(flags.rows).toEqual([
      { relname: 'planning_notifications', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'shift_actual_time_revisions', relrowsecurity: true, relforcerowsecurity: true }
    ]);
  });

  test('SOP instructions, assignment targets and assignments are tenant-isolated under PostgreSQL RLS', async () => {
    const visible = await withTenantTransaction(tenantA, async tx => ({
      sops: (await tx.query('SELECT id,tenant_id FROM sop_instructions')).rows,
      targets: (await tx.query('SELECT tenant_id,sop_id,employee_id FROM sop_assignment_targets')).rows,
      assignments: (await tx.query('SELECT tenant_id,sop_id,employee_id FROM sop_assignments')).rows
    }));
    expect(visible.sops.length).toBeGreaterThanOrEqual(2);
    expect(visible.sops.every(row => row.tenant_id === tenantA)).toBe(true);
    expect(visible.sops.some(row => row.id === sopBId)).toBe(false);
    expect(visible.targets).toEqual([expect.objectContaining({ tenant_id: tenantA, employee_id: employeeAId })]);
    expect(visible.assignments).toEqual([expect.objectContaining({ tenant_id: tenantA, sop_id: sopAId, employee_id: employeeAId })]);

    const systemRows = await withSystemTransaction(async tx => (await tx.query('SELECT * FROM sop_assignments')).rows);
    expect(systemRows).toHaveLength(0);
    expect(assignmentAId).toBeTruthy();
  });

  test('SOP target FKs reject foreign employees and version links reject a different SOP in the same tenant', async () => {
    await expect(migrationPool.query(
      `INSERT INTO sop_assignment_targets (tenant_id,sop_id,target_type,employee_id,created_by)
       VALUES ($1,$2,'employee',$3,$4)`,
      [tenantA,sopAId,employeeBId,sopUserAId]
    )).rejects.toMatchObject({ code: '23503' });

    await expect(migrationPool.query(
      'UPDATE sop_instructions SET current_version_id=$1 WHERE tenant_id=$2 AND id=$3',
      [versionA2Id,tenantA,sopAId]
    )).rejects.toMatchObject({ code: '23503' });

    await expect(migrationPool.query(
      `INSERT INTO sop_events (tenant_id,sop_id,version_id,actor_user_id,action)
       VALUES ($1,$2,$3,$4,'published')`,
      [tenantA,sopAId,versionA2Id,sopUserAId]
    )).rejects.toMatchObject({ code: '23503' });

    await expect(migrationPool.query(
      `INSERT INTO sop_assignments (tenant_id,sop_id,version_id,employee_id)
       VALUES ($1,$2,$3,$4)`,
      [tenantA,sopAId,versionA2Id,employeeAId]
    )).rejects.toMatchObject({ code: '23503' });
  });
});
