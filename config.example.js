// Copiá este archivo como config.js y completá con tus datos reales
// No subas config.js al repositorio (está en .gitignore)

const CONFIG = {
    // URL de tu Google Apps Script (Web App desplegada)
    API_URL: 'https://script.google.com/macros/s/TU_ID_DE_SCRIPT/exec',

    // Estructura de categorías financieras
    // Las claves de primer nivel (Egreso/Ingreso) son fijas.
    // Las categorías y subcategorías se personalizan según tu caso.
    // IMPORTANTE: Los nombres de categorías se usan para filtrar transacciones
    // en la lógica de la app (ej: 'MarDePan' y 'Mar de Pan' tienen filtros especiales).
    // Si los cambiás, revisá las funciones renderHistory, renderMarDePan y renderHogar.
    SCHEMA: {
        Egreso: {
            Alimentacion: ['Subcategoría 1', 'Subcategoría 2', 'Subcategoría 3', 'Subcategoría 4'],
            HogarYVida: ['Persona 1', 'Regalos', 'Varios', 'Salud', 'Actividades', 'Salidas', 'Indumentaria', 'Mascota', 'Servicios', 'Mantenimiento', 'Infraestructura'],
            MarDePan: ['Sueldos', 'Insumos', 'Inversiones', 'Servicios', 'Varios', 'Mantenimiento', 'Extracción'],
            Movilidad: ['Seguro', 'Peajes', 'Nafta', 'Mecánica', 'Transporte'],
            Proyectos: ['Proyecto A', 'Proyecto B', 'Proyecto C', 'MVP', 'Inversión'],
        },
        Ingreso: {
            'Mar de Pan': ['Facturación', 'Otros'],
            'Hogar': ['Fuente 1', 'Fuente 2', 'Fuente 3', 'Fuente 4', 'Changas', 'Otros']
        }
    }
};
