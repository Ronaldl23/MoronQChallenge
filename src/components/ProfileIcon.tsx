"use client";

import { useState } from "react";
import { Avatar } from "./Avatar";

/**
 * Ícono de invocador real (Data Dragon). Cae de vuelta al Avatar de
 * iniciales si el participante todavía no tiene profile_icon_id (recién
 * agregado, aún no corrió /api/update-rankings) o si la imagen falla al
 * cargar.
 */
export function ProfileIcon({
  name,
  profileIconId,
  ddragonVersion,
  size = 40,
}: {
  name: string;
  profileIconId: number | null;
  ddragonVersion: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);

  if (profileIconId == null || failed) {
    return <Avatar name={name} size={size} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- CDN externo (Data Dragon), necesita onError
    <img
      src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/profileicon/${profileIconId}.png`}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-full object-cover"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
