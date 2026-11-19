# Pruebas de punta a punta (contra Supabase real)

Requieren el backend corriendo (`npm run build && npm run start`) y `backend/.env` completo.

| Prueba | Qué cubre | ¿Toca datos reales? |
|---|---|---|
| `fase2.mjs` | productos, inventario, promociones (con imagen), ventas, corte, catálogo del socio, reportes, permisos | **No.** Crea una sede temporal `prueba-…` con su propia recepción y la borra completa al final. |
| `fase0.mjs` | cuentas, dispositivo firmado, perfil, sede, Storage, roles, logout | Crea y borra cuentas `@ejemplo.com`; el socio queda inscrito en San Luis/Dolores mientras corre. |
| `fase1.mjs` | sedes, planes, recepción con PIN, solicitudes, cobros, asistencia, corte | **Sí: usa la sede Dolores y RESTABLECE la contraseña de `dolores@recepcion`.** No correr en un proyecto con operación real; falta migrarla al esquema aislado de `fase2.mjs`. |

```bash
node test/e2e/fase2.mjs
```

## fase3.mjs — coaches (aislada)

`node test/e2e/fase3.mjs` con el backend corriendo. Crea una sede temporal `prueba-…`, un admin, dos coaches y una socia @ejemplo.com; prueba alta/baja de coaches, catálogo de máquinas y ejercicios, rutinas (historial, validaciones), rachas (semanal y consecutiva), peso, estatura, objetivo y la privacidad de los datos de salud. Al final borra la sede, sus datos y las cuentas. `CONSERVAR_SEDE=1` deja la sede para inspeccionarla.
