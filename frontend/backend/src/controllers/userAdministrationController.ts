import { Request, Response, NextFunction } from 'express';
import argon2 from 'argon2';
import crypto from 'crypto';
import { z } from 'zod';
import { withTenantTransaction } from '../config/database';
import {
  deliverPasswordResetEmail,
  getPasswordResetDeliveryProvider,
  PasswordResetDeliveryError
} from '../services/passwordResetDelivery';

const uuid = z.string().uuid();
const strongPassword = z.string().min(12).max(256);
const userFields = z.object({
  email: z.string().email().max(255),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  phone: z.string().trim().max(50).nullable().optional()
}).strict();
const permissionGrants = z.array(z.object({
  code: z.string().min(1).max(100),
  siteId: uuid.nullable().optional(),
  dataScope: z.enum(['TENANT', 'SITE']).default('TENANT'),
  canDelegate: z.boolean().default(false)
}).strict()).max(500);
const sensitiveDelegation = new Set(['users:manage', 'roles:manage', 'roles:delegate_admin']);

function actor(req: Request) {
  return req.user!;
}

function isSystemOperator(req: Request): boolean {
  return Boolean(actor(req).isSuperAdmin || actor(req).permissions.includes('roles:delegate_admin'));
}

function audit(
  db: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
  req: Request,
  action: string,
  target: string,
  details: Record<string, unknown>
) {
  return db.query(
    `INSERT INTO audit_logs (tenant_id,user_email,role,action_type,severity,target_entity,details,ip_address)
     VALUES ($1,$2,$3,$4,'INFO',$5,$6,$7)`,
    [actor(req).tenantId, actor(req).email, actor(req).role, action, target, JSON.stringify(details), req.ip || 'unknown']
  );
}

async function ensureDelegable(
  db: { query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<{ id: string; code: string }> }> },
  req: Request,
  codes: string[]
): Promise<void> {
  if (isSystemOperator(req)) return;
  const distinct = [...new Set(codes)];
  if (distinct.some(code => sensitiveDelegation.has(code) || !actor(req).permissions.includes(code))) {
    throw Object.assign(new Error('Sie dürfen nicht alle angeforderten Berechtigungen delegieren.'), { status: 403 });
  }
  const result = await db.query(
    'SELECT id,code FROM permissions WHERE code = ANY($1::text[])',
    [distinct]
  );
  if (result.rows.length !== distinct.length) {
    throw Object.assign(new Error('Eine oder mehrere Berechtigungen sind ungültig.'), { status: 400 });
  }
}

async function validateSites(
  db: { query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<{ id: string }> }> },
  tenantId: string,
  siteIds: string[]
): Promise<void> {
  const distinct = [...new Set(siteIds)];
  if (!distinct.length) return;
  const result = await db.query('SELECT id FROM sites WHERE tenant_id=$1 AND id=ANY($2::uuid[])', [tenantId, distinct]);
  if (result.rows.length !== distinct.length) {
    throw Object.assign(new Error('Mindestens ein Objekt gehört nicht zum authentifizierten Mandanten.'), { status: 400 });
  }
}

function sendError(res: Response, error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  if (!status) return false;
  res.status(status).json({ success: false, message: error instanceof Error ? error.message : 'Anfrage fehlgeschlagen.' });
  return true;
}

