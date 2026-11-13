import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { withTenantTransaction } from '../config/database';

const employeeFields = z.object({
  personnelNumber: z.string().min(2).max(50), firstName: z.string().min(1).max(100), lastName: z.string().min(1).max(100),
  email: z.string().email(), phone: z.string().min(3).max(50), role: z.string().min(2).max(50),
  status: z.enum(['Aktiv','Urlaub','Krank','Freigestellt']).default('Aktiv'), weeklyHours: z.number().min(0).max(80),
  hourlyRate: z.number().min(0).max(1000), dateOfJoining: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});
const assignedSiteIdsSchema = z.array(z.string().uuid()).max(500)
  .refine(ids => new Set(ids).size === ids.length, 'Standort-IDs müssen eindeutig sein.');
const employeeApiFields = employeeFields.extend({ assignedSiteIds: assignedSiteIdsSchema.optional() });
const employeeColumns: Record<string,string> = { personnelNumber:'personnel_number', firstName:'first_name', lastName:'last_name', email:'email', phone:'phone', role:'role', status:'status', weeklyHours:'weekly_hours', hourlyRate:'hourly_rate', dateOfJoining:'date_of_joining' };
const employeeSelect = 'id,tenant_id,personnel_number,first_name,last_name,email,phone,role,status,weekly_hours,hourly_rate,date_of_joining,account_user_id,archived_at,revision_version';
const versionSchema = z.object({ revisionVersion: z.number().int().positive() }).strict();
const employeeAccountSchema = z.object({
  userId: z.string().uuid().nullable(),
  revisionVersion: z.number().int().positive()
}).strict();
const qualificationFields = z.object({
  type: z.string().min(2).max(100), certificateNumber: z.string().max(100).nullable().optional(), issueDate: z.string().date().nullable().optional(),
  expiryDate: z.string().date().nullable().optional(), verified: z.boolean().default(false), documentReference: z.string().max(255).nullable().optional()
}).strict();
const absenceFields = z.object({ type: z.enum(['Urlaub','Krankheit','Sonstige']), startDate: z.string().date(), endDate: z.string().date(), notes: z.string().max(2000).optional() }).strict();
const statusFromQualification = (verified: boolean, expiryDate?: string | null) => !verified ? 'PENDING' : expiryDate && expiryDate < new Date().toISOString().slice(0,10) ? 'EXPIRED' : 'VALID';

async function siteIdsExist(db: any, tenantId: string, siteIds: string[]): Promise<boolean> {
  if (!siteIds.length) return true;
  const result = await db.query(
    'SELECT id FROM sites WHERE tenant_id=$1 AND id=ANY($2::uuid[]) FOR KEY SHARE',
    [tenantId, siteIds]
  );
  return result.rows.length === siteIds.length;
}

async function replaceEmployeeSites(db: any, tenantId: string, employeeId: string, siteIds: string[]): Promise<void> {
  await db.query('DELETE FROM employee_site_assignments WHERE tenant_id=$1 AND employee_id=$2', [tenantId, employeeId]);
  if (siteIds.length) {
    await db.query(
      `INSERT INTO employee_site_assignments (tenant_id,employee_id,site_id)
       SELECT $1,$2,requested.site_id FROM unnest($3::uuid[]) AS requested(site_id)`,
      [tenantId, employeeId, siteIds]
    );
  }
}

async function getEmployeeSiteIds(db: any, tenantId: string, employeeId: string): Promise<string[]> {
  const result = await db.query(
    'SELECT site_id FROM employee_site_assignments WHERE tenant_id=$1 AND employee_id=$2 ORDER BY site_id',
    [tenantId, employeeId]
  );
  return result.rows.map((row: { site_id: string }) => row.site_id);
}

export async function listEmployees(req: Request,res: Response,next: NextFunction): Promise<void> {
  try {
    const tenantId=req.user!.tenantId;
    const data=await withTenantTransaction(tenantId,async db=>{
      const employees=await db.query(`SELECT ${employeeSelect} FROM employees ORDER BY archived_at NULLS FIRST,last_name,first_name`);
      const siteAssignments=await db.query('SELECT employee_id,site_id FROM employee_site_assignments');
      const qualifications=await db.query(`SELECT q.id,q.employee_id,q.qualification_type,q.certificate_number,q.issue_date,q.expiry_date,q.verified,q.status,q.document_reference,q.revision_version FROM employee_qualifications q JOIN employees e ON e.id=q.employee_id AND e.tenant_id=q.tenant_id ORDER BY q.issue_date DESC NULLS LAST`);
      const absences=await db.query(`SELECT id,employee_id,absence_type,date_from,date_to,status,notes,reviewed_by,reviewed_at,revision_version FROM employee_absences ORDER BY date_from DESC`);
      return employees.rows.map(e=>({...e,assigned_site_ids:siteAssignments.rows.filter(s=>s.employee_id===e.id).map(s=>s.site_id),qualifications:qualifications.rows.filter(q=>q.employee_id===e.id).map(q=>({...q,status:statusFromQualification(q.verified,q.expiry_date)})),absences:absences.rows.filter(a=>a.employee_id===e.id)}));
    });
    res.json({success:true,data});
  } catch(error){next(error);}
}

