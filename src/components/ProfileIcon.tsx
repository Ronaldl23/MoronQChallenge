"use client";

import { useState } from "react";
import { Avatar } from "./Avatar";

type Tier = "avatar_url" | "profile_icon" | "initials";

function firstTier(avatarUrl: string | null, profileIconId: number | null): Tier {
  if (avatarUrl) return "avatar_url";
  if (profileIconId != null) return "profile_icon";
  return "initials";
}

/**
 * Prioridad de imagen: avatar_url manual (pegado en /admin) > ícono de
 * invocador real (Data Dragon) > iniciales. Si un nivel falla al cargar,
 * cae al siguiente en vez de romper — nunca depende de un solo origen.
 */
export function ProfileIcon({
  name,
  avatarUrl,
  profileIconId,
  ddragonVersion,
  size = 40,
}: {
  name: string;
  avatarUrl: string | null;
  profileIconId: number | null;
  ddragonVersion: string;
  size?: number;
}) {
  const [tier, setTier] = useState<Tier>(() => firstTier(avatarUrl, profileIconId));

  if (tier === "avatar_url" && avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- URL externa arbitraria, necesita onError
      <img
        src={avatarUrl}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        loading="lazy"
        onError={() => setTier(profileIconId != null ? "profile_icon" : "initials")}
      />
    );
  }

  if (tier === "profile_icon" && profileIconId != null) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- CDN externo (Data Dragon), necesita onError
      <img
        src={`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/profileicon/${profileIconId}.png`}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        loading="lazy"
        onError={() => setTier("initials")}
      />
    );
  }

  return <Avatar name={name} size={size} />;
}
