import type { ApiTokenView, CreatedApiToken } from '../../../shared/types.ts';
import type { CreateApiTokenInput } from '../../../shared/schemas.ts';
import type { AuthUser } from '../../core/auth/AuthUser.ts';
import { NotFoundError } from '../../core/errors/AppError.ts';
import type { ITokenService } from '../../infra/crypto/TokenService.ts';
import type { IApiTokenRepository } from '../../repositories/contracts/IUserRepository.ts';
import type { IApiTokenService } from '../contracts/index.ts';

/** Tokens de API pessoais (Authorization: Bearer): mesmas permissões do dono. */
export class ApiTokenService implements IApiTokenService {
  constructor(
    private readonly apiTokens: IApiTokenRepository,
    private readonly tokens: ITokenService,
  ) {}

  async list(user: AuthUser): Promise<ApiTokenView[]> {
    return await this.apiTokens.listForUser(user.id);
  }

  async create(user: AuthUser, input: CreateApiTokenInput): Promise<CreatedApiToken> {
    const token = this.tokens.generate('cgt');
    const view = await this.apiTokens.create(user.id, input.name, this.tokens.hash(token), token.slice(0, 10));
    return { ...view, token };
  }

  async revoke(user: AuthUser, id: number): Promise<void> {
    if (!(await this.apiTokens.delete(id, user.id))) throw new NotFoundError('Token não encontrado');
  }
}
