-- Normaliza login_code (trim + mayúsculas) tanto en los datos existentes
-- como en cada escritura futura.
--
-- /api/jugador/login ya normaliza el código INGRESADO (normalizeLoginCode
-- en src/lib/login-code.ts, trim + toUpperCase) antes de compararlo. Pero
-- esa comparación es un match exacto contra el valor CRUDO de la columna
-- — si login_code se edita a mano desde el Table Editor de Supabase (el
-- generador de la app siempre produce códigos ya en mayúsculas sin
-- espacios, así que esta es la única vía por la que puede quedar "sucio"),
-- nada garantiza que el valor guardado sea mayúsculas ni que no arrastre
-- espacios — y entonces ni copiando el código "tal cual" hace match.
--
-- El trigger de acá cierra ese hueco: normaliza login_code en cualquier
-- INSERT/UPDATE, venga de la app o de una edición manual.

-- Backfill: normaliza los valores que ya existan hoy.
update participants
set login_code = upper(trim(login_code))
where login_code is not null
  and login_code <> upper(trim(login_code));

create or replace function normalize_login_code()
returns trigger
language plpgsql
as $$
begin
  if new.login_code is not null then
    new.login_code := upper(trim(new.login_code));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_normalize_login_code on participants;

create trigger trg_normalize_login_code
  before insert or update of login_code on participants
  for each row
  execute function normalize_login_code();