export async function listUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = actor(req).tenantId;
    const querySchema = z.object({
      q: z.string().trim().max(200).optional(),
      status: z.enum(['ACTIVE', 'INACTIVE', 'LOCKED']).optional(),
      roleId: uuid.optional(),
      siteId: uuid.optional()
    }).strict();
    const filters = querySchema.parse(req.query);
    const result = await withTenantTransaction(tenantId, db => {
      const values: unknown[] = [tenantId];
      const where = ['tm.tenant_id=$1'];
      if (filters.q) {
        values.push(`%${filters.q.replace(/[\\%_]/g, '\\$&')}%`);
        where.push(`(u.email ILIKE $${values.length} OR u.first_name ILIKE $${values.length} OR u.last_name ILIKE $${values.length})`);
      }
      if (filters.status === 'ACTIVE') where.push('tm.is_active=true AND tm.is_locked=false AND u.is_active=true');
      if (filters.status === 'INACTIVE') where.push('(tm.is_active=false OR u.is_active=false)');
      if (filters.status === 'LOCKED') where.push('(tm.is_locked=true OR u.is_locked=true OR u.locked_until>CURRENT_TIMESTAMP)');
      if (filters.roleId) {
        values.push(filters.roleId);
        where.push(`EXISTS (SELECT 1 FROM tenant_user_roles fx WHERE fx.tenant_id=tm.tenant_id AND fx.user_id=tm.user_id AND fx.role_id=$${values.length})`);
      }
      if (filters.siteId) {
        values.push(filters.siteId);
        where.push(`EXISTS (SELECT 1 FROM tenant_user_roles fs WHERE fs.tenant_id=tm.tenant_id AND fs.user_id=tm.user_id AND (fs.site_id=$${values.length} OR fs.site_id IS NULL))`);
      }
      return db.query(
        `SELECT u.id,u.email,tm.first_name,tm.last_name,tm.phone,
                (u.is_active AND tm.is_active) AS is_active,
                (u.is_locked OR tm.is_locked OR u.locked_until>CURRENT_TIMESTAMP) AS is_locked,
                tm.last_login_at,tm.created_at,
                COALESCE((SELECT json_agg(json_build_object('id',tr.id,'name',tr.name,'siteId',tur.site_id))
                  FROM tenant_user_roles tur JOIN tenant_roles tr
                    ON tr.id=tur.role_id AND tr.tenant_id=tur.tenant_id
                 WHERE tur.tenant_id=tm.tenant_id AND tur.user_id=tm.user_id),'[]'::json) AS roles,
                COALESCE((SELECT json_agg(json_build_object('id',s.id,'name',s.name))
                  FROM tenant_user_roles tur JOIN sites s
                    ON s.id=tur.site_id AND s.tenant_id=tur.tenant_id
                 WHERE tur.tenant_id=tm.tenant_id AND tur.user_id=tm.user_id AND tur.site_id IS NOT NULL),'[]'::json) AS sites
           FROM tenant_memberships tm JOIN users u ON u.id=tm.user_id
          WHERE ${where.join(' AND ')}
          ORDER BY u.last_name,u.first_name,u.email`,
        values
      );
    });
    res.json({ success: true, data: result.rows });
  } catch (error) { next(error); }
}

export async function getUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = actor(req).tenantId;
    const userId = uuid.parse(req.params.id);
    const result = await withTenantTransaction(tenantId, async db => {
      const user = await db.query(
        `SELECT u.id,u.email,tm.first_name,tm.last_name,tm.phone,
                (u.is_active AND tm.is_active) AS is_active,
                (u.is_locked OR tm.is_locked OR u.locked_until>CURRENT_TIMESTAMP) AS is_locked,
                tm.last_login_at,tm.created_at
           FROM tenant_memberships tm JOIN users u ON u.id=tm.user_id
          WHERE tm.tenant_id=$1 AND tm.user_id=$2`,
        [tenantId,userId]
      );
      if (!user.rows.length) return null;
      const roles = await db.query(
        `SELECT tur.id AS assignment_id,tr.id AS role_id,tr.name,tr.description,tur.site_id,
                s.name AS site_name
           FROM tenant_user_roles tur
           JOIN tenant_roles tr ON tr.id=tur.role_id AND tr.tenant_id=tur.tenant_id
           LEFT JOIN sites s ON s.id=tur.site_id AND s.tenant_id=tur.tenant_id
          WHERE tur.tenant_id=$1 AND tur.user_id=$2
          ORDER BY tr.name,s.name`,
        [tenantId,userId]
      );
      return { ...user.rows[0], roles: roles.rows };
    });
    if (!result) { res.status(404).json({ success:false,message:'Benutzer nicht gefunden.' }); return; }
    res.json({ success:true,data:result });
  } catch (error) { next(error); }
}

