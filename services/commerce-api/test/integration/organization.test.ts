import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp } from '../helpers/app.js';
import { resetDatabase, seedRbac, grantPermissions } from '../helpers/db.js';
import { createAuthenticatedStaff } from '../helpers/auth.js';

/**
 * M00 acceptance/m00-project-foundation.md: a second Brand or Location
 * can be created after initial seed data with no schema migration
 * (ORG-001/ORG-002 extensibility), and Brand/Location support
 * create/read/update.
 */
describe('Organization: Brand & Location (M00)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedRbac();
  });

  it('creates, lists, and updates multiple brands without a schema change', async () => {
    await grantPermissions('BUSINESS_ADMIN', ['org:manage']);
    const { token } = await createAuthenticatedStaff(app, ['BUSINESS_ADMIN']);

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/organization/brands',
      headers: { authorization: `Bearer ${token}` },
      payload: { code: 'HOUSE', name: 'House Label' },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/organization/brands',
      headers: { authorization: `Bearer ${token}` },
      payload: { code: 'STREETWEAR', name: 'Streetwear Sub-brand' },
    });
    expect(second.statusCode).toBe(201);
    const secondId = second.json().id as string;

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/organization/brands',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listRes.json()).toHaveLength(2);

    const updateRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/organization/brands/${secondId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Streetwear Renamed' },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().name).toBe('Streetwear Renamed');
  });

  it('creates a second Location without a schema change', async () => {
    await grantPermissions('BUSINESS_ADMIN', ['org:manage']);
    const { token } = await createAuthenticatedStaff(app, ['BUSINESS_ADMIN']);

    await app.inject({
      method: 'POST',
      url: '/api/v1/organization/locations',
      headers: { authorization: `Bearer ${token}` },
      payload: { code: 'WH-DEL-01', name: 'Delhi Warehouse', type: 'WAREHOUSE' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/organization/locations',
      headers: { authorization: `Bearer ${token}` },
      payload: { code: 'WH-BLR-01', name: 'Bangalore Warehouse', type: 'WAREHOUSE' },
    });
    expect(second.statusCode).toBe(201);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/organization/locations',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listRes.json()).toHaveLength(2);
  });

  it('rejects creating a Brand/Location without org:manage permission', async () => {
    const { token } = await createAuthenticatedStaff(app, ['ANALYTICS']);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/organization/brands',
      headers: { authorization: `Bearer ${token}` },
      payload: { code: 'X', name: 'X' },
    });
    expect(res.statusCode).toBe(403);
  });
});
