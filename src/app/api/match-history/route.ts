import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { platformToContinent } from "@/lib/riot";
import { ROLE_TO_LANE_SLUG, type MainRole } from "@/lib/lane";
import { getChampionList } from "@/lib/champions";
import { getSummonerSpellList } from "@/lib/summoner-spells";
import { correlateLpChanges } from "@/lib/lp-correlation";
import { MIN_MATCH_DURATION_SECONDS } from "@/lib/quests";

export const dynamic = "force-dynamic";

const RANKED_SOLO_QUEUE_ID = 420;
const MATCH_COUNT = 10;

interface RiotMatchParticipant {
  puuid: string;
  win: boolean;
  championName: string;
  riotIdGameName: string;
  riotIdTagline: string;
  profileIcon: number;
  kills: number;
  deaths: number;
  assists: number;
  teamId: number;
  teamPosition: string;
  totalMinionsKilled: number;
  neutralMinionsKilled: number;
  item0: number;
  item1: number;
  item2: number;
  item3: number;
  item4: number;
  item5: number;
  item6: number;
  /** Ids NUMÉRICOS de Riot (no el id de texto de Data Dragon) — mismo campo que usa src/lib/penalty.ts para el castigo de hechizo obligatorio. */
  summoner1Id: number;
  summoner2Id: number;
}

interface RiotMatchTeam {
  teamId: number;
  win: boolean;
  bans: { championId: number; pickTurn: number }[];
}

interface RiotMatch {
  info: {
    gameDuration: number;
    gameEndTimestamp: number;
    participants: RiotMatchParticipant[];
    teams: RiotMatchTeam[];
  };
}

export interface MatchPlayerSummary {
  puuid: string;
  riotId: string;
  profileIconId: number;
  championName: string;
  kills: number;
  deaths: number;
  assists: number;
  items: number[];
  isTrackedParticipant: boolean;
}

export interface SummonerSpellIcon {
  name: string;
  iconUrl: string;
}

export interface MatchTeam {
  teamId: number;
  win: boolean;
  /** Ids de Data Dragon (mismo id que championName) de los baneados, en orden de ban. Null en el slot si el modo no tiene ese ban o no se pudo resolver el id numérico. */
  bans: (string | null)[];
  players: MatchPlayerSummary[];
}

export interface MatchSummary {
  matchId: string;
  win: boolean;
  championName: string;
  /** Slug para el ícono de posición de Community Dragon. Null si Riot no la reportó (ARAM y otros modos sin línea fija). */
  laneSlug: string | null;
  opponentChampionName: string | null;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  /** % de los kills del equipo en los que participó (kills + assists propios / kills totales del equipo). */
  killParticipationPct: number;
  items: number[];
  /** Los dos hechizos de invocador que llevó a esta partida (summoner1Id/summoner2Id de match-v5, resueltos a ícono) — vacío si no se pudo resolver alguno contra el listado de Data Dragon. */
  summonerSpells: SummonerSpellIcon[];
  durationSeconds: number;
  gameEndTimestamp: number;
  /** Los 10 jugadores de la partida (ambos equipos) + bans, para el scoreboard expandido. */
  teams: MatchTeam[];
  /**
   * El LP ganado/perdido no viene en match-v5 — Riot no lo expone por
   * partida en ningún campo. Se estima cruzando la hora de fin de la
   * partida contra nuestro propio historial de snapshots (el cron de
   * /api/update-rankings inserta uno en cada corrida): si hay un snapshot
   * justo antes y otro justo después, ambos del mismo tier/división, y esta
   * es la ÚNICA partida que cae en ese hueco, la diferencia de LP entre esos
   * dos snapshots es ese partido. Si hubo más de una partida en el mismo
   * hueco entre corridas, o cambió de tier/división en el medio, no se puede
   * saber cuál se llevó qué — se deja null en vez de adivinar. Esto último
   * (huecos con varias partidas sin poder separar) se vuelve más común
   * cuanto más espaciado corre el cron — ver el trigger que lo dispara cada
   * 15 min.
   */
  lpChange: number | null;
}

