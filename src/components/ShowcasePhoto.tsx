"use client";

import { useState } from "react";
import { Avatar } from "./Avatar";

/** Foto del roster de /participantes, con fallback a iniciales si la URL no carga (mismo patrón que ProfileIcon). */
export function ShowcasePhoto({
  name,
  photoUrl,
  size,
}: {
  name: string;
  photoUrl: string;
  size: number;
}) {
  const [failed, setFailed] = useState(false);

  if (failed || !photoUrl) {
    return <Avatar name={name} size={size} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- URL externa arbitraria, necesita onError
    <img
      src={photoUrl}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-full object-cover"
      style={{ width: size, height: size }}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
