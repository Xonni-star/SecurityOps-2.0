import assert from 'node:assert/strict';
import argon2 from 'argon2';
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  S3Client
} from '@aws-sdk/client-s3';
import crypto from 'crypto';
import net from 'net';
import request from 'supertest';
import { app } from '../app';
import { migrationPool, pool } from '../config/database';
import { env } from '../config/env';
import { authHeaders } from '../tests/testUtils';
import { S3DocumentObjectStore, setDocumentObjectStore, maxDocumentUploadBytes } from '../services/documentFiles';
import { ClamAvDocumentScanner, documentScanner } from '../services/documentScanner';

const readinessTimeoutMs = 5 * 60 * 1000;
const connectionTimeoutMs = 1500;
const tenantFrankfurtId = '11111111-1111-1111-1111-111111111111';
const tenantBavariaId = '22222222-2222-2222-2222-222222222222';
const seedEmail = 'a.schmidt@ffm-sec.de';
const seedPassword = 'SecOpsVault2025SecurePassword!';
const boundaryEmail = `dms-api-boundary-${crypto.randomUUID()}@example.test`;
const boundaryPassword = `DmsApiBoundary-${crypto.randomUUID()}!`;
const cleanPdf = Buffer.from('%PDF-1.7\nSecurityOps clean DMS integration fixture.\n%%EOF\n');
const eicarSignature = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
const storage = new S3Client({
  endpoint: env.DMS_S3_ENDPOINT,
  region: env.DMS_S3_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: env.DMS_S3_ACCESS_KEY, secretAccessKey: env.DMS_S3_SECRET_KEY }
});
const createdDocumentIds: string[] = [];
let boundaryUserId: string | undefined;
let bucketCreated = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pingClamAv(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: env.DMS_CLAMAV_HOST, port: env.DMS_CLAMAV_PORT });
    let response = '';
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ready);
    };

    socket.setTimeout(connectionTimeoutMs, () => finish(false));
    socket.on('connect', () => socket.end('zPING\0'));
    socket.on('data', (data) => {
      response += data.toString('utf8');
      if (response.includes('PONG')) finish(true);
    });
    socket.on('end', () => finish(response.includes('PONG')));
    socket.on('error', () => finish(false));
  });
}

async function waitForServices(): Promise<void> {
  const deadline = Date.now() + readinessTimeoutMs;
  let clamavReady = false;
  let storageReady = false;
  let lastStorageError: unknown;
  while (Date.now() < deadline) {
    if (!clamavReady) clamavReady = await pingClamAv();
    if (!storageReady) {
      try {
        await storage.send(new ListBucketsCommand({}));
        storageReady = true;
      } catch (error) {
        lastStorageError = error;
      }
    }
    if (clamavReady && storageReady) {
      await storage.send(new CreateBucketCommand({ Bucket: env.DMS_S3_BUCKET }));
      bucketCreated = true;
      return;
    }
    await sleep(1000);
  }
  const storageFailure = lastStorageError instanceof Error ? ` S3 readiness error: ${lastStorageError.message}` : '';
  throw new Error(
    `DMS integration services did not become ready within ${readinessTimeoutMs} ms.` +
    `${clamavReady ? '' : ' ClamAV did not answer zPING.'}${storageReady ? '' : storageFailure || ' MinIO did not answer.'}`
  );
}

async function login(email: string, password: string): Promise<string> {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .set('Origin', 'http://localhost:3000')
    .send({ email, password });
  assert.equal(response.status, 200, `Test login failed for ${email}.`);
  const setCookies = response.headers['set-cookie'];
  const cookie = (Array.isArray(setCookies) ? setCookies : [setCookies || ''])
    .find((value) => value.startsWith('secops_session='));
  const sessionId = cookie?.match(/^secops_session=([^;]+)/)?.[1];
  assert.ok(sessionId, 'Login did not return a session cookie.');
  assert.equal(typeof response.body.data.csrfToken, 'string', 'Login did not return a CSRF token.');
  return `${sessionId}|${response.body.data.csrfToken}`;
}

function upload(token: string, categoryId: string, filename: string, bytes: Buffer, title: string) {
  return request(app)
    .post('/api/v1/documents')
    .query({ title, categoryId })
    .set(authHeaders(token))
    .set('Content-Type', 'application/octet-stream')
    .set('X-File-Name', encodeURIComponent(filename))
    .send(bytes);
}

function download(token: string, documentId: string) {
  return request(app)
    .get(`/api/v1/documents/${documentId}/download`)
    .set(authHeaders(token))
    .buffer()
    .parse((response, callback) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => callback(null, Buffer.concat(chunks)));
    });
}

