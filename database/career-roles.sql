-- Puestos transcritos del plan facilitado. Director Nacional Senior no se incluye.
begin;
insert into public.team_roles(code,label,multiplier) values
 ('financial_trainee','Financial Trainee',2),
 ('financial_consultant','Financial Consultant',2.5),
 ('financial_consultant_senior_i','Financial Consultant Senior I',3.5),
 ('financial_consultant_senior_ii','Financial Consultant Senior II',4.5),
 ('team_manager','Gestor de Equipo',3.5),
 ('zone_coordinator','Coordinador de Zona',4.5),
 ('agency_director','Director de Agencia',5),
 ('regional_director','Director Regional',5.5),
 ('national_director','Director Nacional',6)
on conflict(code) do update set label=excluded.label,multiplier=excluded.multiplier;
commit;
