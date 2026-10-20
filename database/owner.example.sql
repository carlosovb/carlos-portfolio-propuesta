-- Sustituir el UUID por el de TU usuario ya creado en Authentication > Users.
-- No se autoriza a otros usuarios por compartir dominio o correo corporativo.
insert into private.panel_owners (user_id)
values ('00000000-0000-0000-0000-000000000000')
on conflict do nothing;
