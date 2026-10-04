# A4 Office для Яндекс Трекера

Точка входа — штатный слот `attachment.viewer.action`. Код получает Blob
вложения из `slotContext`, открывает ограниченный сеанс организации, а после
сохранения загружает файл через `trackerApi.v3.post["/attachments"]` и закрывает
слот с `{ replace: true }`.

Для живой проверки нужны организация Трекера и проект плагина Weavix. Секреты
не нужны в браузере: `sessionEndpoint` обязан проверять сессию на backend.
Документированный `slotContext.meta` не обещает исходное имя файла, поэтому UI
должен показать поле имени перед сохранением; выдумывать имя из URL нельзя.

Официальная схема слота:
<https://yandex.ru/support/tracker/ru/plugins/slots/attachment-viewer-action>.

