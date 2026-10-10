import { AppConfig } from '../server/config/AppConfig.ts';
import { buildContainer } from '../server/composition/buildContainer.ts';
import { MIGRATIONS } from '../server/infra/database/migrations.ts';
import { TOKENS } from '../server/di/tokens.ts';
import { exchangeDocumentSchema, type ExchangeDocumentInput } from '../shared/schemas.ts';

// Exemplo: Java -> Node API -> MySQL (a Node não fala com a Java).
const doc: ExchangeDocumentInput = {
  mode: 'replace',
  nodes: [
    {
      ref: 'mysql',
      name: 'MySQL Principal',
      kind: 'database',
      tech: 'mysql 8',
      interfaces: [
        { name: 'users', type: 'table' },
        { name: 'orders', type: 'table' },
      ],
    },
    {
      ref: 'node',
      name: 'Node API',
      kind: 'service',
      tech: 'node / express',
      interfaces: [
        { name: 'GET /users', type: 'http', spec: 'GET /users' },
        { name: 'POST /orders', type: 'http', spec: 'POST /orders' },
      ],
    },
    { ref: 'node.users', name: 'UsersModule', kind: 'module', parent: 'node' },
    { ref: 'node.users.repo', name: 'UserRepository', kind: 'module', parent: 'node.users' },
    { ref: 'node.orders', name: 'OrdersModule', kind: 'module', parent: 'node' },
    { ref: 'rabbit', name: 'RabbitMQ', kind: 'queue', tech: 'rabbitmq', interfaces: [{ name: 'order.created', type: 'exchange' }] },
    { ref: 'java', name: 'Java Backoffice', kind: 'project', tech: 'java / spring' },
    { ref: 'java.client', name: 'NodeApiClient', kind: 'module', parent: 'java' },
    { ref: 'k8s', name: 'Cluster K8s', kind: 'infra', tech: 'kubernetes' },
  ],
  connections: [
    { ref: 'node->mysql', from: 'node', to: 'mysql', protocol: 'sql', description: 'Persistência principal' },
    {
      from: 'node.users.repo',
      to: 'mysql',
      interface: 'users',
      protocol: 'sql',
      implements: 'node->mysql',
      callSites: [{ file_path: 'src/users/user.repository.ts', line: 18, symbol: 'UserRepository.findAll' }],
    },
    { from: 'node.orders', to: 'mysql', interface: 'orders', protocol: 'sql', implements: 'node->mysql' },
    { from: 'node.orders', to: 'rabbit', interface: 'order.created', protocol: 'amqp', description: 'Publica evento de pedido' },
    { ref: 'java->node', from: 'java', to: 'node', protocol: 'http' },
    {
      from: 'java.client',
      to: 'node',
      interface: 'GET /users',
      protocol: 'http',
      implements: 'java->node',
      callSites: [{ file_path: 'src/main/java/com/acme/NodeApiClient.java', line: 42, symbol: 'NodeApiClient.listUsers' }],
    },
  ],
};

const container = buildContainer(AppConfig.fromEnv());
const db = container.resolve(TOKENS.Database);
await db.waitUntilReady();
await db.migrate(MIGRATIONS);
console.log(await container.resolve(TOKENS.ExchangeService).importDocument(exchangeDocumentSchema.parse(doc), 1));
await db.close();