export async function createEmployee(req: Request,res: Response,next: NextFunction): Promise<void> {
  try {
    const tenantId=req.user!.tenantId; const {assignedSiteIds=[],...body}=employeeApiFields.parse(req.body);
    const result=await withTenantTransaction(tenantId,async db=>{
      if (!await siteIdsExist(db,tenantId,assignedSiteIds)) return {invalidSites:true};
      const inserted=await db.query(`INSERT INTO employees (tenant_id,personnel_number,first_name,last_name,email,phone,role,status,weekly_hours,hourly_rate,date_of_joining) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${employeeSelect}`,[tenantId,body.personnelNumber,body.firstName,body.lastName,body.email,body.phone,body.role,body.status,body.weeklyHours,body.hourlyRate,body.dateOfJoining]);
      const employee=inserted.rows[0];
      await replaceEmployeeSites(db,tenantId,employee.id,assignedSiteIds);
      return {employee:{...employee,assigned_site_ids:assignedSiteIds}};
    });
    if ('invalidSites' in result) { res.status(404).json({success:false,message:'Ein Standort wurde in diesem Mandanten nicht gefunden.'}); return; }
    res.status(201).json({success:true,data:result.employee});
  } catch(error){next(error);}
}

export async function updateEmployee(req: Request,res: Response,next: NextFunction): Promise<void> {
  try {
    const tenantId=req.user!.tenantId;const id=z.string().uuid().parse(req.params.id);const body=employeeApiFields.partial().extend({revisionVersion:z.number().int().positive()}).strict().parse(req.body);const {revisionVersion,assignedSiteIds,...changes}=body;const entries=Object.entries(changes).filter(([,v])=>v!==undefined);
    if(!entries.length && assignedSiteIds===undefined){res.status(400).json({success:false,message:'Keine Mitarbeiterfelder übermittelt.'});return;}
    const result=await withTenantTransaction(tenantId,async db=>{
      if (assignedSiteIds!==undefined && !await siteIdsExist(db,tenantId,assignedSiteIds)) return {invalidSites:true};
      const values:any[]=entries.map(([,v])=>v);const assignments=entries.map(([k],i)=>`${employeeColumns[k]}=$${i+1}`);
      assignments.push('revision_version=revision_version+1','updated_at=CURRENT_TIMESTAMP');
      values.push(id,tenantId,revisionVersion);
      const updated=await db.query(`UPDATE employees SET ${assignments.join(',')} WHERE id=$${values.length-2} AND tenant_id=$${values.length-1} AND archived_at IS NULL AND revision_version=$${values.length} RETURNING ${employeeSelect}`,values);
      if(!updated.rows.length){
        const cur=await db.query(`SELECT revision_version,archived_at FROM employees WHERE id=$1 AND tenant_id=$2`,[id,tenantId]);
        return {conflict:cur.rows.length>0,current:cur.rows[0]};
      }
      if (assignedSiteIds!==undefined) await replaceEmployeeSites(db,tenantId,id,assignedSiteIds);
      return {employee:{...updated.rows[0],assigned_site_ids:await getEmployeeSiteIds(db,tenantId,id)}};
    });
    if ('invalidSites' in result) { res.status(404).json({success:false,message:'Ein Standort wurde in diesem Mandanten nicht gefunden.'}); return; }
    if ('conflict' in result) { res.status(result.conflict?409:404).json({success:false,message:result.conflict?'Mitarbeiter wurde geändert oder archiviert.':'Mitarbeiter nicht gefunden.',data:result.current}); return; }
    res.json({success:true,data:result.employee});
  }catch(error){next(error);}
}

