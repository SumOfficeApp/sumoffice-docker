# SumOffice for Odoo 18

Open the spreadsheets and documents attached in Odoo with the SumOffice editors, and save them back —
macros, defined names, queries and pictures come back byte for byte.

The module makes Odoo itself a WOPI host: `CheckFileInfo`, `GetFile`, `PutFile` and locking, with
signed access tokens whose signature is verified on every request. The editors run in your own Docker
(`hissih/sumsheet-webhost`, `hissih/sumdoc-webhost`); nothing about your files leaves your servers.

- Install: copy `sumoffice_wopi` into your addons path, update the apps list, install **SumOffice for Odoo**,
  then set the editor address in the module settings.
- Setup measured end to end: https://sumoffice.com/odoo.html
- Every host we measured: https://sumoffice.com/wopi.html
- Contact: hello@sumoffice.com

This branch holds the module at its root, as the Odoo Apps store expects for series 18.0.
