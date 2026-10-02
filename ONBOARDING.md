# Tu propia instancia de Finanzas: guía de instalación

> **Borrador.** Está escrita contra el código de la rama `empaquetar-para-compartir`
> y todavía no se recorrió de punta a punta con una cuenta de Google nueva ni en
> un teléfono real. Los pasos marcados con ⚠️ son los que ese recorrido tiene
> que confirmar.

## Cómo funciona, en tres líneas

- **La app** es una página web. Se abre desde un link y se puede dejar como ícono en el teléfono.
- **Tus datos** viven en una planilla de Google que es tuya. Nadie más la ve, tampoco quien te pasó la app.
- **Un puente** (un script de Google pegado a tu planilla) recibe lo que cargás en la app y lo escribe en la planilla.

Lo que vas a hacer es crear la planilla, pegarle el puente y decirle a la app dónde está. Es una sola vez.

## Qué necesitás

- Una cuenta de Google.
- Una computadora durante unos 15 minutos. La parte de Google no se puede hacer cómoda desde el teléfono.
- Tu teléfono, para el final.

## Antes de instalar nada: probala

Abrí <https://martinlleral.github.io/finanzas-v6>. Sin configurar nada arranca en
modo demo, con datos inventados. Sirve para ver si te gusta. Lo que cargues en
demo no se guarda.

---

## Parte 1 · La planilla y el puente (en la computadora)

1. **Creá una planilla vacía.** Entrá a <https://sheets.new> y ponele un nombre, por ejemplo «Finanzas».
2. **Abrí el editor del puente.** En el menú de la planilla: *Extensiones → Apps Script*. Se abre otra pestaña con un poco de código de ejemplo.
3. **Pegá el código.** Borrá todo lo que haya en el editor y pegá el contenido completo de [`server/apps_script.gs`](server/apps_script.gs). Guardá con el ícono del disquete.
4. **Corré la instalación.** Arriba, en el desplegable que está al lado de «Ejecutar», elegí `instalar` y tocá **▶ Ejecutar**.
5. **Dale permiso.** ⚠️ Google va a mostrar una pantalla que asusta: *«Google no verificó esta aplicación»*. Es esperable: el script es tuyo y lo acabás de pegar vos. Tocá *Configuración avanzada → Ir a (nombre del proyecto) → Permitir*. El permiso es para que el script escriba en tu planilla.
6. **Copiá tu token.** Abajo, en el *Registro de ejecución*, aparece «INSTALACIÓN LISTA» y una clave larga. Esa clave es tu **token**: copiala y guardala un minuto en un lugar a mano. Es la llave de tu planilla.
7. **Publicá el puente.** Arriba a la derecha: *Implementar → Nueva implementación*. En el engranaje elegí **Aplicación web**. Completá así y tocá *Implementar*:
   - *Ejecutar como:* **Yo**
   - *Quién tiene acceso:* **Cualquier usuario**
8. **Copiá la URL.** Termina en `/exec`. Es la dirección de tu puente.
9. **Comprobá que responde.** Pegá esa URL en el navegador y agregale al final `?action=ping`. Tenés que ver algo así:

   ```
   {"ok":true,"backend":"v8","tokenConfigurado":true}
   ```

   Si ves una página de error de Google, la URL no es la correcta. Volvé al paso 7.

> **«Cualquier usuario» no deja tu planilla abierta.** Quiere decir que la app
> puede hablar con el puente sin iniciar sesión en Google. Para leer o escribir
> hace falta además el token. La URL sola no alcanza.

## Parte 2 · Conectar la app (en la misma computadora)

1. Abrí <https://martinlleral.github.io/finanzas-v6>.
2. Tocá **⚙️** y después **Cambiar URL**.
3. Pegá la **URL** del paso 8 y aceptá.
4. En la pantalla siguiente pegá el **token** del paso 6 y aceptá. La app se recarga.
5. **Probá.** Cargá un gasto de $1. Mirá tu planilla: tiene que aparecer en la fila 2, debajo de los títulos.
6. En **⚙️** tocá **🩺 Probar conexión**. Las tres pruebas tienen que dar ✅: lectura, escritura e idempotencia.

## Parte 3 · Tu teléfono

En la computadora, en **⚙️**, tocá **📱 Configurar otro dispositivo**. Aparece un código QR.

**Android.** Escaneá el QR con la cámara. Se abre la app ya conectada. En el menú de Chrome elegí *Agregar a la pantalla principal*. ⚠️ Sin verificar en un teléfono real.

**iPhone.** ⚠️ Acá hay una trampa conocida. El ícono de la pantalla de inicio guarda sus datos **aparte** de Safari. Si escaneás el QR, la configuración queda en Safari y el ícono arranca vacío. El orden que funciona hoy es:

1. Abrí <https://martinlleral.github.io/finanzas-v6> en Safari.
2. *Compartir → Agregar a inicio.*
3. Abrí la app **desde el ícono**. Va a estar en modo demo.
4. Adentro del ícono: **⚙️ → Cambiar URL**, y pegá primero la URL y después el token. Para tenerlos en el teléfono, mandátelos a vos misma por un chat o una nota.
5. Tocá **🩺 Probar conexión** y confirmá las tres ✅.

Desde ese momento usá siempre el ícono. Si alguna vez abrís la app en Safari, es otra copia con otros datos.

## Parte 4 · Sumar a otra persona de tu casa

Desde un dispositivo que ya funcione: **⚙️ → 📱 Configurar otro dispositivo**, y que escanee el QR. En iPhone vale lo mismo que en la parte 3.

> **El QR es la llave completa.** Quien lo escanee puede leer y escribir en tu
> planilla. Mostralo solo a quien quieras darle ese acceso.

---

## Si algo no anda

Lo primero es siempre **⚙️ → 🩺 Probar conexión**. El resultado se copia solo al portapapeles, listo para pegarlo en un chat a quien te esté ayudando. No incluye tu token ni tu URL.

| Qué ves | Qué suele ser | Qué hacer |
|---|---|---|
| «El token de acceso no coincide» | El token cargado no es el de tu puente | ⚙️ → Cambiar URL, y volver a pegar los dos datos |
| Lectura ❌ «respuesta ilegible» | La URL guardada no llega a tu puente | Repetir el paso 9 de la parte 1 con esa URL |
| El primer gasto no aparece en la app | La planilla no tiene los títulos en la fila 1 | Correr `instalar` (parte 1, paso 4) |
| Movimientos «sin subir» | No hay señal, o el token está mal | Nada se pierde: suben solos cuando se arregla |
| El ícono del iPhone está vacío y Safari no | Son dos copias separadas | Configurar adentro del ícono (parte 3) |

## Cuidar la llave

- **No compartas** la URL junto con el token, ni una captura del QR.
- **Si se filtró,** cambiá el token: en el editor del puente elegí `setupToken` y ▶ Ejecutar. Genera uno nuevo. Después hay que cargarlo de nuevo en cada dispositivo.
- **Para saber si hay token** sin verlo: `verificarToken`.

## Cuando salga una versión nueva

- **La app** se actualiza sola: es una página. En iPhone conviene cerrarla y volver a abrirla.
- **El puente** no se actualiza solo. Hay que pegar el archivo nuevo en el editor, guardar y publicar así: *Implementar → Administrar implementaciones → lápiz → Versión: Nueva versión → Implementar*. **No** uses «Nueva implementación»: crea otra URL y tus dispositivos seguirían hablando con el código viejo.
