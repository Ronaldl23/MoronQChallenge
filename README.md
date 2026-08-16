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
  app/page.tsx                      # Ranking: podio top-3 + tabla completa
  app/reglas/page.tsx               # Página de reglas (contenido placeholder)
  app/admin/page.tsx                # Panel de admin: alta de participantes
  app/api/update-rankings/route.ts  # Endpoint que actualiza snapshots desde la API de Riot
  app/api/participants/route.ts     # Endpoint que da de alta un participante (resuelve puuid)
  app/api/admin/login/route.ts      # Login del panel de admin (setea cookie de sesión)
  components/                       # Header, Logo, Countdown, PodiumCard, LeaderboardTable, etc.
  lib/elo.ts                        # Cálculo de elo_score
  lib/leaderboard.ts                # Arma el ranking + racha/±LP a partir del historial de snapshots
  lib/riot.ts                       # Resolución de puuid vía Account-V1
  lib/admin-auth.ts                 # Chequeo de sesión de admin (cookie o Bearer)
  lib/secrets.ts                    # Comparación de secretos en tiempo constante
  lib/config.ts                     # Nombre del torneo y fecha de fin (para el countdown)
  lib/supabase/client.ts            # Cliente Supabase para el browser
  lib/supabase/server.ts            # Cliente Supabase para Server Components/Actions
  lib/supabase/admin.ts             # Cliente con secret key (jobs server-side)
  types/database.ts                 # Tipos de participants/snapshots
supabase/migrations/                # SQL del esquema
```

## Diseño del Ranking

Look esports oscuro: fondo casi negro, tarjetas con borde sutil, paleta
rojo oscuro / dorado / rosa (tokens en `src/app/globals.css`, prefijo
`--color-*`) y tipografía Rajdhani para títulos/números (`font-display`).

- **Logo**: `src/components/Header.tsx` comprueba en el servidor si existe
  `public/logo.png` (`fs.existsSync`). Si no está, muestra un wordmark
  estilizado como placeholder — no hay que tocar código, solo copia tu
  `logo.png` a `public/` y aparece automáticamente en el próximo deploy.
- **Countdown**: cuenta regresivo hasta `TOURNAMENT_END_DATE` en
  `src/lib/config.ts` — edita esa fecha con el cierre real del torneo.
- **Avatares**: no hay foto de perfil en el esquema, así que se generan
  iniciales con un color determinístico por nombre (`src/lib/avatar.ts`).
- **Racha / ±LP**: `snapshots` guarda fotos periódicas (tier/LP/wins/losses
  acumulados), no partidas individuales — no hay forma de reconstruir un
  historial partida-por-partida real. Por eso "Racha" es una mini-gráfica
  de tendencia (últimos `elo_score` en una ventana de 7 días) y "±LP" es la
  suma de subidas/bajadas de `elo_score` entre snapshots consecutivos en esa
  misma ventana — ambos derivados de datos reales, calculados en
  `src/lib/leaderboard.ts`.
- Sin secciones de premios, Blue Shell, Pick'em ni Tier List, tal cual se
  pidió — solo Ranking y Reglas.

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

### Automatizarlo cada 15 minutos con GitHub Actions

`.github/workflows/update-rankings.yml` llama a este endpoint cada 15
minutos vía `cron`, y se puede disparar a mano desde la pestaña Actions
(`workflow_dispatch`). Usa `curl --fail-with-body`, así que si el endpoint
responde un error HTTP el step falla y el run queda en rojo en la pestaña
Actions — con el cuerpo de la respuesta impreso en el log para que veas qué
pasó. `concurrency` evita que dos corridas se pisen si una tarda más de 15
minutos.

Setup:

1. Edita `SITE_URL` en el workflow con el dominio real de tu deploy en
   Vercel (por defecto dice `https://mi-sitio.vercel.app`).
2. En GitHub: **Settings → Secrets and variables → Actions → New repository
   secret**, nombre **`CRON_SECRET`**, mismo valor que configuraste en
   Vercel para `CRON_SECRET`.
3. GitHub notifica por email (a quien tenga watch en el repo) cuando un
   workflow programado falla, así que te enteras sin tener que revisar la
   pestaña Actions manualmente.

## Panel de admin y alta de participantes (`/admin`)

`/admin` muestra un formulario protegido para agregar participantes. Al
enviarlo, llama a `POST /api/participants`, que:

1. Resuelve el `puuid` vía Account-V1 de Riot (`by-riot-id`, ruteado por
   continente — `americas`/`europe`/`asia`/`sea` según el `region_platform`).
2. Si el Riot ID no existe, responde `404` con un mensaje claro (no revienta).
3. Inserta el nuevo participante en `participants` con el `puuid` ya resuelto.

Requiere `RIOT_API_KEY` (la misma que usa `/api/update-rankings`) y
`ADMIN_SECRET`.

**Por qué `ADMIN_SECRET` y no `CRON_SECRET`:** `CRON_SECRET` protege un
disparador automatizado sin sesión (un cron externo pegándole a la URL).
`ADMIN_SECRET` protege una sesión interactiva de una persona (tú, cargando
participantes a mano) — son superficies de riesgo distintas y conviene poder
rotar una sin afectar la otra.

**Cómo entrar:** abre `https://tu-sitio.vercel.app/admin`, ingresa la
contraseña (el valor de `ADMIN_SECRET`). Al validarse, se setea una cookie
httpOnly de sesión (dura 8 horas) y se muestra el formulario: nombre para
mostrar, Riot game name, Riot tag y región. El endpoint también acepta
`Authorization: Bearer TU_ADMIN_SECRET` por si quieres darlo de alta por
`curl` en vez de por el formulario:

```bash
curl -X POST https://tu-sitio.vercel.app/api/participants \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TU_ADMIN_SECRET" \
  -d '{"nombre_display":"Fulano","riot_game_name":"Faker","riot_tag":"KR1","region_platform":"KR"}'
```

## Pendiente

- Copiar el logo real a `public/logo.png` (ver "Diseño del Ranking" arriba).
- Editar el contenido real de `/reglas` (por ahora tiene placeholders).
- Ajustar `TOURNAMENT_END_DATE` en `src/lib/config.ts` a la fecha real de
  cierre del torneo.

## Deploy

La forma más simple es [Vercel](https://vercel.com/new), configurando las
mismas variables de entorno de `.env.local.example`.
