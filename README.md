# MoronQChallenge

Leaderboard de League of Legends SoloQ para un evento de comunidad, construido
con Next.js (App Router) y Supabase.

## Stack

- Next.js 16 (App Router, TypeScript, Tailwind CSS)
- Supabase (Postgres) vía `@supabase/supabase-js` y `@supabase/ssr`

## Empezando

1. Instala dependencias:

   ```bash
   npm install
   ```

2. Copia `.env.local.example` a `.env.local` y completa las credenciales de
   tu proyecto de Supabase (Project Settings → API):

   ```bash
   cp .env.local.example .env.local
   ```

3. Aplica el esquema en tu proyecto de Supabase corriendo el SQL en
   `supabase/migrations/0001_init.sql` (vía el SQL Editor del dashboard o la
   Supabase CLI).

4. Levanta el servidor de desarrollo:

   ```bash
   npm run dev
   ```

   Abre [http://localhost:3000](http://localhost:3000).

## Esquema de datos

- **`participants`**: `id`, `nombre_display`, `riot_game_name`, `riot_tag`,
  `puuid`, `region_platform`.
- **`snapshots`**: `id`, `participant_id`, `tier`, `division`, `lp`, `wins`,
  `losses`, `elo_score`, `created_at`. Cada fila es una foto del rank de un
  participante en un momento dado; el leaderboard se arma ordenando por
  `elo_score`.

## Cálculo de `elo_score`

`src/lib/elo.ts` expone `calculateEloScore({ tier, division, lp })`:

```
elo_score = tier_base + division_offset + lp
```

- `tier_base` avanza en pasos de 400 por tier: IRON=0, BRONZE=400,
  SILVER=800, GOLD=1200, PLATINUM=1600, EMERALD=2000, DIAMOND=2400,
  MASTER/GRANDMASTER/CHALLENGER=2800.
- `division_offset` avanza en pasos de 100 dentro de un tier: IV=0, III=100,
  II=200, I=300. Es 0 en Master+ (no tienen división).
- `lp` se suma tal cual, así desempata dentro del mismo tier/división y es lo
  que ordena entre Master/Grandmaster/Challenger.

## Estructura

```
src/
  app/page.tsx                      # Leaderboard (server component, lee de Supabase)
  app/api/update-rankings/route.ts  # Endpoint que actualiza snapshots desde la API de Riot
  lib/elo.ts                        # Cálculo de elo_score
  lib/supabase/client.ts            # Cliente Supabase para el browser
  lib/supabase/server.ts            # Cliente Supabase para Server Components/Actions
  lib/supabase/admin.ts             # Cliente con secret key (jobs server-side)
  types/database.ts                 # Tipos de participants/snapshots
supabase/migrations/                # SQL del esquema
```

## Actualizar el leaderboard (`/api/update-rankings`)

`GET /api/update-rankings` recorre todos los `participants`, consulta su rank
actual en la API de Riot (League-V4, por `puuid`) e inserta un nuevo
`snapshot` por cada uno con su `elo_score` recalculado.

Requiere `RIOT_API_KEY` y `CRON_SECRET` configuradas. Está protegido: sin el
secreto correcto responde `401 Unauthorized`, porque cada llamada escribe en
la base de datos y consume tu cuota de la API de Riot. Se invoca así:

```bash
curl "https://tu-sitio.vercel.app/api/update-rankings?secret=TU_CRON_SECRET"
# o
curl -H "Authorization: Bearer TU_CRON_SECRET" https://tu-sitio.vercel.app/api/update-rankings
```

Asume que `participants.puuid` ya está poblado (el alta de participantes —
resolver `riot_game_name`/`riot_tag` a `puuid` vía Account-V1 — todavía no
está implementada).

## Pendiente

- Alta de participantes: resolver `riot_game_name`/`riot_tag` a `puuid` vía
  Account-V1 de Riot y guardarlos en `participants`.
- Programar `/api/update-rankings` con un cron (p. ej. Vercel Cron) para que
  corra automáticamente en vez de dispararlo a mano.
- UI final del leaderboard (filtros, búsqueda, avatares, etc.).

## Deploy

La forma más simple es [Vercel](https://vercel.com/new), configurando las
mismas variables de entorno de `.env.local.example`.