export async function createUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = actor(req).tenantId;
    const body = userFields.extend({ roleId: uuid, siteIds: z.array(uuid).max(100).default([]) }).strict().parse(req.body);
    const deliveryProvider = getPasswordResetDeliveryProvider();
    if (!deliveryProvider) {
      res.status(503).json({
        success: false,
        code: 'PASSWORD_RESET_EMAIL_NOT_CONFIGURED',
        message: 'Benutzer können nicht angelegt werden: Es ist kein E-Mail-Anbieter für Passwort-Resets konfiguriert.'
      });
      return;
    }
    const result = await withTenantTransaction(tenantId, async db => {
      const role = await db.query('SELECT id,name FROM tenant_roles WHERE id=$1 AND tenant_id=$2', [body.roleId,tenantId]);
      if (!role.rows.length) return { kind:'role-missing' as const };
      await validateSites(db,tenantId,body.siteIds);
      const rolePermissions = await db.query(
        `SELECT p.code FROM tenant_role_permissions trp
          JOIN permissions p ON p.id=trp.permission_id
         WHERE trp.tenant_id=$1 AND trp.role_id=$2
            AND ($3::uuid[] IS NULL OR trp.site_id IS NULL OR trp.site_id=ANY($3::uuid[]))`,
        [tenantId,body.roleId,body.siteIds.length ? body.siteIds : null]
      );
      await ensureDelegable(db,req,rolePermissions.rows.map(row => row.code));
      const initialSecret = crypto.randomBytes(48).toString('base64url');
      const passwordHash = await argon2.hash(initialSecret, { type: argon2.argon2id });
      const inserted = await db.query(
        `INSERT INTO users (email,password_hash,first_name,last_name,phone)
         VALUES ($1,$2,$3,$4,$5) RETURNING id,email,first_name,last_name,phone`,
        [body.email.toLowerCase(),passwordHash,body.firstName,body.lastName,body.phone ?? null]
      );
      const userId = inserted.rows[0].id;
      await db.query(
        'INSERT INTO tenant_memberships (tenant_id,user_id,first_name,last_name,phone) VALUES ($1,$2,$3,$4,$5)',
        [tenantId,userId,body.firstName,body.lastName,body.phone ?? null]
      );
      for (const siteId of body.siteIds.length ? body.siteIds : [null]) {
        await db.query(
          'INSERT INTO tenant_user_roles (tenant_id,user_id,role_id,site_id,assigned_by) VALUES ($1,$2,$3,$4,$5)',
          [tenantId,userId,body.roleId,siteId,actor(req).userId]
        );
      }
      const reset = await createResetToken(db,tenantId,userId,actor(req).userId);
      await audit(db,req,'USER_CREATED',`user:${userId}`,{ email: body.email.toLowerCase(),roleId:body.roleId,siteIds:body.siteIds });
      await deliverPasswordResetEmail(deliveryProvider, {
        recipientEmail: inserted.rows[0].email,
        recipientName: `${body.firstName} ${body.lastName}`,
        tenantId,
        token: reset.token,
        expiresAt: reset.expiresAt
      });
      return { kind:'created' as const,user:inserted.rows[0],resetExpiresAt:reset.expiresAt };
    });
    if (result.kind === 'role-missing') { res.status(400).json({success:false,message:'Rolle nicht gefunden.'}); return; }
    res.status(201).json({success:true,data:{user:result.user,resetEmailSent:true,resetExpiresAt:result.resetExpiresAt}});
  } catch (error) {
    if (error instanceof PasswordResetDeliveryError) {
      res.status(503).json({
        success: false,
        code: 'PASSWORD_RESET_EMAIL_DELIVERY_FAILED',
        message: 'Der Benutzer wurde nicht angelegt, weil die Passwort-Reset-E-Mail nicht zugestellt werden konnte.'
      });
      return;
    }
    if ((error as { code?: string })?.code === '23505') { res.status(409).json({success:false,message:'Diese E-Mail-Adresse ist bereits registriert.'}); return; }
    if (sendError(res,error)) return;
    next(error);
  }
}

