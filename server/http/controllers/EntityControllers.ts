import type { CallSite, Connection, GraphNode, NodeInterface } from '../../../shared/types.ts';
import {
  createCallSiteSchema,
  createConnectionSchema,
  createInterfaceSchema,
  createNodeSchema,
  updateCallSiteSchema,
  updateConnectionSchema,
  updateInterfaceSchema,
  updateNodeSchema,
  type CreateCallSiteInput,
  type CreateConnectionInput,
  type CreateInterfaceInput,
  type CreateNodeInput,
  type UpdateCallSiteInput,
  type UpdateConnectionInput,
  type UpdateInterfaceInput,
  type UpdateNodeInput,
} from '../../../shared/schemas.ts';
import type { ICallSiteService, IConnectionService, IInterfaceService, INodeService } from '../../services/contracts/index.ts';
import { CrudController } from './CrudController.ts';

export class NodeController extends CrudController<GraphNode, CreateNodeInput, UpdateNodeInput> {
  constructor(service: INodeService) {
    super(service, createNodeSchema, updateNodeSchema);
  }
}

export class InterfaceController extends CrudController<NodeInterface, CreateInterfaceInput, UpdateInterfaceInput> {
  constructor(service: IInterfaceService) {
    super(service, createInterfaceSchema, updateInterfaceSchema);
  }
}

export class ConnectionController extends CrudController<Connection, CreateConnectionInput, UpdateConnectionInput> {
  constructor(service: IConnectionService) {
    super(service, createConnectionSchema, updateConnectionSchema);
  }
}

export class CallSiteController extends CrudController<CallSite, CreateCallSiteInput, UpdateCallSiteInput> {
  constructor(service: ICallSiteService) {
    super(service, createCallSiteSchema, updateCallSiteSchema);
  }
}