/**
 * Historial reciente bajo demanda: se llama solo cuando el usuario abre el
 * acordeón de un jugador puntual, nunca desde /api/update-rankings ni
 * precargado para todos los participantes — cada apertura son ~11 llamadas
 * a Riot (1 de ids + hasta 10 de detalle), y no queremos multiplicar eso
 * por todo el leaderboard en cada carga de página.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const participantId = url.searchParams.get("participantId");
  if (!participantId) {
    return NextResponse.json({ error: "Falta participantId" }, { status: 400 });
  }

  const riotApiKey = process.env.RIOT_API_KEY;
  if (!riotApiKey) {
    return NextResponse.json(
      { error: "RIOT_API_KEY no está configurada" },
      { status: 500 },
    );
  }

  const supabase = createAdminClient();
  const { data: participant, error } = await supabase
    .from("participants")
    .select("puuid, region_platform")
    .eq("id", participantId)
    .single();

  if (error || !participant) {
    return NextResponse.json(
      { error: "Participante no encontrado" },
      { status: 404 },
    );
  }

  const continent = platformToContinent(participant.region_platform);
  if (!continent) {
    return NextResponse.json(
      { error: `region_platform desconocida: ${participant.region_platform}` },
      { status: 400 },
    );
  }

  let matchIds: string[];
  try {
    const idsRes = await fetch(
      `https://${continent}.api.riotgames.com/lol/match/v5/matches/by-puuid/${participant.puuid}/ids?start=0&count=${MATCH_COUNT}&queue=${RANKED_SOLO_QUEUE_ID}`,
      {
        headers: { "X-Riot-Token": riotApiKey },
        // La lista de partidas cambia con cada game nueva, pero no vale la
        // pena pedirla de nuevo si el jugador cierra y reabre el acordeón
        // en la misma sesión de scroll.
        next: { revalidate: 120 },
      },
    );
    if (!idsRes.ok) {
      return NextResponse.json(
        {
          error: `Riot API respondió ${idsRes.status} al pedir la lista de partidas`,
        },
        { status: 502 },
      );
    }
    matchIds = (await idsRes.json()) as string[];
  } catch {
    return NextResponse.json(
      { error: "No se pudo contactar a la API de Riot" },
      { status: 502 },
    );
  }

  // Los bans de match-v5 vienen como championId numérico, no como el id de
  // Data Dragon que usan los ícones — se resuelve una sola vez acá afuera
  // del loop (getChampionList ya cachea 1h por su cuenta) en vez de una
  // llamada a Riot extra por partida.
  let championIdToDDragonId = new Map<number, string>();
  try {
    const champions = await getChampionList();
    championIdToDDragonId = new Map(
      champions.map((c) => [Number(c.key), c.id]),
    );
  } catch {
    // Sin listado de campeones no se pueden resolver los bans a íconos — el
    // mapa queda vacío y cada ban cae a null en vez de romper el historial.
  }

  // Mismo criterio que championIdToDDragonId de arriba: summoner1Id/
  // summoner2Id de match-v5 vienen como id NUMÉRICO de Riot, no el id de
  // texto de Data Dragon que usan los íconos (ver SummonerSpell.key en
  // src/lib/summoner-spells.ts).
  let spellKeyToSpell = new Map<string, { name: string; iconUrl: string }>();
  try {
    const spells = await getSummonerSpellList();
    spellKeyToSpell = new Map(spells.map((s) => [s.key, { name: s.name, iconUrl: s.iconUrl }]));
  } catch {
    // Sin listado de hechizos no se pueden resolver a ícono — cada partida
    // queda con summonerSpells vacío en vez de romper el historial.
  }

  const matches: Omit<MatchSummary, "lpChange">[] = [];

  for (const matchId of matchIds) {
    try {
      const matchRes = await fetch(
        `https://${continent}.api.riotgames.com/lol/match/v5/matches/${matchId}`,
        {
          headers: { "X-Riot-Token": riotApiKey },
          // Una partida terminada no cambia nunca: cachear agresivo, sobre
          // todo porque varios jugadores del leaderboard pueden compartir
          // la misma partida y así evitamos pedirla varias veces.
          next: { revalidate: 86400 },
        },
      );
      if (!matchRes.ok) continue;

      const match = (await matchRes.json()) as RiotMatch;
      // Remake (alguien se desconectó al arranque, termina a los pocos
      // minutos): no afecta el registro ranked real de Riot (ni LP ni
      // wins/losses), así que tampoco debería aparecer acá como si fuera
      // una derrota real — mismo umbral que ya usan quests/castigos para
      // el mismo concepto (ver MIN_MATCH_DURATION_SECONDS).
      if (match.info.gameDuration < MIN_MATCH_DURATION_SECONDS) continue;

      const mp = match.info.participants.find(
        (p) => p.puuid === participant.puuid,
      );
      if (!mp) continue;

      const opponent = mp.teamPosition
        ? match.info.participants.find(
            (p) => p.teamId !== mp.teamId && p.teamPosition === mp.teamPosition,
          )
        : undefined;

      const summonerSpells = [mp.summoner1Id, mp.summoner2Id]
        .map((id) => spellKeyToSpell.get(String(id)))
        .filter((s): s is SummonerSpellIcon => s !== undefined);

      const items = [
        mp.item0,
        mp.item1,
        mp.item2,
        mp.item3,
        mp.item4,
        mp.item5,
        mp.item6,
      ].filter((id) => id !== 0);

      const teamKills = match.info.participants
        .filter((p) => p.teamId === mp.teamId)
        .reduce((sum, p) => sum + p.kills, 0);
      const killParticipationPct =
        teamKills > 0
          ? Math.round(((mp.kills + mp.assists) / teamKills) * 100)
          : 0;

      const teams: MatchTeam[] = match.info.teams.map((team) => ({
        teamId: team.teamId,
        win: team.win,
        bans: team.bans
          .filter((ban) => ban.championId !== -1)
          .map((ban) => championIdToDDragonId.get(ban.championId) ?? null),
        players: match.info.participants
          .filter((p) => p.teamId === team.teamId)
          .map((p) => ({
            puuid: p.puuid,
            riotId: p.riotIdGameName
              ? `${p.riotIdGameName}#${p.riotIdTagline}`
              : "Invocador",
            profileIconId: p.profileIcon,
            championName: p.championName,
            kills: p.kills,
            deaths: p.deaths,
            assists: p.assists,
            items: [
              p.item0,
              p.item1,
              p.item2,
              p.item3,
              p.item4,
              p.item5,
              p.item6,
            ].filter((id) => id !== 0),
            isTrackedParticipant: p.puuid === participant.puuid,
          })),
      }));

      matches.push({
        matchId,
        win: mp.win,
        championName: mp.championName,
        laneSlug: ROLE_TO_LANE_SLUG[mp.teamPosition as MainRole] ?? null,
        opponentChampionName: opponent?.championName ?? null,
        kills: mp.kills,
        deaths: mp.deaths,
        assists: mp.assists,
        cs: mp.totalMinionsKilled + mp.neutralMinionsKilled,
        killParticipationPct,
        items,
        summonerSpells,
        durationSeconds: match.info.gameDuration,
        gameEndTimestamp: match.info.gameEndTimestamp,
        teams,
      });
    } catch {
      // Una partida individual falló al traerse — se omite, no rompe el resto.
    }

    // Rate limit de Riot: mismo criterio que /api/update-rankings.
    await new Promise((resolve) => setTimeout(resolve, 60));
  }

  let lpChanges = new Map<string, number>();
  if (matches.length > 0) {
    const oldestGameEnd = new Date(
      Math.min(...matches.map((m) => m.gameEndTimestamp)),
    ).toISOString();

    // Antes se pedían solo los snapshots de los últimos 30 minutos previos a
    // la partida más vieja — un buffer fijo que asumía que el cron de
    // /api/update-rankings corre cada ~15 min sin fallar nunca. Cuando el
    // cron se atrasa (deploys, cold starts, el trigger que no disparó) ese
    // buffer queda corto: el snapshot "anterior" real existe en la base,
    // pero cae afuera de la ventana de 30 min y correlateLpChanges lo trata
    // como si no existiera — todas las partidas de ese hueco quedan sin LP
    // aunque en teoría se podrían resolver igual. Se pide en cambio el ÚLTIMO
    // snapshot anterior a la partida más vieja, sin importar hace cuánto fue
    // (siempre hay uno después de la primera corrida del cron para este
    // participante), más todos los de ahí en adelante — sin buffer fijo que
    // dependa de la cadencia real del cron.
    const [{ data: priorSnapshot }, { data: snapshotsFromOldestMatch }] =
      await Promise.all([
        supabase
          .from("snapshots")
          .select("tier, division, lp, created_at")
          .eq("participant_id", participantId)
          .lt("created_at", oldestGameEnd)
          .order("created_at", { ascending: false })
          .limit(1),
        supabase
          .from("snapshots")
          .select("tier, division, lp, created_at")
          .eq("participant_id", participantId)
          .gte("created_at", oldestGameEnd)
          .order("created_at", { ascending: true }),
      ]);

    const snapshots = [
      ...(priorSnapshot ?? []),
      ...(snapshotsFromOldestMatch ?? []),
    ];
    if (snapshots.length > 0) {
      lpChanges = correlateLpChanges(matches, snapshots);
    }
  }

  const withLp: MatchSummary[] = matches.map((match) => ({
    ...match,
    lpChange: lpChanges.get(match.matchId) ?? null,
  }));

  return NextResponse.json({ matches: withLp });
}