export async function updateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = actor(req).tenantId;
    const userId = uuid.parse(req.params.id);
    const body = z.object({
      firstName: z.string().trim().min(1).max(100).optional(),
      lastName: z.string().trim().min(1).max(100).optional(),
      phone: z.string().trim().max(50).nullable().optional()
    }).strict().refine(value => Object.keys(value).length > 0).parse(req.body);
    const result = await withTenantTransaction(tenantId,async db => {
      const current = await db.query('SELECT user_id FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2 FOR UPDATE',[tenantId,userId]);
      if (!current.rows.length) return false;
      await db.query(
        `UPDATE tenant_memberships
            SET first_name=COALESCE($1,first_name),last_name=COALESCE($2,last_name),
                phone=CASE WHEN $3 THEN NULL ELSE COALESCE($4,phone) END,updated_at=CURRENT_TIMESTAMP
          WHERE tenant_id=$5 AND user_id=$6`,
        [body.firstName ?? null,body.lastName ?? null,body.phone === null,body.phone ?? null,tenantId,userId]
      );
      await audit(db,req,'USER_UPDATED',`user:${userId}`,{ fields:Object.keys(body) });
      return true;
    });
    if (!result) { res.status(404).json({success:false,message:'Benutzer nicht gefunden.'}); return; }
    res.json({success:true,data:{id:userId}});
  } catch(error) { next(error); }
}

export async function setUserStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId=actor(req).tenantId;
    const userId=uuid.parse(req.params.id);
    const action=z.enum(['activate','deactivate','lock','unlock']).parse(req.params.action);
    const result=await withTenantTransaction(tenantId,async db=>{
      const target=await db.query('SELECT tm.user_id,u.is_superadmin FROM tenant_memberships tm JOIN users u ON u.id=tm.user_id WHERE tm.tenant_id=$1 AND tm.user_id=$2 FOR UPDATE OF tm',[tenantId,userId]);
      if(!target.rows.length)return false;
      if(target.rows[0].is_superadmin&&!actor(req).isSuperAdmin)throw Object.assign(new Error('Systemadministratorkonten dürfen nur durch einen Systemadministrator geändert werden.'),{status:403});
      if(action==='activate'||action==='deactivate'){
        await db.query('UPDATE tenant_memberships SET is_active=$1,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=$2 AND user_id=$3',[action==='activate',tenantId,userId]);
      }else{
        await db.query('UPDATE tenant_memberships SET is_locked=$1,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=$2 AND user_id=$3',[action==='lock',tenantId,userId]);
      }
      if(action==='deactivate'||action==='lock'){
        await db.query('UPDATE user_sessions SET revoked=true WHERE tenant_id=$1 AND user_id=$2 AND revoked=false',[tenantId,userId]);
      }
      await audit(db,req,`USER_${action.toUpperCase()}`,`user:${userId}`,{});
      return true;
    });
    if(!result){res.status(404).json({success:false,message:'Benutzer nicht gefunden.'});return;}
    res.json({success:true,data:{id:userId,action}});
  }catch(error){if(sendError(res,error))return;next(error);}
}

export async function listRoles(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId=actor(req).tenantId;
    const roles=await withTenantTransaction(tenantId,async db=>{
      const result=await db.query(
        `SELECT id,name,description,is_system_role,created_at
           FROM tenant_roles WHERE tenant_id=$1 ORDER BY is_system_role DESC,name`,
        [tenantId]
      );
      const permissions=await db.query(
        `SELECT trp.role_id,p.code,p.module,p.description,trp.site_id,trp.data_scope,trp.can_delegate
           FROM tenant_role_permissions trp JOIN permissions p ON p.id=trp.permission_id
          WHERE trp.tenant_id=$1 ORDER BY p.module,p.code,trp.site_id`,
        [tenantId]
      );
      return result.rows.map(role=>({...role,permissions:permissions.rows.filter(permission=>permission.role_id===role.id)}));
    });
    res.json({success:true,data:roles});
  }catch(error){next(error);}
}

export async function listPermissions(req: Request,res: Response,next: NextFunction): Promise<void>{
  try{
    const result=await withTenantTransaction(actor(req).tenantId,db=>db.query(
      'SELECT code,module,description FROM permissions ORDER BY module,code'
    ));
    res.json({success:true,data:result.rows});
  }catch(error){next(error);}
}

