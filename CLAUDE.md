# Finanzas V6.2 — App de Finanzas Personales

## Qué es
Aplicación web de finanzas personales para registrar ingresos y egresos, con sincronización opcional a Google Sheets e interfaz neumórfica.

## Stack
- HTML5 + CSS3 + JavaScript vanilla
- Chart.js (gráficos)
- canvas-confetti (animaciones)
- Google Apps Script (sync con Google Sheets, opcional)
- localStorage (persistencia offline)

## Estructura
- **Archivo único**: `index.html` (~1300 líneas)
- Vistas: home, historial, tendencias, Mar de Pan, hogar
- Modal de categorías
- Sin package.json — todo vanilla

## Deploy
- GitHub Pages via GitHub Actions
- URL: https://martinlleral.github.io/finanzas-v6

## Configuración
- `API_URL`: vacía por defecto (modo demo/offline)
- `SCHEMA`: configurable con categorías y subcategorías
- Para uso real: editar API_URL y SCHEMA con datos propios

## Convenciones
- Archivo HTML monolítico
- Offline-first: funciona sin API configurada
- Formatos argentinos (ARS, dd/MM/yyyy)
