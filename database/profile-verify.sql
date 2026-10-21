-- Comprobaciones de permisos después de ejecutar profile-setup.sql.
-- Solo consulta configuración y privilegios, no muestra datos personales.
select
  not has_table_privilege('anon', 'public.consultant_profiles', 'SELECT') as anon_sin_lectura_perfiles,
  not has_table_privilege('authenticated', 'public.consultant_profiles', 'SELECT') as sin_lectura_directa_perfiles,
  not has_table_privilege('authenticated', 'public.consultant_profiles', 'INSERT') as sin_insercion_directa_perfiles,
  not has_table_privilege('authenticated', 'public.consultant_profiles', 'UPDATE') as sin_cambios_directos_perfiles,
  not has_schema_privilege('authenticated', 'private', 'USAGE') as miembros_sin_acceso_esquema_privado,
  not has_function_privilege('anon', 'public.panel_access()', 'EXECUTE') as anon_sin_acceso_panel,
  has_function_privilege('authenticated', 'public.panel_access()', 'EXECUTE') as consulta_propio_acceso_habilitada,
  not has_function_privilege('anon', 'public.save_my_profile(text,text,text)', 'EXECUTE') as anon_sin_edicion_perfil,
  exists (select 1 from pg_trigger where tgname = 'portfolio_invited_member' and tgenabled <> 'D') as registro_invitaciones_activo;
