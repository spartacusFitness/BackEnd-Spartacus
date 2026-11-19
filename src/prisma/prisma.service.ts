import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { db, supabaseDb } from './db.js';

@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly db = db;
  readonly supabase = supabaseDb;

  async onModuleDestroy() {
    await this.supabase.close();
  }
}
