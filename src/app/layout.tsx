import type { Metadata } from "next";
import { Geist, Geist_Mono, Rajdhani } from "next/font/google";
import { getAuthenticatedParticipantId } from "@/lib/player-auth";
import { getChampionList, type Champion } from "@/lib/champions";
import { MangoNotifications } from "@/components/MangoNotifications";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const rajdhani = Rajdhani({
  variable: "--font-rajdhani",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "MoronQChallenge — Ranking",
  description: "Leaderboard SoloQ del torneo MoronQChallenge.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Chequeo server-side (cookie httpOnly, no se puede leer desde el
  // cliente) para que las notificaciones de Mango funcionen en CUALQUIER
  // página del sitio con sesión de /jugador activa, no solo en /jugador —
  // un solo montaje acá en la raíz, así no hay riesgo de duplicar avisos
  // por tenerlo en más de un lugar. Si no hay sesión, ni siquiera se monta
  // el componente: cero llamadas extra para un visitante normal.
  const participantId = await getAuthenticatedParticipantId();

  // Solo se pide si hay sesión — lo necesita MangoRevealModal (vía
  // MangoNotifications) para poder armar el pool de la ruleta en CUALQUIER
  // página. getChampionList() está cacheada 1h en el Data Cache de Next
  // (ver src/lib/champions.ts), así que esto no es una llamada de red
  // nueva por cada carga de página — comparte el mismo caché que /jugador.
  let champions: Champion[] = [];
  if (participantId) {
    try {
      champions = await getChampionList();
    } catch {
      // Sin campeones el pool visual de la ruleta queda corto (solo
      // Support de relleno) — no bloquea nada, MangoRevealModal igual
      // funciona con el resultado real que ya viene del servidor.
    }
  }

  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} ${rajdhani.variable} h-full antialiased`}
    >
      <body className="site-bg flex min-h-full flex-col text-text-primary">
        {participantId && <MangoNotifications champions={champions} />}
        {children}
      </body>
    </html>
  );
}
