-- MoronQChallenge: cierra el "vacío legal" de mantener a alguien SIEMPRE
-- por debajo de MAX_ACTIVE_PENALTIES pendientes a la vez (coordinando
-- lanzamientos para que nunca llegue a tener 3 juntos) — con eso nunca se
-- disparaba la protección de PROTECTION_HOURS, aunque en la práctica el
-- jugador fuera acumulando castigos sin parar (6, 10, lo que sea).
--
-- penalty_received_count es un contador ACUMULADO de cuántos castigos
-- recibió un jugador por LANZAMIENTO EXTERNO de otro participante — SOLO
-- eso: rebote propio, hongo (mango podrido tirado a la basura) y castigo
-- por incumplimiento quedan afuera a propósito, son autoinfligidos/
-- excepciones ya aceptadas para superar MAX_ACTIVE_PENALTIES, y contarlos
-- acá bloquearía lanzamientos ajenos por mala suerte propia en vez de por
-- hostigamiento real (que es lo único que este contador debe medir). A
-- diferencia del viejo criterio (cuántos tiene PENDIENTES ahora mismo),
-- este NUNCA baja al cumplir uno: solo se resetea a 0 cuando se le otorga
-- la protección. Con esto, aunque los vaya cumpliendo de a uno sin
-- acumular 3 pendientes a la vez, al 3er castigo EXTERNO recibido (lo haya
-- cumplido o no) ya no le pueden mandar más, y con cumplir cualquiera de
-- los que le queden pendientes se activa la protección de 8h.

alter table participants
  add column if not exists penalty_received_count integer not null default 0;
