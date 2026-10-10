import { beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testDatabase } from '../../../test/support/database.ts';
import { PgCallSiteRepository } from './PgCallSiteRepository.ts';
import { PgConnectionRepository } from './PgConnectionRepository.ts';
import { PgInterfaceRepository } from './PgInterfaceRepository.ts';
import { PgNodeRepository } from './PgNodeRepository.ts';

describe('PgConnectionRepository / PgInterfaceRepository / PgCallSiteRepository', () => {
  let nodes: PgNodeRepository;
  let interfaces: PgInterfaceRepository;
  let connections: PgConnectionRepository;
  let callSites: PgCallSiteRepository;
  let a: number;
  let b: number;

  beforeEach(async () => {
    const db = await testDatabase();
    await resetDatabase(db);
    nodes = new PgNodeRepository(db);
    interfaces = new PgInterfaceRepository(db);
    connections = new PgConnectionRepository(db);
    callSites = new PgCallSiteRepository(db);
    a = (await nodes.create({ graph_id: 1, name: 'A', kind: 'project' })).id;
    b = (await nodes.create({ graph_id: 1, name: 'B', kind: 'project' })).id;
  });

  describe('interfaces', () => {
    it('cria, ordena por nome (case-insensitive) e busca por nó+nome', async () => {
      await interfaces.create({ node_id: b, name: 'rest', type: 'http' });
      const grpc = await interfaces.create({ node_id: b, name: 'GRPC' });
      expect(grpc).toMatchObject({ node_id: b, name: 'GRPC', type: null, spec: null, description: null });
      expect((await interfaces.findAll()).map((i) => i.name)).toEqual(['GRPC', 'rest']);
      expect((await interfaces.findByNodeAndName(b, 'GRPC'))?.id).toBe(grpc.id);
      expect(await interfaces.findByNodeAndName(a, 'GRPC')).toBeNull();
    });

    it('update e delete', async () => {
      const i = await interfaces.create({ node_id: b, name: 'x' });
      expect(await interfaces.update(i.id, { spec: 'openapi.yaml' })).toMatchObject({ name: 'x', spec: 'openapi.yaml' });
      expect(await interfaces.delete(i.id)).toBe(true);
    });
  });

  describe('connections', () => {
    it('findByEndpoints diferencia interface nula de definida', async () => {
      const iface = await interfaces.create({ node_id: b, name: 'rest' });
      const plain = await connections.create({ source_id: a, target_id: b, protocol: 'http' });
      const viaIface = await connections.create({ source_id: a, target_id: b, target_interface_id: iface.id });
      expect(plain).toMatchObject({ source_id: a, target_id: b, target_interface_id: null, parent_connection_id: null, protocol: 'http' });
      expect((await connections.findByEndpoints(a, b, null))?.id).toBe(plain.id);
      expect((await connections.findByEndpoints(a, b, iface.id))?.id).toBe(viaIface.id);
      expect(await connections.findByEndpoints(b, a, null)).toBeNull();
    });

    it('remover a interface zera a referência (ON DELETE SET NULL)', async () => {
      const iface = await interfaces.create({ node_id: b, name: 'rest' });
      const c = await connections.create({ source_id: a, target_id: b, target_interface_id: iface.id });
      await interfaces.delete(iface.id);
      expect((await connections.findById(c.id))?.target_interface_id).toBeNull();
    });

    it('rejeita conexão de um nó para ele mesmo (CHECK)', async () => {
      await expect(connections.create({ source_id: a, target_id: a })).rejects.toThrow(/check/i);
    });

    it('deleteAll remove todas as conexões (e os call sites em cascata)', async () => {
      const c = await connections.create({ source_id: a, target_id: b });
      await connections.create({ source_id: b, target_id: a });
      await callSites.create({ connection_id: c.id, file_path: 'x.ts' });
      await connections.deleteAll();
      expect(await connections.findAll()).toEqual([]);
      expect(await callSites.findAll()).toEqual([]);
    });
  });

  describe('call sites', () => {
    it('ordena por arquivo e linha; existsAt diferencia linha nula', async () => {
      const c = await connections.create({ source_id: a, target_id: b });
      await callSites.create({ connection_id: c.id, file_path: 'b.ts', line: 1 });
      await callSites.create({ connection_id: c.id, file_path: 'a.ts', line: 20 });
      await callSites.create({ connection_id: c.id, file_path: 'a.ts', line: 3, symbol: 'call()' });
      await callSites.create({ connection_id: c.id, file_path: 'c.ts' });
      expect((await callSites.findAll()).map((s) => `${s.file_path}:${s.line}`)).toEqual(['a.ts:3', 'a.ts:20', 'b.ts:1', 'c.ts:null']);

      expect(await callSites.existsAt(c.id, 'a.ts', 3)).toBe(true);
      expect(await callSites.existsAt(c.id, 'a.ts', 4)).toBe(false);
      expect(await callSites.existsAt(c.id, 'c.ts', null)).toBe(true);
      expect(await callSites.existsAt(c.id, 'a.ts', null)).toBe(false);
      expect(await callSites.existsAt(c.id + 1, 'a.ts', 3)).toBe(false);
    });
  });
});