async function createBoundaryUser(): Promise<void> {
  const passwordHash = await argon2.hash(boundaryPassword, { type: argon2.argon2id });
  const user = await migrationPool.query(
    `INSERT INTO users (email,password_hash,first_name,last_name,phone)
     VALUES ($1,$2,'DMS','Boundary','+49 89 000') RETURNING id`,
    [boundaryEmail, passwordHash]
  );
  boundaryUserId = user.rows[0].id;
  await migrationPool.query(
    `INSERT INTO tenant_memberships (tenant_id,user_id,first_name,last_name,phone)
     VALUES ($1,$2,'DMS','Boundary','+49 89 000')`,
    [tenantBavariaId, boundaryUserId]
  );
  const assignment = await migrationPool.query(
    `INSERT INTO user_roles (user_id,role_id,tenant_id)
     SELECT $1,id,$2 FROM roles WHERE name='Einsatzleitung'`,
    [boundaryUserId, tenantBavariaId]
  );
  assert.equal(assignment.rowCount, 1, 'The tenant-boundary fixture requires the seeded Einsatzleitung role.');
}

async function cleanup(): Promise<void> {
  const failures: unknown[] = [];
  const attempt = async (action: () => Promise<void>): Promise<void> => {
    try {
      await action();
    } catch (error) {
      failures.push(error);
    }
  };

  if (bucketCreated) {
    await attempt(async () => {
      let continuationToken: string | undefined;
      do {
        const page = await storage.send(new ListObjectsV2Command({
          Bucket: env.DMS_S3_BUCKET,
          ContinuationToken: continuationToken
        }));
        for (const object of page.Contents ?? []) {
          if (object.Key) {
            await storage.send(new DeleteObjectCommand({ Bucket: env.DMS_S3_BUCKET, Key: object.Key }));
          }
        }
        continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (continuationToken);
    });
  }
  if (createdDocumentIds.length) {
    await attempt(async () => {
      const client = await migrationPool.connect();
      try {
        await client.query('SET session_replication_role = replica');
        await client.query('DELETE FROM document_storage_deletion_outbox WHERE tenant_id=$1 AND document_id=ANY($2::uuid[])', [tenantFrankfurtId, createdDocumentIds]);
        await client.query('DELETE FROM document_audit_events WHERE tenant_id=$1 AND document_id=ANY($2::uuid[])', [tenantFrankfurtId, createdDocumentIds]);
        await client.query('DELETE FROM document_relationships WHERE tenant_id=$1 AND document_id=ANY($2::uuid[])', [tenantFrankfurtId, createdDocumentIds]);
        await client.query('DELETE FROM document_tag_assignments WHERE tenant_id=$1 AND document_id=ANY($2::uuid[])', [tenantFrankfurtId, createdDocumentIds]);
        await client.query('DELETE FROM document_versions WHERE tenant_id=$1 AND document_id=ANY($2::uuid[])', [tenantFrankfurtId, createdDocumentIds]);
        await client.query('DELETE FROM documents WHERE tenant_id=$1 AND id=ANY($2::uuid[])', [tenantFrankfurtId, createdDocumentIds]);
      } finally {
        try {
          await client.query('SET session_replication_role = origin');
        } finally {
          client.release();
        }
      }
    });
  }
  if (boundaryUserId) {
    await attempt(async () => {
      await migrationPool.query('DELETE FROM user_sessions WHERE user_id=$1', [boundaryUserId]);
      await migrationPool.query('DELETE FROM user_roles WHERE user_id=$1', [boundaryUserId]);
      await migrationPool.query('DELETE FROM tenant_memberships WHERE tenant_id=$1 AND user_id=$2', [tenantBavariaId, boundaryUserId]);
      await migrationPool.query('DELETE FROM users WHERE id=$1', [boundaryUserId]);
    });
  }
  if (bucketCreated) {
    await attempt(async () => {
      await storage.send(new DeleteBucketCommand({ Bucket: env.DMS_S3_BUCKET }));
    });
  }
  storage.destroy();
  await Promise.all([pool.end(), migrationPool.end()]);
  if (failures.length) {
    throw new AggregateError(failures, 'One or more DMS integration cleanup steps failed.');
  }
}

async function run(): Promise<void> {
  assert.equal(env.DMS_SCANNER_PROVIDER, 'clamav', 'Integration check requires the ClamAV provider.');
  assert.equal(env.DMS_SCAN_REQUIRED, true, 'Integration check requires fail-closed scanning.');
  assert.ok(documentScanner instanceof ClamAvDocumentScanner, 'The DMS API must use the real ClamAV scanner adapter.');

  setDocumentObjectStore(new S3DocumentObjectStore());
  await waitForServices();

  const token = await login(seedEmail, seedPassword);
  const categories = await request(app).get('/api/v1/documents/categories').set(authHeaders(token));
  assert.equal(categories.status, 200);
  const categoryId = categories.body.data.find((item: { name: string }) => item.name === 'Verträge')?.id;
  assert.ok(categoryId, 'The seeded tenant must have a DMS category.');

  const invalidType = await upload(token, categoryId, 'fake.pdf', Buffer.from('not a PDF'), 'Invalid type fixture');
  assert.equal(invalidType.status, 415, 'The API must reject mismatched file contents.');

  const oversized = await upload(
    token,
    categoryId,
    'oversized.txt',
    Buffer.alloc(maxDocumentUploadBytes() + 1, 0x61),
    'Oversized fixture'
  );
  assert.equal(oversized.status, 413, 'The API must reject a file larger than the configured maximum.');

  const cleanUpload = await upload(token, categoryId, 'clean-integration.pdf', cleanPdf, 'Clean DMS integration fixture');
  if (cleanUpload.body?.data?.id) createdDocumentIds.push(cleanUpload.body.data.id);
  assert.equal(cleanUpload.status, 201);
  const cleanDocumentId = cleanUpload.body.data.id as string;
  assert.equal(cleanUpload.body.data.scan_status, 'clean');
  assert.equal(cleanUpload.body.data.file_released, true);

  const cleanState = await migrationPool.query(
    `SELECT version.scan_status, version.released_at, version.storage_key
       FROM document_versions version
      WHERE version.tenant_id=$1 AND version.document_id=$2 AND version.version_number=1`,
    [tenantFrankfurtId, cleanDocumentId]
  );
  assert.equal(cleanState.rows[0]?.scan_status, 'clean');
  assert.ok(cleanState.rows[0]?.released_at, 'A clean file must be persisted as released.');

  const cleanKey = cleanState.rows[0].storage_key as string;
  const anonymousObjectResponse = await fetch(
    `${env.DMS_S3_ENDPOINT.replace(/\/$/, '')}/${env.DMS_S3_BUCKET}/${cleanKey}`,
    { signal: AbortSignal.timeout(5000) }
  );
  assert.equal(anonymousObjectResponse.status, 403, 'The S3-compatible bucket must not allow anonymous object reads.');

  const unauthenticatedDownload = await request(app).get(`/api/v1/documents/${cleanDocumentId}/download`);
  assert.equal(unauthenticatedDownload.status, 401, 'File downloads must require an authenticated session.');
  const cleanDownload = await download(token, cleanDocumentId);
  assert.equal(cleanDownload.status, 200);
  assert.deepEqual(cleanDownload.body, cleanPdf);

  await createBoundaryUser();
  const boundaryToken = await login(boundaryEmail, boundaryPassword);
  const crossTenantDownload = await request(app)
    .get(`/api/v1/documents/${cleanDocumentId}/download`)
    .set(authHeaders(boundaryToken));
  assert.equal(crossTenantDownload.status, 404, 'A different tenant must not retrieve document metadata or bytes.');

  const cleanAudit = await request(app).get(`/api/v1/documents/${cleanDocumentId}/audit`).set(authHeaders(token));
  assert.equal(cleanAudit.status, 200);
  assert.deepEqual(
    ['uploaded', 'scan_clean', 'downloaded'].map((action) => cleanAudit.body.data.some((item: { action: string }) => item.action === action)),
    [true, true, true],
    'Upload, successful scan/release, and authorized download must be auditable.'
  );

  const infectedUpload = await upload(token, categoryId, 'eicar-integration.txt', eicarSignature, 'EICAR quarantine integration fixture');
  if (infectedUpload.body?.data?.id) createdDocumentIds.push(infectedUpload.body.data.id);
  assert.equal(infectedUpload.status, 202);
  const infectedDocumentId = infectedUpload.body.data.id as string;
  assert.equal(infectedUpload.body.data.scan_status, 'infected');
  assert.equal(infectedUpload.body.data.file_released, false);

  const infectedState = await migrationPool.query(
    `SELECT scan_status, released_at FROM document_versions
      WHERE tenant_id=$1 AND document_id=$2 AND version_number=1`,
    [tenantFrankfurtId, infectedDocumentId]
  );
  assert.equal(infectedState.rows[0]?.scan_status, 'infected');
  assert.equal(infectedState.rows[0]?.released_at, null, 'An infected file must remain quarantined.');
  const blockedDownload = await request(app)
    .get(`/api/v1/documents/${infectedDocumentId}/download`)
    .set(authHeaders(token));
  assert.equal(blockedDownload.status, 423, 'A quarantined file must not be downloadable.');

  const infectedAudit = await request(app).get(`/api/v1/documents/${infectedDocumentId}/audit`).set(authHeaders(token));
  assert.equal(infectedAudit.status, 200);
  assert.ok(infectedAudit.body.data.some((item: { action: string }) => item.action === 'scan_infected'));
  assert.ok(!infectedAudit.body.data.some((item: { action: string }) => item.action === 'downloaded'));
  console.log('DMS API integration verified type/size validation, private S3 storage, real ClamAV release/quarantine, authorization, tenant isolation, and audit events.');
}

run()
  .catch((error: unknown) => {
    console.error('DMS API integration check failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (error) {
      console.error('DMS API integration cleanup failed:', error);
      process.exitCode = 1;
    }
  });