export async function linkEmployeeAccount(req: Request,res: Response,next: NextFunction): Promise<void> {
  try {
    const tenantId = req.user!.tenantId;
    const employeeId = z.string().uuid().parse(req.params.id);
    const { userId, revisionVersion } = employeeAccountSchema.parse(req.body);
    const result = await withTenantTransaction(tenantId, async db => {
      const current = await db.query(
        'SELECT revision_version, account_user_id FROM employees WHERE id=$1 AND tenant_id=$2 AND archived_at IS NULL FOR UPDATE',
        [employeeId, tenantId]
      );
      if (!current.rows.length) return { kind: 'missing' as const };
      if (Number(current.rows[0].revision_version) !== revisionVersion) return { kind: 'stale' as const };
      if (userId) {
        const membership = await db.query(
          'SELECT 1 FROM user_roles WHERE user_id=$1 AND tenant_id=$2 LIMIT 1',
          [userId, tenantId]
        );
        if (!membership.rows.length) return { kind: 'foreign-account' as const };
        const alreadyLinked = await db.query(
          'SELECT 1 FROM employees WHERE tenant_id=$1 AND account_user_id=$2 AND id<>$3 LIMIT 1',
          [tenantId, userId, employeeId]
        );
        if (alreadyLinked.rows.length) return { kind: 'already-linked' as const };
      }
      const updated = await db.query(
        `UPDATE employees SET account_user_id=$1, revision_version=revision_version+1,
           updated_at=CURRENT_TIMESTAMP
         WHERE id=$2 AND tenant_id=$3 AND revision_version=$4
         RETURNING id, account_user_id, revision_version`,
        [userId, employeeId, tenantId, revisionVersion]
      );
      if (!updated.rows.length) return { kind: 'stale' as const };
      await db.query(
        `INSERT INTO audit_logs
           (tenant_id,user_email,role,action_type,severity,target_entity,details,ip_address)
         VALUES ($1,$2,$3,'employee.account_linked','INFO',$4,$5,$6)`,
        [
          tenantId, req.user!.email, req.user!.role, employeeId,
          JSON.stringify({
            previousAccountUserId: current.rows[0].account_user_id,
            accountUserId: userId
          }), req.ip || 'unknown'
        ]
      );
      return { kind: 'ok' as const, employee: updated.rows[0] };
    });
    if (result.kind !== 'ok') {
      const status = result.kind === 'missing' ? 404 : result.kind === 'foreign-account' ? 400 : 409;
      const message = {
        missing: 'Aktiver Mitarbeiter nicht gefunden.',
        stale: 'Mitarbeiter wurde zwischenzeitlich geändert.',
        'foreign-account': 'Das Benutzerkonto gehört nicht zu diesem Mandanten.',
        'already-linked': 'Das Benutzerkonto ist bereits einem anderen Mitarbeiter zugeordnet.'
      }[result.kind];
      res.status(status).json({ success: false, message });
      return;
    }
    res.json({ success: true, data: result.employee });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      res.status(409).json({ success: false, message: 'Das Benutzerkonto ist bereits einem anderen Mitarbeiter zugeordnet.' });
      return;
    }
    next(error);
  }
}

async function lifecycle(req:Request,res:Response,next:NextFunction,restore:boolean):Promise<void>{
  try{const tenantId=req.user!.tenantId;const id=z.string().uuid().parse(req.params.id);const {revisionVersion}=versionSchema.parse(req.body);const result=await withTenantTransaction(tenantId,db=>db.query(`UPDATE employees SET archived_at=${restore?'NULL':'CURRENT_TIMESTAMP'},revision_version=revision_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND tenant_id=$2 AND archived_at IS ${restore?'NOT NULL':'NULL'} AND revision_version=$3 RETURNING id,archived_at,revision_version`,[id,tenantId,revisionVersion]));if(!result.rows.length){const cur=await withTenantTransaction(tenantId,db=>db.query('SELECT revision_version,archived_at FROM employees WHERE id=$1 AND tenant_id=$2',[id,tenantId]));res.status(cur.rows.length?409:404).json({success:false,message:cur.rows.length?'Mitarbeiterstatus oder Revision hat sich geändert.':'Mitarbeiter nicht gefunden.',data:cur.rows[0]});return;}res.json({success:true,data:result.rows[0]});}catch(error){next(error);}
}
export const archiveEmployee=(req:Request,res:Response,next:NextFunction)=>lifecycle(req,res,next,false);
export const restoreEmployee=(req:Request,res:Response,next:NextFunction)=>lifecycle(req,res,next,true);

