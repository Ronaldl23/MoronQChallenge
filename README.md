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
  app/page.tsx            # Leaderboard (server component, lee de Supabase)
  lib/elo.ts               # Cálculo de elo_score
  lib/supabase/client.ts   # Cliente Supabase para el browser
  lib/supabase/server.ts   # Cliente Supabase para Server Components/Actions
  lib/supabase/admin.ts    # Cliente con service role (jobs server-side)
  types/database.ts        # Tipos de participants/snapshots
supabase/migrations/       # SQL del esquema
```

## Pendiente

- Fetch a la API de Riot (Account-V1 + League-V4) para poblar `snapshots`.
- Job/cron que resuelva `puuid` a partir de `riot_game_name`/`riot_tag`,
  consulte el rank actual y calcule `elo_score` con `calculateEloScore`.
- UI final del leaderboard (filtros, búsqueda, avatares, etc.).

## Deploy

La forma más simple es [Vercel](https://vercel.com/new), configurando las
mismas variables de entorno de `.env.local.example`.
