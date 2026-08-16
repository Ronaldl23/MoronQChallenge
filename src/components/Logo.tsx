export function Logo({ hasLogo }: { hasLogo: boolean }) {
  if (hasLogo) {
    // eslint-disable-next-line @next/next/no-img-element -- aspect ratio del logo real es variable
    return <img src="/logo.png" alt="MoronQChallenge" className="h-16 w-auto" />;
  }

  return (
    <span className="font-display text-xl font-bold tracking-wide text-text-primary">
      Moron<span className="text-gold">Q</span>
      <span className="text-pink">Challenge</span>
    </span>
  );
}