export async function createQualification(req:Request,res:Response,next:NextFunction):Promise<void>{
  try{const tenantId=req.user!.tenantId;const employeeId=z.string().uuid().parse(req.params.id);const body=qualificationFields.parse(req.body);const status=statusFromQualification(body.verified,body.expiryDate);const result=await withTenantTransaction(tenantId,db=>db.query(`INSERT INTO employee_qualifications (tenant_id,employee_id,qualification_type,certificate_number,issue_date,expiry_date,verified,status,document_reference) SELECT $1,e.id,$3,$4,$5,$6,$7,$8,$9 FROM employees e WHERE e.id=$2 AND e.tenant_id=$1 AND e.archived_at IS NULL RETURNING id,employee_id,qualification_type,certificate_number,issue_date,expiry_date,verified,status,document_reference,revision_version`,[tenantId,employeeId,body.type,body.certificateNumber||'',body.issueDate,body.expiryDate,body.verified,status,body.documentReference]));if(!result.rows.length){res.status(404).json({success:false,message:'Aktiver Mitarbeiter nicht gefunden.'});return;}res.status(201).json({success:true,data:result.rows[0]});}catch(error){next(error);}
}
export async function updateQualification(req:Request,res:Response,next:NextFunction):Promise<void>{
  try{const tenantId=req.user!.tenantId;const id=z.string().uuid().parse(req.params.qualificationId);const {revisionVersion,...body}=qualificationFields.partial().strict().extend({revisionVersion:z.number().int().positive()}).parse(req.body);if(!Object.keys(body).some(k=>(body as any)[k]!==undefined)){res.status(400).json({success:false,message:'Keine Qualifikationsfelder übermittelt.'});return;}const current=await withTenantTransaction(tenantId,db=>db.query('SELECT verified,expiry_date FROM employee_qualifications WHERE id=$1 AND tenant_id=$2',[id,tenantId]));if(!current.rows.length){res.status(404).json({success:false,message:'Qualifikation nicht gefunden.'});return;}const verified=body.verified??current.rows[0].verified;const expiry=body.expiryDate===undefined?current.rows[0].expiry_date:body.expiryDate;const status=statusFromQualification(verified,expiry);const vals=[body.type??null,body.certificateNumber??null,body.issueDate===null,body.issueDate??null,body.expiryDate===null,body.expiryDate??null,body.verified??null,status,body.documentReference===null,body.documentReference??null,id,tenantId,revisionVersion];const updated=await withTenantTransaction(tenantId,db=>db.query(`UPDATE employee_qualifications SET qualification_type=COALESCE($1,qualification_type),certificate_number=COALESCE($2,certificate_number),issue_date=CASE WHEN $3 THEN NULL ELSE COALESCE($4,issue_date) END,expiry_date=CASE WHEN $5 THEN NULL ELSE COALESCE($6,expiry_date) END,verified=COALESCE($7,verified),status=$8,document_reference=CASE WHEN $9 THEN NULL ELSE COALESCE($10,document_reference) END,revision_version=revision_version+1 WHERE id=$11 AND tenant_id=$12 AND revision_version=$13 RETURNING id,employee_id,qualification_type,certificate_number,issue_date,expiry_date,verified,status,document_reference,revision_version`,vals));if(!updated.rows.length){res.status(409).json({success:false,message:'Qualifikation wurde zwischenzeitlich geändert.'});return;}res.json({success:true,data:updated.rows[0]});}catch(error){next(error);}
}

