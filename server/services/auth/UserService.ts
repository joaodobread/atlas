import type { User } from '../../../shared/types.ts';
import type { CreateUserInput, UpdateUserInput } from '../../../shared/schemas.ts';
import type { AuthUser } from '../../core/auth/AuthUser.ts';
import { BusinessRuleError, NotFoundError } from '../../core/errors/AppError.ts';
import type { IPasswordHasher } from '../../infra/crypto/IPasswordHasher.ts';
import type { ISessionRepository, IUserRepository } from '../../repositories/contracts/IUserRepository.ts';
import type { IUserService } from '../contracts/index.ts';

export class UserService implements IUserService {
  constructor(
    private readonly users: IUserRepository,
    private readonly sessions: ISessionRepository,
    private readonly hasher: IPasswordHasher,
  ) {}

  async list(): Promise<User[]> {
    return await this.users.findAll();
  }

  async create(input: CreateUserInput): Promise<User> {
    if (await this.users.findByEmailWithSecret(input.email)) throw new BusinessRuleError('Já existe um usuário com este e-mail');
    return await this.users.create({ email: input.email, name: input.name, role: input.role, password_hash: await this.hasher.hash(input.password) });
  }

  async update(actor: AuthUser, id: number, input: UpdateUserInput): Promise<User> {
    const target = await this.users.findById(id);
    if (!target) throw new NotFoundError(`Usuário ${id} não encontrado`);
    if (input.email && input.email !== target.email && (await this.users.findByEmailWithSecret(input.email))) {
      throw new BusinessRuleError('Já existe um usuário com este e-mail');
    }
    const losesAdmin = target.role === 'admin' && target.active && ((input.role && input.role !== 'admin') || input.active === false);
    if (losesAdmin && (await this.users.countActiveAdmins()) <= 1) throw new BusinessRuleError('Precisa existir ao menos um administrador ativo');
    if (actor.id === id && input.active === false) throw new BusinessRuleError('Você não pode desativar a si mesmo');

    const updated = await this.users.update(id, {
      name: input.name,
      email: input.email,
      role: input.role,
      active: input.active,
      password_hash: input.password ? await this.hasher.hash(input.password) : undefined,
    });
    // Desativado ou senha trocada pelo admin: derruba as sessões abertas.
    if (input.active === false || input.password) await this.sessions.deleteForUser(id);
    return updated;
  }

  async delete(actor: AuthUser, id: number): Promise<void> {
    const target = await this.users.findById(id);
    if (!target) throw new NotFoundError(`Usuário ${id} não encontrado`);
    if (actor.id === id) throw new BusinessRuleError('Você não pode excluir a si mesmo');
    if (target.role === 'admin' && target.active && (await this.users.countActiveAdmins()) <= 1) {
      throw new BusinessRuleError('Precisa existir ao menos um administrador ativo');
    }
    await this.users.delete(id);
  }
}
