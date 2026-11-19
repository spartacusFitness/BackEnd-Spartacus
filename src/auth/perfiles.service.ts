import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { config } from '../config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { nearest } from '../sedes.js';
import { authCache } from './auth-cache.js';
import type { SupabaseClaims } from './supabase-jwt.js';

export type RolNombre = 'admin' | 'encargado' | 'recepcion' | 'coach' | 'socio';

export interface Yo {
  id: string;
  email: string;
  nombre: string | null;
  apodo: string | null;
  fotoUrl: string | null;
  fechaNacimiento: string | null;
  sede: { id: string; nombre: string } | null;
  roles: { rol: RolNombre; sedeId: string | null }[];
}

const AVATARS = 'avatars';

/** Lee un número de user_metadata con seguridad (lo escribe la persona; solo se usa como dato, nunca para autorizar). */
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null);

@Injectable()
export class PerfilesService {
  constructor(private readonly prisma: PrismaService) {}

  private get orm() {
    return this.prisma.db.orm.public;
  }

  private async sedesActivas() {
    return this.orm.Sede.where({ activa: true }).select('id', 'nombre', 'lat', 'lng').all();
  }

  /** Perfil de la cuenta de Supabase; lo crea la primera vez que la persona entra. */
  async ensure(claims: SupabaseClaims) {
    const existing = await this.orm.Perfil.where({ userId: claims.userId }).first();
    if (existing) return existing;

    const meta = claims.userMetadata;
    // La ubicación llega en user_metadata desde el registro; con ella calculamos la sede más cercana.
    const ubic = (meta.ubicacion ?? null) as { lat?: unknown; lng?: unknown } | null;
    const lat = num(ubic?.lat);
    const lng = num(ubic?.lng);
    const sede = lat !== null && lng !== null ? nearest(await this.sedesActivas(), lat, lng) : undefined;

    try {
      const perfil = await this.orm.Perfil.create({
        userId: claims.userId,
        email: claims.email,
        nombre: str(meta.full_name) ?? str(meta.name),
        fotoUrl: str(meta.avatar_url) ?? str(meta.picture),
        sedeId: sede?.id ?? null,
      });
      if (sede) await this.orm.RolAsignado.create({ perfilId: perfil.id, rol: 'socio', sedeId: sede.id });
      return perfil;
    } catch (err) {
      // Dos peticiones a la vez: la otra ya lo creó.
      const again = await this.orm.Perfil.where({ userId: claims.userId }).first();
      if (again) return again;
      throw err;
    }
  }

  async roles(perfilId: string) {
    const rows = await this.orm.RolAsignado.where({ perfilId }).select('rol', 'sedeId').all();
    return rows.map((r) => ({ rol: r.rol as RolNombre, sedeId: r.sedeId }));
  }

  async yo(perfilId: string): Promise<Yo> {
    const [p, roles, sedes] = await Promise.all([
      this.orm.Perfil.first({ id: perfilId }),
      this.roles(perfilId),
      this.orm.Sede.select('id', 'nombre').all(), // 3 filas: más barato que esperar al perfil para pedir la suya
    ]);
    if (!p) throw new UnauthorizedException({ message: 'Tu cuenta ya no existe.', code: 'perfil_missing' });
    const sede = p.sedeId ? sedes.find((s) => s.id === p.sedeId) : null;
    return {
      id: p.id,
      email: p.email,
      nombre: p.nombre,
      apodo: p.apodo,
      fotoUrl: p.fotoUrl,
      fechaNacimiento: p.fechaNacimiento ? p.fechaNacimiento.toISOString().slice(0, 10) : null,
      sede: sede ?? null,
      roles,
    };
  }

  /** Asigna la sede más cercana y deja a la persona como socia de esa sede. */
  async asignarSede(perfilId: string, lat: number, lng: number): Promise<Yo> {
    const sede = nearest(await this.sedesActivas(), lat, lng);
    if (!sede) throw new BadRequestException('No hay sedes activas.');
    await this.orm.Perfil.where({ id: perfilId }).update({ sedeId: sede.id });
    await this.orm.RolAsignado.where({ perfilId, rol: 'socio' }).deleteAll();
    await this.orm.RolAsignado.create({ perfilId, rol: 'socio', sedeId: sede.id });
    authCache.invalidarPerfil(perfilId);
    return this.yo(perfilId);
  }

  async actualizar(perfilId: string, data: { nombre?: string; apodo?: string; fechaNacimiento?: string }): Promise<Yo> {
    if (Object.keys(data).length) {
      await this.orm.Perfil.where({ id: perfilId }).update({
        ...(data.nombre !== undefined ? { nombre: data.nombre } : {}),
        ...(data.apodo !== undefined ? { apodo: data.apodo } : {}),
        ...(data.fechaNacimiento !== undefined ? { fechaNacimiento: new Date(`${data.fechaNacimiento}T12:00:00Z`) } : {}),
      });
    }
    return this.yo(perfilId);
  }

  /** Guarda la foto que el navegador subió a Storage, solo si está en la carpeta de esa persona. */
  async guardarFoto(perfilId: string, userId: string, path: string): Promise<Yo> {
    if (!path.startsWith(`${userId}/`)) throw new BadRequestException('Archivo inválido.');
    const url = `${config.supabase.url}/storage/v1/object/public/${AVATARS}/${path}`;
    // Comprobamos que el archivo de verdad existe en Storage antes de guardarlo.
    const head = await fetch(url, { method: 'HEAD' });
    if (!head.ok) throw new BadRequestException('No encontramos la foto. Súbela de nuevo.');
    await this.orm.Perfil.where({ id: perfilId }).update({ fotoUrl: url });
    return this.yo(perfilId);
  }
}
