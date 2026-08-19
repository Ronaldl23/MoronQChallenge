-- MoronQChallenge: Sistema de Mangos — fix de RLS para el leaderboard público (Fase 5)
--
-- mangos y penalty_progress tienen RLS activado desde 0005_mango_system_phase1
-- pero nunca se les agregó una policy de SELECT pública — esa migración lo
-- decía explícito ("sin policies de lectura/escritura pública todavía") para
-- cuando ninguna fase necesitaba mostrar estos datos fuera de rutas
-- server-side con el service role.
--
-- La Fase 5 sí lo necesita: getLeaderboard() (src/lib/leaderboard.ts) usa el
-- cliente público (createClient(), sujeto a RLS) para mostrar los íconos de
-- Mangos/Castigos y el badge de descalificado en el leaderboard público. Sin
-- esta policy, esas queries devuelven 0 filas SIEMPRE (para todos los
-- participantes, no solo los de prueba) — silencioso, sin error visible, que
-- es justo el bug reportado.

create policy "mangos are publicly readable"
  on mangos for select
  using (true);

create policy "penalty_progress is publicly readable"
  on penalty_progress for select
  using (true);
