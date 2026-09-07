-- MoronQChallenge: cierra el "vacío legal" de mantener a alguien SIEMPRE
-- por debajo de MAX_ACTIVE_PENALTIES pendientes a la vez (coordinando
-- lanzamientos para que nunca llegue a tener 3 juntos) — con eso nunca se
-- disparaba la protección de PROTECTION_HOURS, aunque en la práctica el
-- jugador fuera acumulando castigos sin parar (6, 10, lo que sea).
--
-- penalty_received_count es un contador ACUMULADO de cuántos castigos
-- recibió un jugador (de cualquier fuente: lanzamiento externo, rebote
-- propio, hongo, castigo por incumplimiento) desde la última vez que ganó
-- protección — a diferencia del viejo criterio (cuántos tiene PENDIENTES
-- ahora mismo), este NUNCA baja al cumplir uno: solo se resetea a 0 cuando
-- se le otorga la protección. Con esto, aunque los vaya cumpliendo de a
-- uno sin acumular 3 pendientes a la vez, al 3er castigo RECIBIDO (los
-- haya cumplido o no) ya no le pueden mandar más, y con cumplir cualquiera
-- de los que le queden pendientes se activa la protección de 8h.

alter table participants
  add column if not exists penalty_received_count integer not null default 0;