async function employeeAbsenceOverlap(db:any,tenantId:string,employeeId:string,startDate:string,endDate:string,excludeId?:string):Promise<boolean>{const r=await db.query(`SELECT 1 FROM employee_absences WHERE tenant_id=$1 AND employee_id=$2 AND status IN ('PENDING','APPROVED') AND daterange(date_from,date_to,'[]') && daterange($3::date,$4::date,'[]') AND ($5::uuid IS NULL OR id<>$5) LIMIT 1`,[tenantId,employeeId,startDate,endDate,excludeId||null]);return r.rows.length>0;}
export async function createAbsence(req:Request,res:Response,next:NextFunction):Promise<void>{
  try{const tenantId=req.user!.tenantId;const employeeId=z.string().uuid().parse(req.params.id);const b=absenceFields.parse(req.body);if(b.endDate<b.startDate){res.status(400).json({success:false,message:'Enddatum muss am oder nach dem Startdatum liegen.'});return;}const mutationId=req.header('Idempotency-Key')||null;const result=await withTenantTransaction(tenantId,async db=>{await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${tenantId}:absence:${employeeId}`]);if(await employeeAbsenceOverlap(db,tenantId,employeeId,b.startDate,b.endDate))return {conflict:true};return db.query(`INSERT INTO employee_absences (tenant_id,employee_id,absence_type,date_from,date_to,status,notes,client_mutation_id) SELECT $1,e.id,$3,$4,$5,'PENDING',$6,$7 FROM employees e WHERE e.id=$2 AND e.tenant_id=$1 AND e.archived_at IS NULL RETURNING id,employee_id,absence_type,date_from,date_to,status,notes,revision_version`,[tenantId,employeeId,b.type==='Urlaub'?'VACATION':b.type==='Krankheit'?'SICKNESS':'OTHER',b.startDate,b.endDate,b.notes||null,mutationId]);});if((result as any).conflict){res.status(409).json({success:false,message:'Abwesenheit überschneidet sich mit einer genehmigten Abwesenheit.'});return;}const rows=(result as any).rows;if(!rows.length){res.status(404).json({success:false,message:'Aktiver Mitarbeiter nicht gefunden.'});return;}res.status(201).json({success:true,data:rows[0]});}catch(error){next(error);}
}
export async function reviewAbsence(req:Request,res:Response,next:NextFunction):Promise<void>{
  try{const tenantId=req.user!.tenantId;const id=z.string().uuid().parse(req.params.absenceId);const b=z.object({revisionVersion:z.number().int().positive(),decision:z.enum(['APPROVED','REJECTED'])}).strict().parse(req.body);const userId=req.user!.userId;const result=await withTenantTransaction(tenantId,async db=>{const info=await db.query('SELECT employee_id,date_from,date_to,status FROM employee_absences WHERE id=$1 AND tenant_id=$2',[id,tenantId]);if(!info.rows.length)return {kind:'missing'};await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${tenantId}:absence:${info.rows[0].employee_id}`]);if(b.decision==='APPROVED'&&await employeeAbsenceOverlap(db,tenantId,info.rows[0].employee_id,info.rows[0].date_from,info.rows[0].date_to,id))return {kind:'overlap'};const updated=await db.query(`UPDATE employee_absences SET status=$1,reviewed_by=$2,reviewed_at=CURRENT_TIMESTAMP,revision_version=revision_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$3 AND tenant_id=$4 AND status='PENDING' AND revision_version=$5 RETURNING id,status,revision_version,reviewed_at`,[b.decision,userId,id,tenantId,b.revisionVersion]);return updated.rows.length?{kind:'ok',row:updated.rows[0]}:{kind:'stale'};});if(result.kind!=='ok'){const code=result.kind==='missing'?404:409;res.status(code).json({success:false,message:result.kind==='overlap'?'Genehmigung überschneidet sich mit einer bestehenden genehmigten Abwesenheit.':result.kind==='missing'?'Abwesenheit nicht gefunden.':'Abwesenheit ist nicht mehr offen oder wurde geändert.'});return;}res.json({success:true,data:result.row});}catch(error){next(error);}
}

