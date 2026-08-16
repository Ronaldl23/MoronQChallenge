import { avatarColor, initials } from "@/lib/avatar";

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-display font-bold text-white/95 [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        backgroundColor: avatarColor(name),
      }}
    >
      {initials(name)}
    </div>
  );
}
