import { NextResponse } from 'next/server';
import { api, modoDemo, sesion, sinSesion } from '../bff';
import { listar } from '../demo';

export const dynamic = 'force-dynamic';

/** GET /bandeja/api/hilos — la lista de la bandeja. */
export async function GET(): Promise<NextResponse> {
  const s = await sesion();
  if (s) return api(s, '/threads');
  if (modoDemo()) return NextResponse.json(listar());
  return sinSesion();
}
