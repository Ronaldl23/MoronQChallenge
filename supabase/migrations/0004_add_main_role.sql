-- MoronQChallenge: línea main opcional por participante

alter table participants
  add column if not exists main_role text check (
    main_role in ('TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY')
  );