// Match the shared IndexedDB envelope (deviceId + per-mutation entityType and
// clientTimestamp) while validating every field this endpoint actually uses.
const syncSchema=z.object({
  deviceId:z.string().max(255).optional(),
  mutations:z.array(z.object({
    clientUuid:z.string().min(8).max(64),
    entityType:z.literal('employee').optional(),
    action:z.enum(['CREATE','UPDATE','DELETE','RESTORE','QUALIFICATION_CREATE','QUALIFICATION_UPDATE','ABSENCE_CREATE','ABSENCE_REVIEW']),
    clientTimestamp:z.string().datetime().optional(),
    baseVersion:z.number().int().positive(),
    payload:z.record(z.any())
  }).strict()).min(1).max(100)
}).strict();
export async function syncEmployeeMutations(req:Request,res:Response,next:NextFunction):Promise<void>{
  try{const tenantId=req.user!.tenantId;const user=req.user!;const {mutations}=syncSchema.parse(req.body);const results=await withTenantTransaction(tenantId,async db=>{const outputs:any[]=[];for(const m of mutations){const permission=m.action==='CREATE'?'employees:create':m.action==='UPDATE'?'employees:update':m.action==='DELETE'?'employees:archive':m.action==='RESTORE'?'employees:restore':m.action.startsWith('QUALIFICATION_')?'qualifications:manage':m.action==='ABSENCE_REVIEW'?'employees:absence:approve':'employees:absence:manage';if(!user.permissions.includes(permission)){outputs.push({clientUuid:m.clientUuid,status:'REJECTED',message:`Fehlende Berechtigung '${permission}'`});continue;}const hash=crypto.createHash('sha256').update(JSON.stringify({action:m.action,baseVersion:m.baseVersion,payload:m.payload})).digest('hex');await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${tenantId}:employee:${m.clientUuid}`]);const prior=await db.query('SELECT payload_hash,response_json FROM sync_idempotency_receipts WHERE tenant_id=$1 AND client_mutation_id=$2',[tenantId,m.clientUuid]);if(prior.rows.length){outputs.push(prior.rows[0].payload_hash===hash?prior.rows[0].response_json:{clientUuid:m.clientUuid,status:'REJECTED',message:'Mutations-ID mit verändertem Inhalt wiederverwendet.'});continue;}let result:any;const p=m.payload;const id=z.string().uuid().safeParse(p.id);
      if(m.action==='CREATE'){
        const v=employeeApiFields.safeParse(p);
        if(!id.success||!v.success)result={clientUuid:m.clientUuid,status:'REJECTED',message:'Ungültige Mitarbeiterdaten.'};
        else{
          const {assignedSiteIds=[],...b}=v.data;
          if(!await siteIdsExist(db,tenantId,assignedSiteIds))result={clientUuid:m.clientUuid,status:'REJECTED',message:'Ein Standort wurde in diesem Mandanten nicht gefunden.'};
          else{
            const r=await db.query(`INSERT INTO employees (id,tenant_id,personnel_number,first_name,last_name,email,phone,role,status,weekly_hours,hourly_rate,date_of_joining,client_mutation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (tenant_id,client_mutation_id) WHERE client_mutation_id IS NOT NULL DO NOTHING RETURNING id,revision_version`,[id.data,tenantId,b.personnelNumber,b.firstName,b.lastName,b.email,b.phone,b.role,b.status,b.weeklyHours,b.hourlyRate,b.dateOfJoining,m.clientUuid]);
            if(r.rows.length)await replaceEmployeeSites(db,tenantId,r.rows[0].id,assignedSiteIds);
            result={clientUuid:m.clientUuid,serverId:(r.rows[0]?.id||id.data),status:'SYNCED',serverVersion:r.rows[0]?.revision_version||1};
          }
        }
      }
      else if(m.action==='QUALIFICATION_CREATE'){const emp=z.string().uuid().safeParse(p.employeeId);const fields={...p};delete fields.id;delete fields.employeeId;const v=qualificationFields.safeParse(fields);if(!emp.success||!id.success||!v.success)result={clientUuid:m.clientUuid,status:'REJECTED',message:'Ungültiger Qualifikationsnachweis.'};else{const b=v.data;const r=await db.query(`INSERT INTO employee_qualifications (id,tenant_id,employee_id,qualification_type,certificate_number,issue_date,expiry_date,verified,status,document_reference,client_mutation_id) SELECT $1,$2,e.id,$4,$5,$6,$7,$8,$9,$10,$11 FROM employees e WHERE e.id=$3 AND e.tenant_id=$2 AND e.archived_at IS NULL ON CONFLICT (tenant_id,client_mutation_id) WHERE client_mutation_id IS NOT NULL DO NOTHING RETURNING id,revision_version`,[id.data,tenantId,emp.data,b.type,b.certificateNumber||'',b.issueDate,b.expiryDate,b.verified,statusFromQualification(b.verified,b.expiryDate),b.documentReference,m.clientUuid]);result=r.rows.length?{clientUuid:m.clientUuid,serverId:r.rows[0].id,status:'SYNCED',serverVersion:r.rows[0].revision_version}:{clientUuid:m.clientUuid,status:'REJECTED',message:'Mitarbeiter nicht gefunden oder Qualifikation bereits angelegt.'};}}
      else if(m.action==='ABSENCE_CREATE'){const emp=z.string().uuid().safeParse(p.employeeId);const fields={...p};delete fields.id;delete fields.employeeId;const b=absenceFields.safeParse(fields);if(!emp.success||!id.success||!b.success||b.data.endDate<b.data.startDate)result={clientUuid:m.clientUuid,status:'REJECTED',message:'Ungültige Abwesenheit.'};else{await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${tenantId}:absence:${emp.data}`]);if(await employeeAbsenceOverlap(db,tenantId,emp.data,b.data.startDate,b.data.endDate))result={clientUuid:m.clientUuid,status:'CONFLICT',message:'Überschneidung mit genehmigter Abwesenheit.'};else{const r=await db.query(`INSERT INTO employee_absences (id,tenant_id,employee_id,absence_type,date_from,date_to,status,notes,client_mutation_id) SELECT $1,$2,e.id,$4,$5,$6,'PENDING',$7,$8 FROM employees e WHERE e.id=$3 AND e.tenant_id=$2 AND e.archived_at IS NULL ON CONFLICT (tenant_id,client_mutation_id) WHERE client_mutation_id IS NOT NULL DO NOTHING RETURNING id,revision_version`,[id.data,tenantId,emp.data,b.data.type==='Urlaub'?'VACATION':b.data.type==='Krankheit'?'SICKNESS':'OTHER',b.data.startDate,b.data.endDate,b.data.notes||null,m.clientUuid]);result=r.rows.length?{clientUuid:m.clientUuid,serverId:r.rows[0].id,status:'SYNCED',serverVersion:r.rows[0].revision_version}:{clientUuid:m.clientUuid,status:'REJECTED',message:'Mitarbeiter nicht gefunden oder Abwesenheit bereits übertragen.'};}}}
      else if(!id.success)result={clientUuid:m.clientUuid,status:'REJECTED',message:'Ungültige ID.'};
      else if(m.action==='UPDATE'){
        const {id:payloadId,...fields}=p;
        const v=employeeApiFields.partial().strict().safeParse(fields);
        if(!id.success||payloadId!==undefined&&payloadId!==id.data||!v.success)result={clientUuid:m.clientUuid,status:'REJECTED',message:'Ungültige Mitarbeiterdaten.'};
        else{
          const {assignedSiteIds,...employeeChanges}=v.data;
          const entries=Object.entries(employeeChanges).filter(([,x])=>x!==undefined);
          if(!entries.length&&assignedSiteIds===undefined)result={clientUuid:m.clientUuid,status:'REJECTED',message:'Keine Mitarbeiterfelder übermittelt.'};
          else if(assignedSiteIds!==undefined&&!await siteIdsExist(db,tenantId,assignedSiteIds))result={clientUuid:m.clientUuid,status:'REJECTED',message:'Ein Standort wurde in diesem Mandanten nicht gefunden.'};
          else{
            const values:any[]=entries.map(([,x])=>x);
            const sets=entries.map(([k],i)=>`${employeeColumns[k]}=$${i+1}`);
            sets.push('revision_version=revision_version+1','updated_at=CURRENT_TIMESTAMP');
            values.push(id.data,tenantId,m.baseVersion);
            const r=await db.query(`UPDATE employees SET ${sets.join(',')} WHERE id=$${values.length-2} AND tenant_id=$${values.length-1} AND archived_at IS NULL AND revision_version=$${values.length} RETURNING revision_version`,values);
            if(r.rows.length){
              if(assignedSiteIds!==undefined)await replaceEmployeeSites(db,tenantId,id.data,assignedSiteIds);
              result={clientUuid:m.clientUuid,serverId:id.data,status:'SYNCED',serverVersion:r.rows[0].revision_version};
            }else result=await conflictEmployee(db,tenantId,id.data,m.clientUuid,m.baseVersion,p);
          }
        }
      }
      else if(m.action==='DELETE'||m.action==='RESTORE'){const restore=m.action==='RESTORE';const r=await db.query(`UPDATE employees SET archived_at=${restore?'NULL':'CURRENT_TIMESTAMP'},revision_version=revision_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND tenant_id=$2 AND archived_at IS ${restore?'NOT NULL':'NULL'} AND revision_version=$3 RETURNING revision_version`,[id.data,tenantId,m.baseVersion]);result=r.rows.length?{clientUuid:m.clientUuid,serverId:id.data,status:'SYNCED',serverVersion:r.rows[0].revision_version}:await conflictEmployee(db,tenantId,id.data,m.clientUuid,m.baseVersion,p);}
      else if(m.action==='QUALIFICATION_UPDATE'){const qid=z.string().uuid().safeParse(p.qualificationId??p.id);const {id:payloadId,qualificationId,...fields}=p;const b=qualificationFields.partial().strict().safeParse(fields);if(!qid.success||payloadId!==undefined&&payloadId!==qid.data||qualificationId!==undefined&&qualificationId!==qid.data||!b.success)result={clientUuid:m.clientUuid,status:'REJECTED',message:'Ungültiger Nachweis.'};else{const entries=Object.entries(b.data).filter(([,x])=>x!==undefined);if(!entries.length)result={clientUuid:m.clientUuid,status:'REJECTED',message:'Keine Qualifikationsfelder übermittelt.'};else{const cur=await db.query('SELECT revision_version FROM employee_qualifications WHERE id=$1 AND tenant_id=$2',[qid.data,tenantId]);const r=await db.query(`UPDATE employee_qualifications SET qualification_type=COALESCE($1,qualification_type),certificate_number=COALESCE($2,certificate_number),issue_date=CASE WHEN $3 THEN NULL ELSE COALESCE($4,issue_date) END,expiry_date=CASE WHEN $5 THEN NULL ELSE COALESCE($6,expiry_date) END,verified=COALESCE($7,verified),status=CASE WHEN COALESCE($7,verified)=false THEN 'PENDING' WHEN (CASE WHEN $5 THEN NULL ELSE COALESCE($6,expiry_date) END)<CURRENT_DATE THEN 'EXPIRED' ELSE 'VALID' END,document_reference=CASE WHEN $8 THEN NULL ELSE COALESCE($9,document_reference) END,revision_version=revision_version+1 WHERE id=$10 AND tenant_id=$11 AND revision_version=$12 RETURNING revision_version`,[b.data.type??null,b.data.certificateNumber??null,b.data.issueDate===null,b.data.issueDate??null,b.data.expiryDate===null,b.data.expiryDate??null,b.data.verified??null,b.data.documentReference===null,b.data.documentReference??null,qid.data,tenantId,m.baseVersion]);result=r.rows.length?{clientUuid:m.clientUuid,serverId:qid.data,status:'SYNCED',serverVersion:r.rows[0].revision_version}:cur.rows.length?{clientUuid:m.clientUuid,serverId:qid.data,status:'CONFLICT',serverVersion:cur.rows[0].revision_version,conflictData:{serverVersion:cur.rows[0].revision_version,clientVersion:m.baseVersion,clientPayload:p}}:{clientUuid:m.clientUuid,serverId:qid.data,status:'REJECTED',message:'Qualifikation nicht gefunden.'};}}}
      else {const decision=p.decision==='APPROVED'?'APPROVED':'REJECTED';const aid=z.string().uuid().safeParse(p.absenceId);if(!aid.success)result={clientUuid:m.clientUuid,status:'REJECTED',message:'Ungültige Abwesenheit.'};else{const info=await db.query(`SELECT employee_id,date_from,date_to FROM employee_absences WHERE id=$1 AND tenant_id=$2 AND status='PENDING' AND revision_version=$3`,[aid.data,tenantId,m.baseVersion]);if(!info.rows.length)result={clientUuid:m.clientUuid,serverId:aid.data,status:'CONFLICT',message:'Abwesenheit wurde zwischenzeitlich geändert.'};else{await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${tenantId}:absence:${info.rows[0].employee_id}`]);if(decision==='APPROVED'&&await employeeAbsenceOverlap(db,tenantId,info.rows[0].employee_id,info.rows[0].date_from,info.rows[0].date_to,aid.data))result={clientUuid:m.clientUuid,serverId:aid.data,status:'CONFLICT',message:'Überschneidung mit einer anderen Abwesenheit.'};else{const r=await db.query(`UPDATE employee_absences SET status=$1,reviewed_by=$2,reviewed_at=CURRENT_TIMESTAMP,revision_version=revision_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$3 AND tenant_id=$4 AND status='PENDING' AND revision_version=$5 RETURNING revision_version`,[decision,user.userId,aid.data,tenantId,m.baseVersion]);result=r.rows.length?{clientUuid:m.clientUuid,serverId:aid.data,status:'SYNCED',serverVersion:r.rows[0].revision_version}:{clientUuid:m.clientUuid,serverId:aid.data,status:'CONFLICT',serverVersion:Number(m.baseVersion)+1};}}}}
      const receiptServerId = result.serverId || (id.success ? id.data : m.clientUuid);
      await db.query(`INSERT INTO sync_idempotency_receipts (tenant_id,client_mutation_id,entity_type,action,payload_hash,status,server_id,server_version,response_json) VALUES ($1,$2,'employee',$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,[tenantId,m.clientUuid,m.action,hash,result.status,receiptServerId,result.serverVersion||m.baseVersion,JSON.stringify(result)]);outputs.push(result);
    }return outputs;});res.json({success:true,data:results});}catch(error){next(error);}
}
async function conflictEmployee(db:any,tenantId:string,id:string,clientUuid:string,baseVersion:number,payload:any):Promise<any>{const r=await db.query('SELECT revision_version,archived_at FROM employees WHERE id=$1 AND tenant_id=$2',[id,tenantId]);return r.rows.length?{clientUuid,serverId:id,status:'CONFLICT',serverVersion:r.rows[0].revision_version,conflictData:{serverVersion:r.rows[0].revision_version,clientVersion:baseVersion,clientPayload:payload}}:{clientUuid,serverId:id,status:'REJECTED',message:'Mitarbeiter nicht gefunden.'};}