export async function listAdminSites(req:Request,res:Response,next:NextFunction):Promise<void>{
  try{
    const result=await withTenantTransaction(actor(req).tenantId,db=>db.query(
      'SELECT id,name,site_code FROM sites WHERE tenant_id=$1 AND archived_at IS NULL ORDER BY name',
      [actor(req).tenantId]
    ));
    res.json({success:true,data:result.rows});
  }catch(error){next(error);}
}

export async function createRole(req: Request,res: Response,next: NextFunction): Promise<void>{
  try{
    const tenantId=actor(req).tenantId;
    const body=z.object({name:z.string().trim().min(2).max(100),description:z.string().max(1000).nullable().optional(),permissions:permissionGrants.default([])}).strict().parse(req.body);
    const result=await withTenantTransaction(tenantId,async db=>{
      const role=await db.query('INSERT INTO tenant_roles (tenant_id,name,description,created_by) VALUES ($1,$2,$3,$4) RETURNING id,name,description',[tenantId,body.name,body.description??null,actor(req).userId]);
      await replaceRolePermissions(db,req,tenantId,role.rows[0].id,body.permissions);
      await audit(db,req,'ROLE_CREATED',`role:${role.rows[0].id}`,{name:body.name,permissionCount:body.permissions.length});
      return role.rows[0];
    });
    res.status(201).json({success:true,data:result});
  }catch(error){
    if((error as {code?:string})?.code==='23505'){res.status(409).json({success:false,message:'Eine Rolle mit diesem Namen existiert bereits.'});return;}
    if(sendError(res,error))return;next(error);
  }
}

export async function updateRole(req: Request,res: Response,next: NextFunction): Promise<void>{
  try{
    const tenantId=actor(req).tenantId;
    const roleId=uuid.parse(req.params.id);
    const body=z.object({name:z.string().trim().min(2).max(100).optional(),description:z.string().max(1000).nullable().optional(),permissions:permissionGrants.optional()}).strict().refine(value=>Object.keys(value).length>0).parse(req.body);
    const result=await withTenantTransaction(tenantId,async db=>{
      const current=await db.query('SELECT id,is_system_role FROM tenant_roles WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[roleId,tenantId]);
      if(!current.rows.length)return {kind:'missing' as const};
      if(current.rows[0].is_system_role&&!actor(req).isSuperAdmin)throw Object.assign(new Error('Systemrollen dürfen nur durch einen Systemadministrator geändert werden.'),{status:403});
      await db.query('UPDATE tenant_roles SET name=COALESCE($1,name),description=CASE WHEN $2 THEN NULL ELSE COALESCE($3,description) END,updated_at=CURRENT_TIMESTAMP WHERE id=$4 AND tenant_id=$5',[body.name??null,body.description===null,body.description??null,roleId,tenantId]);
      if(body.permissions)await replaceRolePermissions(db,req,tenantId,roleId,body.permissions);
      await audit(db,req,'ROLE_UPDATED',`role:${roleId}`,{fields:Object.keys(body)});
      return {kind:'updated' as const};
    });
    if(result.kind==='missing'){res.status(404).json({success:false,message:'Rolle nicht gefunden.'});return;}
    res.json({success:true,data:{id:roleId}});
  }catch(error){
    if((error as {code?:string})?.code==='23505'){res.status(409).json({success:false,message:'Eine Rolle mit diesem Namen existiert bereits.'});return;}
    if(sendError(res,error))return;next(error);
  }
}

async function replaceRolePermissions(
  db: { query: (sql: string, values?: unknown[]) => Promise<{rows:Array<{id:string;code:string}>}> },
  req:Request,
  tenantId:string,
  roleId:string,
  grants:z.infer<typeof permissionGrants>
):Promise<void>{
  const codes=grants.map(grant=>grant.code);
  await ensureDelegable(db,req,codes);
  await validateSites(db,tenantId,grants.flatMap(grant=>grant.siteId?[grant.siteId]:[]));
  const permissions=await db.query('SELECT id,code FROM permissions WHERE code=ANY($1::text[])',[codes]);
  if(permissions.rows.length!==new Set(codes).size)throw Object.assign(new Error('Eine oder mehrere Berechtigungen sind ungültig.'),{status:400});
  if(grants.some(grant=>(grant.dataScope==='SITE')!==Boolean(grant.siteId)))throw Object.assign(new Error('Standortberechtigungen benötigen genau eine Objekt-ID.'),{status:400});
  await db.query('DELETE FROM tenant_role_permissions WHERE tenant_id=$1 AND role_id=$2',[tenantId,roleId]);
  for(const grant of grants){
    const permission=permissions.rows.find(row=>row.code===grant.code)!;
    await db.query(
      `INSERT INTO tenant_role_permissions (tenant_id,role_id,permission_id,site_id,data_scope,can_delegate)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tenantId,roleId,permission.id,grant.siteId??null,grant.dataScope,isSystemOperator(req)&&grant.canDelegate]
    );
  }
}

export async function assignRole(req: Request,res: Response,next: NextFunction):Promise<void>{
  try{
    const tenantId=actor(req).tenantId,userId=uuid.parse(req.params.id);
    const body=z.object({roleId:uuid,siteIds:z.array(uuid).max(100).default([])}).strict().parse(req.body);
    const result=await withTenantTransaction(tenantId,async db=>{
      const target=await db.query('SELECT u.is_superadmin FROM tenant_memberships tm JOIN users u ON u.id=tm.user_id WHERE tm.tenant_id=$1 AND tm.user_id=$2',[tenantId,userId]);
      if(!target.rows.length)return 'user-missing';
      if(target.rows[0].is_superadmin&&!actor(req).isSuperAdmin)throw Object.assign(new Error('Systemadministratorkonten dürfen nur durch einen Systemadministrator geändert werden.'),{status:403});
      const role=await db.query('SELECT id FROM tenant_roles WHERE tenant_id=$1 AND id=$2',[tenantId,body.roleId]);
      if(!role.rows.length)return 'role-missing';
      await validateSites(db,tenantId,body.siteIds);
      const grants=await db.query(
        `SELECT p.code FROM tenant_role_permissions trp JOIN permissions p ON p.id=trp.permission_id
         WHERE trp.tenant_id=$1 AND trp.role_id=$2
           AND ($3::uuid[] IS NULL OR trp.site_id IS NULL OR trp.site_id=ANY($3::uuid[]))`,
        [tenantId,body.roleId,body.siteIds.length?body.siteIds:null]
      );
      await ensureDelegable(db,req,grants.rows.map(grant=>grant.code));
      for(const siteId of body.siteIds.length?body.siteIds:[null]){
        await db.query('INSERT INTO tenant_user_roles (tenant_id,user_id,role_id,site_id,assigned_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[tenantId,userId,body.roleId,siteId,actor(req).userId]);
      }
      await audit(db,req,'USER_ROLE_ASSIGNED',`user:${userId}`,{roleId:body.roleId,siteIds:body.siteIds});
      await db.query('UPDATE user_sessions SET revoked=true WHERE tenant_id=$1 AND user_id=$2 AND revoked=false',[tenantId,userId]);
      return 'assigned';
    });
    if(result==='user-missing'){res.status(404).json({success:false,message:'Benutzer nicht gefunden.'});return;}
    if(result==='role-missing'){res.status(400).json({success:false,message:'Rolle gehört nicht zum authentifizierten Mandanten.'});return;}
    res.json({success:true,data:{userId,roleId:body.roleId}});
  }catch(error){if(sendError(res,error))return;next(error);}
}

export async function removeRole(req: Request,res: Response,next:NextFunction):Promise<void>{
  try{
    const tenantId=actor(req).tenantId,userId=uuid.parse(req.params.id),assignmentId=uuid.parse(req.params.assignmentId);
    const removed=await withTenantTransaction(tenantId,async db=>{
      const result=await db.query('DELETE FROM tenant_user_roles WHERE id=$1 AND tenant_id=$2 AND user_id=$3 RETURNING role_id',[assignmentId,tenantId,userId]);
      if(!result.rows.length)return false;
      await audit(db,req,'USER_ROLE_REMOVED',`user:${userId}`,{roleId:result.rows[0].role_id});
      await db.query('UPDATE user_sessions SET revoked=true WHERE tenant_id=$1 AND user_id=$2 AND revoked=false',[tenantId,userId]);
      return true;
    });
    if(!removed){res.status(404).json({success:false,message:'Rollenzuordnung nicht gefunden.'});return;}
    res.json({success:true,data:{assignmentId}});
  }catch(error){next(error);}
}

async function createResetToken(
  db:{query:(sql:string,values?:unknown[])=>Promise<unknown>},
  tenantId:string,userId:string,createdBy:string|null
):Promise<{token:string;expiresAt:string}>{
  const token=crypto.randomBytes(32).toString('base64url');
  const expiresAt=new Date(Date.now()+30*60*1000);
  const tokenHash=crypto.createHash('sha256').update(token).digest('hex');
  await db.query('UPDATE user_password_reset_tokens SET consumed_at=CURRENT_TIMESTAMP WHERE tenant_id=$1 AND user_id=$2 AND consumed_at IS NULL',[tenantId,userId]);
  await db.query('INSERT INTO user_password_reset_tokens (tenant_id,user_id,token_hash,expires_at,created_by) VALUES ($1,$2,$3,$4,$5)',[tenantId,userId,tokenHash,expiresAt,createdBy]);
  return {token,expiresAt:expiresAt.toISOString()};
}

export async function preparePasswordReset(req:Request,res:Response,next:NextFunction):Promise<void>{
  try{
    const tenantId=actor(req).tenantId,userId=uuid.parse(req.params.id);
    const deliveryProvider=getPasswordResetDeliveryProvider();
    if(!deliveryProvider){
      res.status(503).json({
        success:false,
        code:'PASSWORD_RESET_EMAIL_NOT_CONFIGURED',
        message:'Passwort-Reset kann nicht versendet werden: Es ist kein E-Mail-Anbieter konfiguriert.'
      });
      return;
    }
    const result=await withTenantTransaction(tenantId,async db=>{
      const target=await db.query(
        'SELECT u.email,tm.first_name,tm.last_name,u.is_superadmin FROM tenant_memberships tm JOIN users u ON u.id=tm.user_id WHERE tm.tenant_id=$1 AND tm.user_id=$2',
        [tenantId,userId]
      );
      if(!target.rows.length)return null;
      if(target.rows[0].is_superadmin&&!actor(req).isSuperAdmin)throw Object.assign(new Error('Systemadministratorkonten dürfen nur durch einen Systemadministrator geändert werden.'),{status:403});
      const token=await createResetToken(db,tenantId,userId,actor(req).userId);
      await db.query('UPDATE user_sessions SET revoked=true WHERE tenant_id=$1 AND user_id=$2 AND revoked=false',[tenantId,userId]);
      await audit(db,req,'PASSWORD_RESET_PREPARED',`user:${userId}`,{expiresAt:token.expiresAt,delivery:'email'});
      await deliverPasswordResetEmail(deliveryProvider,{
        recipientEmail:target.rows[0].email,
        recipientName:`${target.rows[0].first_name} ${target.rows[0].last_name}`,
        tenantId,
        token:token.token,
        expiresAt:token.expiresAt
      });
      return {expiresAt:token.expiresAt};
    });
    if(!result){res.status(404).json({success:false,message:'Benutzer nicht gefunden.'});return;}
    res.json({success:true,data:{expiresAt:result.expiresAt,delivery:'email'}});
  }catch(error){
    if(error instanceof PasswordResetDeliveryError){
      res.status(503).json({
        success:false,
        code:'PASSWORD_RESET_EMAIL_DELIVERY_FAILED',
        message:'Die Passwort-Reset-E-Mail konnte nicht zugestellt werden; der Reset wurde nicht abgeschlossen.'
      });
      return;
    }
    if(sendError(res,error))return;
    next(error);
  }
}

export async function changeOwnPassword(req:Request,res:Response,next:NextFunction):Promise<void>{
  try{
    const body=z.object({currentPassword:z.string().min(1).max(256),newPassword:strongPassword}).strict().parse(req.body);
    const tenantId=actor(req).tenantId,userId=actor(req).userId;
    const changed=await withTenantTransaction(tenantId,async db=>{
      const target=await db.query('SELECT password_hash FROM users WHERE id=$1 FOR UPDATE',[userId]);
      if(!target.rows.length||!await argon2.verify(target.rows[0].password_hash,body.currentPassword))return false;
      const hash=await argon2.hash(body.newPassword,{type:argon2.argon2id});
      await db.query('UPDATE users SET password_hash=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2',[hash,userId]);
      await db.query("SELECT set_config('app.current_user_id',$1,true)",[userId]);
      await db.query('UPDATE user_sessions SET revoked=true WHERE user_id=$1 AND token_hash<>$2',[userId,actor(req).sessionHash]);
      await db.query('UPDATE user_password_reset_tokens SET consumed_at=CURRENT_TIMESTAMP WHERE user_id=$1 AND tenant_id=$2 AND consumed_at IS NULL',[userId,tenantId]);
      await audit(db,req,'PASSWORD_CHANGED',`user:${userId}`,{});
      return true;
    });
    if(!changed){res.status(400).json({success:false,message:'Das aktuelle Passwort ist falsch.'});return;}
    res.json({success:true,data:{changed:true}});
  }catch(error){next(error);}
}

export async function completePasswordReset(req:Request,res:Response,next:NextFunction):Promise<void>{
  try{
    const body=z.object({tenantId:uuid,token:z.string().regex(/^[A-Za-z0-9_-]{43}$/),newPassword:strongPassword}).strict().parse(req.body);
    const tokenHash=crypto.createHash('sha256').update(body.token).digest('hex');
    const reset=await withTenantTransaction(body.tenantId,async db=>{
      const result=await db.query(
        `SELECT id,user_id FROM user_password_reset_tokens
          WHERE tenant_id=$1 AND token_hash=$2 AND consumed_at IS NULL AND expires_at>CURRENT_TIMESTAMP
          FOR UPDATE`,
        [body.tenantId,tokenHash]
      );
      if(!result.rows.length)return null;
      const userId=result.rows[0].user_id;
      const hash=await argon2.hash(body.newPassword,{type:argon2.argon2id});
      await db.query('UPDATE users SET password_hash=$1,failed_login_attempts=0,locked_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$2',[hash,userId]);
      await db.query('UPDATE user_password_reset_tokens SET consumed_at=CURRENT_TIMESTAMP WHERE tenant_id=$1 AND user_id=$2 AND consumed_at IS NULL',[body.tenantId,userId]);
      await db.query("SELECT set_config('app.current_user_id',$1,true)",[userId]);
      await db.query('UPDATE user_sessions SET revoked=true WHERE user_id=$1',[userId]);
      await db.query(
        `INSERT INTO audit_logs (tenant_id,user_email,role,action_type,severity,target_entity,details,ip_address)
         SELECT $1,u.email,'self-service','PASSWORD_RESET_COMPLETED','INFO',$2,'{}','unknown' FROM users u WHERE u.id=$3`,
        [body.tenantId,`user:${userId}`,userId]
      );
      return userId;
    });
    if(!reset){res.status(400).json({success:false,message:'Der Wiederherstellungstoken ist ungültig oder abgelaufen.'});return;}
    res.json({success:true,data:{passwordChanged:true}});
  }catch(error){next(error);}
}

export async function listUserAudit(req:Request,res:Response,next:NextFunction):Promise<void>{
  try{
    const tenantId=actor(req).tenantId,userId=uuid.parse(req.params.id);
    const result=await withTenantTransaction(tenantId,async db=>{
      const exists=await db.query('SELECT 1 FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2',[tenantId,userId]);
      if(!exists.rows.length)return null;
      return db.query(
        `SELECT id,user_email,role,action_type,severity,target_entity,details,created_at
           FROM audit_logs WHERE tenant_id=$1 AND target_entity=$2
          ORDER BY created_at DESC LIMIT 100`,
        [tenantId,`user:${userId}`]
      );
    });
    if(!result){res.status(404).json({success:false,message:'Benutzer nicht gefunden.'});return;}
    res.json({success:true,data:result.rows});
  }catch(error){next(error);}
}
